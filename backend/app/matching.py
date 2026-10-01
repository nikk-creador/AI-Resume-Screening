"""Requirement-level hybrid matching; LLM output never supplies candidate scores."""

from __future__ import annotations

from functools import lru_cache
import logging
import math
import os
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

logger = logging.getLogger(__name__)
PROTECTED_REQUIREMENT_TERMS = {
    "age", "birth date", "citizenship", "date of birth", "disability", "ethnicity", "gender",
    "gender identity", "marital status", "medical history", "national origin", "nationality",
    "native speaker", "photograph", "pregnancy", "race", "religion", "sexual orientation",
    "sex", "veteran status", "zip code", "postal code", "postcode", "culture fit",
}


class JobRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=3, max_length=500)
    normalized_concept: str = Field(min_length=2, max_length=160)
    requirement_type: Literal["skill", "experience", "education", "responsibility", "certification", "other"]
    requirement_class: Literal["must_have", "nice_to_have"]
    priority: int = Field(default=3, ge=1, le=5)
    evidence_needed: str = Field(default="Direct resume evidence", max_length=300)
    minimum_years: float | None = Field(default=None, ge=0, le=60)

    @field_validator("text", "normalized_concept")
    @classmethod
    def reject_protected_requirement(cls, value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()
        if any(f" {term} " in f" {normalized} " for term in PROTECTED_REQUIREMENT_TERMS):
            raise ValueError("Job requirements must not use protected traits or personal characteristics.")
        return value.strip()


class JobDescriptionProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str = Field(default="", max_length=200)
    requirements: list[JobRequirement] = Field(min_length=1, max_length=40)


class ResumeEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    normalized_concept: str = Field(min_length=2, max_length=160)
    evidence: str = Field(min_length=8, max_length=800)
    section: str = Field(default="Unknown", max_length=80)
    source_type: Literal[
        "professional",
        "internship",
        "academic_project",
        "personal_project",
        "certification",
        "course",
        "other",
    ]
    start_year: int | None = Field(default=None, ge=1950, le=2100)
    end_year: int | None = Field(default=None, ge=1950, le=2100)


class StructuredResume(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence: list[ResumeEvidence] = Field(min_length=1, max_length=100)


class MatchingWeights(BaseModel):
    """Provisional, configurable weights; calibrate only against reviewed validation data."""

    exact: float = Field(default=0.30, ge=0, le=1)
    semantic: float = Field(default=0.35, ge=0, le=1)
    reranker: float = Field(default=0.20, ge=0, le=1)
    evidence: float = Field(default=0.15, ge=0, le=1)
    must_have_group: float = Field(default=0.80, ge=0, le=1)
    nice_to_have_group: float = Field(default=0.20, ge=0, le=1)
    matched_threshold: float = Field(default=0.68, ge=0, le=1)
    partial_threshold: float = Field(default=0.40, ge=0, le=1)

    @model_validator(mode="after")
    def validate_weight_groups(self) -> MatchingWeights:
        if self.exact + self.semantic + self.reranker + self.evidence == 0:
            raise ValueError("At least one matching component weight must be positive.")
        if self.must_have_group + self.nice_to_have_group == 0:
            raise ValueError("At least one requirement group weight must be positive.")
        if self.partial_threshold > self.matched_threshold:
            raise ValueError("The partial match threshold must not exceed the match threshold.")
        return self


def default_matching_weights() -> MatchingWeights:
    defaults = MatchingWeights().model_dump()
    for name in defaults:
        env_name = f"MATCH_{name.upper()}"
        value = os.getenv(env_name)
        if value is not None:
            defaults[name] = float(value)
    return MatchingWeights.model_validate(defaults)


SKILL_ALIASES = {
    "react.js": "react",
    "reactjs": "react",
    "react js": "react",
    "node": "node.js",
    "nodejs": "node.js",
    "node.js": "node.js",
    "react native": "react native",
    "javascript": "javascript",
    "js": "javascript",
    "typescript": "typescript",
    "ts": "typescript",
    "amazon web services": "aws",
    "microsoft azure": "azure",
}

SOURCE_STRENGTH = {
    "professional": 1.0,
    "internship": 0.82,
    "academic_project": 0.68,
    "personal_project": 0.55,
    "certification": 0.48,
    "course": 0.35,
    "other": 0.5,
}


def normalize_concept(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value.casefold().replace("®", "").replace("™", "")).strip()
    return SKILL_ALIASES.get(normalized, normalized)


@lru_cache(maxsize=1)
def _embedding_model():
    from fastembed import TextEmbedding

    return TextEmbedding(
        model_name=os.getenv(
            "MATCH_EMBEDDING_MODEL",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        ),
        threads=int(os.getenv("MATCH_CPU_THREADS", "4")),
    )


@lru_cache(maxsize=1)
def _reranker_model():
    from fastembed.rerank.cross_encoder import TextCrossEncoder

    return TextCrossEncoder(
        model_name=os.getenv(
            "MATCH_RERANKER_MODEL", "jinaai/jina-reranker-v2-base-multilingual"
        ),
        threads=int(os.getenv("MATCH_CPU_THREADS", "4")),
    )


def _precompute_passage_vectors(passages: list[str]) -> list | None:
    """Embed all passages in a single batch so they are not re-embedded for each requirement.

    The same evidence passages are scored against every requirement, so embedding
    them per-requirement is redundant.  This changes embedding work from
    N × M (N requirements, M passages) to a single batch of M + N query embeddings.
    """
    if not passages:
        return None
    try:
        return list(_embedding_model().embed(passages))
    except Exception:
        logger.exception("Local embedding model is unavailable; using exact/lexical evidence matching.")
        return None


def _cosine_scores(
    query: str, passages: list[str], passage_vectors: list | None = None
) -> list[float | None]:
    if not passages:
        return []
    try:
        import numpy as np

        if passage_vectors is not None:
            # Reuse pre-computed passage vectors; only embed the query token.
            query_vector = list(_embedding_model().embed([query]))[0]
        else:
            vectors = list(_embedding_model().embed([query, *passages]))
            query_vector = vectors[0]
            passage_vectors = vectors[1:]
        return [
            float(np.clip(np.dot(query_vector, vector) / (np.linalg.norm(query_vector) * np.linalg.norm(vector)), 0, 1))
            for vector in passage_vectors
        ]
    except Exception:
        logger.exception("Local embedding model is unavailable; using exact/lexical evidence matching.")
        query_terms = set(re.findall(r"[\w+#.]+", query.casefold()))
        return [
            len(query_terms & set(re.findall(r"[\w+#.]+", passage.casefold())))
            / max(1, len(query_terms | set(re.findall(r"[\w+#.]+", passage.casefold()))))
            for passage in passages
        ]


def _reranker_scores(query: str, passages: list[str]) -> list[float | None]:
    if not passages:
        return []
    try:
        logits = list(_reranker_model().rerank(query, passages))
        return [1 / (1 + math.exp(-max(-30, min(30, float(logit))))) for logit in logits]
    except Exception:
        logger.exception("Local cross-encoder reranker unavailable; retaining hybrid retrieval scores.")
        return [None] * len(passages)


def _experience_match(requirement: JobRequirement, evidence: ResumeEvidence) -> bool | None:
    if requirement.minimum_years is None:
        return None
    if evidence.source_type not in {"professional", "internship"}:
        return False
    stated_years = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*years?", evidence.evidence, re.IGNORECASE)
    years = float(stated_years.group(1)) if stated_years else 0.0
    if evidence.start_year is not None and evidence.end_year is not None:
        years = max(years, float(max(0, evidence.end_year - evidence.start_year)))
    if years == 0:
        return None
    return years >= requirement.minimum_years


def score_requirements(
    requirements: list[JobRequirement],
    profile: StructuredResume,
    resume_text: str,
    weights: MatchingWeights | None = None,
) -> dict:
    """Score each requirement against quoted, source-typed candidate evidence."""
    weights = weights or MatchingWeights()
    evidence_items = [
        item
        for item in profile.evidence
        if item.evidence.casefold() in resume_text.casefold()
    ]
    # Pre-compute passage embeddings once — the same evidence passages are
    # scored against every requirement, so embedding them per-requirement is
    # redundant work (N requirements × M passages → M + N).
    passages = [f"{item.normalized_concept}. {item.evidence}" for item in evidence_items]
    passage_vectors = _precompute_passage_vectors(passages)
    scored = []
    for requirement in requirements:
        candidates = evidence_items
        query = f"{requirement.normalized_concept}. {requirement.text}"
        semantic = _cosine_scores(query, passages, passage_vectors=passage_vectors) if passages else []
        top_indices = sorted(range(len(candidates)), key=lambda index: semantic[index] or 0, reverse=True)[:5]
        reranked = _reranker_scores(query, [passages[index] for index in top_indices]) if top_indices else []
        rerank_by_index = dict(zip(top_indices, reranked, strict=False))
        best = None
        best_score = -1.0
        for index, evidence in enumerate(candidates):
            exact = normalize_concept(requirement.normalized_concept) == normalize_concept(evidence.normalized_concept)
            sem = semantic[index]
            rerank = rerank_by_index.get(index)
            source_strength = SOURCE_STRENGTH[evidence.source_type]
            components = [(weights.exact, 1.0 if exact else 0.0), (weights.evidence, source_strength)]
            if sem is not None:
                components.append((weights.semantic, sem))
            if rerank is not None:
                components.append((weights.reranker, rerank))
            denominator = sum(weight for weight, _ in components)
            match_score = sum(weight * value for weight, value in components) / denominator if denominator else 0.0
            if match_score > best_score:
                best_score = match_score
                best = (evidence, exact, sem, rerank, source_strength)

        is_relevant = best is not None and (
            best[1]
            or (best[2] or 0.0) >= 0.20
            or (best[3] or 0.0) >= 0.40
        )
        if best is None or not is_relevant:
            result = {
                "criterion_id": requirement.id,
                "name": requirement.text,
                "required": requirement.requirement_class == "must_have",
                "requirement_type": requirement.requirement_type,
                "priority": requirement.priority,
                "score": 0,
                "exact_match": False,
                "semantic_score": None,
                "reranker_score": None,
                "experience_match": None,
                "evidence_strength": 0.0,
                "status": "missing",
                "evidence": [],
            }
        else:
            evidence, exact, sem, rerank, strength = best
            experience = _experience_match(requirement, evidence)
            if experience is False:
                best_score *= 0.5
            status = (
                "matched"
                if (exact and experience is not False) or best_score >= weights.matched_threshold
                else "partially_matched"
                if best_score >= weights.partial_threshold
                else "insufficient_evidence"
            )
            result = {
                "criterion_id": requirement.id,
                "name": requirement.text,
                "required": requirement.requirement_class == "must_have",
                "requirement_type": requirement.requirement_type,
                "priority": requirement.priority,
                "score": round(best_score * 100),
                "exact_match": exact,
                "semantic_score": round(sem * 100) if sem is not None else None,
                "reranker_score": round(rerank * 100) if rerank is not None else None,
                "experience_match": experience,
                "evidence_strength": round(strength, 2),
                "status": status,
                "evidence": [evidence.evidence],
            }
        scored.append(result)

    def weighted_average(items: list[dict]) -> float | None:
        if not items:
            return None
        total_weight = sum(item["priority"] for item in items)
        return sum(item["score"] * item["priority"] for item in items) / total_weight

    must = [item for item in scored if item["required"]]
    nice = [item for item in scored if not item["required"]]
    must_score = weighted_average(must)
    nice_score = weighted_average(nice)
    group_weights = []
    if must_score is not None:
        group_weights.append((weights.must_have_group, must_score))
    if nice_score is not None:
        group_weights.append((weights.nice_to_have_group, nice_score))
    denominator = sum(weight for weight, _ in group_weights)
    overall = round(sum(weight * score for weight, score in group_weights) / denominator) if denominator else 0
    return {
        "score": overall,
        "job_match_score": round(must_score if must_score is not None else (nice_score or 0)),
        "preferred_score": round(nice_score) if nice_score is not None else None,
        "bonus_points": 0,
        "required_checks_passed": all(item["status"] == "matched" for item in must) if must else None,
        "required_checks": [
            {"name": item["name"], "met": item["status"] == "matched", "evidence": item["evidence"]}
            for item in must
        ],
        "job_evidence": list(dict.fromkeys(quote for item in scored for quote in item["evidence"]))[:5],
        "assessments": scored,
        "matching_method": "hybrid_exact_embedding_cross_encoder",
        "weights": weights.model_dump(),
        "must_have_score": round(must_score) if must_score is not None else None,
        "nice_to_have_score": round(nice_score) if nice_score is not None else None,
    }
