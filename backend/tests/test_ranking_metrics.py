import unittest

from backend.app.ranking_metrics import calculate_ranking_metrics


class RankingMetricsTests(unittest.TestCase):
    def test_perfect_ranking_returns_perfect_metrics(self):
        metrics = calculate_ranking_metrics([(90, 3), (80, 2), (70, 0)], k=2)

        self.assertEqual(metrics["precision"], 1)
        self.assertEqual(metrics["recall"], 1)
        self.assertEqual(metrics["ndcg"], 1)
        self.assertEqual(metrics["effective_k"], 2)

    def test_unlabeled_candidates_keep_all_metrics_unavailable(self):
        metrics = calculate_ranking_metrics([(90, 3), (80, None)])

        self.assertEqual(metrics["labeled_count"], 1)
        self.assertEqual(metrics["unlabeled_count"], 1)
        self.assertIsNone(metrics["precision"])
        self.assertIsNone(metrics["recall"])
        self.assertIsNone(metrics["ndcg"])

    def test_recall_uses_every_qualified_candidate_and_ndcg_is_graded(self):
        metrics = calculate_ranking_metrics([(90, 0), (80, 3), (70, 1)], k=1)

        self.assertEqual(metrics["precision"], 0)
        self.assertEqual(metrics["recall"], 0)
        self.assertEqual(metrics["ndcg"], 0)

    def test_tied_scores_are_averaged_at_the_cutoff(self):
        metrics = calculate_ranking_metrics([(90, 3), (90, 0), (80, 2)], k=1)

        self.assertEqual(metrics["precision"], 0.5)
        self.assertEqual(metrics["recall"], 0.25)


if __name__ == "__main__":
    unittest.main()
