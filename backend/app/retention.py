from datetime import datetime, timedelta, timezone
import logging
from pathlib import Path
from threading import Event
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from .database import SessionLocal, UPLOAD_DIR
from .models import (
    AuditLog,
    CandidateAssignment,
    CandidateReview,
    Company,
    CompanyRetentionPolicy,
    Resume,
    Screening,
)

logger = logging.getLogger(__name__)
RETENTION_CHECK_INTERVAL_SECONDS = 24 * 60 * 60


def _audit_retention_action(
    db: Session,
    *,
    policy: CompanyRetentionPolicy,
    company: Company,
    action: str,
    resource_type: str,
    details: dict,
    now: datetime,
) -> None:
    if policy.updated_by_id is None:
        return
    db.add(
        AuditLog(
            id=str(uuid4()),
            organization_id=company.organization_id,
            company_id=company.id,
            actor_id=None,
            user_id=policy.updated_by_id,
            action=action,
            resource_type=resource_type,
            details=details,
            created_at=now,
        )
    )


def _stored_file_path(storage_name: str | None) -> Path | None:
    if not storage_name:
        return None
    storage_root = UPLOAD_DIR.resolve()
    candidate = (storage_root / storage_name).resolve()
    try:
        candidate.relative_to(storage_root)
    except ValueError:
        logger.error("Skipping retention cleanup for a storage path outside the upload directory.")
        return None
    return candidate


def apply_data_retention_policies(db: Session, now: datetime | None = None) -> None:
    current_time = now or datetime.now(timezone.utc)
    policies = db.scalars(
        select(CompanyRetentionPolicy).where(CompanyRetentionPolicy.enabled.is_(True))
    ).all()
    for policy in policies:
        company = db.get(Company, policy.company_id)
        if company is None:
            continue
        try:
            resume_cutoff = current_time - timedelta(days=policy.resume_after_days)
            resume_conditions = [
                Screening.company_id == company.id,
                Resume.created_at < resume_cutoff,
            ]
            if policy.resume_action == "archive":
                resume_conditions.append(Resume.archived_at.is_(None))
            old_resumes = list(
                db.scalars(select(Resume).join(Screening).where(*resume_conditions)).all()
            )
            if old_resumes:
                if policy.resume_action == "archive":
                    for resume in old_resumes:
                        resume.archived_at = current_time
                    _audit_retention_action(
                        db,
                        policy=policy,
                        company=company,
                        action="retention.resumes_archived",
                        resource_type="resume_batch",
                        details={"count": len(old_resumes), "resume_ids": [item.id for item in old_resumes]},
                        now=current_time,
                    )
                    db.commit()
                else:
                    resume_ids = [item.id for item in old_resumes]
                    paths = [
                        path
                        for item in old_resumes
                        if (path := _stored_file_path(item.storage_name)) is not None
                    ]
                    db.execute(
                        delete(CandidateReview).where(CandidateReview.resume_id.in_(resume_ids))
                    )
                    db.execute(
                        delete(CandidateAssignment).where(
                            CandidateAssignment.resume_id.in_(resume_ids)
                        )
                    )
                    for resume in old_resumes:
                        db.delete(resume)
                    _audit_retention_action(
                        db,
                        policy=policy,
                        company=company,
                        action="retention.resumes_deleted",
                        resource_type="resume_batch",
                        details={"count": len(resume_ids), "resume_ids": resume_ids},
                        now=current_time,
                    )
                    db.commit()
                    for path in paths:
                        path.unlink(missing_ok=True)

            screening_conditions = [
                Screening.company_id == company.id,
                Screening.created_at
                < current_time - timedelta(days=policy.screening_after_days),
            ]
            if policy.screening_action == "archive":
                screening_conditions.append(Screening.archived_at.is_(None))
            screenings = list(
                db.scalars(
                    select(Screening)
                    .options(selectinload(Screening.resumes))
                    .where(*screening_conditions)
                ).all()
            )
            if screenings:
                if policy.screening_action == "archive":
                    for screening in screenings:
                        screening.archived_at = current_time
                    _audit_retention_action(
                        db,
                        policy=policy,
                        company=company,
                        action="retention.screenings_archived",
                        resource_type="screening_batch",
                        details={
                            "count": len(screenings),
                            "screening_ids": [item.id for item in screenings],
                        },
                        now=current_time,
                    )
                    db.commit()
                else:
                    screening_ids = [item.id for item in screenings]
                    resume_ids = [
                        resume.id for screening in screenings for resume in screening.resumes
                    ]
                    paths = [
                        path
                        for screening in screenings
                        for path in (
                            _stored_file_path(screening.job_description_storage_name),
                            *(
                                _stored_file_path(resume.storage_name)
                                for resume in screening.resumes
                            ),
                        )
                        if path is not None
                    ]
                    if resume_ids:
                        db.execute(
                            delete(CandidateReview).where(
                                CandidateReview.resume_id.in_(resume_ids)
                            )
                        )
                        db.execute(
                            delete(CandidateAssignment).where(
                                CandidateAssignment.resume_id.in_(resume_ids)
                            )
                        )
                    for screening in screenings:
                        db.delete(screening)
                    _audit_retention_action(
                        db,
                        policy=policy,
                        company=company,
                        action="retention.screenings_deleted",
                        resource_type="screening_batch",
                        details={"count": len(screening_ids), "screening_ids": screening_ids},
                        now=current_time,
                    )
                    db.commit()
                    for path in paths:
                        path.unlink(missing_ok=True)
        except Exception:
            db.rollback()
            logger.exception("Could not apply retention policy for company %s.", company.id)


def run_retention_worker(
    stop_event: Event,
    interval_seconds: int = RETENTION_CHECK_INTERVAL_SECONDS,
) -> None:
    while not stop_event.is_set():
        try:
            with SessionLocal() as db:
                apply_data_retention_policies(db)
        except Exception:
            logger.exception("The scheduled data retention check failed.")
        stop_event.wait(interval_seconds)
