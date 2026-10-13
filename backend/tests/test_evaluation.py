import json
import os
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from docx import Document
from pypdf import PdfWriter
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect

import backend.app.models as models
from backend.app.database import Base, migrate_screening_schema
from backend.app.evaluation import (
    EvaluationCriterion,
    JobDescriptionProfile,
    _request_model,
    detect_resume_language,
    extract_job_requirements,
    extract_resume_profile,
    extract_resume_text,
)


class EvaluationTests(unittest.TestCase):
    def test_groq_api_key_alias_is_used_for_optional_generation(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "role": "Backend engineer",
                        "requirements": [{
                            "id": "python",
                            "text": "Python experience",
                            "normalized_concept": "python",
                            "requirement_type": "skill",
                            "requirement_class": "must_have",
                            "priority": 3,
                            "evidence_needed": "Direct evidence",
                            "minimum_years": None,
                        }],
                    }),
                },
            }],
        }).encode()

        with patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "openai_compatible",
                "AI_MODEL": "test-model",
                "AI_API_KEY": "stale-test-key",
                "RM_AI_KEY": "test-key",
            },
            clear=True,
        ), patch("backend.app.evaluation.urlopen", return_value=response) as open_url:
            result = _request_model(
                "Generate job requirements",
                JobDescriptionProfile,
                "Return structured requirements.",
            )

        request = open_url.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(result.role, "Backend engineer")

    def test_local_extraction_does_not_require_an_ai_provider(self):
        requirements = extract_job_requirements(
            "The engineer must have at least 3 years of Python experience. "
            "Docker is preferred."
        )
        python = next(item for item in requirements.requirements if item.normalized_concept == "python")
        docker = next(item for item in requirements.requirements if item.normalized_concept == "docker")
        self.assertEqual(python.requirement_class, "must_have")
        self.assertEqual(python.minimum_years, 3)
        self.assertEqual(docker.requirement_class, "nice_to_have")

        profile = extract_resume_profile(
            "Experience\nBuilt APIs with Python from 2021-2024.\nProjects\nCreated Docker images."
        )
        python_evidence = next(item for item in profile.evidence if item.normalized_concept == "python")
        docker_evidence = next(item for item in profile.evidence if item.normalized_concept == "docker")
        self.assertIn(python_evidence.evidence, "Experience\nBuilt APIs with Python from 2021-2024.\nProjects\nCreated Docker images.")
        self.assertEqual(python_evidence.source_type, "professional")
        self.assertEqual(python_evidence.start_year, 2021)
        self.assertEqual(python_evidence.end_year, 2024)
        self.assertEqual(docker_evidence.source_type, "personal_project")

    def test_protected_traits_cannot_be_added_as_criteria(self):
        with self.assertRaises(ValidationError):
            EvaluationCriterion(id="age", name="Age")

    def test_extracts_docx_paragraph_text(self):
        document = Document()
        document.add_paragraph("Experienced Python engineer building production APIs.")
        content = BytesIO()
        document.save(content)
        self.assertIn("Experienced Python engineer", extract_resume_text("candidate.docx", content.getvalue()))

    def test_detects_multilingual_resume_language(self):
        spanish = "Experiencia profesional desarrollando aplicaciones empresariales para clientes internacionales y equipos técnicos distribuidos."
        french = "Expérience professionnelle dans le développement de logiciels et la conception de systèmes distribués pour plusieurs entreprises."
        self.assertEqual(detect_resume_language(spanish), "es")
        self.assertEqual(detect_resume_language(french), "fr")

    def test_scanned_pdf_without_ocr_reports_actionable_error(self):
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        content = BytesIO()
        writer.write(content)
        with self.assertRaisesRegex(ValueError, "Scanned PDFs require Tesseract"):
            extract_resume_text("candidate.pdf", content.getvalue())

    def test_startup_migration_adds_new_matching_columns(self):
        engine = create_engine("sqlite:///:memory:")
        self.assertIn(models.Screening.__tablename__, Base.metadata.tables)
        Base.metadata.create_all(engine)
        migrate_screening_schema(engine)
        self.assertIn("job_requirements", {column["name"] for column in inspect(engine).get_columns("screenings")})
        self.assertIn("structured_profile", {column["name"] for column in inspect(engine).get_columns("resumes")})
        self.assertIn("matching_details", {column["name"] for column in inspect(engine).get_columns("resume_evaluations")})
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
