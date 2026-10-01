from datetime import datetime, timedelta, timezone
import os
from uuid import uuid4

import jwt
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
        )
        db.add(user)
        db.flush()
    db.execute(
        update(Screening).where(Screening.owner_id.is_(None)).values(owner_id=user.id)
    )
    db.commit()
