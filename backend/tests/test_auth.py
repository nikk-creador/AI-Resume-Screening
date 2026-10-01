import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.database import Base
from backend.app.auth import authenticate_user, hash_password
from backend.app.auth import send_auth_email
from backend.app.main import (
    EmailActionRequest,
    GoogleSignInRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenActionRequest,
    login,
    google_login,
    register_account,
    request_password_reset,
    reset_password,
    verify_account,
)
from backend.app.models import User


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
                "SENDGRID_API_KEY": "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",
                "SENDGRID_FROM_EMAIL": "nbnik17@gmail.com",
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
        self.assertEqual(message["from"]["email"], "nbnik17@gmail.com")
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