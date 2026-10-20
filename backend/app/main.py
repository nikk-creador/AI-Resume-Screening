from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import hmac
from io import BytesIO
import json
import os
from pathlib import Path
import re
import secrets
from threading import Event, Thread
from typing import Any, Literal
from uuid import uuid4
from urllib.parse import quote

from google.auth.exceptions import GoogleAuthError
import jwt
from docx import Document
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import case, func, select, text, update
from sqlalchemy.orm import Session, selectinload

from .auth import (
    APP_ENV,
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    authenticate_user,
    create_action_token,
    create_session_token,
    decode_action_token,
    get_current_user,
    get_optional_current_user,
    hash_password,
    normalize_email,
    seed_demo_user,
    send_auth_email,
    verify_google_credential,
)
from .database import (
    Base,
    SessionLocal,
    UPLOAD_DIR,
    backfill_organization_schema,
    engine,
    get_db,
    migrate_screening_schema,
)
from .evaluation import EvaluationCriterion, extract_pdf_text, suggest_criteria, test_ai_service
from .matching import JobRequirement, MatchingWeights, default_matching_weights
from .models import (
    AuditLog,
    CandidateAssignment,
    CandidateReview,
    Company,
    CompanyInvitation,
    CompanyMembership,
    Organization,
    OrganizationMembership,
    Resume,
    ResumeEvaluation,
    Screening,
    ScreeningRubric,
    ScreeningTemplate,
    User,
)
from .tenancy import (
    company_access_payload,
    create_default_tenant,
    get_company_user,
    invitation_expiry,
    require_company_permission,
    screening_company_scope,
    write_audit_log,
)
from .worker import run_worker

MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_JOB_DESCRIPTION_CHARS = 10_000
MIN_JOB_DESCRIPTION_WORDS = 20
RESUME_EXTENSIONS = {".pdf", ".docx"}
JOB_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_RESUMES_PER_BATCH = 10
MAX_EVALUATION_CRITERIA = 20


class BulkDeleteResumes(BaseModel):
    resume_ids: list[str]


class OrganizationCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    initial_company_name: str = Field(min_length=2, max_length=160)


class CompanyCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    parent_company_id: str | None = None


class InviteCompanyMemberRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    can_view: bool = True
    can_edit: bool = False
    can_download: bool = False
    can_manage_members: bool = False


class UpdateCompanyMemberRequest(BaseModel):
    can_view: bool | None = None
    can_edit: bool | None = None
    can_download: bool | None = None
    can_manage_members: bool | None = None


class AcceptCompanyInvitationRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    password: str | None = Field(default=None, min_length=12, max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)


class EmailActionRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class TokenActionRequest(BaseModel):
    token: str = Field(min_length=1, max_length=4096)


class ResetPasswordRequest(TokenActionRequest):
    password: str = Field(min_length=12, max_length=256)


class GoogleSignInRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)


class UpdateScreeningRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    job_description_text: str = Field(min_length=1, max_length=MAX_JOB_DESCRIPTION_CHARS)
    criteria: list[dict] | None = Field(default=None, max_length=MAX_EVALUATION_CRITERIA)


class UpdateRequirementsRequest(BaseModel):
    requirements: list[JobRequirement] = Field(min_length=1, max_length=40)


class ScreeningTemplateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    criteria: list[EvaluationCriterion] = Field(default_factory=list, max_length=MAX_EVALUATION_CRITERIA)
    job_requirements: list[JobRequirement] = Field(default_factory=list, max_length=40)
    scoring_config: MatchingWeights | None = None


class ReviewOverrideRequest(BaseModel):
    score: int = Field(ge=0, le=100)
    note: str = Field(min_length=3, max_length=2000)


class CandidateAssignmentRequest(BaseModel):
    reviewer_ids: list[str] = Field(default_factory=list, max_length=20)


class CandidateTeamReviewRequest(BaseModel):
    score: int = Field(ge=0, le=100)
    note: str = Field(min_length=3, max_length=2000)


class UpdatePipelineStageRequest(BaseModel):
    stage: Literal["new", "in_review", "interview", "decision"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_screening_schema(engine)
    with SessionLocal() as db:
        seed_demo_user(db)
    backfill_organization_schema(engine)
    worker_stop = Event()
    worker_thread = None
    if os.getenv("RUN_EVALUATION_WORKER", "true").strip().lower() not in {"0", "false", "no"}:
        worker_thread = Thread(
            target=run_worker,
            kwargs={"stop_event": worker_stop, "initialize": False, "recover": True},
            name="resume-evaluation-worker",
            daemon=True,
        )
        worker_thread.start()
    try:
        yield
    finally:
        worker_stop.set()
        if worker_thread is not None:
            worker_thread.join(timeout=5)


app = FastAPI(
    title="RecruitAI Resume Screening API",
    version="0.3.0",
    description="API for storing resume screening sessions and uploaded documents.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def count_words(value: str) -> int:
    return len(re.findall(r"\b[\w]+(?:['-][\w]+)*\b", value, flags=re.UNICODE))


def safe_filename(upload: UploadFile) -> str:
    raw_name = (upload.filename or "").replace("\\", "/")
    filename = Path(raw_name).name.strip()
    if not filename or filename in {".", ".."}:
        raise HTTPException(status_code=400, detail="Every uploaded file must have a filename.")
    return filename[:255]


async def read_upload(upload: UploadFile, allowed_extensions: set[str]) -> tuple[str, bytes]:
    filename = safe_filename(upload)
    if Path(filename).suffix.lower() not in allowed_extensions:
        allowed = ", ".join(sorted(allowed_extensions))
        raise HTTPException(status_code=415, detail=f"{filename}: supported file types are {allowed}.")
    content = await upload.read(MAX_FILE_SIZE + 1)
    if not content:
        raise HTTPException(status_code=400, detail=f"{filename}: the file is empty.")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"{filename}: files must be 10 MB or smaller.")
    return filename, content


def extract_job_description(filename: str, content: bytes) -> str:
    extension = Path(filename).suffix.lower()
    try:
        if extension == ".txt":
            return content.decode("utf-8-sig")
        if extension == ".pdf":
            return extract_pdf_text(content)
        if extension == ".docx":
            document = Document(BytesIO(content))
            parts = [paragraph.text for paragraph in document.paragraphs]
            parts.extend(cell.text for table in document.tables for row in table.rows for cell in row.cells)
            return "\n".join(parts)
    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail="Could not read text from the job description file. Use a searchable PDF, DOCX, or plain text file.",
        ) from error
    raise HTTPException(status_code=415, detail="Use a PDF, DOCX, or TXT job description.")


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def auth_user_payload(db: Session, user: User) -> dict:
    memberships = db.execute(
        select(CompanyMembership, Company, Organization)
        .join(Company, Company.id == CompanyMembership.company_id)
        .join(Organization, Organization.id == Company.organization_id)
        .where(
            CompanyMembership.user_id == user.id,
            CompanyMembership.is_active.is_(True),
            Company.is_active.is_(True),
            Organization.is_active.is_(True),
        )
        .order_by(Organization.name, Company.name)
    ).all()
    organization_roles = {
        membership.organization_id: membership.role
        for membership in db.scalars(
            select(OrganizationMembership).where(
                OrganizationMembership.user_id == user.id,
                OrganizationMembership.is_active.is_(True),
            )
        ).all()
    }
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "default_company_id": user.default_company_id,
        "companies": [
            company_access_payload(
                membership, company, organization, organization_roles.get(organization.id)
            )
            for membership, company, organization in memberships
        ],
    }


def require_selected_company(user: User, company_id: str) -> None:
    if getattr(user, "active_company_id", None) != company_id:
        raise HTTPException(status_code=404, detail="Company not found.")


def membership_role(can_view: bool, can_edit: bool, can_download: bool, can_manage_members: bool) -> str:
    if can_view and can_edit and can_download and can_manage_members:
        return "company_admin"
    if can_edit:
        return "recruiter"
    return "viewer"


def invitation_payload(invitation: CompanyInvitation) -> dict:
    return {
        "id": invitation.id,
        "email": invitation.email,
        "role": invitation.role,
        "permissions": {
            "view": invitation.can_view,
            "edit": invitation.can_edit,
            "download": invitation.can_download,
            "manage_members": invitation.can_manage_members,
        },
        "expires_at": iso_utc(invitation.expires_at),
    }


def deliver_company_invitation(
    db: Session,
    invitation: CompanyInvitation,
    company: Company,
    raw_token: str,
) -> str | None:
    action_url = auth_action_url("/accept-invitation", raw_token)
    try:
        send_auth_email(
            invitation.email,
            f"Join {company.name} on RecruitAI",
            action_url,
            invitation=True,
        )
    except (OSError, RuntimeError, ValueError) as error:
        invitation.revoked_at = datetime.now(timezone.utc)
        invitation.status = "revoked"
        db.commit()
        raise HTTPException(
            status_code=503,
            detail="Invitation email could not be sent. Try again later.",
        ) from error
    return action_url if APP_ENV != "production" else None


@app.post("/api/ai/test", tags=["ai"])
def ai_test(_: User = Depends(get_current_user)):
    try:
        model, latency_ms = test_ai_service()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"ok": True, "model": model, "latency_ms": latency_ms}


