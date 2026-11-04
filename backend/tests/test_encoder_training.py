import unittest

from backend.training.finetune_encoder import PairRecord, _positive_pair_records


class EncoderPairSelectionTests(unittest.TestCase):
    def test_mnrl_pair_selection_uses_only_positive_labels(self):
        pairs = [
            PairRecord("job-1", "resume-1", 1),
            PairRecord("job-1", "resume-2", 0),
            PairRecord("job-2", "resume-3", 1),
        ]

        self.assertEqual(
            _positive_pair_records(pairs),
            [pairs[0], pairs[2]],
        )


if __name__ == "__main__":
    unittest.main()
