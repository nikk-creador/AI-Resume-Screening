import os
from pathlib import Path

from sqlalchemy import DateTime, Integer, JSON, String, create_engine, inspect, text
from sqlalchemy import Boolean
from sqlalchemy.orm import DeclarativeBase, sessionmaker


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
        "resumes": {"language_code": String(12), "structured_profile": JSON()},
    }
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
                compiled_type = column_type.compile(dialect=bind.dialect)
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} "
                        f"ADD COLUMN {column_name} {compiled_type}"
                    )
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


def get_db():
    with SessionLocal() as session:
        yield session
