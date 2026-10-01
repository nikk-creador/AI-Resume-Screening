import unittest
from unittest.mock import patch

from backend.app.matching import JobRequirement, MatchingWeights, ResumeEvidence, StructuredResume, normalize_concept, score_requirements


class MatchingTests(unittest.TestCase):
    def test_aliases_normalize_without_merging_related_tools(self):
        self.assertEqual(normalize_concept("React.js"), "react")
        self.assertEqual(normalize_concept("React Native"), "react native")
        self.assertNotEqual(normalize_concept("TypeScript"), normalize_concept("JavaScript"))

    def test_exact_requirement_match_has_verifiable_evidence(self):
        requirement = JobRequirement(
            id="react", text="React development", normalized_concept="react",
            requirement_type="skill", requirement_class="must_have", priority=5,
            evidence_needed="Work evidence", minimum_years=None,
        )
        profile = StructuredResume(evidence=[ResumeEvidence(
            normalized_concept="React.js", evidence="Built responsive React.js dashboards for customers.",
            section="Experience", source_type="professional",
        )])
        with patch("backend.app.matching._precompute_passage_vectors", return_value=None), patch(
            "backend.app.matching._cosine_scores", return_value=[0.9]
        ), patch(
            "backend.app.matching._reranker_scores", return_value=[0.9]
        ):
            result = score_requirements([requirement], profile, profile.evidence[0].evidence, MatchingWeights())
        item = result["assessments"][0]
        self.assertEqual(item["status"], "matched")
        self.assertTrue(item["exact_match"])
        self.assertEqual(item["evidence"], [profile.evidence[0].evidence])
        self.assertGreaterEqual(result["score"], 90)

    def test_course_evidence_does_not_satisfy_professional_years(self):
        requirement = JobRequirement(
            id="react-years", text="Two years of React experience", normalized_concept="react",
            requirement_type="experience", requirement_class="must_have", priority=5,
            evidence_needed="Professional evidence", minimum_years=2,
        )
        quote = "Completed a React course and built a small project."
        profile = StructuredResume(evidence=[ResumeEvidence(
            normalized_concept="react", evidence=quote, section="Projects", source_type="course",
        )])
        with patch("backend.app.matching._precompute_passage_vectors", return_value=None), patch(
            "backend.app.matching._cosine_scores", return_value=[0.95]
        ), patch(
            "backend.app.matching._reranker_scores", return_value=[0.95]
        ):
            result = score_requirements([requirement], profile, quote, MatchingWeights())
        self.assertFalse(result["assessments"][0]["experience_match"])
        self.assertNotEqual(result["assessments"][0]["status"], "matched")


if __name__ == "__main__":
    unittest.main()
