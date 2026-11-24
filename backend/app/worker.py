from datetime import datetime, timedelta, timezone
from threading import Event
from pathlib import Path
import logging
import time

from dotenv import load_dotenv
from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT.parent / ".env")

from .database import Base, SessionLocal, UPLOAD_DIR, engine, migrate_screening_schema
from .evaluation import (
    EvaluationCriterion,
    detect_resume_language,
    extract_job_requirements,
    extract_resume_profile,
    evaluate_resume,
    extract_resume_text,
)
from .matching import JobRequirement, MatchingWeights, StructuredResume, default_matching_weights
from .models import Resume, ResumeEvaluation, Screening, utc_now

MAX_ATTEMPTS = 3
POLL_INTERVAL_SECONDS = 1
logger = logging.getLogger(__name__)


def recover_inflight_jobs(db: Session) -> None:
    db.execute(
        update(ResumeEvaluation)
        .where(ResumeEvaluation.status == "processing")
        .values(status="queued", updated_at=utc_now())
    )
    db.commit()


def process_next_evaluation(db: Session, upload_dir: Path = UPLOAD_DIR) -> bool:
    now = datetime.now(timezone.utc)
    resume_id = db.scalar(
        select(ResumeEvaluation.resume_id)
        .where(
            ResumeEvaluation.status == "queued",
            (ResumeEvaluation.available_at.is_(None)) | (ResumeEvaluation.available_at <= now),
        )
        .order_by(ResumeEvaluation.updated_at)
        .limit(1)
    )
    if resume_id is None:
        return False

    claimed_resume_id = db.scalar(
        update(ResumeEvaluation)
        .where(ResumeEvaluation.resume_id == resume_id, ResumeEvaluation.status == "queued")
        .values(
            status="processing",
            attempts=ResumeEvaluation.attempts + 1,
            error_message=None,
            updated_at=now,
        )
        .returning(ResumeEvaluation.resume_id)
    )
    if claimed_resume_id is None:
        db.rollback()
        return True
    db.commit()

    resume = db.scalar(
        select(Resume)
        .options(
            joinedload(Resume.evaluation),
            joinedload(Resume.screening).joinedload(Screening.rubric),
        )
        .where(Resume.id == resume_id)
    )
    if resume is None or resume.evaluation is None or resume.screening.rubric is None:
        return _finish_failure(db, resume_id, "Screening criteria or resume record is missing.")
    if resume.evaluation.status != "processing":
        return True

    attempts = resume.evaluation.attempts
    filename = resume.filename
    storage_name = resume.storage_name
    job_description = resume.screening.job_description_text
    criteria = [EvaluationCriterion.model_validate(item) for item in resume.screening.rubric.criteria]
    file_path = upload_dir / storage_name

    try:
        if not file_path.is_file():
            raise ValueError("Stored resume file is missing.")
        resume_bytes = file_path.read_bytes()
        resume_text = extract_resume_text(filename, resume_bytes)
        resume.language_code = detect_resume_language(resume_text)
        if not resume.screening.job_requirements:
            extracted_requirements = extract_job_requirements(job_description)
            resume.screening.job_requirements = [
                requirement.model_dump() for requirement in extracted_requirements.requirements
            ]
            if resume.screening.scoring_config is None:
                resume.screening.scoring_config = default_matching_weights().model_dump()
        if not resume.structured_profile:
            resume.structured_profile = extract_resume_profile(resume_text).model_dump()
        elif not all(
            resume.structured_profile.get(section)
            for section in ("education", "work_experience")
        ):
            extracted_profile = extract_resume_profile(resume_text).model_dump()
            profile_data = dict(resume.structured_profile)
            for section in ("education", "work_experience"):
                if not profile_data.get(section):
                    profile_data[section] = extracted_profile[section]
            resume.structured_profile = profile_data
        db.commit()
        current_status = db.scalar(
            select(ResumeEvaluation.status).where(ResumeEvaluation.resume_id == resume_id)
        )
        db.rollback()
        if current_status != "processing":
            return True
        result = evaluate_resume(
            job_description,
            resume_text,
            criteria,
            requirements=[
                JobRequirement.model_validate(item)
                for item in resume.screening.job_requirements or []
            ],
            profile=StructuredResume.model_validate(resume.structured_profile),
            weights=MatchingWeights.model_validate(
                resume.screening.scoring_config or default_matching_weights().model_dump()
            ),
            resume_embedding=resume.resume_embedding,
        )
        if result.get("resume_embedding") and resume.resume_embedding is None:
            resume.resume_embedding = result["resume_embedding"]
            db.commit()

    except ValueError as error:
        return _finish_failure(db, resume_id, str(error))
    except Exception as error:
        error_detail = str(error).strip() or type(error).__name__
        error_detail = error_detail[:450]
        if attempts < MAX_ATTEMPTS:
            retry_at = datetime.now(timezone.utc) + timedelta(seconds=min(60, 2**attempts))
            db.execute(
                update(ResumeEvaluation)
                .where(
                    ResumeEvaluation.resume_id == resume_id,
                    ResumeEvaluation.status == "processing",
                )
                .values(
                    status="queued",
                    available_at=retry_at,
                    error_message=f"{error_detail} Retrying.",
                    updated_at=datetime.now(timezone.utc),
                )
            )
            db.commit()
            return True
        return _finish_failure(db, resume_id, f"Evaluation failed after three attempts: {error_detail}")

    db.execute(
        update(ResumeEvaluation)
        .where(
            ResumeEvaluation.resume_id == resume_id,
            ResumeEvaluation.status == "processing",
        )
        .values(
            status="completed",
            score=result["score"],
            job_match_score=result["job_match_score"],
            preferred_score=result["preferred_score"],
            bonus_points=result["bonus_points"],
            required_checks_passed=result["required_checks_passed"],
            required_checks=result["required_checks"],
            job_evidence=result["job_evidence"],
            explanation=result["explanation"],
            assessments=result["assessments"],
            matching_details={
                "matching_method": result["matching_method"],
                "weights": result["weights"],
                "must_have_score": result["must_have_score"],
                "nice_to_have_score": result["nice_to_have_score"],
                **result["research_scores"],
            },
            error_message=None,
            available_at=None,
            updated_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return True


def backfill_next_completed_profile(db: Session, upload_dir: Path = UPLOAD_DIR) -> bool:
    resume = db.scalar(
        select(Resume)
        .join(ResumeEvaluation)
        .where(
            ResumeEvaluation.status == "completed",
            Resume.structured_profile.is_(None),
        )
        .order_by(Resume.created_at)
        .limit(1)
    )
    if resume is None:
        return False

    try:
        resume_text = extract_resume_text(
            resume.filename,
            (upload_dir / resume.storage_name).read_bytes(),
        )
        resume.structured_profile = extract_resume_profile(resume_text).model_dump()
    except (OSError, ValueError):
        resume.structured_profile = {"evidence": [], "education": [], "work_experience": []}
    db.commit()
    return True


def _finish_failure(db: Session, resume_id: str, message: str) -> bool:
    db.execute(
        update(ResumeEvaluation)
        .where(
            ResumeEvaluation.resume_id == resume_id,
            ResumeEvaluation.status == "processing",
        )
        .values(
            status="failed",
            error_message=message[:500],
            available_at=None,
            updated_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return True


def run_worker(
    stop_event: Event | None = None,
    *,
    initialize: bool = True,
    recover: bool = True,
) -> None:
    if initialize:
        Base.metadata.create_all(bind=engine)
        migrate_screening_schema(engine)
    if recover:
        with SessionLocal() as db:
            recover_inflight_jobs(db)
    print("Local resume evaluation worker started.", flush=True)
    while stop_event is None or not stop_event.is_set():
        try:
            with SessionLocal() as db:
                processed = process_next_evaluation(db)
                if not processed:
                    processed = backfill_next_completed_profile(db)
        except Exception:
            logger.exception("Resume evaluation worker loop failed.")
            processed = False
        if not processed:
            if stop_event is None:
                time.sleep(POLL_INTERVAL_SECONDS)
            else:
                stop_event.wait(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    run_worker()
