"""Reproducible held-out comparison of BM25, embeddings, and hybrid ranking."""

from __future__ import annotations

import argparse
from collections import defaultdict
from collections.abc import Sequence
from importlib.metadata import PackageNotFoundError, version
import json
import math
import os
import re
from pathlib import Path
from time import perf_counter
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator
from rank_bm25 import BM25Okapi

from .evaluation import evaluate_resume
from .matching import _embed_texts, default_matching_weights

TOKEN_PATTERN = re.compile(r"[\w+#.]+", re.UNICODE)


class ExperimentPair(BaseModel):
    candidate_id: str = Field(min_length=1)
    group_id: str = Field(min_length=1)
    job_id: str = Field(min_length=1)
    split: Literal["train", "dev", "test"]
    job_text: str = Field(min_length=1)
    resume_text: str = Field(min_length=1)
    relevance: int = Field(ge=0, le=3)
    required_skills: list[str] = Field(default_factory=list)
    experience_match: float | None = Field(default=None, ge=0, le=1)
    qualification_match: float | None = Field(default=None, ge=0, le=1)
    # Optional, independently reviewed research labels. These fields are never
    # consumed by production scoring; audit_group should be pseudonymous.
    requirement_labels: dict[str, bool] = Field(default_factory=dict)
    audit_group: str | None = Field(default=None, min_length=1, max_length=80)
    job_family: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("candidate_id", "group_id", "job_id", "job_text", "resume_text")
    @classmethod
    def require_nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Dataset identifiers and text fields must not be blank.")
        return value


def _tokens(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.casefold())


def _normalize(values: Sequence[float]) -> list[float]:
    if not values:
        return []
    low, high = min(values), max(values)
    if high == low:
        return [0.5 for _ in values]
    return [(value - low) / (high - low) for value in values]


def _ranking_metrics(
    pairs: list[ExperimentPair],
    scores: dict[tuple[str, str], float],
) -> dict[str, float | int | None]:
    by_job: dict[str, list[ExperimentPair]] = defaultdict(list)
    for pair in pairs:
        by_job[pair.job_id].append(pair)

    ndcg_values: list[float] = []
    precision_values: list[float] = []
    recall_values: list[float] = []
    reciprocal_ranks: list[float] = []
    spearman_values: list[float] = []
    kendall_values: list[float] = []
    for candidates in by_job.values():
        ranked = sorted(
            candidates,
            key=lambda item: (
                -scores[(item.job_id, item.candidate_id)],
                item.candidate_id,
            ),
        )
        predicted = [scores[(item.job_id, item.candidate_id)] for item in candidates]
        relevance = [float(item.relevance) for item in candidates]
        correlation = _rank_correlations(predicted, relevance)
        if correlation["Spearman"] is not None:
            spearman_values.append(correlation["Spearman"])
        if correlation["Kendall"] is not None:
            kendall_values.append(correlation["Kendall"])
        relevant_total = sum(pair.relevance > 0 for pair in candidates)
        top_10 = ranked[:10]
        dcg = sum(
            (2**pair.relevance - 1) / math.log2(index + 2)
            for index, pair in enumerate(top_10)
        )
        ideal = sorted((pair.relevance for pair in candidates), reverse=True)[:10]
        idcg = sum(
            (2**relevance - 1) / math.log2(index + 2)
            for index, relevance in enumerate(ideal)
        )
        if idcg:
            ndcg_values.append(dcg / idcg)
        top_5_relevant = sum(pair.relevance > 0 for pair in ranked[:5])
        precision_values.append(top_5_relevant / 5)
        top_10_relevant = sum(pair.relevance > 0 for pair in top_10)
        recall_values.append(
            top_10_relevant / relevant_total if relevant_total else 0.0
        )
        first_relevant_rank = next(
            (index for index, pair in enumerate(ranked, start=1) if pair.relevance > 0),
            None,
        )
        if first_relevant_rank is not None:
            reciprocal_ranks.append(1 / first_relevant_rank)

    return {
        "job_count": len(by_job),
        "NDCG@10": sum(ndcg_values) / len(ndcg_values) if ndcg_values else None,
        "Precision@5": sum(precision_values) / len(precision_values) if precision_values else None,
        "Recall@10": sum(recall_values) / len(recall_values) if recall_values else None,
        "MRR": sum(reciprocal_ranks) / len(reciprocal_ranks) if reciprocal_ranks else None,
        "Spearman": sum(spearman_values) / len(spearman_values) if spearman_values else None,
        "Kendall": sum(kendall_values) / len(kendall_values) if kendall_values else None,
    }


