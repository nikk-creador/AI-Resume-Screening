import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.database import Base
from backend.app.main import GoogleSignInRequest, google_login
from backend.app.models import User


class GoogleSignInTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

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