def auth_action_url(path: str, token: str) -> str:
    base_url = os.getenv("APP_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
    return f"{base_url}{path}?token={quote(token)}"


def deliver_auth_action(
    email: str,
    subject: str,
    action_url: str,
    *,
    password_reset: bool = False,
) -> None:
    try:
        send_auth_email(email, subject, action_url, password_reset=password_reset)
    except (OSError, RuntimeError, ValueError) as error:
        raise HTTPException(
            status_code=503,
            detail="Email delivery is temporarily unavailable. Try again later.",
        ) from error


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED, tags=["authentication"])
def register_account(payload: RegisterRequest, db: Session = Depends(get_db)) -> dict[str, str | None]:
    email = normalize_email(payload.email)
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    user = User(
        id=str(uuid4()),
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        is_verified=False,
    )
    db.add(user)
    create_default_tenant(db, user)
    db.commit()
    action_url = auth_action_url(
        "/verify-email", create_action_token(user, "email_verification")
    )
    deliver_auth_action(email, "Verify your RecruitAI account", action_url)
    return {
        "message": "Account created. Check your email for a verification link.",
        "action_url": action_url if APP_ENV != "production" else None,
    }

def screening_payload(screening: Screening) -> dict:
    return {
        "id": screening.id,
        "name": screening.name,
        "created_at": iso_utc(screening.created_at),
        "job_description_text": screening.job_description_text,
        "job_description_filename": screening.job_description_filename,
        "job_requirements": screening.job_requirements,
        "scoring_config": screening.scoring_config,
        "criteria": screening.rubric.criteria if screening.rubric else [],
        "resumes": [
            {
                "id": resume.id,
                "filename": resume.filename,
                "size_bytes": resume.size_bytes,
                "content_type": resume.content_type,
                "created_at": iso_utc(resume.created_at),
                "language_code": resume.language_code,
                "pipeline_stage": resume.pipeline_stage,
                "duplicate_of_resume_id": resume.duplicate_of_resume_id,
                "duplicate_of_filename": resume.duplicate_of_filename,
                "duplicate_reason": resume.duplicate_reason,
                "evaluation": (
                    {
                        "status": resume.evaluation.status,
                        "score": resume.evaluation.reviewer_override_score if resume.evaluation.reviewer_override_score is not None else resume.evaluation.score,
                        "model_score": resume.evaluation.score,
                        "job_match_score": resume.evaluation.job_match_score,
                        "preferred_score": resume.evaluation.preferred_score,
                        "bonus_points": resume.evaluation.bonus_points,
                        "required_checks_passed": resume.evaluation.required_checks_passed,
                        "required_checks": resume.evaluation.required_checks,
                        "job_evidence": resume.evaluation.job_evidence,
                        "explanation": resume.evaluation.explanation,
                        "assessments": resume.evaluation.assessments,
                        "matching_details": resume.evaluation.matching_details,
                        "reviewer_override_score": resume.evaluation.reviewer_override_score,
                        "reviewer_override_note": resume.evaluation.reviewer_override_note,
                        "reviewer_id": resume.evaluation.reviewer_id,
                        "reviewer_updated_at": iso_utc(resume.evaluation.reviewer_updated_at) if resume.evaluation.reviewer_updated_at else None,
                        "error_message": resume.evaluation.error_message,
                        "attempts": resume.evaluation.attempts,
                        "updated_at": iso_utc(resume.evaluation.updated_at),
                    }
                    if resume.evaluation
                    else None
                ),
            }
            for resume in screening.resumes
            ],
            }


def parse_evaluation_criteria(value: str) -> list[dict]:
    try:
        raw_criteria = json.loads(value)
        if not isinstance(raw_criteria, list):
            raise ValueError("Evaluation criteria must be a list.")
        if len(raw_criteria) > MAX_EVALUATION_CRITERIA:
            raise ValueError(f"Use no more than {MAX_EVALUATION_CRITERIA} evaluation criteria.")
        criteria = [EvaluationCriterion.model_validate(item) for item in raw_criteria]
    except (json.JSONDecodeError, ValidationError, TypeError) as error:
        raise HTTPException(status_code=422, detail="Evaluation criteria are invalid.") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if any(criterion.required for criterion in criteria):
        raise HTTPException(
            status_code=422,
            detail="Additional criteria must be optional preferred qualifications.",
        )

    ids = [criterion.id for criterion in criteria]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Evaluation criteria must have unique IDs.")
    return [criterion.model_dump() for criterion in criteria]


def parse_job_requirements(value: str) -> list[dict]:
    try:
        raw_requirements = json.loads(value)
        if not isinstance(raw_requirements, list) or len(raw_requirements) > 40:
            raise ValueError("Job requirements must be a list of at most 40 items.")
        requirements = [JobRequirement.model_validate(item) for item in raw_requirements]
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Job requirements are invalid.") from error
    ids = [requirement.id for requirement in requirements]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Requirement IDs must be unique.")
    return [requirement.model_dump() for requirement in requirements]


def parse_matching_config(value: str) -> dict:
    if not value.strip():
        return default_matching_weights().model_dump()
    try:
        raw_config = json.loads(value)
        if not isinstance(raw_config, dict):
            raise ValueError("Scoring settings must be an object.")
        return MatchingWeights.model_validate(raw_config).model_dump()
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Scoring settings are invalid.") from error


def template_payload(template: ScreeningTemplate) -> dict:
    return {
        "id": template.id,
        "name": template.name,
        "criteria": template.criteria,
        "job_requirements": template.job_requirements,
        "scoring_config": template.scoring_config,
        "created_at": iso_utc(template.created_at),
    }


async def store_resume_uploads(
    db: Session,
    screening: Screening,
    resumes: list[UploadFile],
    uploaded_paths: list[Path],
) -> None:
    if len(resumes) > MAX_RESUMES_PER_BATCH:
        raise HTTPException(
            status_code=413,
            detail=f"Upload no more than {MAX_RESUMES_PER_BATCH} resumes per batch.",
        )
    if screening.company_id:
        existing_resumes = list(
            db.scalars(
                select(Resume)
                .join(Screening)
                .where(Screening.company_id == screening.company_id)
            ).all()
        )
    else:
        existing_resumes = list(screening.resumes)

    existing_by_name_size: dict[tuple[str, int], Resume] = {}
    existing_by_hash: dict[str, Resume] = {}
    for existing_resume in existing_resumes:
        key = (existing_resume.filename.casefold(), existing_resume.size_bytes)
        existing_by_name_size.setdefault(key, existing_resume)
        digest = existing_resume.content_sha256
        if not digest:
            existing_path = UPLOAD_DIR / existing_resume.storage_name
            if existing_path.is_file():
                try:
                    digest = hashlib.sha256(existing_path.read_bytes()).hexdigest()
                    existing_resume.content_sha256 = digest
                except OSError:
                    digest = None
        if digest:
            existing_by_hash.setdefault(digest, existing_resume)

    for upload in resumes:
        filename, content = await read_upload(upload, RESUME_EXTENSIONS)
        duplicate_key = (filename.casefold(), len(content))
        content_hash = hashlib.sha256(content).hexdigest()
        duplicate_source = existing_by_hash.get(content_hash)
        duplicate_reason = "Matching file content" if duplicate_source else None
        if duplicate_source is None:
            duplicate_source = existing_by_name_size.get(duplicate_key)
            if duplicate_source is not None:
                duplicate_reason = "Matching filename and file size"

        storage_name = f"{uuid4().hex}{Path(filename).suffix.lower()}"
        file_path = UPLOAD_DIR / storage_name
        file_path.write_bytes(content)
        uploaded_paths.append(file_path)
        resume = Resume(
            id=str(uuid4()),
            filename=filename,
            content_type=upload.content_type,
            size_bytes=len(content),
            storage_name=storage_name,
            content_sha256=content_hash,
            duplicate_of_resume_id=duplicate_source.id if duplicate_source else None,
            duplicate_of_filename=duplicate_source.filename if duplicate_source else None,
            duplicate_reason=duplicate_reason,
            evaluation=ResumeEvaluation(status="queued"),
        )
        screening.resumes.append(resume)
        existing_by_hash.setdefault(content_hash, resume)
        existing_by_name_size.setdefault(duplicate_key, resume)


@app.get("/health", tags=["system"])
def health_check(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@app.post("/api/auth/login", tags=["authentication"])
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    if not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail="Verify your email before signing in.",
        )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_session_token(user),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=APP_ENV == "production",
        samesite="strict",
        path="/",
    )
    return {"user": auth_user_payload(db, user)}


@app.post("/api/auth/verification/complete", tags=["authentication"])
def verify_account(payload: TokenActionRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        claims = decode_action_token(payload.token, "email_verification")
    except jwt.InvalidTokenError as error:
        raise HTTPException(status_code=400, detail="This link is invalid or expired.") from error
    user = db.get(User, claims["sub"])
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="This link is invalid or expired.")
    if not user.is_verified:
        user.is_verified = True
        db.commit()
    return {"message": "Email verified. You can now sign in."}


@app.post("/api/auth/password-reset/request", tags=["authentication"])
def request_password_reset(
    payload: EmailActionRequest, db: Session = Depends(get_db)
) -> dict[str, str | None]:
    user = db.scalar(select(User).where(User.email == normalize_email(payload.email)))
    action_url = None
    if user is not None and user.is_active and user.is_verified:
        action_url = auth_action_url(
            "/reset-password", create_action_token(user, "password_reset")
        )
        deliver_auth_action(
            user.email,
            "Reset your RecruitAI password",
            action_url,
            password_reset=True,
        )
    return {
        "message": "If an account exists for that email, a password reset link has been sent.",
        "action_url": action_url if APP_ENV != "production" else None,
    }


