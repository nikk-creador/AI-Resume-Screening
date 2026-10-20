import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy import DateTime, Integer, JSON, String, create_engine, inspect, text
from sqlalchemy import Boolean
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("DATA_DIR", BACKEND_DIR / "data"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BACKEND_DIR / "storage")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'screening.db').as_posix()}")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def migrate_screening_schema(bind=engine) -> None:
    migrations = {
        "screenings": {
            "name": String(160),
            "owner_id": String(36),
            "company_id": String(36),
            "job_requirements": JSON(),
            "scoring_config": JSON(),
        },
        "resume_evaluations": {
            "available_at": DateTime(timezone=True),
            "job_match_score": Integer(),
            "preferred_score": Integer(),
            "bonus_points": Integer(),
            "required_checks_passed": Boolean(),
            "required_checks": JSON(),
            "job_evidence": JSON(),
            "matching_details": JSON(),
            "reviewer_override_score": Integer(),
            "reviewer_override_note": String(),
            "reviewer_id": String(36),
            "reviewer_updated_at": DateTime(timezone=True),
        },
        "resumes": {
            "language_code": String(12),
            "structured_profile": JSON(),
            "pipeline_stage": String(20),
            "content_sha256": String(64),
            "duplicate_of_resume_id": String(36),
            "duplicate_of_filename": String(255),
            "duplicate_reason": String(80),
        },
        "users": {"is_verified": Boolean(), "default_company_id": String(36)},
        "organizations": {"is_active": Boolean(), "created_at": DateTime(timezone=True)},
        "companies": {
            "organization_id": String(36),
            "parent_company_id": String(36),
            "name": String(160),
            "is_active": Boolean(),
            "created_at": DateTime(timezone=True),
        },
        "organization_memberships": {
            "organization_id": String(36),
            "user_id": String(36),
            "role": String(32),
            "is_active": Boolean(),
            "created_at": DateTime(timezone=True),
        },
        "company_memberships": {
            "company_id": String(36),
            "user_id": String(36),
            "role": String(32),
            "can_view": Boolean(),
            "can_edit": Boolean(),
            "can_download": Boolean(),
            "can_manage_members": Boolean(),
            "is_active": Boolean(),
            "created_at": DateTime(timezone=True),
        },
        "company_invitations": {
            "company_id": String(36),
            "email": String(320),
            "token_digest": String(64),
            "invited_by_id": String(36),
            "role": String(32),
            "can_view": Boolean(),
            "can_edit": Boolean(),
            "can_download": Boolean(),
            "can_manage_members": Boolean(),
            "expires_at": DateTime(timezone=True),
            "accepted_at": DateTime(timezone=True),
            "revoked_at": DateTime(timezone=True),
            "created_at": DateTime(timezone=True),
        },
        "audit_logs": {
            "organization_id": String(36),
            "company_id": String(36),
            "actor_id": String(36),
            "action": String(80),
            "resource_type": String(80),
            "resource_id": String(36),
            "details": JSON(),
            "created_at": DateTime(timezone=True),
        },
    }
    added_columns: set[tuple[str, str]] = set()
    with bind.begin() as connection:
        # API and worker startup can run at the same time. Serialize inspection
        # and ALTERs so every process sees schema changes committed by its peers.
        if bind.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(1779032110, 1)"))
        inspector = inspect(connection)
        for table_name, new_columns in migrations.items():
            if not inspector.has_table(table_name):
                continue
            existing = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, column_type in new_columns.items():
                if column_name in existing:
                    continue
                if table_name == "screenings" and column_name == "name":
                    connection.execute(
                        text("ALTER TABLE screenings ADD COLUMN name VARCHAR(160)")
                    )
                    connection.execute(
                        text(
                            "UPDATE screenings SET name = 'Screening ' || id "
                            "WHERE name IS NULL OR trim(name) = ''"
                        )
                    )
                    continue
                if table_name == "users" and column_name == "is_verified":
                    connection.execute(
                        text("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT TRUE")
                    )
                    continue
                if table_name == "resumes" and column_name == "pipeline_stage":
                    connection.execute(
                        text(
                            "ALTER TABLE resumes ADD COLUMN pipeline_stage "
                            "VARCHAR(20) NOT NULL DEFAULT 'new'"
                        )
                    )
                    continue
                if table_name in {"organization_memberships", "company_memberships"} and column_name == "is_active":
                    connection.execute(
                        text(
                            f"ALTER TABLE {table_name} ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE"
                        )
                    )
                    added_columns.add((table_name, column_name))
                    continue
                compiled_type = column_type.compile(dialect=bind.dialect)
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} "
                        f"ADD COLUMN {column_name} {compiled_type}"
                    )
                )
                added_columns.add((table_name, column_name))

        # Older tenant tables used status/token_hash/invited_by/user_id names.
        # Copy values into the current model columns before the application uses them.
        legacy_backfills = {
            ("organization_memberships", "is_active"): "CASE WHEN lower(coalesce(status, '')) IN ('active', 'accepted') THEN TRUE ELSE FALSE END",
            ("company_memberships", "is_active"): "CASE WHEN lower(coalesce(status, '')) IN ('active', 'accepted') THEN TRUE ELSE FALSE END",
            ("company_invitations", "token_digest"): "token_hash",
            ("company_invitations", "invited_by_id"): "invited_by",
            ("company_invitations", "accepted_at"): "CASE WHEN lower(coalesce(status, '')) = 'accepted' THEN created_at END",
            ("company_invitations", "revoked_at"): "CASE WHEN lower(coalesce(status, '')) IN ('revoked', 'cancelled') THEN created_at END",
            ("audit_logs", "actor_id"): "user_id",
        }
        for (table_name, target_column), expression in legacy_backfills.items():
            if (table_name, target_column) not in added_columns:
                continue
            columns = {column["name"] for column in inspect(connection).get_columns(table_name)}
            source_column = expression if expression.isidentifier() else None
            if source_column is not None and source_column not in columns:
                continue
            where_null = "" if target_column == "is_active" else f" WHERE {target_column} IS NULL"
            connection.execute(
                text(f"UPDATE {table_name} SET {target_column} = {expression}{where_null}")
            )
        if inspector.has_table("screenings"):
            # Use the same transaction connection for catalog reads. A separate
            # connection blocks on PostgreSQL's catalog locks held by our own
            # uncommitted ALTER TABLE statements, leaving startup stuck forever.
            screening_columns = {
                column["name"] for column in inspect(connection).get_columns("screenings")
            }
            if "name" in screening_columns:
                connection.execute(
                    text(
                        "UPDATE screenings SET name = 'Screening ' || id "
                        "WHERE name IS NULL OR trim(name) = ''"
                    )
                )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_screenings_owner_id ON screenings (owner_id)")
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_screenings_company_id ON screenings (company_id)")
            )
        if inspect(connection).has_table("company_invitations"):
            invitation_columns = {
                column["name"] for column in inspect(connection).get_columns("company_invitations")
            }
            if "token_digest" in invitation_columns:
                connection.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_company_invitations_token_digest "
                        "ON company_invitations (token_digest)"
                    )
                )


