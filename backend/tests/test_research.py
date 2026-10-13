import unittest
from unittest.mock import patch

from backend.app.research import (
    ExperimentPair,
    _ranking_metrics,
    _score_test_pairs,
    _validate_splits,
)


class ResearchTests(unittest.TestCase):
    def test_metric_ties_use_stable_candidate_order(self):
        pairs = [
            ExperimentPair(
                candidate_id="candidate-a",
                group_id="group-a",
                job_id="job-a",
                split="test",
                job_text="Python engineer",
                resume_text="Python experience",
                relevance=1,
            ),
            ExperimentPair(
                candidate_id="candidate-b",
                group_id="group-b",
                job_id="job-a",
                split="test",
                job_text="Python engineer",
                resume_text="Python experience",
                relevance=0,
            ),
        ]

        metrics = _ranking_metrics(
            pairs,
            {("job-a", "candidate-a"): 0.5, ("job-a", "candidate-b"): 0.5},
        )

        self.assertEqual(metrics["MRR"], 1.0)

    def test_related_groups_cannot_cross_splits(self):
        pairs = [
            ExperimentPair(
                candidate_id="candidate-a",
                group_id="related-a",
                job_id=f"job-{split}",
                split=split,
                job_text="Python engineer",
                resume_text="Python experience",
                relevance=1,
            )
            for split in ("train", "dev", "test")
        ]
        with self.assertRaisesRegex(ValueError, "group_id"):
            _validate_splits(pairs)

    def test_all_methods_use_the_same_held_out_pairs_and_metrics(self):
        pairs = [
            ExperimentPair(
                candidate_id=f"candidate-{split}-{index}",
                group_id=f"group-{split}-{index}",
                job_id=f"job-{split}",
                split=split,
                job_text="Python developer with SQL",
                resume_text=f"Resume {index} with Python and SQL experience",
                relevance=1 if index == 0 else 0,
                required_skills=["python", "sql"],
            )
            for split in ("train", "dev", "test")
            for index in range(2)
        ]
        _validate_splits(pairs)
        test_pairs = [pair for pair in pairs if pair.split == "test"]
        with patch(
            "backend.app.research._embed_texts",
            return_value=[(1.0, 0.0), (1.0, 0.0), (0.0, 1.0)],
        ):
            scores, _, assessments = _score_test_pairs(test_pairs)

        self.assertEqual(set(scores), {"keyword_bm25", "semantic_cosine", "hybrid"})
        self.assertTrue(all(len(method_scores) == 2 for method_scores in scores.values()))
        self.assertEqual(len(assessments), 2)
        metrics = _ranking_metrics(test_pairs, scores["semantic_cosine"])
        self.assertEqual(metrics["job_count"], 1)
        self.assertIsNotNone(metrics["NDCG@10"])


if __name__ == "__main__":
    unittest.main()