@app.post("/api/auth/password-reset/complete", tags=["authentication"])
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        claims = decode_action_token(payload.token, "password_reset")
    except jwt.InvalidTokenError as error:
        raise HTTPException(status_code=400, detail="This link is invalid or expired.") from error
    user = db.get(User, claims["sub"])
    fingerprint = hashlib.sha256(user.password_hash.encode()).hexdigest() if user else ""
    if (
        user is None
        or not user.is_active
        or not hmac.compare_digest(str(claims.get("password_fingerprint", "")), fingerprint)
    ):
        raise HTTPException(status_code=400, detail="This link is invalid or expired.")
    user.password_hash = hash_password(payload.password)
    db.commit()
    return {"message": "Password updated. You can now sign in."}


@app.post("/api/auth/google", tags=["authentication"])
def google_login(
    payload: GoogleSignInRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        claims = verify_google_credential(payload.credential)
    except (GoogleAuthError, ValueError) as error:
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified.") from error

    email = claims.get("email")
    if claims.get("email_verified") is not True or not isinstance(email, str) or "@" not in email:
        raise HTTPException(status_code=401, detail="Google sign-in requires a verified email address.")

    email = normalize_email(email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        full_name = claims.get("name")
        user = User(
            id=str(uuid4()),
            email=email,
            full_name=(full_name.strip() if isinstance(full_name, str) and full_name.strip() else email.split("@", 1)[0])[:120],
            password_hash=hash_password(secrets.token_urlsafe(48)),
        )
        db.add(user)
        create_default_tenant(db, user)
        db.commit()
    elif not user.is_active:
        raise HTTPException(status_code=403, detail="This account is disabled.")
    elif not user.is_verified:
        user.is_verified = True
        db.commit()

    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_session_token(user),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=APP_ENV == "production",
        samesite="strict",
        path="/",
    )
    return {"user": auth_user_payload(db, user)}


@app.get("/api/auth/me", tags=["authentication"])
def current_user(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, Any]:
    return {"user": auth_user_payload(db, user)}


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["authentication"])
def logout(response: Response) -> Response:
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        httponly=True,
        secure=APP_ENV == "production",
        samesite="strict",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@app.post("/api/organizations", status_code=status.HTTP_201_CREATED, tags=["organizations"])
