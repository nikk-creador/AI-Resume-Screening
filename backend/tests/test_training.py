import json
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from backend.training.finetune import TrainingExample, load_training_examples


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


if __name__ == "__main__":
    unittest.main()
