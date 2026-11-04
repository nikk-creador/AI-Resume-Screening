from math import log2
from typing import Sequence


RANKING_METRICS_K = 5
QUALIFIED_RELEVANCE_THRESHOLD = 2


def calculate_ranking_metrics(
    candidates: Sequence[tuple[int, int | None]],
    k: int = RANKING_METRICS_K,
) -> dict[str, int | float | None]:
    ranked = sorted(candidates, key=lambda candidate: candidate[0], reverse=True)
    completed_count = len(ranked)
    labeled = [relevance for _score, relevance in ranked if relevance is not None]
    labeled_count = len(labeled)
    qualified_count = sum(
        relevance >= QUALIFIED_RELEVANCE_THRESHOLD for relevance in labeled
    )
    effective_k = min(k, completed_count)
    result: dict[str, int | float | None] = {
        "k": k,
        "effective_k": effective_k,
        "completed_count": completed_count,
        "labeled_count": labeled_count,
        "unlabeled_count": completed_count - labeled_count,
        "qualified_count": qualified_count,
        "qualified_threshold": QUALIFIED_RELEVANCE_THRESHOLD,
        "precision": None,
        "recall": None,
        "ndcg": None,
    }
    if completed_count == 0 or labeled_count != completed_count:
        return result

    relevant_total = sum(
        relevance >= QUALIFIED_RELEVANCE_THRESHOLD for relevance in labeled
    )
    discounted_gain = 0.0
    expected_relevant_in_top_k = 0.0
    position = 0
    while position < completed_count:
        score = ranked[position][0]
        end = position
        while end < completed_count and ranked[end][0] == score:
            end += 1
        group = [relevance for _score, relevance in ranked[position:end]]
        selected_count = min(end, effective_k) - position
        if selected_count > 0:
            expected_relevant_in_top_k += selected_count * sum(
                relevance >= QUALIFIED_RELEVANCE_THRESHOLD for relevance in group
            ) / len(group)
            average_gain = sum(2**relevance - 1 for relevance in group) / len(group)
            discounted_gain += average_gain * sum(
                1 / log2(rank + 1)
                for rank in range(position + 1, position + selected_count + 1)
            )
        position = end

    ideal_gains = sorted((2**relevance - 1 for relevance in labeled), reverse=True)
    ideal_discounted_gain = sum(
        gain / log2(rank + 2) for rank, gain in enumerate(ideal_gains[:effective_k])
    )
    result["precision"] = expected_relevant_in_top_k / effective_k
    result["recall"] = (
        expected_relevant_in_top_k / relevant_total if relevant_total else None
    )
    result["ndcg"] = (
        discounted_gain / ideal_discounted_gain if ideal_discounted_gain else 0.0
    )
    return result
