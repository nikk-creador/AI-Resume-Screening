from datetime import datetime, timezone
from pathlib import Path

import strawberry
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from strawberry.types import Info

from .database import UPLOAD_DIR
from .models import Resume, Screening


def utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@strawberry.type
class ResumeType:
    id: strawberry.ID
    filename: str
    size_bytes: int
    content_type: str | None
    created_at: datetime


@strawberry.type
class ScreeningType:
    id: strawberry.ID
    created_at: datetime
    job_description_text: str
    job_description_filename: str | None
    resumes: list[ResumeType]


@strawberry.type
class DeleteResumesResult:
    deleted_count: int
    deleted_ids: list[strawberry.ID]


def map_screening(record: Screening) -> ScreeningType:
    return ScreeningType(
        id=strawberry.ID(record.id),
        created_at=utc_datetime(record.created_at),
        job_description_text=record.job_description_text,
        job_description_filename=record.job_description_filename,
        resumes=[
            ResumeType(
                id=strawberry.ID(resume.id),
                filename=resume.filename,
                size_bytes=resume.size_bytes,
                content_type=resume.content_type,
                created_at=utc_datetime(resume.created_at),
            )
            for resume in record.resumes
        ],
    )


@strawberry.type
class Query:
    @strawberry.field
    def screening(self, info: Info, id: strawberry.ID) -> ScreeningType | None:
        db: Session = info.context["db"]
        record = db.scalar(
            select(Screening)
            .options(selectinload(Screening.resumes))
            .where(Screening.id == str(id))
        )
        return map_screening(record) if record else None


@strawberry.type
class Mutation:
    @strawberry.mutation
    def delete_resumes(self, info: Info, ids: list[strawberry.ID]) -> DeleteResumesResult:
        db: Session = info.context["db"]
        resume_ids = list(dict.fromkeys(str(resume_id) for resume_id in ids))
        if not resume_ids:
            raise ValueError("Select at least one resume to remove.")

        records = list(db.scalars(select(Resume).where(Resume.id.in_(resume_ids))).all())
        try:
            for record in records:
                db.delete(record)
            db.commit()
        except Exception:
            db.rollback()
            raise

        for record in records:
            (UPLOAD_DIR / Path(record.storage_name).name).unlink(missing_ok=True)
        return DeleteResumesResult(
            deleted_count=len(records),
            deleted_ids=[strawberry.ID(record.id) for record in records],
        )


schema = strawberry.Schema(query=Query, mutation=Mutation)
