import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from docx import Document
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session

from backend.app.database import Base
from backend.app.models import Resume, ResumeEvaluation, Screening, ScreeningRubric
from backend.app.worker import process_next_evaluation, recover_inflight_jobs


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.upload_dir = Path(tempfile.mkdtemp())
        document = Document()
        document.add_paragraph("Python engineer with experience building production APIs.")
        content = BytesIO()
        document.save(content)
        (self.upload_dir / "candidate.docx").write_bytes(content.getvalue())

        with Session(self.engine) as session:
            screening = Screening(
                id="screening-1",
                job_description_text="Build backend services",
                job_requirements=[{
                    "id": "python", "text": "Python experience", "normalized_concept": "python",
                    "requirement_type": "skill", "requirement_class": "must_have", "priority": 3,
                    "evidence_needed": "Direct resume evidence", "minimum_years": None,
                }],
            )
            screening.rubric = ScreeningRubric(
                criteria=[
                    {"id": "python", "name": "Python", "required": True, "weight": 3}
                ]
            )
            resume = Resume(
                id="resume-1",
                filename="candidate.docx",
                size_bytes=len(content.getvalue()),
                storage_name="candidate.docx",
            )
            resume.evaluation = ResumeEvaluation(status="queued")
            resume.structured_profile = {"evidence": [{
                "normalized_concept": "python", "evidence": "Python engineer with experience building production APIs.",
                "section": "Experience", "source_type": "professional", "start_year": None, "end_year": None,
            }]}
            screening.resumes.append(resume)
            session.add(screening)
            session.commit()

    def tearDown(self):
        self.engine.dispose()
        for path in self.upload_dir.iterdir():
            path.unlink()
        self.upload_dir.rmdir()

    def test_worker_persists_completed_score_and_assessments(self):
        result = {
            "score": 86,
            "job_match_score": 86,
            "preferred_score": None,
            "bonus_points": 0,
            "required_checks_passed": False,
            "required_checks": [],
            "job_evidence": ["Python engineer"],
            "explanation": "Clear evidence for Python.",
            "assessments": [
                {
                    "bonus_points": 0,
                    "required_checks_passed": False,
                    "required_checks": [],
                    "criterion_id": "python",
                    "name": "Python",
                    "required": True,
                    "score": 86,
                    "evidence": ["Python engineer"],
                }
            ],
            "matching_method": "test",
            "weights": {},
            "must_have_score": 86,
            "nice_to_have_score": None,
        }
        with Session(self.engine) as session, patch(
            "backend.app.worker.evaluate_resume", return_value=result
        ):
            self.assertTrue(process_next_evaluation(session, self.upload_dir))
            evaluation = session.get(ResumeEvaluation, "resume-1")
            resume = session.get(Resume, "resume-1")
            self.assertEqual(evaluation.status, "completed")
            self.assertEqual(evaluation.score, 86)
            self.assertEqual(evaluation.job_match_score, 86)
            self.assertIsNone(evaluation.preferred_score)
            self.assertEqual(evaluation.bonus_points, 0)
            self.assertFalse(evaluation.required_checks_passed)
            self.assertEqual(evaluation.required_checks, [])
            self.assertEqual(evaluation.job_evidence, ["Python engineer"])
            self.assertEqual(resume.language_code, "en")

    def test_worker_discards_result_if_screening_stops_during_model_call(self):
        result = {
            "score": 86,
            "job_match_score": 86,
            "preferred_score": None,
            "bonus_points": 0,
            "required_checks_passed": False,
            "required_checks": [],
            "job_evidence": ["Python engineer"],
            "explanation": "Clear evidence for Python.",
            "assessments": [],
            "matching_method": "test",
            "weights": {},
            "must_have_score": 86,
            "nice_to_have_score": None,
        }

        def stop_during_inference(*_, **__):
            with Session(self.engine) as control_session:
                control_session.execute(
                    update(ResumeEvaluation)
                    .where(ResumeEvaluation.resume_id == "resume-1")
                    .values(status="stopped", error_message="Stopped by recruiter.")
                )
                control_session.commit()
            return result

        with Session(self.engine) as session, patch(
            "backend.app.worker.evaluate_resume", side_effect=stop_during_inference
        ):
            self.assertTrue(process_next_evaluation(session, self.upload_dir))
            evaluation = session.get(ResumeEvaluation, "resume-1")
            session.refresh(evaluation)

            self.assertEqual(evaluation.status, "stopped", evaluation.error_message)
            self.assertEqual(evaluation.error_message, "Stopped by recruiter.")
            self.assertIsNone(evaluation.score)
            self.assertIsNone(evaluation.assessments)

    def test_transient_error_is_requeued_and_processing_jobs_recover(self):
        with Session(self.engine) as session, patch(
            "backend.app.worker.evaluate_resume", side_effect=RuntimeError("offline")
        ):
            self.assertTrue(process_next_evaluation(session, self.upload_dir))
            evaluation = session.get(ResumeEvaluation, "resume-1")
            self.assertEqual(evaluation.status, "queued")
            self.assertEqual(evaluation.attempts, 1)
            self.assertIsNotNone(evaluation.available_at)

            evaluation.status = "processing"
            session.commit()
            recover_inflight_jobs(session)

            self.assertEqual(evaluation.status, "queued")


if __name__ == "__main__":
    unittest.main()