def _average_ranks(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        rank = (start + 1 + end) / 2
        for position in range(start, end):
            ranks[order[position]] = rank
        start = end
    return ranks


def _rank_correlations(left: Sequence[float], right: Sequence[float]) -> dict[str, float | None]:
    if len(left) < 2:
        return {"Spearman": None, "Kendall": None}
    left_ranks = _average_ranks(left)
    right_ranks = _average_ranks(right)

    def pearson(a: Sequence[float], b: Sequence[float]) -> float | None:
        mean_a = sum(a) / len(a)
        mean_b = sum(b) / len(b)
        covariance = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b, strict=True))
        norm_a = sum((x - mean_a) ** 2 for x in a)
        norm_b = sum((y - mean_b) ** 2 for y in b)
        return covariance / math.sqrt(norm_a * norm_b) if norm_a and norm_b else None

    concordant = discordant = left_ties = right_ties = 0
    for first in range(len(left)):
        for second in range(first + 1, len(left)):
            delta_left = left[first] - left[second]
            delta_right = right[first] - right[second]
            if delta_left == 0 and delta_right == 0:
                continue
            if delta_left == 0:
                left_ties += 1
            elif delta_right == 0:
                right_ties += 1
            elif delta_left * delta_right > 0:
                concordant += 1
            else:
                discordant += 1
    denominator = math.sqrt(
        (concordant + discordant + left_ties)
        * (concordant + discordant + right_ties)
    )
    return {
        "Spearman": pearson(left_ranks, right_ranks),
        "Kendall": (concordant - discordant) / denominator if denominator else None,
    }


def _requirement_metrics(pairs: list[ExperimentPair], assessments: dict[tuple[str, str], list[dict]]) -> dict:
    true_positive = false_positive = false_negative = 0
    for pair in pairs:
        predicted = {
            item["criterion_id"]: item["status"] == "matched"
            for item in assessments.get((pair.job_id, pair.candidate_id), [])
        }
        for requirement_id, relevant in pair.requirement_labels.items():
            matched = predicted.get(requirement_id, False)
            true_positive += int(relevant and matched)
            false_positive += int(not relevant and matched)
            false_negative += int(relevant and not matched)
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else None
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else None
    f1 = 2 * precision * recall / (precision + recall) if precision is not None and recall is not None and precision + recall else None
    return {"labeled_requirement_count": true_positive + false_positive + false_negative, "precision": precision, "recall": recall, "f1": f1}


def _evidence_metrics(pairs: list[ExperimentPair], assessments: dict[tuple[str, str], list[dict]]) -> dict:
    requirement_count = evidence_count = quote_count = unsupported_quote_count = 0
    for pair in pairs:
        for assessment in assessments.get((pair.job_id, pair.candidate_id), []):
            requirement_count += 1
            quotes = assessment.get("evidence", [])
            evidence_count += int(bool(quotes))
            for quote in quotes:
                quote_count += 1
                unsupported_quote_count += int(quote.casefold() not in pair.resume_text.casefold())
    return {
        "requirement_evidence_coverage": evidence_count / requirement_count if requirement_count else None,
        "evidence_quote_count": quote_count,
        "unsupported_evidence_quote_rate": unsupported_quote_count / quote_count if quote_count else None,
    }


