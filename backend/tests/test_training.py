import json
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from backend.training.finetune import (
    TrainingExample,
    load_training_examples,
    score_extraction_predictions,
)


class FineTuningDataTests(unittest.TestCase):
    def make_example(self):
        return {
            "reviewed": True,
            "task": "resume",
            "source_text": "Built production backend services for three years.",
            "target": {"evidence": [{
                "normalized_concept": "backend engineering",
                "evidence": "Built production backend services for three years.",
                "section": "Experience", "source_type": "professional",
                "start_year": 2021, "end_year": 2024,
            }]},
        }

    def test_requires_reviewed_labels_and_verbatim_resume_evidence(self):
        example = self.make_example()
        self.assertEqual(TrainingExample.model_validate(example).task, "resume")
        example["target"]["evidence"][0]["evidence"] = "Unsupported claim"
        with self.assertRaises(ValidationError):
            TrainingExample.model_validate(example)
        example = self.make_example()
        example["reviewed"] = False
        with self.assertRaises(ValidationError):
            TrainingExample.model_validate(example)

    def test_loader_requires_minimum_dataset_size(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset = Path(directory) / "examples.jsonl"
            dataset.write_text(json.dumps(self.make_example()) + "\n", encoding="utf-8")
            self.assertEqual(len(load_training_examples(dataset, minimum_examples=1)), 1)
            with self.assertRaisesRegex(ValueError, "Need at least 2"):
                load_training_examples(dataset, minimum_examples=2)

    def test_extraction_report_measures_schema_and_evidence_support(self):
        # Cover valid output, unsupported evidence, malformed JSON, and invalid schema.
        resume_example = TrainingExample.model_validate(self.make_example())
        job_description_example = TrainingExample.model_validate({
            "reviewed": True,
            "task": "job_description",
            "source_text": "The role requires professional Python development experience.",
            "target": {
                "role": "Backend engineer",
                "requirements": [{
                    "id": "python",
                    "text": "Professional Python development experience",
                    "normalized_concept": "python development",
                    "requirement_type": "skill",
                    "requirement_class": "must_have",
                    "priority": 5,
                    "evidence_needed": "Professional Python development",
                    "minimum_years": None,
                }],
            },
        })
        examples = [
            resume_example,
            resume_example,
            resume_example,
            job_description_example,
            job_description_example,
        ]
        grounded_prediction = json.dumps(resume_example.target)
        unsupported_prediction = json.dumps({
            "evidence": [{
                "normalized_concept": "distributed systems",
                "evidence": "Designed distributed systems for millions of users.",
                "section": "Experience",
                "source_type": "professional",
                "start_year": 2021,
                "end_year": 2024,
            }]
        })
        job_prediction = json.dumps(job_description_example.target)

        report = score_extraction_predictions(
            examples,
            [
                grounded_prediction,
                unsupported_prediction,
                "not json",
                json.dumps({"role": "Backend engineer"}),
                job_prediction,
            ],
        )

        self.assertEqual(report["parseable_json_examples"], 4)
        self.assertEqual(report["parseable_json_rate"], 0.8)
        self.assertEqual(report["schema_valid_examples"], 3)
        self.assertEqual(report["schema_valid_rate"], 0.6)
        self.assertEqual(report["resume_examples"], 3)
        self.assertEqual(report["job_description_examples"], 2)
        self.assertEqual(report["resume_evidence_quotes"], 2)
        self.assertEqual(report["resume_evidence_quotes_supported"], 1)
        self.assertEqual(report["resume_evidence_support_rate"], 0.5)


if __name__ == "__main__":
    unittest.main()
