"""Fine-tune the resume/JD encoder with labeled pairs and hard triplets."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import nullcontext
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import random
import re


DEFAULT_PAIR_DATASET = Path("backend/pairs.jsonl")
DEFAULT_TRIPLET_DATASET = Path("backend/triplets.jsonl")
DEFAULT_OUTPUT_DIR = Path("backend/training/output/resume-encoder")
DEFAULT_BASE_MODEL = "sentence-transformers/all-mpnet-base-v2"


@dataclass(frozen=True)
class PairRecord:
    job_key: str
    resume_key: str
    label: int


@dataclass(frozen=True)
class TripletRecord:
    job_key: str
    positive_key: str
    negative_key: str


@dataclass
class RankingData:
    texts: dict[str, str]
    pairs: list[PairRecord]
    triplets: list[TripletRecord]
    skipped_identical_triplets: int = 0


def _positive_pair_records(records: list[PairRecord]) -> list[PairRecord]:
    return [record for record in records if record.label == 1]


def _text_key(text: str) -> str:
    normalized = " ".join(text.split()).casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _read_text(record: dict, field: str, path: Path, line_number: int) -> tuple[str, str]:
    value = record.get(field)
    if not isinstance(value, str) or len(value.strip()) < 20:
        raise ValueError(f"{path}:{line_number}: {field!r} must contain at least 20 characters.")
    text = value.strip()
    return _text_key(text), text


def load_ranking_data(pair_path: Path, triplet_path: Path) -> RankingData:
    texts: dict[str, str] = {}
    pairs: list[PairRecord] = []
    triplets: list[TripletRecord] = []
    skipped_identical_triplets = 0
    positive_pairs: set[tuple[str, str]] = set()

    with pair_path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{pair_path}:{line_number}: invalid JSON.") from error
            if not isinstance(row, dict) or type(row.get("label")) is not int or row["label"] not in (0, 1):
                raise ValueError(f"{pair_path}:{line_number}: expected an integer label of 0 or 1.")
            job_key, job_text = _read_text(row, "jd", pair_path, line_number)
            resume_key, resume_text = _read_text(row, "resume", pair_path, line_number)
            texts.setdefault(job_key, job_text)
            texts.setdefault(resume_key, resume_text)
            pairs.append(PairRecord(job_key, resume_key, row["label"]))
            if row["label"] == 1:
                positive_pairs.add((job_key, resume_key))

    with triplet_path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{triplet_path}:{line_number}: invalid JSON.") from error
            if not isinstance(row, dict):
                raise ValueError(f"{triplet_path}:{line_number}: expected a JSON object.")
            job_key, job_text = _read_text(row, "jd", triplet_path, line_number)
            positive_key, positive_text = _read_text(row, "positive", triplet_path, line_number)
            negative_key, negative_text = _read_text(row, "negative", triplet_path, line_number)
            if positive_key == negative_key:
                skipped_identical_triplets += 1
                continue
            if (job_key, positive_key) not in positive_pairs:
                raise ValueError(f"{triplet_path}:{line_number}: positive pair is missing from the labeled pair data.")
            texts.setdefault(job_key, job_text)
            texts.setdefault(positive_key, positive_text)
            texts.setdefault(negative_key, negative_text)
            triplets.append(TripletRecord(job_key, positive_key, negative_key))

    labels = Counter(record.label for record in pairs)
    if not pairs or not labels[0] or not labels[1] or not triplets:
        raise ValueError("Training needs positive and negative pairs plus at least one triplet.")
    return RankingData(
        texts=texts,
        pairs=pairs,
        triplets=triplets,
        skipped_identical_triplets=skipped_identical_triplets,
    )


def split_by_job_description(
    data: RankingData,
    *,
    seed: int,
    validation_ratio: float,
    test_ratio: float,
) -> dict[str, dict[str, list]]:
    if validation_ratio <= 0 or test_ratio <= 0 or validation_ratio + test_ratio >= 0.5:
        raise ValueError("Validation and test ratios must be positive and total less than 0.5.")
    groups = sorted(
        {record.job_key for record in data.pairs}
        | {record.job_key for record in data.triplets}
    )
    if len(groups) < 10:
        raise ValueError("At least 10 distinct job descriptions are needed for group-based evaluation.")
    random.Random(seed).shuffle(groups)
    test_count = max(1, round(len(groups) * test_ratio))
    validation_count = max(1, round(len(groups) * validation_ratio))
    if test_count + validation_count >= len(groups):
        raise ValueError("Not enough distinct job descriptions remain for training.")
    test_groups = set(groups[:test_count])
    validation_groups = set(groups[test_count : test_count + validation_count])
    assignments = {
        "test": test_groups,
        "validation": validation_groups,
        "train": set(groups[test_count + validation_count :]),
    }
    splits = {
        name: {
            "pairs": [record for record in data.pairs if record.job_key in job_keys],
            "triplets": [record for record in data.triplets if record.job_key in job_keys],
        }
        for name, job_keys in assignments.items()
    }
    for name, split in splits.items():
        labels = Counter(record.label for record in split["pairs"])
        if not labels[0] or not labels[1] or not split["triplets"]:
            raise ValueError(f"The {name} split must contain both pair labels and at least one triplet.")
    return splits


def summarize_data(data: RankingData, splits: dict[str, dict[str, list]]) -> dict:
    summary = {
        "unique_texts": len(data.texts),
        "total_pairs": len(data.pairs),
        "total_positive_pairs": sum(record.label == 1 for record in data.pairs),
        "total_negative_pairs": sum(record.label == 0 for record in data.pairs),
        "total_triplets": len(data.triplets),
        "skipped_identical_triplets": data.skipped_identical_triplets,
        "splits": {},
    }
    for name, split in splits.items():
        summary["splits"][name] = {
            "job_descriptions": len(
                {record.job_key for records in split.values() for record in records}
            ),
            "pairs": len(split["pairs"]),
            "positive_pairs": sum(record.label == 1 for record in split["pairs"]),
            "negative_pairs": sum(record.label == 0 for record in split["pairs"]),
            "triplets": len(split["triplets"]),
        }
    return summary


def _evaluate(model, split: dict[str, list], texts: dict[str, str], batch_size: int) -> dict:
    import numpy as np
    from sklearn.metrics import balanced_accuracy_score, roc_auc_score

    pairs = split["pairs"]
    triplets = split["triplets"]
    keys = sorted(
        {record.job_key for record in pairs}
        | {record.resume_key for record in pairs}
        | {record.positive_key for record in triplets}
        | {record.negative_key for record in triplets}
    )
    vectors = model.encode(
        [texts[key] for key in keys],
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    embedding_by_key = dict(zip(keys, vectors))
    pair_scores = np.asarray(
        [float(np.dot(embedding_by_key[row.job_key], embedding_by_key[row.resume_key])) for row in pairs],
        dtype=np.float32,
    )
    labels = np.asarray([row.label for row in pairs], dtype=np.int32)
    auc = float(roc_auc_score(labels, pair_scores)) if len(set(labels.tolist())) == 2 else None

    grouped = defaultdict(list)
    for row, score in zip(pairs, pair_scores):
        grouped[row.job_key].append((float(score), row.label))
    precision_values: list[float] = []
    recall_values: list[float] = []
    ndcg_values: list[float] = []
    for candidates in grouped.values():
        ranked = sorted(candidates, key=lambda item: item[0], reverse=True)
        top = ranked[:5]
        relevant_top = sum(label for _score, label in top)
        relevant_total = sum(label for _score, label in ranked)
        precision_values.append(relevant_top / len(top))
        if relevant_total:
            recall_values.append(relevant_top / relevant_total)
        dcg = sum(label / math.log2(rank + 2) for rank, (_score, label) in enumerate(top))
        ideal = sum(1 / math.log2(rank + 2) for rank in range(min(5, relevant_total)))
        ndcg_values.append(dcg / ideal if ideal else 0.0)

    triplet_wins = sum(
        float(np.dot(embedding_by_key[row.job_key], embedding_by_key[row.positive_key]))
        > float(np.dot(embedding_by_key[row.job_key], embedding_by_key[row.negative_key]))
        for row in triplets
    )
    metric = {
        "pair_roc_auc": auc,
        "precision_at_5": sum(precision_values) / len(precision_values) if precision_values else None,
        "recall_at_5": sum(recall_values) / len(recall_values) if recall_values else None,
        "ndcg_at_5": sum(ndcg_values) / len(ndcg_values) if ndcg_values else None,
        "triplet_accuracy": triplet_wins / len(triplets) if triplets else None,
    }
    quality_values = [metric[name] for name in ("pair_roc_auc", "ndcg_at_5", "triplet_accuracy") if metric[name] is not None]
    metric["validation_quality"] = sum(quality_values) / len(quality_values) if quality_values else None
    return metric


def _best_balanced_threshold(scores: list[float], labels: list[int]) -> float:
    import numpy as np
    from sklearn.metrics import balanced_accuracy_score

    candidates = np.linspace(-1.0, 1.0, 401)
    return float(
        max(
            candidates,
            key=lambda threshold: balanced_accuracy_score(labels, [score >= threshold for score in scores]),
        )
    )


def _pair_scores(model, pairs: list[PairRecord], texts: dict[str, str], batch_size: int) -> tuple[list[float], list[int]]:
    import numpy as np

    keys = sorted({record.job_key for record in pairs} | {record.resume_key for record in pairs})
    vectors = model.encode(
        [texts[key] for key in keys],
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    embedding_by_key = dict(zip(keys, vectors))
    return (
        [float(np.dot(embedding_by_key[row.job_key], embedding_by_key[row.resume_key])) for row in pairs],
        [row.label for row in pairs],
    )


def _balanced_accuracy(scores: list[float], labels: list[int], threshold: float) -> float:
    from sklearn.metrics import balanced_accuracy_score

    return float(balanced_accuracy_score(labels, [score >= threshold for score in scores]))


def _save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _export_fastembed_model(model, output_dir: Path, max_seq_length: int) -> None:
    import torch

    transformer = model[0].auto_model.to("cpu").eval()
    tokenizer = model.tokenizer
    tokenizer.model_max_length = max_seq_length
    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_dir = output_dir / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    transformer.config.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    class TokenEncoder(torch.nn.Module):
        def __init__(self, encoder):
            super().__init__()
            self.encoder = encoder

        def forward(self, input_ids, attention_mask, token_type_ids):
            return self.encoder(
                input_ids=input_ids,
                attention_mask=attention_mask,
                token_type_ids=token_type_ids,
            ).last_hidden_state

    wrapper = TokenEncoder(transformer).eval()
    dummy = tokenizer("resume encoder export", return_tensors="pt", max_length=8, truncation=True)
    input_ids = dummy["input_ids"]
    attention_mask = dummy["attention_mask"]
    token_type_ids = dummy.get("token_type_ids", torch.zeros_like(input_ids))
    torch.onnx.export(
        wrapper,
        (input_ids, attention_mask, token_type_ids),
        str(onnx_dir / "model.onnx"),
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "token_type_ids": {0: "batch", 1: "sequence"},
            "last_hidden_state": {0: "batch", 1: "sequence"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    (output_dir / "README.txt").write_text(
        "Fine-tuned Sentence Transformers ONNX export for FastEmbed.\n"
        "The ONNX graph returns token embeddings; FastEmbed applies the model's mean pooling.\n",
        encoding="utf-8",
    )


def train(args: argparse.Namespace, data: RankingData, splits: dict[str, dict[str, list]]) -> None:
    try:
        import numpy as np
        import torch
        from sentence_transformers import SentenceTransformer, losses
        from torch.utils.data import DataLoader
    except ImportError as error:
        raise RuntimeError(
            "Install a CUDA-enabled PyTorch build and backend/requirements-training.txt before fine-tuning."
        ) from error

    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but PyTorch cannot access a CUDA GPU.")
    if args.device == "auto" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Install CUDA-enabled PyTorch, or explicitly use --device cpu.")
    device = "cuda" if args.device == "auto" else args.device
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if device == "cuda":
        torch.cuda.manual_seed_all(args.seed)

    model = SentenceTransformer(args.base_model, device=device)
    model.max_seq_length = args.max_seq_length
    pair_loss_function = losses.MultipleNegativesRankingLoss(model)
    baseline_validation = _evaluate(model, splits["validation"], data.texts, args.eval_batch_size)
    validation_scores, validation_labels = _pair_scores(
        model, splits["validation"]["pairs"], data.texts, args.eval_batch_size
    )
    baseline_threshold = _best_balanced_threshold(validation_scores, validation_labels)
    baseline_test = _evaluate(model, splits["test"], data.texts, args.eval_batch_size)
    base_test_scores, base_test_labels = _pair_scores(
        model, splits["test"]["pairs"], data.texts, args.eval_batch_size
    )
    baseline_test["pair_balanced_accuracy"] = _balanced_accuracy(
        base_test_scores, base_test_labels, baseline_threshold
    )

    class PairRows:
        def __init__(self, records):
            self.records = records

        def __len__(self):
            return len(self.records)

        def __getitem__(self, index):
            return self.records[index]

    def collate_pairs(rows):
        jobs = [data.texts[row.job_key] for row in rows]
        resumes = [data.texts[row.resume_key] for row in rows]
        return jobs, resumes

    def collate_triplets(rows):
        jobs = [data.texts[row.job_key] for row in rows]
        positives = [data.texts[row.positive_key] for row in rows]
        negatives = [data.texts[row.negative_key] for row in rows]
        return jobs, positives, negatives

    generator = torch.Generator().manual_seed(args.seed)
    pair_loader = DataLoader(
        PairRows(_positive_pair_records(splits["train"]["pairs"])),
        batch_size=args.batch_size,
        shuffle=True,
        generator=generator,
        num_workers=0,
        collate_fn=collate_pairs,
    )
    triplet_loader = DataLoader(
        PairRows(splits["train"]["triplets"]),
        batch_size=args.batch_size,
        shuffle=True,
        generator=torch.Generator().manual_seed(args.seed + 1),
        num_workers=0,
        collate_fn=collate_triplets,
    )
    output_dir = args.output_dir.resolve()
    best_model_dir = output_dir / "best-model"
    best_validation_quality = baseline_validation["validation_quality"] or 0.0
    model.save_pretrained(best_model_dir)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
    accumulation = max(1, args.gradient_accumulation_steps)
    total_updates = max(1, math.ceil(len(pair_loader) / accumulation) * args.epochs)
    warmup_updates = max(1, round(total_updates * 0.05))

    def learning_rate_scale(step: int) -> float:
        if step < warmup_updates:
            return (step + 1) / warmup_updates
        return max(0.0, (total_updates - step) / max(1, total_updates - warmup_updates))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, learning_rate_scale)
    use_amp = device == "cuda"
    scaler = torch.cuda.amp.GradScaler(enabled=use_amp)
    triplet_interval = max(1, round(len(pair_loader) / max(1, len(triplet_loader))))
    best_epoch = 0

    for epoch in range(args.epochs):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        triplet_iter = iter(triplet_loader)
        triplets_used = 0
        running_loss = 0.0
        for step, (jobs, resumes) in enumerate(pair_loader):
            group_start = (step // accumulation) * accumulation
            group_size = min(accumulation, len(pair_loader) - group_start)
            should_train_triplet = step % triplet_interval == 0 and triplets_used < len(triplet_loader)

            amp_context = (
                torch.autocast(device_type="cuda", dtype=torch.float16)
                if use_amp
                else nullcontext()
            )
            with amp_context:
                job_features = {
                    key: value.to(device, non_blocking=use_amp)
                    for key, value in model.tokenize(jobs).items()
                }
                resume_features = {
                    key: value.to(device, non_blocking=use_amp)
                    for key, value in model.tokenize(resumes).items()
                }
                pair_loss = pair_loss_function([job_features, resume_features], None)
            scaler.scale(pair_loss / group_size).backward()
            loss_value = float(pair_loss.detach().item())

            if should_train_triplet:
                try:
                    triplet_jobs, positives, negatives = next(triplet_iter)
                except StopIteration:
                    should_train_triplet = False
                else:
                    amp_context = (
                        torch.autocast(device_type="cuda", dtype=torch.float16)
                        if use_amp
                        else nullcontext()
                    )
                    with amp_context:
                        triplet_texts = triplet_jobs + positives + negatives
                        triplet_features = {
                            key: value.to(device, non_blocking=use_amp)
                            for key, value in model.tokenize(triplet_texts).items()
                        }
                        triplet_embeddings = torch.nn.functional.normalize(
                            model(triplet_features)["sentence_embedding"], p=2, dim=1
                        )
                        tri_size = len(triplet_jobs)
                        anchors = triplet_embeddings[:tri_size]
                        positive_vectors = triplet_embeddings[tri_size : 2 * tri_size]
                        negative_vectors = triplet_embeddings[2 * tri_size :]
                        positive_similarity = (anchors * positive_vectors).sum(dim=1)
                        negative_similarity = (anchors * negative_vectors).sum(dim=1)
                        triplet_loss = torch.relu(
                            args.triplet_margin - positive_similarity + negative_similarity
                        ).mean()
                    scaler.scale(triplet_loss / group_size).backward()
                    loss_value += float(triplet_loss.detach().item())
                    triplets_used += 1

            running_loss += loss_value
            if (step + 1) % accumulation == 0 or step + 1 == len(pair_loader):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.max_grad_norm)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)
            if (step + 1) % args.log_steps == 0:
                print(
                    f"epoch {epoch + 1}/{args.epochs} step {step + 1}/{len(pair_loader)} "
                    f"loss={running_loss / args.log_steps:.4f} triplet_batches={triplets_used}"
                )
                running_loss = 0.0

        validation_metrics = _evaluate(model, splits["validation"], data.texts, args.eval_batch_size)
        print(f"validation epoch {epoch + 1}: {json.dumps(validation_metrics, sort_keys=True)}")
        quality = validation_metrics["validation_quality"] or 0.0
        if quality > best_validation_quality + args.min_validation_gain:
            best_validation_quality = quality
            best_epoch = epoch + 1
            model.save_pretrained(best_model_dir)

    del model
    if use_amp:
        torch.cuda.empty_cache()
    best_model = SentenceTransformer(str(best_model_dir), device=device)
    best_model.max_seq_length = args.max_seq_length
    final_validation = _evaluate(best_model, splits["validation"], data.texts, args.eval_batch_size)
    final_val_scores, final_val_labels = _pair_scores(
        best_model, splits["validation"]["pairs"], data.texts, args.eval_batch_size
    )
    threshold = _best_balanced_threshold(final_val_scores, final_val_labels)
    final_test = _evaluate(best_model, splits["test"], data.texts, args.eval_batch_size)
    final_test_scores, final_test_labels = _pair_scores(
        best_model, splits["test"]["pairs"], data.texts, args.eval_batch_size
    )
    final_test["pair_balanced_accuracy"] = _balanced_accuracy(
        final_test_scores, final_test_labels, threshold
    )
    final_model_dir = output_dir / "sentence-transformer"
    best_model.save_pretrained(final_model_dir)
    fastembed_dir = output_dir / "fastembed"
    if not args.skip_onnx_export:
        _export_fastembed_model(best_model, fastembed_dir, args.max_seq_length)

    report = {
        "base_model": args.base_model,
        "max_seq_length": args.max_seq_length,
        "training_objectives": {
            "pair_loss": "MultipleNegativesRankingLoss",
            "triplet_loss": "margin_ranking",
        },
        "best_epoch": best_epoch,
        "improved_on_validation": best_epoch > 0,
        "validation_threshold_for_balanced_accuracy": threshold,
        "baseline_validation": baseline_validation,
        "baseline_test": baseline_test,
        "fine_tuned_validation": final_validation,
        "fine_tuned_test": final_test,
    }
    _save_json(output_dir / "metrics.json", report)
    print(f"Fine-tuned encoder saved to {final_model_dir}")
    if not args.skip_onnx_export:
        print(f"FastEmbed ONNX export saved to {fastembed_dir}")
    print(f"Metrics saved to {output_dir / 'metrics.json'}")
    if best_epoch == 0:
        print("No validation improvement was observed; the saved encoder remains the base model.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-dataset", type=Path, default=DEFAULT_PAIR_DATASET)
    parser.add_argument("--triplet-dataset", type=Path, default=DEFAULT_TRIPLET_DATASET)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--eval-batch-size", type=int, default=8)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=4)
    parser.add_argument("--max-seq-length", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--negative-similarity", type=float, default=0.2)
    parser.add_argument("--triplet-margin", type=float, default=0.1)
    parser.add_argument("--max-grad-norm", type=float, default=1.0)
    parser.add_argument("--min-validation-gain", type=float, default=0.001)
    parser.add_argument("--validation-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--log-steps", type=int, default=100)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--skip-onnx-export", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.epochs < 1 or args.batch_size < 1 or args.eval_batch_size < 1:
        raise SystemExit("epochs and batch sizes must be positive integers.")
    try:
        data = load_ranking_data(args.pair_dataset, args.triplet_dataset)
        splits = split_by_job_description(
            data,
            seed=args.seed,
            validation_ratio=args.validation_ratio,
            test_ratio=args.test_ratio,
        )
    except ValueError as error:
        raise SystemExit(str(error)) from error
    summary = summarize_data(data, splits)
    print(json.dumps(summary, indent=2))
    if args.validate_only:
        return
    try:
        train(args, data, splits)
    except (ImportError, RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