def create_organization(
    payload: OrganizationCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    organization_name = payload.name.strip()
    initial_company_name = payload.initial_company_name.strip()
    if len(organization_name) < 2 or len(initial_company_name) < 2:
        raise HTTPException(status_code=422, detail="Enter organization and company names with at least two characters.")
    organization = Organization(id=str(uuid4()), name=organization_name)
    company = Company(
        id=str(uuid4()),
        organization_id=organization.id,
        name=initial_company_name,
    )
    db.add(organization)
    db.flush()
    db.add(company)
    db.flush()
    db.add_all(
        [
            OrganizationMembership(
                id=str(uuid4()), organization_id=organization.id, user_id=user.id,
                role="admin", status="active",
            ),
            CompanyMembership(
                id=str(uuid4()), company_id=company.id, user_id=user.id,
                role="company_admin", status="active", can_view=True, can_edit=True,
                can_download=True, can_manage_members=True,
            ),
        ]
    )
    user.default_company_id = company.id
    write_audit_log(
        db, user=user, company=company, action="organization.created",
        resource_type="organization", resource_id=organization.id,
    )
    db.commit()
    return {
        "organization_id": organization.id,
        "organization_name": organization.name,
        "company_id": company.id,
        "company_name": company.name,
    }


@app.get("/api/companies", tags=["organizations"])
def list_user_companies(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    rows = db.execute(
        select(CompanyMembership, Company, Organization)
        .join(Company, Company.id == CompanyMembership.company_id)
        .join(Organization, Organization.id == Company.organization_id)
        .where(
            CompanyMembership.user_id == user.id,
            CompanyMembership.is_active.is_(True),
            Company.is_active.is_(True),
            Organization.is_active.is_(True),
        )
        .order_by(Organization.name, Company.name)
    ).all()
    organization_roles = {
        membership.organization_id: membership.role
        for membership in db.scalars(
            select(OrganizationMembership).where(
                OrganizationMembership.user_id == user.id,
                OrganizationMembership.is_active.is_(True),
            )
        ).all()
    }
    return {
        "default_company_id": user.default_company_id,
        "companies": [
            company_access_payload(
                membership, company, organization, organization_roles.get(organization.id)
            )
            for membership, company, organization in rows
        ],
    }


@app.post(
    "/api/organizations/{organization_id}/companies",
    status_code=status.HTTP_201_CREATED,
    tags=["organizations"],
)
def create_company(
    organization_id: str,
    payload: CompanyCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    organization = db.get(Organization, organization_id)
    organization_membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.is_active.is_(True),
            OrganizationMembership.role == "admin",
        )
    )
    if organization is None or not organization.is_active or organization_membership is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    company_name = payload.name.strip()
    if len(company_name) < 2:
        raise HTTPException(status_code=422, detail="Enter a company name with at least two characters.")
    if payload.parent_company_id:
        parent = db.get(Company, payload.parent_company_id)
        if parent is None or parent.organization_id != organization_id or not parent.is_active:
            raise HTTPException(status_code=422, detail="Choose a parent company in this organization.")

    company = Company(
        id=str(uuid4()),
        organization_id=organization_id,
        parent_company_id=payload.parent_company_id,
        name=company_name,
    )
    db.add(company)
    db.flush()
    db.add(
        CompanyMembership(
            id=str(uuid4()), company_id=company.id, user_id=user.id,
            role="company_admin", status="active", can_view=True, can_edit=True,
            can_download=True, can_manage_members=True,
        )
    )
    write_audit_log(
        db, user=user, company=company, action="company.created",
        resource_type="company", resource_id=company.id,
    )
    db.commit()
    return {
        "id": company.id,
        "name": company.name,
        "organization_id": organization_id,
        "parent_company_id": company.parent_company_id,
    }


@app.get("/api/organizations/{organization_id}/companies", tags=["organizations"])
def list_organization_companies(
    organization_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    organization = db.get(Organization, organization_id)
    organization_admin = db.scalar(
        select(OrganizationMembership.id).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.role == "admin",
            OrganizationMembership.is_active.is_(True),
        )
    )
    if organization is None or organization_admin is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    companies = db.scalars(
        select(Company).where(Company.organization_id == organization_id)
        .order_by(Company.name)
    ).all()
    return {"companies": [
        {
            "id": company.id,
            "name": company.name,
            "parent_company_id": company.parent_company_id,
            "is_active": company.is_active,
        }
        for company in companies
    ]}


@app.post("/api/companies/{company_id}/archive", tags=["organizations"])
def archive_company(
    company_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    company = db.get(Company, company_id)
    organization_admin = db.scalar(
        select(OrganizationMembership.id).where(
            OrganizationMembership.organization_id == (company.organization_id if company else ""),
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.role == "admin",
            OrganizationMembership.is_active.is_(True),
        )
    )
    if company is None or organization_admin is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    if not company.is_active:
        return {"archived": True, "company_id": company.id}
    active_children = db.scalar(
        select(func.count()).select_from(Company).where(
            Company.parent_company_id == company.id,
            Company.is_active.is_(True),
        )
    ) or 0
    if active_children:
        raise HTTPException(status_code=409, detail="Archive active subsidiary companies first.")
    other_accessible_companies = db.scalar(
        select(func.count())
        .select_from(CompanyMembership)
        .join(Company, Company.id == CompanyMembership.company_id)
        .where(
            CompanyMembership.user_id == user.id,
            CompanyMembership.is_active.is_(True),
            Company.is_active.is_(True),
            Company.id != company.id,
        )
    ) or 0
    if other_accessible_companies == 0:
        raise HTTPException(status_code=409, detail="Create or join another company before archiving your only active company.")
    write_audit_log(
        db, user=user, company=company, action="company.archived",
        resource_type="company", resource_id=company.id,
    )
    company.is_active = False
    db.commit()
    return {"archived": True, "company_id": company.id}


@app.post("/api/companies/{company_id}/restore", tags=["organizations"])
def restore_company(
    company_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    company = db.get(Company, company_id)
    organization_admin = db.scalar(
        select(OrganizationMembership.id).where(
            OrganizationMembership.organization_id == (company.organization_id if company else ""),
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.role == "admin",
            OrganizationMembership.is_active.is_(True),
        )
    )
    if company is None or organization_admin is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    organization = db.get(Organization, company.organization_id)
    if organization is None or not organization.is_active:
        raise HTTPException(status_code=409, detail="Restore the organization before restoring this company.")
    if company.parent_company_id:
        parent = db.get(Company, company.parent_company_id)
        if parent is None or not parent.is_active:
            raise HTTPException(status_code=409, detail="Restore the parent company before restoring this company.")
    company.is_active = True
    write_audit_log(
        db, user=user, company=company, action="company.restored",
        resource_type="company", resource_id=company.id,
    )
    db.commit()
    return {"restored": True, "company_id": company.id}


@app.get("/api/companies/{company_id}/members", tags=["organizations"])
def list_company_members(
    company_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    rows = db.execute(
        select(CompanyMembership, User)
        .join(User, User.id == CompanyMembership.user_id)
        .where(CompanyMembership.company_id == company_id)
        .order_by(User.full_name, User.email)
    ).all()
    return {
        "members": [
            {
                "user_id": member_user.id,
                "email": member_user.email,
                "full_name": member_user.full_name,
                "role": membership.role,
                "is_active": membership.is_active,
                "permissions": {
                    "view": membership.can_view,
                    "edit": membership.can_edit,
                    "download": membership.can_download,
                    "manage_members": membership.can_manage_members,
                },
            }
            for membership, member_user in rows
        ]
    }


@app.patch("/api/companies/{company_id}/members/{member_user_id}", tags=["organizations"])
def update_company_member(
    company_id: str,
    member_user_id: str,
    payload: UpdateCompanyMemberRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    membership = db.scalar(
        select(CompanyMembership).where(
            CompanyMembership.company_id == company_id,
            CompanyMembership.user_id == member_user_id,
        )
    )
    company = db.get(Company, company_id)
    if membership is None or company is None:
        raise HTTPException(status_code=404, detail="Member not found.")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Choose at least one access permission.")
    next_permissions = {
        "can_view": changes.get("can_view", membership.can_view),
        "can_edit": changes.get("can_edit", membership.can_edit),
        "can_download": changes.get("can_download", membership.can_download),
        "can_manage_members": changes.get("can_manage_members", membership.can_manage_members),
    }
    if not next_permissions["can_view"] and any(
        next_permissions[key] for key in ("can_edit", "can_download", "can_manage_members")
    ):
        raise HTTPException(status_code=422, detail="Edit, download, and member management require view access.")
    if membership.is_active and membership.can_manage_members and not next_permissions["can_manage_members"]:
        other_admins = db.scalar(
            select(func.count()).select_from(CompanyMembership).where(
                CompanyMembership.company_id == company_id,
                CompanyMembership.is_active.is_(True),
                CompanyMembership.can_manage_members.is_(True),
                CompanyMembership.user_id != member_user_id,
            )
        ) or 0
        if other_admins == 0:
            raise HTTPException(status_code=409, detail="A company must keep at least one member manager.")
    for key, value in next_permissions.items():
        setattr(membership, key, value)
    membership.role = membership_role(**next_permissions)
    write_audit_log(
        db, user=user, company=company, action="membership.permissions_changed",
        resource_type="user", resource_id=member_user_id, details=next_permissions,
    )
    db.commit()
    return {"user_id": member_user_id, "role": membership.role, "permissions": {
        "view": membership.can_view, "edit": membership.can_edit,
        "download": membership.can_download, "manage_members": membership.can_manage_members,
    }}


@app.delete("/api/companies/{company_id}/members/{member_user_id}", tags=["organizations"])
def revoke_company_member(
    company_id: str,
    member_user_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    membership = db.scalar(
        select(CompanyMembership).where(
            CompanyMembership.company_id == company_id,
            CompanyMembership.user_id == member_user_id,
            CompanyMembership.is_active.is_(True),
        )
    )
    company = db.get(Company, company_id)
    if membership is None or company is None:
        raise HTTPException(status_code=404, detail="Member not found.")
    if membership.can_manage_members:
        other_admins = db.scalar(
            select(func.count()).select_from(CompanyMembership).where(
                CompanyMembership.company_id == company_id,
                CompanyMembership.is_active.is_(True),
                CompanyMembership.can_manage_members.is_(True),
                CompanyMembership.user_id != member_user_id,
            )
        ) or 0
        if other_admins == 0:
            raise HTTPException(status_code=409, detail="A company must keep at least one member manager.")
    membership.is_active = False
    membership.status = "inactive"
    write_audit_log(
        db, user=user, company=company, action="membership.revoked",
        resource_type="user", resource_id=member_user_id,
    )
    db.commit()
    return {"revoked": True, "user_id": member_user_id}


@app.post("/api/companies/{company_id}/invitations", status_code=status.HTTP_201_CREATED, tags=["organizations"])
def invite_company_member(
    company_id: str,
    payload: InviteCompanyMemberRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    email = normalize_email(payload.email)
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    permissions = payload.model_dump(exclude={"email"})
    if not permissions["can_view"]:
        raise HTTPException(status_code=422, detail="An invitation must grant screening view access.")
    if not permissions["can_view"] and any(
        permissions[key] for key in ("can_edit", "can_download", "can_manage_members")
    ):
        raise HTTPException(status_code=422, detail="Edit, download, and member management require view access.")
    existing = db.scalar(select(User).where(User.email == email))
    if existing and db.scalar(
        select(CompanyMembership.id).where(
            CompanyMembership.company_id == company_id,
            CompanyMembership.user_id == existing.id,
            CompanyMembership.is_active.is_(True),
        )
    ):
        raise HTTPException(status_code=409, detail="This user is already a member of the company.")
    pending = db.scalars(
        select(CompanyInvitation).where(
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.email == email,
            CompanyInvitation.accepted_at.is_(None),
            CompanyInvitation.revoked_at.is_(None),
        )
    ).all()
    now = datetime.now(timezone.utc)
    for previous in pending:
        previous.revoked_at = now
        previous.status = "revoked"
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    raw_token = secrets.token_urlsafe(32)
    token_digest = hashlib.sha256(raw_token.encode()).hexdigest()
    invitation = CompanyInvitation(
        id=str(uuid4()),
        company_id=company_id,
        email=email,
        token_digest=token_digest,
        token_hash=token_digest,
        invited_by_id=user.id,
        invited_by=user.id,
        role=membership_role(**permissions),
        status="pending",
        expires_at=invitation_expiry(),
        **permissions,
    )
    db.add(invitation)
    write_audit_log(
        db, user=user, company=company, action="invitation.created",
        resource_type="invitation", resource_id=invitation.id, details={"email": email},
    )
    db.commit()
    action_url = deliver_company_invitation(db, invitation, company, raw_token)
    return {"invitation": invitation_payload(invitation), "action_url": action_url}


@app.get("/api/companies/{company_id}/invitations", tags=["organizations"])
def list_company_invitations(
    company_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    invitations = db.scalars(
        select(CompanyInvitation).where(
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.accepted_at.is_(None),
            CompanyInvitation.revoked_at.is_(None),
        ).order_by(CompanyInvitation.created_at.desc())
    ).all()
    return {"invitations": [invitation_payload(invitation) for invitation in invitations]}


@app.delete("/api/companies/{company_id}/invitations/{invitation_id}", tags=["organizations"])
def revoke_company_invitation(
    company_id: str,
    invitation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    invitation = db.scalar(
        select(CompanyInvitation).where(
            CompanyInvitation.id == invitation_id,
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.accepted_at.is_(None),
            CompanyInvitation.revoked_at.is_(None),
        )
    )
    company = db.get(Company, company_id)
    if invitation is None or company is None:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    invitation.revoked_at = datetime.now(timezone.utc)
    invitation.status = "revoked"
    write_audit_log(
        db, user=user, company=company, action="invitation.revoked",
        resource_type="invitation", resource_id=invitation.id,
    )
    db.commit()
    return {"revoked": True}


@app.post("/api/companies/{company_id}/invitations/{invitation_id}/resend", tags=["organizations"])
def resend_company_invitation(
    company_id: str,
    invitation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    invitation = db.scalar(
        select(CompanyInvitation).where(
            CompanyInvitation.id == invitation_id,
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.accepted_at.is_(None),
            CompanyInvitation.revoked_at.is_(None),
        )
    )
    company = db.get(Company, company_id)
    if invitation is None or company is None:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    raw_token = secrets.token_urlsafe(32)
    invitation.token_digest = hashlib.sha256(raw_token.encode()).hexdigest()
    invitation.token_hash = invitation.token_digest
    invitation.status = "pending"
    invitation.expires_at = invitation_expiry()
    invitation.created_at = datetime.now(timezone.utc)
    write_audit_log(
        db, user=user, company=company, action="invitation.resent",
        resource_type="invitation", resource_id=invitation.id,
    )
    db.commit()
    action_url = deliver_company_invitation(db, invitation, company, raw_token)
    return {"invitation": invitation_payload(invitation), "action_url": action_url}


@app.get("/api/invitations/{token}", tags=["organizations"])
def get_invitation(token: str, db: Session = Depends(get_db)) -> dict:
    digest = hashlib.sha256(token.encode()).hexdigest()
    invitation = db.scalar(
        select(CompanyInvitation).where(CompanyInvitation.token_digest == digest)
    )
    if invitation is None or invitation.accepted_at or invitation.revoked_at:
        raise HTTPException(status_code=404, detail="Invitation not found or expired.")
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="Invitation not found or expired.")
    company = db.get(Company, invitation.company_id)
    organization = db.get(Organization, company.organization_id) if company else None
    if company is None or organization is None or not company.is_active or not organization.is_active:
        raise HTTPException(status_code=404, detail="Invitation not found or expired.")
    return {
        "company_id": company.id,
        "email": invitation.email,
        "company_name": company.name,
        "organization_name": organization.name,
        "permissions": {
            "view": invitation.can_view,
            "edit": invitation.can_edit,
            "download": invitation.can_download,
        },
        "expires_at": iso_utc(invitation.expires_at),
    }


@app.post("/api/invitations/accept", tags=["organizations"])
def accept_company_invitation(
    payload: AcceptCompanyInvitationRequest,
    response: Response,
    db: Session = Depends(get_db),
    authenticated_user: User | None = Depends(get_optional_current_user),
) -> dict:
    digest = hashlib.sha256(payload.token.encode()).hexdigest()
    invitation = db.scalar(
        select(CompanyInvitation).where(CompanyInvitation.token_digest == digest)
    )
    if invitation is None or invitation.accepted_at or invitation.revoked_at:
        raise HTTPException(status_code=400, detail="This invitation is invalid or expired.")
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This invitation is invalid or expired.")

    user = db.scalar(select(User).where(User.email == invitation.email))
    if user is None:
        if not payload.full_name or not payload.password:
            raise HTTPException(status_code=422, detail="Enter your full name to accept this invitation.")
        user = User(
            id=str(uuid4()),
            email=invitation.email,
            full_name=payload.full_name.strip(),
            password_hash=hash_password(payload.password),
            is_verified=True,
        )
        db.add(user)
        db.flush()
    else:
        authenticated = authenticated_user if (
            authenticated_user is not None and authenticated_user.email == invitation.email
        ) else authenticate_user(db, invitation.email, payload.password or "")
        if authenticated is None:
            raise HTTPException(status_code=401, detail="Sign in with the invited email and password to continue.")
        user = authenticated
        user.is_verified = True

    membership = db.scalar(
        select(CompanyMembership).where(
            CompanyMembership.company_id == invitation.company_id,
            CompanyMembership.user_id == user.id,
        )
    )
    if membership is None:
        membership = CompanyMembership(
            id=str(uuid4()), company_id=invitation.company_id, user_id=user.id,
            role=invitation.role, status="active", can_view=invitation.can_view,
            can_edit=invitation.can_edit, can_download=invitation.can_download,
            can_manage_members=invitation.can_manage_members,
        )
        db.add(membership)
    else:
        membership.is_active = True
        membership.status = "active"
        membership.role = invitation.role
        membership.can_view = invitation.can_view
        membership.can_edit = invitation.can_edit
        membership.can_download = invitation.can_download
        membership.can_manage_members = invitation.can_manage_members
    if user.default_company_id is None:
        user.default_company_id = invitation.company_id
    invitation.accepted_at = datetime.now(timezone.utc)
    invitation.status = "accepted"
    company = db.get(Company, invitation.company_id)
    if company is None:
        raise HTTPException(status_code=400, detail="This invitation is invalid or expired.")
    write_audit_log(
        db, user=user, company=company, action="invitation.accepted",
        resource_type="invitation", resource_id=invitation.id,
    )
    db.commit()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_session_token(user),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=APP_ENV == "production",
        samesite="strict",
        path="/",
    )
    return {"user": auth_user_payload(db, user)}


@app.get("/api/companies/{company_id}/audit-log", tags=["organizations"])
def list_company_audit_log(
    company_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
) -> dict:
    require_selected_company(user, company_id)
    require_company_permission(user, "can_manage_members")
    events = db.scalars(
        select(AuditLog).where(AuditLog.company_id == company_id)
        .order_by(AuditLog.created_at.desc()).limit(100)
    ).all()
    return {"events": [
        {
            "id": event.id, "actor_id": event.actor_id, "action": event.action,
            "resource_type": event.resource_type, "resource_id": event.resource_id,
            "details": event.details, "created_at": iso_utc(event.created_at),
        }
        for event in events
    ]}


@app.get("/api/screening-templates", tags=["screening templates"])
def list_screening_templates(
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_view")
    company_id = getattr(user, "active_company_id", None)
    templates = db.scalars(
        select(ScreeningTemplate)
        .where(ScreeningTemplate.company_id == company_id)
        .order_by(ScreeningTemplate.name, ScreeningTemplate.created_at.desc())
    ).all()
    return {"templates": [template_payload(template) for template in templates]}


@app.post(
    "/api/screening-templates",
    status_code=status.HTTP_201_CREATED,
    tags=["screening templates"],
)
def create_screening_template(
    payload: ScreeningTemplateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, company_id) if company_id else None
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Enter a template name.")
    criteria = parse_evaluation_criteria(
        json.dumps([item.model_dump() for item in payload.criteria])
    )
    requirements = [item.model_dump() for item in payload.job_requirements]
    requirement_ids = [item["id"] for item in requirements]
    if len(requirement_ids) != len(set(requirement_ids)):
        raise HTTPException(status_code=422, detail="Requirement IDs must be unique.")
    template = ScreeningTemplate(
        id=str(uuid4()),
        company_id=company.id,
        created_by_id=user.id,
        name=name,
        criteria=criteria,
        job_requirements=requirements,
        scoring_config=(payload.scoring_config or default_matching_weights()).model_dump(),
    )
    db.add(template)
    write_audit_log(
        db,
        user=user,
        company=company,
        action="screening_template.created",
        resource_type="screening_template",
        resource_id=template.id,
    )
    db.commit()
    db.refresh(template)
    return template_payload(template)


@app.delete("/api/screening-templates/{template_id}", tags=["screening templates"])
def delete_screening_template(
    template_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    company_id = getattr(user, "active_company_id", None)
    template = db.scalar(
        select(ScreeningTemplate).where(
            ScreeningTemplate.id == template_id,
            ScreeningTemplate.company_id == company_id,
        )
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Screening template not found.")
    company = db.get(Company, company_id) if company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="screening_template.deleted",
            resource_type="screening_template",
            resource_id=template.id,
        )
    db.delete(template)
    db.commit()
    return {"deleted": True, "template_id": template_id}


@app.post("/api/screenings", status_code=status.HTTP_201_CREATED, tags=["screenings"])
async def create_screening(
    screening_name: str = Form(..., min_length=2, max_length=160),
    resumes: list[UploadFile] = File(default=[]),
    job_description_text: str = Form(default=""),
    job_description_file: UploadFile | None = File(default=None),
    evaluation_criteria: str = Form(default="[]"),
    job_requirements: str = Form(default="[]"),
    scoring_config: str = Form(default=""),
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    if len(job_description_text) > MAX_JOB_DESCRIPTION_CHARS:
        raise HTTPException(status_code=422, detail=f"Keep the job description under {MAX_JOB_DESCRIPTION_CHARS:,} characters.")
    criteria = parse_evaluation_criteria(evaluation_criteria)
    requirements = parse_job_requirements(job_requirements)
    scoring_settings = parse_matching_config(scoring_config)

    clean_job_text = job_description_text.strip()
    if clean_job_text and count_words(clean_job_text) < MIN_JOB_DESCRIPTION_WORDS:
        raise HTTPException(status_code=422, detail=f"Job description must contain at least {MIN_JOB_DESCRIPTION_WORDS} words.")

    screening_name = screening_name.strip()
    if len(screening_name) < 2:
        raise HTTPException(status_code=422, detail="Enter a screening name.")

    uploaded_paths: list[Path] = []
    screening = Screening(
        id=str(uuid4()),
        name=screening_name,
        owner_id=user.id,
        company_id=getattr(user, "active_company_id", None),
        job_description_text=clean_job_text,
        scoring_config=scoring_settings,
        job_requirements=requirements or None,
    )
    screening.rubric = ScreeningRubric(criteria=criteria)
    try:
        if job_description_file is not None:
            filename, content = await read_upload(job_description_file, JOB_EXTENSIONS)
            extracted_text = extract_job_description(filename, content).strip()
            if len(extracted_text) > MAX_JOB_DESCRIPTION_CHARS:
                raise HTTPException(status_code=422, detail=f"Keep the job description under {MAX_JOB_DESCRIPTION_CHARS:,} characters.")
            if not clean_job_text:
                if count_words(extracted_text) < MIN_JOB_DESCRIPTION_WORDS:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Job description file must contain at least {MIN_JOB_DESCRIPTION_WORDS} readable words. Try a searchable PDF or paste the text.",
                    )
                screening.job_description_text = extracted_text
            storage_name = f"{uuid4().hex}{Path(filename).suffix.lower()}"
            file_path = UPLOAD_DIR / storage_name
            file_path.write_bytes(content)
            uploaded_paths.append(file_path)
            screening.job_description_filename = filename
            screening.job_description_content_type = job_description_file.content_type
            screening.job_description_storage_name = storage_name

        await store_resume_uploads(db, screening, resumes, uploaded_paths)
        db.add(screening)
        company = db.get(Company, screening.company_id) if screening.company_id else None
        if company is not None:
            write_audit_log(
                db, user=user, company=company, action="screening.created",
                resource_type="screening", resource_id=screening.id,
                details={
                    "resume_count": len(screening.resumes),
                    "preferred_criteria_count": len(criteria),
                    "job_requirements_count": len(requirements),
                },
            )
        db.commit()
        db.refresh(screening)
        return screening_payload(screening)
    except HTTPException:
        db.rollback()
        for file_path in uploaded_paths:
            file_path.unlink(missing_ok=True)
        raise
    except Exception:
        db.rollback()
        for file_path in uploaded_paths:
            file_path.unlink(missing_ok=True)
        raise


@app.get("/api/screenings", tags=["screenings"])
def list_screenings(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    search: str = Query(default="", max_length=120),
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_view")
    conditions = [screening_company_scope(user)]
    clean_search = search.strip()
    if clean_search:
        pattern = f"%{clean_search}%"
        conditions.append(Screening.name.ilike(pattern))

    total = db.scalar(select(func.count()).select_from(Screening).where(*conditions)) or 0
    resume_stats = (
        select(
            Resume.screening_id.label("screening_id"),
            func.count(Resume.id).label("resume_count"),
            func.coalesce(
                func.sum(case((ResumeEvaluation.status == "completed", 1), else_=0)), 0
            ).label("completed_count"),
            func.coalesce(
                func.sum(
                    case(
                        (ResumeEvaluation.status.in_(("queued", "processing")), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("active_count"),
            func.coalesce(
                func.sum(case((ResumeEvaluation.status == "failed", 1), else_=0)), 0
            ).label("failed_count"),
            func.coalesce(
                func.sum(case((ResumeEvaluation.status == "stopped", 1), else_=0)), 0
            ).label("stopped_count"),
            func.avg(func.coalesce(ResumeEvaluation.reviewer_override_score, ResumeEvaluation.score)).label("average_score"),
        )
        .outerjoin(ResumeEvaluation, ResumeEvaluation.resume_id == Resume.id)
        .group_by(Resume.screening_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Screening,
            func.coalesce(resume_stats.c.resume_count, 0),
            func.coalesce(resume_stats.c.completed_count, 0),
            func.coalesce(resume_stats.c.active_count, 0),
            func.coalesce(resume_stats.c.failed_count, 0),
            func.coalesce(resume_stats.c.stopped_count, 0),
            resume_stats.c.average_score,
        )
        .outerjoin(resume_stats, resume_stats.c.screening_id == Screening.id)
        .where(*conditions)
        .order_by(Screening.created_at.desc(), Screening.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "screenings": [
            {
                "id": screening.id,
                "name": screening.name,
                "created_at": iso_utc(screening.created_at),
                "resume_count": int(resume_count),
                "completed_count": int(completed_count),
                "active_count": int(active_count),
                "failed_count": int(failed_count),
                "stopped_count": int(stopped_count),
                "average_score": round(float(average_score)) if average_score is not None else None,
            }
            for screening, resume_count, completed_count, active_count, failed_count, stopped_count, average_score in rows
        ],
    }


@app.post("/api/screenings/{screening_id}/retry", tags=["screenings"])
def retry_screening(
    screening_id: str,
    mode: Literal["all", "failed"],
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    screening = db.scalar(
        select(Screening.id).where(
            Screening.id == screening_id,
            screening_company_scope(user),
        )
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")

    owned_resume_ids = select(Resume.id).where(Resume.screening_id == screening_id).scalar_subquery()
    conditions = [ResumeEvaluation.resume_id.in_(owned_resume_ids)]
    if mode == "failed":
        conditions.append(ResumeEvaluation.status.in_(("failed", "stopped")))
    queued = db.execute(
        update(ResumeEvaluation)
        .where(*conditions)
        .values(
            status="queued",
            score=None,
            job_match_score=None,
            preferred_score=None,
            bonus_points=None,
            required_checks_passed=None,
            required_checks=None,
            job_evidence=None,
            explanation=None,
            assessments=None,
            matching_details=None,
            reviewer_override_score=None,
            reviewer_override_note=None,
            reviewer_id=None,
            reviewer_updated_at=None,
            error_message=None,
            attempts=0,
            available_at=None,
            updated_at=datetime.now(timezone.utc),
        )
    )
    company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, company_id) if company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="screening.retry_requested",
            resource_type="screening",
            resource_id=screening_id,
            details={"mode": mode, "queued_count": queued.rowcount or 0},
        )
    db.commit()
    return {"queued_count": queued.rowcount or 0, "mode": mode}


@app.post("/api/screenings/{screening_id}/stop", tags=["screenings"])
def stop_screening(
    screening_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    screening = db.scalar(
        select(Screening.id).where(
            Screening.id == screening_id,
            screening_company_scope(user),
        )
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")

    owned_resume_ids = select(Resume.id).where(Resume.screening_id == screening_id).scalar_subquery()
    stopped = db.execute(
        update(ResumeEvaluation)
        .where(
            ResumeEvaluation.resume_id.in_(owned_resume_ids),
            ResumeEvaluation.status.in_(("queued", "processing")),
        )
        .values(
            status="stopped",
            error_message="Stopped by recruiter.",
            available_at=None,
            updated_at=datetime.now(timezone.utc),
        )
    )
    company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, company_id) if company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="screening.stopped",
            resource_type="screening",
            resource_id=screening_id,
            details={"stopped_count": stopped.rowcount or 0},
        )
    db.commit()
    return {"stopped_count": stopped.rowcount or 0}


@app.post("/api/resumes/{resume_id}/retry", tags=["resumes"])
def retry_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    evaluation = db.scalar(
        select(ResumeEvaluation)
        .join(Resume)
        .join(Screening)
        .where(Resume.id == resume_id, screening_company_scope(user))
    )
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Candidate evaluation not found.")
    if evaluation.status not in {"failed", "stopped"}:
        raise HTTPException(
            status_code=409,
            detail="Only failed or stopped candidates can be retried individually.",
        )
    now = datetime.now(timezone.utc)
    evaluation.status = "queued"
    evaluation.score = None
    evaluation.job_match_score = None
    evaluation.preferred_score = None
    evaluation.bonus_points = None
    evaluation.required_checks_passed = None
    evaluation.required_checks = None
    evaluation.job_evidence = None
    evaluation.explanation = None
    evaluation.assessments = None
    evaluation.matching_details = None
    evaluation.reviewer_override_score = None
    evaluation.reviewer_override_note = None
    evaluation.reviewer_id = None
    evaluation.reviewer_updated_at = None
    evaluation.error_message = None
    evaluation.attempts = 0
    evaluation.available_at = None
    evaluation.updated_at = now
    company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, company_id) if company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="candidate.retry_requested",
            resource_type="resume",
            resource_id=resume_id,
        )
    db.commit()
    return {"resume_id": resume_id, "status": "queued"}


@app.post("/api/screenings/suggest-criteria", tags=["screenings"])
async def suggest_screening_criteria(
    job_description_text: str = Form(default=""),
    job_description_file: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
):
    if len(job_description_text) > MAX_JOB_DESCRIPTION_CHARS:
        raise HTTPException(
            status_code=422,
            detail=f"Keep the job description under {MAX_JOB_DESCRIPTION_CHARS:,} characters.",
        )
    clean_job_text = job_description_text.strip()
    if job_description_file is not None:
        filename, content = await read_upload(job_description_file, JOB_EXTENSIONS)
        extracted_text = extract_job_description(filename, content).strip()
        if len(extracted_text) > MAX_JOB_DESCRIPTION_CHARS:
            raise HTTPException(
                status_code=422,
                detail=f"Keep the job description under {MAX_JOB_DESCRIPTION_CHARS:,} characters.",
            )
        if not clean_job_text:
            clean_job_text = extracted_text
    if count_words(clean_job_text) < MIN_JOB_DESCRIPTION_WORDS:
        raise HTTPException(
            status_code=422,
            detail=f"Job description must contain at least {MIN_JOB_DESCRIPTION_WORDS} words.",
        )
    try:
        return {"criteria": suggest_criteria(clean_job_text)}
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/screenings/{screening_id}/resumes", tags=["resumes"])
async def upload_screening_resumes(
    screening_id: str,
    resumes: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    screening = db.scalar(
        select(Screening)
        .options(
            selectinload(Screening.resumes).selectinload(Resume.evaluation),
                selectinload(Screening.rubric),
        )
        .where(Screening.id == screening_id, screening_company_scope(user))
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")
    previous_resume_ids = {resume.id for resume in screening.resumes}
    uploaded_paths: list[Path] = []
    try:
        await store_resume_uploads(db, screening, resumes, uploaded_paths)
        uploaded_resume_ids = [
            resume.id for resume in screening.resumes if resume.id not in previous_resume_ids
        ]
        company = db.get(Company, screening.company_id) if screening.company_id else None
        if company is not None and uploaded_resume_ids:
            write_audit_log(
                db,
                user=user,
                company=company,
                action="resumes.uploaded",
                resource_type="resume_batch",
                details={"count": len(uploaded_resume_ids), "resume_ids": uploaded_resume_ids},
            )
        db.commit()
        return screening_payload(screening)
    except HTTPException:
        db.rollback()
        for file_path in uploaded_paths:
            file_path.unlink(missing_ok=True)
        raise
    except Exception:
        db.rollback()
        for file_path in uploaded_paths:
            file_path.unlink(missing_ok=True)
        raise


@app.get("/api/screenings/{screening_id}", tags=["screenings"])
def get_screening(
    screening_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_view")
    screening = db.scalar(
        select(Screening)
        .options(
            selectinload(Screening.resumes).selectinload(Resume.evaluation),
                selectinload(Screening.rubric),
        )
        .where(Screening.id == screening_id, screening_company_scope(user))
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")
    return screening_payload(screening)


@app.put("/api/screenings/{screening_id}/requirements", tags=["screenings"])
def update_screening_requirements(
    screening_id: str,
    payload: UpdateRequirementsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    screening = db.scalar(
        select(Screening)
        .options(selectinload(Screening.resumes).selectinload(Resume.evaluation))
        .where(Screening.id == screening_id, screening_company_scope(user))
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")
    requirements = [item.model_dump() for item in payload.requirements]
    requirement_ids = [item["id"] for item in requirements]
    if len(requirement_ids) != len(set(requirement_ids)):
        raise HTTPException(status_code=422, detail="Requirement IDs must be unique.")
    previous_requirements = screening.job_requirements or []
    screening.job_requirements = requirements
    now = datetime.now(timezone.utc)
    for resume in screening.resumes:
        evaluation = resume.evaluation
        if evaluation is None:
            resume.evaluation = ResumeEvaluation(status="queued", updated_at=now)
            continue
        evaluation.status = "queued"
        evaluation.score = None
        evaluation.job_match_score = None
        evaluation.preferred_score = None
        evaluation.bonus_points = None
        evaluation.required_checks_passed = None
        evaluation.required_checks = None
        evaluation.job_evidence = None
        evaluation.explanation = None
        evaluation.assessments = None
        evaluation.matching_details = None
        evaluation.reviewer_override_score = None
        evaluation.reviewer_override_note = None
        evaluation.reviewer_id = None
        evaluation.reviewer_updated_at = None
        evaluation.error_message = None
        evaluation.attempts = 0
        evaluation.available_at = None
        evaluation.updated_at = now
    company = db.get(Company, screening.company_id) if screening.company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="screening.requirements_updated",
            resource_type="screening",
            resource_id=screening.id,
            details={
                "previous_count": len(previous_requirements),
                "requirement_count": len(requirements),
                "requirements": [item["text"] for item in requirements],
            },
        )
    db.commit()
    return {"requirements": screening.job_requirements, "queued_count": len(screening.resumes)}


@app.patch("/api/screenings/{screening_id}", tags=["screenings"])
def update_screening(
    screening_id: str,
    payload: UpdateScreeningRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    screening = db.scalar(
        select(Screening)
        .options(
            selectinload(Screening.resumes).selectinload(Resume.evaluation),
            selectinload(Screening.rubric),
        )
        .where(Screening.id == screening_id, screening_company_scope(user))
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")

    screening_name = payload.name.strip()
    if len(screening_name) < 2:
        raise HTTPException(status_code=422, detail="Enter a screening name.")
    job_description = payload.job_description_text.strip()
    if count_words(job_description) < MIN_JOB_DESCRIPTION_WORDS:
        raise HTTPException(
            status_code=422,
            detail=f"Job description must contain at least {MIN_JOB_DESCRIPTION_WORDS} words.",
        )
    criteria = (
        parse_evaluation_criteria(json.dumps(payload.criteria))
        if payload.criteria is not None
        else screening.rubric.criteria if screening.rubric else []
    )
    previous_name = screening.name
    previous_job_description = screening.job_description_text
    previous_criteria = screening.rubric.criteria if screening.rubric else []
    previous_requirements_count = len(screening.job_requirements or [])
    previous_job_file = (
        UPLOAD_DIR / screening.job_description_storage_name
        if screening.job_description_storage_name
        else None
    )

    screening.name = screening_name
    screening.job_description_text = job_description
    screening.job_requirements = None
    screening.job_description_filename = None
    screening.job_description_content_type = None
    screening.job_description_storage_name = None
    if screening.rubric is None:
        screening.rubric = ScreeningRubric(criteria=criteria)
    else:
        screening.rubric.criteria = criteria

    now = datetime.now(timezone.utc)
    for resume in screening.resumes:
        if resume.evaluation is None:
            resume.evaluation = ResumeEvaluation(status="queued", updated_at=now)
            continue
        resume.evaluation.status = "queued"
        resume.evaluation.score = None
        resume.evaluation.job_match_score = None
        resume.evaluation.preferred_score = None
        resume.evaluation.bonus_points = None
        resume.evaluation.required_checks_passed = None
        resume.evaluation.required_checks = None
        resume.evaluation.job_evidence = None
        resume.evaluation.explanation = None
        resume.evaluation.assessments = None
        resume.evaluation.matching_details = None
        resume.evaluation.error_message = None
        resume.evaluation.attempts = 0
        resume.evaluation.available_at = None
        resume.evaluation.updated_at = now

    company = db.get(Company, screening.company_id) if screening.company_id else None
    if company is not None:
        write_audit_log(
            db, user=user, company=company, action="screening.updated",
            resource_type="screening", resource_id=screening.id,
            details={
                "name_changed": previous_name != screening_name,
                "job_description_changed": previous_job_description != job_description,
                "criteria_changed": previous_criteria != criteria,
                "previous_criteria": [item.get("name", "") for item in previous_criteria],
                "criteria": [item.get("name", "") for item in criteria],
                "previous_job_requirements_count": previous_requirements_count,
                "job_requirements_reset": previous_requirements_count > 0,
            },
        )
    db.commit()
    if previous_job_file is not None:
        previous_job_file.unlink(missing_ok=True)
    return screening_payload(screening)


@app.delete("/api/screenings/{screening_id}", tags=["screenings"])
def delete_screening(
    screening_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    screening = db.scalar(
        select(Screening)
        .options(selectinload(Screening.resumes))
        .where(Screening.id == screening_id, screening_company_scope(user))
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")

    stored_files = [UPLOAD_DIR / resume.storage_name for resume in screening.resumes]
    if screening.job_description_storage_name:
        stored_files.append(UPLOAD_DIR / screening.job_description_storage_name)
    company = db.get(Company, screening.company_id) if screening.company_id else None
    if company is not None:
        write_audit_log(
            db, user=user, company=company, action="screening.deleted",
            resource_type="screening", resource_id=screening.id,
            details={"screening_name": screening.name, "resume_count": len(screening.resumes)},
        )
    db.delete(screening)
    db.commit()
    for file_path in stored_files:
        file_path.unlink(missing_ok=True)
    return {"deleted": True, "screening_id": screening_id}


@app.get("/api/resumes/{resume_id}/download", tags=["resumes"])
def download_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_download")
    resume = db.scalar(
        select(Resume)
        .join(Screening)
        .where(Resume.id == resume_id, screening_company_scope(user))
    )
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume not found.")
    file_path = UPLOAD_DIR / resume.storage_name
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Stored resume file is missing.")
    active_company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, active_company_id) if active_company_id else None
    if company is not None:
        write_audit_log(
            db, user=user, company=company, action="resume.downloaded",
            resource_type="resume", resource_id=resume.id,
        )
        db.commit()
    return FileResponse(file_path, media_type=resume.content_type or "application/octet-stream", filename=resume.filename)


@app.patch("/api/resumes/{resume_id}/review", tags=["resumes"])
def review_resume_score(
    resume_id: str,
    payload: ReviewOverrideRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    evaluation = db.scalar(
        select(ResumeEvaluation)
        .join(Resume)
        .join(Screening)
        .where(Resume.id == resume_id, screening_company_scope(user))
    )
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Candidate evaluation not found.")
    if evaluation.status != "completed":
        raise HTTPException(status_code=409, detail="Wait for evaluation to complete before reviewing its score.")
    previous_override_score = evaluation.reviewer_override_score
    evaluation.reviewer_override_score = payload.score
    evaluation.reviewer_override_note = payload.note.strip()
    evaluation.reviewer_id = user.id
    evaluation.reviewer_updated_at = datetime.now(timezone.utc)
    active_company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, active_company_id) if active_company_id else None
    if company is not None:
        write_audit_log(
            db, user=user, company=company, action="candidate.reviewed",
            resource_type="resume", resource_id=resume_id,
            details={
                "model_score": evaluation.score,
                "previous_override_score": previous_override_score,
                "override_score": payload.score,
            },
        )
    db.commit()
    return {
        "resume_id": resume_id,
        "model_score": evaluation.score,
        "score": evaluation.reviewer_override_score,
        "reviewer_note": evaluation.reviewer_override_note,
        "reviewer_updated_at": iso_utc(evaluation.reviewer_updated_at),
    }


@app.patch("/api/resumes/{resume_id}/pipeline-stage", tags=["candidate pipeline"])
def update_candidate_pipeline_stage(
    resume_id: str,
    payload: UpdatePipelineStageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    resume = db.scalar(
        select(Resume)
        .join(Screening)
        .where(Resume.id == resume_id, screening_company_scope(user))
    )
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume not found.")
    previous_stage = resume.pipeline_stage
    resume.pipeline_stage = payload.stage
    company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, company_id) if company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="candidate.pipeline_stage_changed",
            resource_type="resume",
            resource_id=resume_id,
            details={"from": previous_stage, "to": payload.stage},
        )
    db.commit()
    return {"resume_id": resume_id, "pipeline_stage": resume.pipeline_stage}


@app.get("/api/resumes/{resume_id}/interview-questions", tags=["candidate interview"])
def suggest_candidate_interview_questions(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_view")
    evaluation = db.scalar(
        select(ResumeEvaluation)
        .join(Resume)
        .join(Screening)
        .where(Resume.id == resume_id, screening_company_scope(user))
    )
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Candidate evaluation not found.")
    if evaluation.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Wait for the candidate evaluation to complete before drafting interview questions.",
        )

    resume = evaluation.resume
    screening = resume.screening
    assessments = evaluation.assessments or []
    assessments_by_id = {item.get("criterion_id"): item for item in assessments}
    criteria: list[dict] = []
    seen_ids: set[str] = set()
    for requirement in screening.job_requirements or []:
        criterion_id = requirement.get("id", "")
        if not criterion_id or criterion_id in seen_ids:
            continue
        seen_ids.add(criterion_id)
        assessment = assessments_by_id.get(criterion_id, {})
        criteria.append(
            {
                "id": criterion_id,
                "name": requirement.get("text", "Role requirement"),
                "required": requirement.get("requirement_class") == "must_have",
                "priority": requirement.get("priority", 3),
                "score": assessment.get("score"),
                "status": assessment.get("status", "not_assessed"),
                "evidence": assessment.get("evidence") or [],
            }
        )
    for criterion in screening.rubric.criteria if screening.rubric else []:
        criterion_id = criterion.get("id", "")
        if not criterion_id or criterion_id in seen_ids:
            continue
        seen_ids.add(criterion_id)
        assessment = assessments_by_id.get(criterion_id, {})
        criteria.append(
            {
                "id": criterion_id,
                "name": criterion.get("name", "Preferred qualification"),
                "required": False,
                "priority": criterion.get("weight", 3),
                "score": assessment.get("score"),
                "status": assessment.get("status", "not_assessed"),
                "evidence": assessment.get("evidence") or [],
            }
        )
    for assessment in assessments:
        criterion_id = assessment.get("criterion_id", "")
        if not criterion_id or criterion_id in seen_ids:
            continue
        seen_ids.add(criterion_id)
        criteria.append(
            {
                "id": criterion_id,
                "name": assessment.get("name", "Screening criterion"),
                "required": bool(assessment.get("required")),
                "priority": assessment.get("priority", 3),
                "score": assessment.get("score"),
                "status": assessment.get("status", "not_assessed"),
                "evidence": assessment.get("evidence") or [],
            }
        )

    criteria.sort(
        key=lambda item: (
            not item["required"],
            -int(item["priority"] or 3),
            int(item["score"] if item["score"] is not None else -1),
        )
    )
    questions = []
    for criterion in criteria[:8]:
        name = str(criterion["name"]).strip()
        evidence = [str(quote) for quote in criterion["evidence"] if str(quote).strip()]
        question = (
            f"Your resume includes experience related to {name}. What was your specific contribution, "
            "and what outcome did the work produce?"
            if evidence
            else f"This role calls for {name}. What relevant example or experience can you share? "
            "If you have not had that experience, how would you approach it?"
        )
        questions.append(
            {
                "criterion_id": criterion["id"],
                "criterion": name,
                "criterion_type": "Must-have" if criterion["required"] else "Nice-to-have",
                "score": criterion["score"],
                "status": criterion["status"],
                "question": question,
                "grounding": (
                    "Resume evidence"
                    if evidence
                    else "Role requirement; no matching resume excerpt was recorded."
                ),
                "evidence": evidence,
            }
        )
    return {"resume_id": resume_id, "questions": questions}


@app.get("/api/companies/{company_id}/reviewers", tags=["candidate reviews"])
def list_company_reviewers(
    company_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_selected_company(user, company_id)
    require_company_permission(user, "can_edit")
    rows = db.execute(
        select(CompanyMembership, User)
        .join(User, User.id == CompanyMembership.user_id)
        .where(
            CompanyMembership.company_id == company_id,
            CompanyMembership.is_active.is_(True),
            CompanyMembership.can_view.is_(True),
        )
        .order_by(User.full_name, User.email)
    ).all()
    return {
        "reviewers": [
            {"user_id": reviewer.id, "full_name": reviewer.full_name, "email": reviewer.email}
            for _membership, reviewer in rows
        ]
    }


@app.get("/api/screenings/{screening_id}/team-reviews", tags=["candidate reviews"])
def list_screening_team_reviews(
    screening_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_view")
    screening = db.scalar(
        select(Screening)
        .options(selectinload(Screening.resumes))
        .where(Screening.id == screening_id, screening_company_scope(user))
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")
    resume_ids = [resume.id for resume in screening.resumes]
    if not resume_ids:
        return {"candidates": []}
    assignment_rows = db.execute(
        select(CandidateAssignment, User)
        .join(User, User.id == CandidateAssignment.reviewer_id)
        .where(CandidateAssignment.resume_id.in_(resume_ids))
        .order_by(User.full_name, User.email)
    ).all()
    review_rows = db.execute(
        select(CandidateReview, User)
        .join(User, User.id == CandidateReview.reviewer_id)
        .where(CandidateReview.resume_id.in_(resume_ids))
        .order_by(CandidateReview.updated_at.desc())
    ).all()
    assignments_by_resume: dict[str, list[dict]] = {}
    for assignment, reviewer in assignment_rows:
        assignments_by_resume.setdefault(assignment.resume_id, []).append(
            {
                "reviewer_id": reviewer.id,
                "full_name": reviewer.full_name,
                "email": reviewer.email,
                "is_active": assignment.is_active,
                "assigned_at": iso_utc(assignment.assigned_at),
            }
        )
    reviews_by_resume: dict[str, list[dict]] = {}
    for review, reviewer in review_rows:
        reviews_by_resume.setdefault(review.resume_id, []).append(
            {
                "reviewer_id": reviewer.id,
                "full_name": reviewer.full_name,
                "score": review.score,
                "note": review.note,
                "created_at": iso_utc(review.created_at),
                "updated_at": iso_utc(review.updated_at),
            }
        )
    return {
        "candidates": [
            {
                "resume_id": resume.id,
                "assignments": assignments_by_resume.get(resume.id, []),
                "reviews": reviews_by_resume.get(resume.id, []),
            }
            for resume in screening.resumes
        ]
    }


@app.put("/api/resumes/{resume_id}/assignments", tags=["candidate reviews"])
def update_candidate_assignments(
    resume_id: str,
    payload: CandidateAssignmentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    resume = db.scalar(
        select(Resume)
        .join(Screening)
        .where(Resume.id == resume_id, screening_company_scope(user))
    )
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume not found.")
    company_id = getattr(user, "active_company_id", None)
    reviewer_ids = list(dict.fromkeys(payload.reviewer_ids))
    valid_reviewer_ids = set(
        db.scalars(
            select(CompanyMembership.user_id).where(
                CompanyMembership.company_id == company_id,
                CompanyMembership.user_id.in_(reviewer_ids) if reviewer_ids else text("1 = 0"),
                CompanyMembership.is_active.is_(True),
                CompanyMembership.can_view.is_(True),
            )
        ).all()
    )
    if valid_reviewer_ids != set(reviewer_ids):
        raise HTTPException(
            status_code=422,
            detail="Assign reviews only to active company members with candidate view access.",
        )
    now = datetime.now(timezone.utc)
    assignments = list(
        db.scalars(
            select(CandidateAssignment).where(CandidateAssignment.resume_id == resume_id)
        ).all()
    )
    assignments_by_user = {assignment.reviewer_id: assignment for assignment in assignments}
    for assignment in assignments:
        is_selected = assignment.reviewer_id in valid_reviewer_ids
        if assignment.is_active != is_selected:
            assignment.is_active = is_selected
            if is_selected:
                assignment.assigned_by_id = user.id
                assignment.assigned_at = now
    for reviewer_id in valid_reviewer_ids - assignments_by_user.keys():
        db.add(
            CandidateAssignment(
                id=str(uuid4()),
                resume_id=resume_id,
                reviewer_id=reviewer_id,
                assigned_by_id=user.id,
                is_active=True,
                assigned_at=now,
            )
        )
    company = db.get(Company, company_id) if company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="candidate.reviewers_assigned",
            resource_type="resume",
            resource_id=resume_id,
            details={"reviewer_ids": reviewer_ids},
        )
    db.commit()
    return {"resume_id": resume_id, "reviewer_ids": reviewer_ids}


@app.put("/api/resumes/{resume_id}/team-review", tags=["candidate reviews"])
def save_candidate_team_review(
    resume_id: str,
    payload: CandidateTeamReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_view")
    resume = db.scalar(
        select(Resume)
        .join(Screening)
        .where(Resume.id == resume_id, screening_company_scope(user))
    )
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume not found.")
    assignment = db.scalar(
        select(CandidateAssignment).where(
            CandidateAssignment.resume_id == resume_id,
            CandidateAssignment.reviewer_id == user.id,
            CandidateAssignment.is_active.is_(True),
        )
    )
    if assignment is None:
        raise HTTPException(status_code=403, detail="You are not assigned to review this candidate.")
    note = payload.note.strip()
    if len(note) < 3:
        raise HTTPException(status_code=422, detail="Add a review note with at least three characters.")
    review = db.scalar(
        select(CandidateReview).where(
            CandidateReview.resume_id == resume_id,
            CandidateReview.reviewer_id == user.id,
        )
    )
    now = datetime.now(timezone.utc)
    if review is None:
        review = CandidateReview(
            id=str(uuid4()),
            resume_id=resume_id,
            reviewer_id=user.id,
            score=payload.score,
            note=note,
            created_at=now,
            updated_at=now,
        )
        db.add(review)
    else:
        review.score = payload.score
        review.note = note
        review.updated_at = now
    company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, company_id) if company_id else None
    if company is not None:
        write_audit_log(
            db,
            user=user,
            company=company,
            action="candidate.team_reviewed",
            resource_type="resume",
            resource_id=resume_id,
            details={"score": payload.score},
        )
    db.commit()
    return {
        "resume_id": resume_id,
        "reviewer_id": user.id,
        "score": review.score,
        "note": review.note,
        "updated_at": iso_utc(review.updated_at),
    }


@app.get("/api/screenings/{screening_id}/job-description", tags=["screenings"])
def download_job_description(
    screening_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_download")
    screening = db.scalar(
        select(Screening).where(Screening.id == screening_id, screening_company_scope(user))
    )
    if screening is None or not screening.job_description_storage_name:
        raise HTTPException(status_code=404, detail="Uploaded job description not found.")
    file_path = UPLOAD_DIR / screening.job_description_storage_name
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Stored job description file is missing.")
    active_company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, active_company_id) if active_company_id else None
    if company is not None:
        write_audit_log(
            db, user=user, company=company, action="job_description.downloaded",
            resource_type="screening", resource_id=screening.id,
        )
        db.commit()
    return FileResponse(
        file_path,
        media_type=screening.job_description_content_type or "application/octet-stream",
        filename=screening.job_description_filename,
    )


@app.post("/api/resumes/bulk-delete", tags=["resumes"])
def bulk_delete_resumes(
    payload: BulkDeleteResumes,
    db: Session = Depends(get_db),
    user: User = Depends(get_company_user),
):
    require_company_permission(user, "can_edit")
    resume_ids = list(dict.fromkeys(payload.resume_ids))
    if not resume_ids:
        raise HTTPException(status_code=422, detail="Select at least one resume to remove.")
    records = list(
        db.scalars(
            select(Resume)
            .join(Screening)
            .where(Resume.id.in_(resume_ids), screening_company_scope(user))
        ).all()
    )
    for record in records:
        db.delete(record)
    active_company_id = getattr(user, "active_company_id", None)
    company = db.get(Company, active_company_id) if active_company_id else None
    if company is not None:
        write_audit_log(
            db, user=user, company=company, action="resumes.deleted",
            resource_type="resume_batch",
            details={"count": len(records), "resume_ids": [record.id for record in records]},
        )
    db.commit()
    for record in records:
        (UPLOAD_DIR / record.storage_name).unlink(missing_ok=True)
    return {"deleted_count": len(records), "deleted_ids": [record.id for record in records]}
