"""Prepare privacy-reduced, unreviewed resume extraction drafts from a HF dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

from backend.training.finetune import EXTRACTION_PROMPTS

DATASET_ID = "sukhrobnurali/resume-parsing-vision"
SPLITS = ("train", "validation", "test")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)")
DOB_LINE_RE = re.compile(r"(?im)^.*\b(?:dob|date of birth|birth date)\b.*(?:\n|$)")


def redact_direct_identifiers(text: str, ground_truth: dict) -> str:
    text = EMAIL_RE.sub("[REDACTED EMAIL]", text)
    text = PHONE_RE.sub("[REDACTED PHONE]", text)
    text = DOB_LINE_RE.sub("", text)
    for key in ("first_name", "last_name", "email", "phone", "address"):
        value = ground_truth.get(key)
        if isinstance(value, str) and len(value.strip()) >= 2:
            text = re.sub(re.escape(value.strip()), "[REDACTED]", text, flags=re.IGNORECASE)
    return text.strip()


def _skill_name(value: object) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        for key in ("name", "skill", "skill_name", "title", "value"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    return None


def _skill_values(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return list(value.values())
    if isinstance(value, str):
        return [value]
    return []


def _evidence_quote(source_text: str, skill: str) -> str | None:
    match = re.search(re.escape(skill), source_text, flags=re.IGNORECASE)
    if not match:
        return None
    start = max(0, match.start() - 24)
    end = min(len(source_text), match.end() + 24)
    quote = source_text[start:end].strip()
    if len(quote) < 8:
        return None
    return quote[:800]


def convert_row(row: dict) -> dict | None:
    try:
        ground_truth = json.loads(row.get("ground_truth") or "{}")
    except (TypeError, json.JSONDecodeError):
        return None
    source_text = redact_direct_identifiers(str(row.get("resume_text") or ""), ground_truth)
    if len(source_text) < 20:
        return None

    evidence = []
    for raw_skill in _skill_values(ground_truth.get("skills")):
        skill = _skill_name(raw_skill)
        if not skill or len(skill) < 2:
            continue
        quote = _evidence_quote(source_text, skill)
        if not quote:
            continue
        evidence.append({
            "normalized_concept": skill.casefold()[:160],
            "evidence": quote,
            "section": "Unknown",
            "source_type": "other",
            "start_year": None,
            "end_year": None,
        })
    if not evidence:
        return None
    return {
        "reviewed": False,
        "synthetic": True,
        "task": "resume",
        "source_text": source_text,
        "target": {"evidence": evidence[:100]},
    }


def _fits_context(example: dict, tokenizer, max_length: int) -> bool:
    prompt = EXTRACTION_PROMPTS[example["task"]]
    user_content = json.dumps(
        {"task": example["task"], "source_text": example["source_text"], "instructions": prompt},
        ensure_ascii=False,
    )
    token_ids = tokenizer.apply_chat_template(
        [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": json.dumps(example["target"], ensure_ascii=False)},
        ],
        tokenize=True,
        add_generation_prompt=False,
    )
    return len(token_ids) <= max_length


def prepare(
    output_dir: Path,
    dataset_id: str = DATASET_ID,
    base_model: str = "Qwen/Qwen2.5-1.5B-Instruct",
    max_length: int = 2048,
) -> dict[str, dict[str, int]]:
    try:
        from datasets import load_dataset
        from transformers import AutoTokenizer
    except ImportError as error:
        raise RuntimeError("Install backend/requirements-training.txt, including datasets and transformers, first.") from error

    dataset = load_dataset(dataset_id)
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    output_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, dict[str, int]] = {}
    for split in SPLITS:
        if split not in dataset:
            raise ValueError(f"Dataset {dataset_id} is missing its expected {split!r} split.")
        required_columns = {"resume_text", "ground_truth"}
        if not required_columns.issubset(dataset[split].column_names):
            raise ValueError(f"Dataset {dataset_id} {split!r} split must contain resume_text and ground_truth.")
        text_rows = dataset[split].select_columns(["resume_text", "ground_truth"])
        output_path = output_dir / f"{split}.draft.jsonl"
        count = 0
        too_long = 0
        with output_path.open("w", encoding="utf-8", newline="\n") as stream:
            for row in text_rows:
                converted = convert_row(row)
                if not converted:
                    continue
                if not _fits_context(converted, tokenizer, max_length):
                    too_long += 1
                    continue
                stream.write(json.dumps(converted, ensure_ascii=False) + "\n")
                count += 1
        counts[split] = {"included": count, "skipped_over_context": too_long}
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default=DATASET_ID, help="Hugging Face dataset repository id.")
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument("--max-length", type=int, default=2048, help="Exclude samples exceeding this full prompt+target token length.")
    parser.add_argument("--output-dir", type=Path, default=Path("backend/training/data/resume-parsing-vision"))
    args = parser.parse_args()
    try:
        counts = prepare(args.output_dir, args.dataset, args.base_model, args.max_length)
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print("Wrote unreviewed synthetic draft examples (eligible only with --allow-synthetic-data):")
    for split, detail in counts.items():
        print(
            f"  {split}: {detail['included']} included, "
            f"{detail['skipped_over_context']} skipped over {args.max_length} tokens "
            f"-> {args.output_dir / f'{split}.draft.jsonl'}"
        )
    print("Review labels and evidence before marking any examples reviewed=true.")


if __name__ == "__main__":
    main()
