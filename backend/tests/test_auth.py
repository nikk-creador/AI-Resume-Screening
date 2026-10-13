import os
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException, Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.database import Base
from backend.app.auth import authenticate_user, hash_password, seed_demo_user
from backend.app.auth import send_auth_email
from backend.app.main import (
    EmailActionRequest,
    GoogleSignInRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenActionRequest,
    app,
    get_db,
    login,
    google_login,
    register_account,
    request_password_reset,
    reset_password,
    verify_account,
)
from backend.app.models import Company, CompanyMembership, Organization, OrganizationMembership, User


class GoogleSignInTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_password_reset_email_sends_supplied_html_through_sendgrid(self):
        action_url = "https://recruitai.example/reset-password?token=one-time-token"
        with patch.dict(
            "os.environ",
            {
                "SENDGRID_API_KEY": "test-sendgrid-key",
                "SENDGRID_FROM_EMAIL": "sender@example.test",
            },
        ), patch("backend.app.auth.SendGridAPIClient") as client_factory:
            client_factory.return_value.send.return_value.status_code = 202
            sent = send_auth_email(
                "recruiter@example.com",
                "Reset your RecruitAI password",
                action_url,
                password_reset=True,
            )
            message = client_factory.return_value.send.call_args.args[0].get()

        self.assertTrue(sent)
        self.assertEqual(message["from"]["email"], "sender@example.test")
        self.assertEqual(message["personalizations"][0]["to"][0]["email"], "recruiter@example.com")
        self.assertEqual(message["content"][1]["type"], "text/html")
        self.assertEqual(message["content"][1]["value"].count(action_url), 3)

    def test_verified_google_identity_creates_user_and_session_cookie(self):
        claims = {
            "email": "Recruiter@Example.com",
            "email_verified": True,
            "name": "Example Recruiter",
        }
        with Session(self.engine) as db, patch(
            "backend.app.main.verify_google_credential", return_value=claims
        ):
            response = Response()
            result = google_login(
                GoogleSignInRequest(credential="verified-google-token"), response, db
            )

            user = db.scalar(select(User).where(User.email == "recruiter@example.com"))
            self.assertIsNotNone(user)
            self.assertEqual(result["user"]["id"], user.id)
            self.assertEqual(result["user"]["full_name"], "Example Recruiter")
            self.assertIn("recruitai_session=", response.headers["set-cookie"])
            self.assertIn("httponly", response.headers["set-cookie"].lower())

    def test_google_identity_with_unverified_email_is_rejected(self):
        claims = {"email": "recruiter@example.com", "email_verified": False}
        with Session(self.engine) as db, patch(
            "backend.app.main.verify_google_credential", return_value=claims
        ):
            with self.assertRaises(HTTPException) as error:
                google_login(
                    GoogleSignInRequest(credential="unverified-google-token"), Response(), db
                )

        self.assertEqual(error.exception.status_code, 401)


class DemoUserSeedingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_demo_seed_requires_an_explicit_password(self):
        with patch.dict(os.environ, {"SEED_DEMO_USER": "true", "DEMO_USER_PASSWORD": ""}):
            with Session(self.engine) as db, self.assertRaisesRegex(
                RuntimeError, "DEMO_USER_PASSWORD"
            ):
                seed_demo_user(db)

    def test_demo_seed_uses_explicit_local_credentials(self):
        password = "unit-test-password"
        with patch.dict(
            os.environ,
            {
                "SEED_DEMO_USER": "true",
                "DEMO_USER_EMAIL": "demo@example.test",
                "DEMO_USER_PASSWORD": password,
            },
        ), Session(self.engine) as db:
            seed_demo_user(db)
            self.assertIsNotNone(authenticate_user(db, "demo@example.test", password))


class AccountLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_registration_requires_email_verification_before_login(self):
        with Session(self.engine) as db, patch(
            "backend.app.main.APP_ENV", "development"
        ), patch("backend.app.main.send_auth_email", return_value=False):
            result = register_account(
                RegisterRequest(
                    full_name="New Recruiter",
                    email="Recruiter@Example.com",
                    password="correct-horse-battery-staple",
                ),
                db,
            )
            user = db.scalar(select(User).where(User.email == "recruiter@example.com"))
            self.assertIsNotNone(user)
            self.assertFalse(user.is_verified)
            with self.assertRaises(HTTPException) as error:
                login(LoginRequest(email=user.email, password="correct-horse-battery-staple"), Response(), db)
            self.assertEqual(error.exception.status_code, 403)

            token = parse_qs(urlparse(result["action_url"]).query)["token"][0]
            verify_account(TokenActionRequest(token=token), db)
            self.assertTrue(user.is_verified)
            signed_in = login(
                LoginRequest(email=user.email, password="correct-horse-battery-staple"),
                Response(),
                db,
            )
            self.assertEqual(signed_in["user"]["id"], user.id)

    def test_password_reset_is_generic_and_link_cannot_be_reused(self):
        with Session(self.engine) as db, patch(
            "backend.app.main.APP_ENV", "development"
        ), patch("backend.app.main.send_auth_email", return_value=False):
            user = User(
                id="reset-user",
                email="recruiter@example.com",
                full_name="Recruiter",
                password_hash=hash_password("old-password-123"),
            )
            db.add(user)
            db.commit()

            known = request_password_reset(EmailActionRequest(email=user.email), db)
            unknown = request_password_reset(EmailActionRequest(email="missing@example.com"), db)
            self.assertEqual(known["message"], unknown["message"])
            token = parse_qs(urlparse(known["action_url"]).query)["token"][0]
            request = ResetPasswordRequest(token=token, password="new-password-456")
            reset_password(request, db)
            self.assertIsNotNone(authenticate_user(db, user.email, "new-password-456"))
            with self.assertRaises(HTTPException) as error:
                reset_password(request, db)
            self.assertEqual(error.exception.status_code, 400)

    def test_login_route_returns_company_list_in_user_payload(self):
        fd, db_path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        os.unlink(db_path)
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(engine)
        SessionFactory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        with SessionFactory() as db:
            organization = Organization(id="org-1", name="Example Org")
            company = Company(id="company-1", organization_id=organization.id, name="Example Company")
            user = User(
                id="user-1",
                email="recruiter@example.com",
                full_name="Recruiter",
                password_hash=hash_password("correct-horse-battery-staple"),
                is_verified=True,
                default_company_id=company.id,
            )
            db.add_all([organization, company, user])
            db.add_all([
                OrganizationMembership(
                    id="org-member-1",
                    organization_id=organization.id,
                    user_id=user.id,
                    role="admin",
                    status="active",
                    is_active=True,
                ),
                CompanyMembership(
                    id="company-member-1",
                    company_id=company.id,
                    user_id=user.id,
                    role="company_admin",
                    status="active",
                    can_view=True,
                    can_edit=True,
                    can_download=True,
                    can_manage_members=True,
                    is_active=True,
                ),
            ])
            db.commit()

        def override_get_db():
            with Session(bind=engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as client:
                response = client.post(
                    "/api/auth/login",
                    json={"email": "recruiter@example.com", "password": "correct-horse-battery-staple"},
                )
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertIsInstance(payload["user"]["companies"], list)
            self.assertEqual(len(payload["user"]["companies"]), 1)
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
            if os.path.exists(db_path):
                os.remove(db_path)