def _fairness_metrics(pairs: list[ExperimentPair], scores: dict[tuple[str, str], float], minimum_group_size: int = 5) -> dict:
    """Report top-10 selection rates for pseudonymous, explicitly supplied audit groups."""
    grouped_jobs: dict[str, list[ExperimentPair]] = defaultdict(list)
    groups: dict[str, list[tuple[bool, bool]]] = defaultdict(list)
    for pair in pairs:
        grouped_jobs[pair.job_id].append(pair)
    for candidates in grouped_jobs.values():
        ranked = sorted(candidates, key=lambda item: (-scores[(item.job_id, item.candidate_id)], item.candidate_id))
        selected = {(item.job_id, item.candidate_id) for item in ranked[:10]}
        for pair in candidates:
            if pair.audit_group:
                groups[pair.audit_group].append(((pair.job_id, pair.candidate_id) in selected, pair.relevance > 0))
    included = {
        group: values for group, values in groups.items() if len(values) >= minimum_group_size
    }
    rates = {
        group: {
            "candidate_count": len(values),
            "top_10_selection_rate": sum(selected for selected, _ in values) / len(values),
            "relevant_candidate_recall": (
                sum(selected and relevant for selected, relevant in values)
                / sum(relevant for _, relevant in values)
                if any(relevant for _, relevant in values) else None
            ),
        }
        for group, values in included.items()
    }
    selection_rates = [item["top_10_selection_rate"] for item in rates.values()]
    ratio = min(selection_rates) / max(selection_rates) if selection_rates and max(selection_rates) else None
    return {
        "minimum_group_size": minimum_group_size,
        "groups_below_minimum_suppressed": len(groups) - len(included),
        "top_10_selection_rate_ratio_min_to_max": ratio,
        "by_group": rates,
    }


def _validate_splits(pairs: list[ExperimentPair]) -> None:
    if not {"train", "dev", "test"}.issubset({pair.split for pair in pairs}):
        raise ValueError("Dataset must contain train, dev, and test splits.")
    group_splits: dict[str, set[str]] = defaultdict(set)
    candidate_splits: dict[str, set[str]] = defaultdict(set)
    seen_pairs: set[tuple[str, str]] = set()
    for pair in pairs:
        group_splits[pair.group_id].add(pair.split)
        candidate_splits[pair.candidate_id].add(pair.split)
        key = pair.job_id, pair.candidate_id
        if key in seen_pairs:
            raise ValueError(f"Duplicate candidate/job pair: {pair.job_id}/{pair.candidate_id}.")
        seen_pairs.add(key)
    if any(len(splits) > 1 for splits in group_splits.values()):
        raise ValueError("Related group_id values must not cross dataset splits.")
    if any(len(splits) > 1 for splits in candidate_splits.values()):
        raise ValueError("candidate_id values must not cross dataset splits.")


def _score_test_pairs(
    pairs: list[ExperimentPair],
) -> tuple[dict[str, dict[tuple[str, str], float]], float, dict[tuple[str, str], list[dict]]]:
    per_method: dict[str, dict[tuple[str, str], float]] = {
        "keyword_bm25": {},
        "semantic_cosine": {},
        "hybrid": {},
    }
    started = perf_counter()
    assessments_by_pair: dict[tuple[str, str], list[dict]] = {}
    production_weights = default_matching_weights()
    by_job: dict[str, list[ExperimentPair]] = defaultdict(list)
    for pair in pairs:
        by_job[pair.job_id].append(pair)

    for candidates in by_job.values():
        job_text = candidates[0].job_text
        if any(pair.job_text != job_text for pair in candidates):
            raise ValueError("Each job_id must have identical job_text across its candidates.")
        tokenized_resumes = [_tokens(pair.resume_text) for pair in candidates]
        query_terms = _tokens(job_text)
        if query_terms and any(tokenized_resumes):
            bm25 = BM25Okapi(tokenized_resumes)
            lexical = [float(value) for value in bm25.get_scores(query_terms)]
        else:
            lexical = [0.0] * len(candidates)
        semantic_vectors = _embed_texts([job_text, *(pair.resume_text for pair in candidates)])
        query_vector = semantic_vectors[0]
        semantic = [
            sum(left * right for left, right in zip(query_vector, vector, strict=True))
            / max(
                math.sqrt(sum(value * value for value in query_vector))
                * math.sqrt(sum(value * value for value in vector)),
                1e-12,
            )
            for vector in semantic_vectors[1:]
        ]
        for index, pair in enumerate(candidates):
            key = pair.job_id, pair.candidate_id
            per_method["keyword_bm25"][key] = lexical[index]
            per_method["semantic_cosine"][key] = semantic[index]
            # Use the same extraction, quote validation, requirement matching,
            # and score aggregation as the screening worker. Human relevance
            # labels remain evaluation-only and are never passed to the scorer.
            production = evaluate_resume(
                pair.job_text, pair.resume_text, weights=production_weights
            )
            per_method["hybrid"][key] = float(production["score"]) / 100
            assessments_by_pair[key] = production["assessments"]
    return per_method, (perf_counter() - started) / max(1, len(pairs)), assessments_by_pair


