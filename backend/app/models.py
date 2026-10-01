from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Screening(Base):
    __tablename__ = "screenings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), default="Untitled screening", nullable=False)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    job_description_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    job_requirements: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    scoring_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    job_description_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    job_description_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    job_description_storage_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    resumes: Mapped[list["Resume"]] = relationship(
        back_populates="screening", cascade="all, delete-orphan"
    )
    rubric: Mapped["ScreeningRubric | None"] = relationship(
        back_populates="screening", cascade="all, delete-orphan", uselist=False
    )


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    screening_id: Mapped[str] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    language_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    structured_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    screening: Mapped[Screening] = relationship(back_populates="resumes")
    evaluation: Mapped["ResumeEvaluation | None"] = relationship(
        back_populates="resume", cascade="all, delete-orphan", uselist=False
    )


class ScreeningRubric(Base):
    __tablename__ = "screening_rubrics"

    screening_id: Mapped[str] = mapped_column(
        ForeignKey("screenings.id", ondelete="CASCADE"), primary_key=True
    )
    criteria: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    screening: Mapped[Screening] = relationship(back_populates="rubric")


class ResumeEvaluation(Base):
    __tablename__ = "resume_evaluations"

    resume_id: Mapped[str] = mapped_column(
        ForeignKey("resumes.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_match_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    preferred_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bonus_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    required_checks_passed: Mapped[bool | None] = mapped_column(nullable=True)
    required_checks: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    job_evidence: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    assessments: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    matching_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reviewer_override_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewer_override_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewer_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    resume: Mapped[Resume] = relationship(back_populates="evaluation")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
