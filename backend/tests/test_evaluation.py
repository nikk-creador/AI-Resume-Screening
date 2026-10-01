import unittest
from io import BytesIO

from docx import Document
from pypdf import PdfWriter
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect

from backend.app.database import Base, migrate_screening_schema
from backend.app.evaluation import EvaluationCriterion, detect_resume_language, extract_resume_text


class EvaluationTests(unittest.TestCase):
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
        Base.metadata.create_all(engine)
        migrate_screening_schema(engine)
        self.assertIn("job_requirements", {column["name"] for column in inspect(engine).get_columns("screenings")})
        self.assertIn("structured_profile", {column["name"] for column in inspect(engine).get_columns("resumes")})
        self.assertIn("matching_details", {column["name"] for column in inspect(engine).get_columns("resume_evaluations")})
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