def run_experiment(dataset_path: Path, dataset_version: str) -> dict:
    pairs: list[ExperimentPair] = []
    with dataset_path.open(encoding="utf-8") as dataset_file:
        for line_number, line in enumerate(dataset_file, start=1):
            if not line.strip():
                continue
            try:
                pairs.append(ExperimentPair.model_validate_json(line))
            except ValidationError as error:
                raise ValueError(f"Invalid dataset record on line {line_number}: {error}") from error
    _validate_splits(pairs)
    test_pairs = [pair for pair in pairs if pair.split == "test"]
    weights = default_matching_weights()
    scores, seconds_per_resume, assessments = _score_test_pairs(test_pairs)
    try:
        fastembed_version = version("fastembed")
        rank_bm25_version = version("rank-bm25")
    except PackageNotFoundError as error:
        raise RuntimeError(f"Missing experiment package: {error.name}") from error
    return {
        "scorer_version": "recruitai-ranking-v2",
        "dataset_version": dataset_version,
        "fastembed_version": fastembed_version,
        "rank_bm25_version": rank_bm25_version,
        "embedding_model": os.getenv(
            "MATCH_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        ),
        "production_matching_weights": weights.model_dump(),
        "hybrid_method": "production requirement-level exact/embedding/evidence matcher",
        "structured_extraction_requested": os.getenv("AI_EXTRACTION_ENABLED", "false").casefold() == "true"
        and os.getenv("AI_PROVIDER", "ollama").strip().casefold() == "ollama",
        "reranker_enabled": os.getenv("MATCH_ENABLE_RERANKER", "false").casefold() == "true",
        "reranker_model": os.getenv("MATCH_RERANKER_MODEL", "jinaai/jina-reranker-v2-base-multilingual"),
        "test_pair_count": len(test_pairs),
        "seconds_per_resume": seconds_per_resume,
        "metrics": {
            method: _ranking_metrics(test_pairs, method_scores)
            for method, method_scores in scores.items()
        },
        "requirement_metrics": _requirement_metrics(test_pairs, assessments),
        "evidence_metrics": _evidence_metrics(test_pairs, assessments),
        "fairness_audit": _fairness_metrics(test_pairs, scores["hybrid"]),
        "job_family_metrics": {
            family: {
                method: _ranking_metrics(
                    [pair for pair in test_pairs if pair.job_family == family], method_scores
                )
                for method, method_scores in scores.items()
            }
            for family in sorted({pair.job_family for pair in test_pairs if pair.job_family})
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True, help="UTF-8 JSONL with explicit train/dev/test splits.")
    parser.add_argument("--dataset-version", required=True, help="Human-managed immutable dataset version.")
    arguments = parser.parse_args()
    report = run_experiment(arguments.dataset, arguments.dataset_version)
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