def backfill_organization_schema(bind=engine) -> None:
    from sqlalchemy import select

    from .models import (
        Company,
        CompanyMembership,
        Organization,
        OrganizationMembership,
        Screening,
        User,
    )

    with Session(bind) as session:
        users = session.scalars(select(User)).all()
        for user in users:
            company = session.get(Company, user.default_company_id) if user.default_company_id else None
            if company is None:
                organization = Organization(
                    id=str(uuid4()),
                    name=f"{user.full_name}'s Organization"[:160],
                )
                company = Company(
                    id=str(uuid4()),
                    organization_id=organization.id,
                    name=f"{user.full_name}'s Company"[:160],
                )
                session.add(organization)
                session.flush()
                session.add(company)
                session.flush()
                user.default_company_id = company.id

            if session.scalar(
                select(OrganizationMembership.id).where(
                    OrganizationMembership.organization_id == company.organization_id,
                    OrganizationMembership.user_id == user.id,
                )
            ) is None:
                session.add(
                    OrganizationMembership(
                        id=str(uuid4()),
                        organization_id=company.organization_id,
                        user_id=user.id,
                        role="admin",
                        status="active",
                    )
                )
            if session.scalar(
                select(CompanyMembership.id).where(
                    CompanyMembership.company_id == company.id,
                    CompanyMembership.user_id == user.id,
                )
            ) is None:
                session.add(
                    CompanyMembership(
                        id=str(uuid4()),
                        company_id=company.id,
                        user_id=user.id,
                        role="company_admin",
                        status="active",
                        can_view=True,
                        can_edit=True,
                        can_download=True,
                        can_manage_members=True,
                    )
                )
            session.execute(
                Screening.__table__.update()
                .where(Screening.owner_id == user.id, Screening.company_id.is_(None))
                .values(company_id=company.id)
            )

        session.commit()


def get_db():
    with SessionLocal() as session:
        yield session
