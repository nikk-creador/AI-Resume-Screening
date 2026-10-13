import hashlib
from pathlib import Path
import tempfile
from urllib.parse import parse_qs, urlparse
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.orm import Session

from backend.app.auth import hash_password
from backend.app.database import Base, backfill_organization_schema, migrate_screening_schema
from backend.app.main import (
    AcceptCompanyInvitationRequest,
    CompanyCreateRequest,
    InviteCompanyMemberRequest,
    UpdateCompanyMemberRequest,
    archive_company,
    accept_company_invitation,
    create_company,
    download_resume,
    get_invitation,
    invite_company_member,
    list_screenings,
    update_company_member,
    update_screening,
    UpdateScreeningRequest,
    resend_company_invitation,
    restore_company,
)
from backend.app.models import (
    AuditLog,
    Company,
    CompanyInvitation,
    CompanyMembership,
    Organization,
    OrganizationMembership,
    Screening,
    Resume,
    User,
)
from backend.app.tenancy import create_default_tenant, get_company_user


class OrganizationTenancyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        event.listen(
            self.engine,
            "connect",
            lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"),
        )
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def create_user(self, db, user_id, email, full_name):
        user = User(
            id=user_id,
            email=email,
            full_name=full_name,
            password_hash=hash_password("correct-horse-battery-staple"),
            is_verified=True,
        )
        db.add(user)
        db.flush()
        company = create_default_tenant(db, user)
        db.commit()
        return user, company

    def test_company_scope_does_not_inherit_parent_organization_access(self):
        with Session(self.engine) as db:
            owner, company_a = self.create_user(db, "tenant-a", "a@example.com", "Company A")
            other_user, default_b = self.create_user(db, "tenant-b", "b@example.com", "Company B")
            company_b = Company(
                id=str(uuid4()),
                organization_id=company_a.organization_id,
                parent_company_id=company_a.id,
                name="Subsidiary B",
            )
            db.add(company_b)
            db.flush()
            other_user.default_company_id = company_b.id
            membership_b = db.scalar(
                select(CompanyMembership).where(
                    CompanyMembership.user_id == other_user.id,
                    CompanyMembership.company_id == default_b.id,
                )
            )
            membership_b.company_id = company_b.id
            db.add_all(
                [
                    Screening(
                        id="screening-a", owner_id=owner.id, company_id=company_a.id,
                        name="A confidential", job_description_text="A role",
                    ),
                    Screening(
                        id="screening-b", owner_id=other_user.id, company_id=company_b.id,
                        name="B confidential", job_description_text="B role",
                    ),
                ]
            )
            db.commit()

            scoped_owner = get_company_user(company_a.id, db, owner)
            results_a = list_screenings(0, 10, "", db, scoped_owner)
            self.assertEqual([item["name"] for item in results_a["screenings"]], ["A confidential"])

            with self.assertRaises(HTTPException) as error:
                get_company_user(company_b.id, db, owner)
            self.assertEqual(error.exception.status_code, 404)

    def test_view_only_member_cannot_edit_and_can_be_granted_download_access(self):
        with Session(self.engine) as db:
            admin, company = self.create_user(db, "admin", "admin@example.com", "Admin User")
            reader = User(
                id="reader", email="reader@example.com", full_name="Reader User",
                password_hash=hash_password("correct-horse-battery-staple"), is_verified=True,
            )
            db.add(reader)
            db.flush()
            membership = CompanyMembership(
                id=str(uuid4()), company_id=company.id, user_id=reader.id,
                role="viewer", can_view=True, can_edit=False, can_download=False,
                can_manage_members=False,
            )
            db.add(membership)
            db.add(Screening(
                id="screening-edit-denied", owner_id=admin.id, company_id=company.id,
                job_description_text="Existing job description",
            ))
            db.commit()

            scoped_admin = get_company_user(company.id, db, admin)
            scoped_reader = get_company_user(company.id, db, reader)
            with self.assertRaises(HTTPException) as error:
                update_company_member(
                    company.id, reader.id,
                    UpdateCompanyMemberRequest(can_download=True), db, scoped_reader,
                )
            self.assertEqual(error.exception.status_code, 403)

            with self.assertRaises(HTTPException) as denied:
                update_screening(
                    "screening-edit-denied",
                    UpdateScreeningRequest(
                        name="Changed job", job_description_text="This should not be saved.", criteria=[]
                    ),
                    db,
                    scoped_reader,
                )
            self.assertEqual(denied.exception.status_code, 403)

            updated = update_company_member(
                company.id, reader.id,
                UpdateCompanyMemberRequest(can_download=True), db,
                scoped_admin,
            )
            self.assertTrue(updated["permissions"]["download"])
            self.assertFalse(updated["permissions"]["edit"])

    def test_resume_download_requires_capability_and_writes_audit_event(self):
        with Session(self.engine) as db:
            admin, company = self.create_user(db, "download-admin", "download-admin@example.com", "Download Admin")
            viewer = User(
                id="download-viewer", email="download-viewer@example.com", full_name="Download Viewer",
                password_hash=hash_password("correct-horse-battery-staple"), is_verified=True,
            )
            screening = Screening(
                id="download-screening", owner_id=admin.id, company_id=company.id,
                name="Download test", job_description_text="Role",
            )
            resume = Resume(
                id="download-resume", screening_id=screening.id, filename="candidate.pdf",
                content_type="application/pdf", size_bytes=7, storage_name="candidate.pdf",
            )
            membership = CompanyMembership(
                id=str(uuid4()), company_id=company.id, user_id=viewer.id,
                role="viewer", can_view=True, can_edit=False,
                can_download=False, can_manage_members=False,
            )
            db.add(viewer)
            db.flush()
            db.add(screening)
            db.flush()
            db.add_all([resume, membership])
            db.commit()
            scoped_viewer = get_company_user(company.id, db, viewer)
            with self.assertRaises(HTTPException) as denied:
                download_resume(resume.id, db, scoped_viewer)
            self.assertEqual(denied.exception.status_code, 403)

            membership.can_download = True
            db.commit()
            with tempfile.TemporaryDirectory() as storage:
                (Path(storage) / resume.storage_name).write_bytes(b"resume")
                with patch("backend.app.main.UPLOAD_DIR", Path(storage)):
                    response = download_resume(resume.id, db, get_company_user(company.id, db, viewer))
            self.assertEqual(Path(response.path), Path(storage) / resume.storage_name)
            self.assertIsNotNone(db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "resume.downloaded",
                    AuditLog.resource_id == resume.id,
                )
            ))

    def test_invitation_creates_verified_account_and_is_single_use(self):
        with Session(self.engine) as db:
            admin, company = self.create_user(db, "inviter", "inviter@example.com", "Hiring Admin")
            scoped_admin = get_company_user(company.id, db, admin)
            with patch("backend.app.main.send_auth_email", return_value=False):
                created = invite_company_member(
                    company.id,
                    InviteCompanyMemberRequest(
                        email="new.member@example.com", can_view=True,
                        can_edit=True, can_download=False,
                    ),
                    db,
                    scoped_admin,
                )
            token = parse_qs(urlparse(created["action_url"]).query)["token"][0]
            invite_details = get_invitation(token, db)
            self.assertEqual(invite_details["company_name"], company.name)
            self.assertTrue(invite_details["permissions"]["edit"])

            result = accept_company_invitation(
                AcceptCompanyInvitationRequest(
                    token=token,
                    full_name="New Member",
                    password="new-member-password-123",
                ),
                Response(),
                db,
            )
            member = db.scalar(select(User).where(User.email == "new.member@example.com"))
            membership = db.scalar(
                select(CompanyMembership).where(
                    CompanyMembership.company_id == company.id,
                    CompanyMembership.user_id == member.id,
                )
            )
            self.assertEqual(result["user"]["id"], member.id)
            self.assertTrue(member.is_verified)
            self.assertTrue(membership.can_edit)
            self.assertFalse(membership.can_download)
            self.assertIsNotNone(db.scalar(select(AuditLog).where(AuditLog.action == "invitation.accepted")))
            with self.assertRaises(HTTPException) as error:
                accept_company_invitation(
                    AcceptCompanyInvitationRequest(token=token, password="new-member-password-123"),
                    Response(),
                    db,
                )
            self.assertEqual(error.exception.status_code, 400)

    def test_resend_rotates_invitation_token_and_expiry(self):
        with Session(self.engine) as db:
            admin, company = self.create_user(db, "resend-admin", "resend@example.com", "Resend Admin")
            scoped_admin = get_company_user(company.id, db, admin)
            with patch("backend.app.main.send_auth_email", return_value=False):
                created = invite_company_member(
                    company.id,
                    InviteCompanyMemberRequest(email="new@example.com"),
                    db,
                    scoped_admin,
                )
                first_token = parse_qs(urlparse(created["action_url"]).query)["token"][0]
                resent = resend_company_invitation(
                    company.id,
                    created["invitation"]["id"],
                    db,
                    scoped_admin,
                )
            second_token = parse_qs(urlparse(resent["action_url"]).query)["token"][0]
            self.assertNotEqual(first_token, second_token)
            self.assertGreater(resent["invitation"]["expires_at"], created["invitation"]["expires_at"])
            with self.assertRaises(HTTPException):
                get_invitation(first_token, db)
            self.assertEqual(get_invitation(second_token, db)["email"], "new@example.com")

    def test_signed_in_oauth_member_accepts_without_password_change(self):
        with Session(self.engine) as db:
            admin, company = self.create_user(db, "oauth-inviter", "oauth-inviter@example.com", "Inviter")
            oauth_user = User(
                id="oauth-member",
                email="oauth-member@example.com",
                full_name="OAuth Member",
                password_hash=hash_password("unavailable-random-password"),
                is_verified=True,
            )
            db.add(oauth_user)
            db.flush()
            scoped_admin = get_company_user(company.id, db, admin)
            with patch("backend.app.main.send_auth_email", return_value=False):
                created = invite_company_member(
                    company.id,
                    InviteCompanyMemberRequest(email=oauth_user.email),
                    db,
                    scoped_admin,
                )
            token = parse_qs(urlparse(created["action_url"]).query)["token"][0]
            accepted = accept_company_invitation(
                AcceptCompanyInvitationRequest(token=token),
                Response(),
                db,
                oauth_user,
            )
            self.assertEqual(accepted["user"]["id"], oauth_user.id)
            self.assertIsNotNone(db.scalar(
                select(CompanyMembership).where(
                    CompanyMembership.company_id == company.id,
                    CompanyMembership.user_id == oauth_user.id,
                    CompanyMembership.is_active.is_(True),
                )
            ))

    def test_archive_blocks_parent_with_active_children_and_restore_reopens_access(self):
        with Session(self.engine) as db:
            admin, parent = self.create_user(db, "archive-admin", "archive@example.com", "Archive Admin")
            child = create_company(
                parent.organization_id,
                CompanyCreateRequest(name="Child company", parent_company_id=parent.id),
                db,
                admin,
            )
            sibling = create_company(
                parent.organization_id,
                CompanyCreateRequest(name="Sibling company"),
                db,
                admin,
            )
            with self.assertRaises(HTTPException) as blocked:
                archive_company(parent.id, db, admin)
            self.assertEqual(blocked.exception.status_code, 409)

            archive_company(child["id"], db, admin)
            archive_company(parent.id, db, admin)
            with self.assertRaises(HTTPException) as denied:
                get_company_user(parent.id, db, admin)
            self.assertEqual(denied.exception.status_code, 404)
            restore_company(parent.id, db, admin)
            self.assertEqual(get_company_user(parent.id, db, admin).active_company_id, parent.id)
            self.assertIsNotNone(db.get(Company, sibling["id"]))

    def test_organization_admin_can_create_nested_company(self):
        with Session(self.engine) as db:
            admin, parent = self.create_user(db, "org-admin", "org-admin@example.com", "Org Admin")
            result = create_company(
                parent.organization_id,
                CompanyCreateRequest(name="New subsidiary", parent_company_id=parent.id),
                db,
                admin,
            )
            created = db.get(Company, result["id"])
            self.assertEqual(created.parent_company_id, parent.id)
            self.assertEqual(created.organization_id, parent.organization_id)
            self.assertIsNotNone(db.scalar(
                select(CompanyMembership).where(
                    CompanyMembership.company_id == created.id,
                    CompanyMembership.user_id == admin.id,
                    CompanyMembership.can_manage_members.is_(True),
                )
            ))

    def test_startup_backfill_is_idempotent_and_assigns_legacy_screenings(self):
        with Session(self.engine) as db:
            user = User(
                id="legacy-user", email="legacy@example.com", full_name="Legacy User",
                password_hash=hash_password("correct-horse-battery-staple"),
            )
            screening = Screening(
                id="legacy-screening", owner_id=user.id,
                name="Legacy screening", job_description_text="Legacy role",
            )
            db.add(user)
            db.flush()
            db.add(screening)
            db.commit()

        backfill_organization_schema(self.engine)
        backfill_organization_schema(self.engine)

        with Session(self.engine) as db:
            user = db.get(User, "legacy-user")
            screening = db.get(Screening, "legacy-screening")
            self.assertIsNotNone(user.default_company_id)
            self.assertEqual(screening.company_id, user.default_company_id)
            self.assertEqual(db.scalar(select(func.count()).select_from(Organization)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(OrganizationMembership)), 1)

    def test_legacy_database_migration_adds_company_columns_before_backfill(self):
        legacy_engine = create_engine("sqlite:///:memory:")
        try:
            with legacy_engine.begin() as connection:
                connection.execute(text(
                    "CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, email VARCHAR(320) NOT NULL, "
                    "full_name VARCHAR(120) NOT NULL, password_hash VARCHAR(512) NOT NULL, "
                    "is_active BOOLEAN NOT NULL, is_verified BOOLEAN NOT NULL, created_at DATETIME NOT NULL)"
                ))
                connection.execute(text(
                    "CREATE TABLE screenings (id VARCHAR(36) PRIMARY KEY, name VARCHAR(160) NOT NULL, "
                    "owner_id VARCHAR(36), created_at DATETIME NOT NULL, job_description_text TEXT NOT NULL, "
                    "job_requirements JSON, scoring_config JSON, job_description_filename VARCHAR(255), "
                    "job_description_content_type VARCHAR(120), job_description_storage_name VARCHAR(80))"
                ))
                connection.execute(text(
                    "INSERT INTO users (id, email, full_name, password_hash, is_active, is_verified, created_at) "
                    "VALUES ('legacy-db-user', 'legacy-db@example.com', 'Legacy DB', 'hash', 1, 1, CURRENT_TIMESTAMP)"
                ))
                connection.execute(text(
                    "INSERT INTO screenings (id, name, owner_id, created_at, job_description_text) "
                    "VALUES ('legacy-db-screening', 'Old screening', 'legacy-db-user', CURRENT_TIMESTAMP, 'Role')"
                ))

            Base.metadata.create_all(legacy_engine)
            migrate_screening_schema(legacy_engine)
            backfill_organization_schema(legacy_engine)
            with Session(legacy_engine) as db:
                user = db.get(User, "legacy-db-user")
                screening = db.get(Screening, "legacy-db-screening")
                self.assertIsNotNone(user.default_company_id)
                self.assertEqual(screening.company_id, user.default_company_id)
        finally:
            legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()