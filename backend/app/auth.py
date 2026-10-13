from datetime import datetime, timedelta, timezone
from html import escape
import hashlib
import os
from pathlib import Path
from uuid import uuid4

import jwt
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Content, Email, Mail, To
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from fastapi import Cookie, Depends, HTTPException, status
from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .database import get_db
from .models import Screening, User

SESSION_COOKIE = "recruitai_session"
SESSION_TTL_SECONDS = 60 * 60 * 8
ACTION_TOKEN_TTL_SECONDS = 60 * 30
PASSWORD_RESET_EMAIL_TEMPLATE = Path(__file__).resolve().parent / "templates" / "password_reset.html"
PASSWORD_HASHER = PasswordHash.recommended()
_DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash("not-a-valid-user-password")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
AUTH_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "recruitai-local-development-secret-change-before-deployment")
GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    os.getenv(
        "VITE_GOOGLE_CLIENT_ID",
        os.getenv("CLIENT_ID", "443288765564-ileiomf2qvgvl8t0renuqbtnsjuhnvdf.apps.googleusercontent.com"),
    ),
).strip()
if APP_ENV == "production" and AUTH_SECRET_KEY == "recruitai-local-development-secret-change-before-deployment":
    raise RuntimeError("Set AUTH_SECRET_KEY to a unique secret in production.")
if APP_ENV == "production" and (
    AUTH_SECRET_KEY.startswith("replace-with-") or len(AUTH_SECRET_KEY) < 32
):
    raise RuntimeError("AUTH_SECRET_KEY must be at least 32 characters and must not be a placeholder.")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def verify_password(password: str, password_hash: str) -> bool:
    return PASSWORD_HASHER.verify(password, password_hash)


def hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def create_session_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user.id, "iat": now, "exp": now + timedelta(seconds=SESSION_TTL_SECONDS)},
        AUTH_SECRET_KEY,
        algorithm="HS256",
    )


def create_action_token(user: User, purpose: str) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user.id,
        "purpose": purpose,
        "iat": now,
        "exp": now + timedelta(seconds=ACTION_TOKEN_TTL_SECONDS),
    }
    if purpose == "password_reset":
        claims["password_fingerprint"] = hashlib.sha256(user.password_hash.encode()).hexdigest()
    return jwt.encode(claims, AUTH_SECRET_KEY, algorithm="HS256")


def decode_action_token(token: str, purpose: str) -> dict:
    claims = jwt.decode(token, AUTH_SECRET_KEY, algorithms=["HS256"])
    if claims.get("purpose") != purpose or not isinstance(claims.get("sub"), str):
        raise jwt.InvalidTokenError("Invalid action token.")
    return claims


def send_auth_email(
    email: str,
    subject: str,
    action_url: str,
    *,
    password_reset: bool = False,
    invitation: bool = False,
) -> bool:
    api_key = os.getenv("SENDGRID_API_KEY", "").strip()
    from_email = os.getenv("SENDGRID_FROM_EMAIL", "").strip()
    if not api_key or not from_email:
        if APP_ENV == "production":
            raise RuntimeError("SendGrid email delivery is not configured.")
        return False

    plain_text = (
        "We received a request to reset your RecruitAI password.\n\n"
        f"Choose a new password using this secure link: {action_url}\n\n"
        "This link expires in 30 minutes and can only be used once. "
        "If you didn't request a password reset, you can ignore this email."
        if password_reset
        else (
            "You have been invited to join a RecruitAI hiring company.\n\n"
            f"Accept the invitation and set your password using this secure link: {action_url}\n\n"
            "This link expires in 72 hours and can only be used once."
        )
        if invitation
        else f"Use this link to verify your RecruitAI account. It expires in 30 minutes.\n\n{action_url}"
    )
    message = Mail(Email(from_email), To(email), subject, Content("text/plain", plain_text))
    if password_reset:
        html_template = PASSWORD_RESET_EMAIL_TEMPLATE.read_text(encoding="utf-8")
        html_content = html_template.replace("{{{reset_url}}}", escape(action_url, quote=True))
        message.add_content(Content("text/html", html_content))

    try:
        response = SendGridAPIClient(api_key=api_key).send(message)
    except Exception as error:
        raise RuntimeError("SendGrid email delivery failed.") from error
    if response.status_code != 202:
        raise RuntimeError(f"SendGrid did not accept the email (HTTP {response.status_code}).")
    return True


def verify_google_credential(credential: str) -> dict:
    return id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        GOOGLE_CLIENT_ID,
    )


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    valid_password = verify_password(password, user.password_hash if user else _DUMMY_PASSWORD_HASH)
    if user is None or not user.is_active or not valid_password:
        return None
    return user


def get_current_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Your session has expired. Sign in again.",
    )
    if not session_token:
        raise unauthorized
    try:
        payload = jwt.decode(session_token, AUTH_SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not isinstance(user_id, str):
            raise unauthorized
    except jwt.InvalidTokenError as error:
        raise unauthorized from error
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    return user


def get_optional_current_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: Session = Depends(get_db),
) -> User | None:
    if not session_token:
        return None
    try:
        payload = jwt.decode(session_token, AUTH_SECRET_KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        return None
    user = db.get(User, user_id)
    return user if user is not None and user.is_active else None


def seed_demo_user(db: Session) -> None:
    if APP_ENV == "production" or os.getenv("SEED_DEMO_USER", "true").lower() not in {"1", "true", "yes"}:
        return
    email = normalize_email(os.getenv("DEMO_USER_EMAIL", "demo@recruitai.local"))
    password = os.getenv("DEMO_USER_PASSWORD", "RecruitAI-Demo-2026!")
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            id=str(uuid4()),
            email=email,
            full_name="RecruitAI Demo",
            password_hash=hash_password(password),
            is_verified=True,
        )
        db.add(user)
        db.flush()
    db.execute(
        update(Screening).where(Screening.owner_id.is_(None)).values(owner_id=user.id)
    )
    db.commit()
