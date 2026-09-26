from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Screening(Base):
    __tablename__ = "screenings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    job_description_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    job_description_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    job_description_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    job_description_storage_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    resumes: Mapped[list["Resume"]] = relationship(
        back_populates="screening", cascade="all, delete-orphan"
    )


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    screening_id: Mapped[str] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    screening: Mapped[Screening] = relationship(back_populates="resumes")
