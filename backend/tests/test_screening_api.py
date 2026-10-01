import asyncio
from io import BytesIO
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from docx import Document
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from backend.app.database import Base
from backend.app.main import (
    create_screening,
    delete_screening,
    get_screening,
    list_screenings,
    review_resume_score,
    retry_screening,
    stop_screening,
    suggest_screening_criteria,
    update_screening,
    upload_screening_resumes,
    UpdateScreeningRequest,
    ReviewOverrideRequest,
)
from backend.app.models import Resume, ResumeEvaluation, Screening, ScreeningRubric


class ScreeningApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.storage_dir = Path(tempfile.mkdtemp())
        self.user = SimpleNamespace(id="recruiter-1")

    def tearDown(self):
        self.engine.dispose()
        for path in self.storage_dir.iterdir():
            path.unlink()
        self.storage_dir.rmdir()

    def test_recruiter_override_is_saved_separately_from_model_score(self):
        with Session(self.engine) as session:
            screening = Screening(id="review-screening", owner_id=self.user.id, job_description_text="Role")
            screening.rubric = ScreeningRubric(criteria=[])
            resume = Resume(
                id="review-resume", filename="candidate.docx", size_bytes=10,
                storage_name="review.docx", evaluation=ResumeEvaluation(status="completed", score=72),
            )
            screening.resumes.append(resume)
            session.add(screening)
            session.commit()

            result = review_resume_score(
                resume.id, ReviewOverrideRequest(score=84, note="Verified missing experience evidence manually."),
                db=session, user=self.user,
            )
            self.assertEqual(result["model_score"], 72)
            self.assertEqual(result["score"], 84)
            self.assertEqual(resume.evaluation.reviewer_id, self.user.id)

            with self.assertRaises(HTTPException) as error:
                review_resume_score(
                    resume.id, ReviewOverrideRequest(score=84, note="Another recruiter review."),
                    db=session, user=SimpleNamespace(id="other-user"),
                )
            self.assertEqual(error.exception.status_code, 404)

    def test_criteria_and_resume_batches_are_persisted_and_owner_scoped(self):
        criteria = [
            {"id": "python", "name": "Python", "required": False, "weight": 4}
        ]
        job_description = (
            "Seeking an experienced software engineer to design build test and maintain scalable "
            "backend applications with Python APIs and database systems across cloud infrastructure "
            "and collaborative product teams."
        )
        with Session(self.engine) as session, patch(
            "backend.app.main.UPLOAD_DIR", self.storage_dir
        ):
            created = asyncio.run(
                create_screening(
                    screening_name="Backend engineer hiring",
                    resumes=[],
                    job_description_text=job_description,
                    job_description_file=None,
                    evaluation_criteria=json.dumps(criteria),
                    db=session,
                    user=self.user,
                )
            )
            self.assertEqual(created["name"], "Backend engineer hiring")
            self.assertEqual(created["criteria"], criteria)

            document = Document()
            document.add_paragraph("Python engineer building scalable backend applications.")
            content = BytesIO()
            document.save(content)
            upload = UploadFile(filename="candidate.docx", file=BytesIO(content.getvalue()))
            saved = asyncio.run(
                upload_screening_resumes(
                    screening_id=created["id"],
                    resumes=[upload],
                    db=session,
                    user=self.user,
                )
            )

            self.assertEqual(len(saved["resumes"]), 1)
            self.assertEqual(saved["resumes"][0]["evaluation"]["status"], "queued")
            self.assertEqual(saved["criteria"], criteria)
            self.assertIsNotNone(session.get(ResumeEvaluation, saved["resumes"][0]["id"]))

            other_user = SimpleNamespace(id="recruiter-2")
            with self.assertRaises(HTTPException) as error:
                get_screening(created["id"], db=session, user=other_user)
            self.assertEqual(error.exception.status_code, 404)

            screening = session.get(Screening, created["id"])
            self.assertEqual(screening.owner_id, self.user.id)

    def test_screening_can_be_created_without_optional_criteria(self):
        job_description = (
            "Seeking an experienced software engineer to design build test and maintain scalable "
            "backend applications with Python APIs and database systems across cloud infrastructure "
            "and collaborative product teams."
        )
        with Session(self.engine) as session:
            result = asyncio.run(
                create_screening(
                    screening_name="Optional criteria example",
                    resumes=[],
                    job_description_text=job_description,
                    job_description_file=None,
                    evaluation_criteria="[]",
                    db=session,
                    user=self.user,
                )
            )

        self.assertEqual(result["name"], "Optional criteria example")
        self.assertEqual(result["criteria"], [])

    def test_suggestion_route_returns_criteria_from_local_model_adapter(self):
        criteria = [
            {"id": "python", "name": "Python APIs", "required": True, "weight": 4}
        ]
        job_description = (
            "Seeking an experienced software engineer to design build test and maintain scalable "
            "backend applications with Python APIs and database systems across cloud infrastructure "
            "and collaborative product teams."
        )
        with patch("backend.app.main.suggest_criteria", return_value=criteria) as suggest:
            result = asyncio.run(
                suggest_screening_criteria(
                    job_description_text=job_description,
                    job_description_file=None,
                    user=self.user,
                )
            )

        self.assertEqual(result, {"criteria": criteria})
        suggest.assert_called_once_with(job_description)

    def test_list_screenings_searches_and_aggregates_only_current_users(self):
        with Session(self.engine) as session:
            screening = Screening(
                id="screening-list-1",
                name="Python backend recruitment",
                owner_id=self.user.id,
                job_description_text="Python backend engineer role",
            )
            resume = Resume(
                id="resume-list-1",
                filename="candidate.docx",
                size_bytes=100,
                storage_name="candidate-list.docx",
                evaluation=ResumeEvaluation(status="completed", score=90),
            )
            screening.resumes.append(resume)
            session.add(screening)
            session.add(
                Screening(
                    id="screening-list-other",
                    name="Python backend another team",
                    owner_id="other-recruiter",
                    job_description_text="Python backend role",
                )
            )
            session.commit()

            result = list_screenings(
                skip=0,
                limit=10,
                search="recruitment",
                db=session,
                user=self.user,
            )

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["screenings"][0]["name"], "Python backend recruitment")
        self.assertNotIn("job_description_preview", result["screenings"][0])
        self.assertEqual(result["screenings"][0]["resume_count"], 1)
        self.assertEqual(result["screenings"][0]["completed_count"], 1)
        self.assertEqual(result["screenings"][0]["average_score"], 90)

    def test_retry_requeues_only_failed_resumes_for_the_owner(self):
        with Session(self.engine) as session:
            screening = Screening(
                id="screening-retry-1",
                owner_id=self.user.id,
                job_description_text="Backend engineering role",
            )
            failed = Resume(
                id="resume-failed",
                filename="failed.docx",
                size_bytes=100,
                storage_name="failed.docx",
                evaluation=ResumeEvaluation(
                    status="failed",
                    score=0,
                    job_match_score=0,
                    explanation="Local model unavailable.",
                    error_message="model offline",
                    attempts=3,
                ),
            )
            completed = Resume(
                id="resume-complete",
                filename="completed.docx",
                size_bytes=100,
                storage_name="completed.docx",
                evaluation=ResumeEvaluation(status="completed", score=91, job_match_score=91),
            )
            screening.resumes.extend([failed, completed])
            session.add(screening)
            session.commit()

            result = retry_screening(
                screening_id=screening.id,
                mode="failed",
                db=session,
                user=self.user,
            )

            failed_result = session.get(ResumeEvaluation, "resume-failed")
            completed_result = session.get(ResumeEvaluation, "resume-complete")
            self.assertEqual(result["queued_count"], 1)
            self.assertEqual(failed_result.status, "queued")
            self.assertEqual(failed_result.attempts, 0)
            self.assertIsNone(failed_result.score)
            self.assertIsNone(failed_result.error_message)
            self.assertEqual(completed_result.status, "completed")
            self.assertEqual(completed_result.score, 91)

            all_result = retry_screening(
                screening_id=screening.id,
                mode="all",
                db=session,
                user=self.user,
            )
            self.assertEqual(all_result["queued_count"], 2)
            self.assertEqual(failed_result.status, "queued")
            self.assertEqual(completed_result.status, "queued")
            self.assertIsNone(completed_result.score)

            with self.assertRaises(HTTPException) as error:
                retry_screening(
                    screening_id=screening.id,
                    mode="failed",
                    db=session,
                    user=SimpleNamespace(id="other-recruiter"),
                )
            self.assertEqual(error.exception.status_code, 404)

    def test_stop_marks_only_active_resumes_and_preserves_completed_results(self):
        with Session(self.engine) as session:
            screening = Screening(
                id="screening-stop-1",
                owner_id=self.user.id,
                job_description_text="Backend engineering role",
            )
            queued = Resume(
                id="resume-stop-queued",
                filename="queued.docx",
                size_bytes=100,
                storage_name="queued.docx",
                evaluation=ResumeEvaluation(status="queued"),
            )
            processing = Resume(
                id="resume-stop-processing",
                filename="processing.docx",
                size_bytes=100,
                storage_name="processing.docx",
                evaluation=ResumeEvaluation(status="processing"),
            )
            completed = Resume(
                id="resume-stop-completed",
                filename="completed.docx",
                size_bytes=100,
                storage_name="completed.docx",
                evaluation=ResumeEvaluation(status="completed", score=88),
            )
            screening.resumes.extend([queued, processing, completed])
            session.add(screening)
            session.commit()

            result = stop_screening(screening.id, db=session, user=self.user)

            self.assertEqual(result["stopped_count"], 2)
            self.assertEqual(session.get(ResumeEvaluation, queued.id).status, "stopped")
            self.assertEqual(session.get(ResumeEvaluation, processing.id).status, "stopped")
            completed_result = session.get(ResumeEvaluation, completed.id)
            self.assertEqual(completed_result.status, "completed")
            self.assertEqual(completed_result.score, 88)

            with self.assertRaises(HTTPException) as error:
                stop_screening(
                    screening.id,
                    db=session,
                    user=SimpleNamespace(id="other-recruiter"),
                )
            self.assertEqual(error.exception.status_code, 404)

    def test_edit_updates_job_and_requeues_candidates(self):
        original_job_file = self.storage_dir / "job-description.pdf"
        original_job_file.write_bytes(b"job description")
        new_description = (
            "Seeking an experienced software engineer to design build test and maintain scalable "
            "backend applications with Python APIs and database systems across cloud infrastructure "
            "and collaborative product teams."
        )
        with Session(self.engine) as session:
            screening = Screening(
                id="screening-edit-1",
                owner_id=self.user.id,
                job_description_text="Old job description with enough words to pass screening checks.",
                job_description_filename="job-description.pdf",
                job_description_storage_name=original_job_file.name,
            )
            screening.rubric = ScreeningRubric(criteria=[])
            resume = Resume(
                id="resume-edit-1",
                filename="candidate.docx",
                size_bytes=100,
                storage_name="candidate-edit.docx",
                evaluation=ResumeEvaluation(
                    status="completed",
                    score=90,
                    job_match_score=92,
                    preferred_score=80,
                    explanation="Previous result.",
                ),
            )
            screening.resumes.append(resume)
            session.add(screening)
            session.commit()

            with patch("backend.app.main.UPLOAD_DIR", self.storage_dir):
                result = update_screening(
                    screening_id=screening.id,
                    payload=UpdateScreeningRequest(
                        name="Updated backend hiring",
                        job_description_text=new_description,
                        criteria=[],
                    ),
                    db=session,
                    user=self.user,
                )

            evaluation = session.get(ResumeEvaluation, "resume-edit-1")
            self.assertEqual(result["job_description_text"], new_description)
            self.assertEqual(evaluation.status, "queued")
            self.assertIsNone(evaluation.score)
            self.assertIsNone(evaluation.explanation)
            self.assertFalse(original_job_file.exists())

    def test_delete_removes_screening_related_rows_and_stored_files(self):
        resume_file = self.storage_dir / "resume-delete.docx"
        job_file = self.storage_dir / "job-delete.pdf"
        resume_file.write_bytes(b"resume")
        job_file.write_bytes(b"job description")
        with Session(self.engine) as session:
            screening = Screening(
                id="screening-delete-1",
                owner_id=self.user.id,
                job_description_text="Backend engineering role requirements and team details.",
                job_description_filename="job-delete.pdf",
                job_description_storage_name=job_file.name,
            )
            screening.rubric = ScreeningRubric(criteria=[])
            screening.resumes.append(
                Resume(
                    id="resume-delete-1",
                    filename="resume-delete.docx",
                    size_bytes=6,
                    storage_name=resume_file.name,
                    evaluation=ResumeEvaluation(status="queued"),
                )
            )
            session.add(screening)
            session.commit()

            with patch("backend.app.main.UPLOAD_DIR", self.storage_dir):
                result = delete_screening(screening.id, db=session, user=self.user)

            self.assertTrue(result["deleted"])
            self.assertIsNone(session.get(Screening, screening.id))
            self.assertIsNone(session.get(Resume, "resume-delete-1"))
            self.assertIsNone(session.get(ResumeEvaluation, "resume-delete-1"))
            self.assertFalse(resume_file.exists())
            self.assertFalse(job_file.exists())


if __name__ == "__main__":
    unittest.main()
