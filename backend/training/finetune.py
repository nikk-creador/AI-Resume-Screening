from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
import hashlib
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from backend.app.evaluation import (
    JOB_REQUIREMENTS_SYSTEM_PROMPT,
    MAX_RESUME_TEXT_CHARS,
    RESUME_EXTRACTION_SYSTEM_PROMPT,
)
from backend.app.matching import JobDescriptionProfile, StructuredResume

EXTRACTION_PROMPTS = {
    "resume": RESUME_EXTRACTION_SYSTEM_PROMPT,
    "job_description": JOB_REQUIREMENTS_SYSTEM_PROMPT,
}


class TrainingExample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewed: bool
    synthetic: bool = False
    task: Literal["resume", "job_description"]
    source_text: str = Field(min_length=20, max_length=MAX_RESUME_TEXT_CHARS)
    target: dict

    @model_validator(mode="after")
    def validate_labels(self) -> TrainingExample:
        if not self.reviewed and not self.synthetic:
            raise ValueError("Unreviewed examples are allowed only when explicitly identified as synthetic.")
        if self.task == "job_description" and len(self.source_text) > 10_000:
            raise ValueError("Job-description training inputs must be 10,000 characters or shorter.")
        if self.task == "resume":
            profile = StructuredResume.model_validate(self.target)
            evidence = [item.evidence for item in profile.evidence]
        else:
            JobDescriptionProfile.model_validate(self.target)
            evidence = []
        if any(not quote.strip() or quote.casefold() not in self.source_text.casefold() for quote in evidence):
            raise ValueError("Every resume training evidence quote must appear verbatim in its source text.")
        return self


def load_training_examples(
    dataset_path: Path,
    minimum_examples: int = 100,
    allow_synthetic: bool = False,
) -> list[TrainingExample]:
    if not dataset_path.is_file():
        raise ValueError(f"Training dataset not found: {dataset_path}")
    examples: list[TrainingExample] = []
    for line_number, line in enumerate(dataset_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            example = TrainingExample.model_validate_json(line)
            if not example.reviewed and not (allow_synthetic and example.synthetic):
                raise ValueError("Unreviewed synthetic data requires --allow-synthetic-data.")
            examples.append(example)
        except ValueError as error:
            raise ValueError(f"Invalid training example on line {line_number}: {error}") from error
        except ValidationError as error:
            raise ValueError(f"Invalid training example on line {line_number}: {error.errors()[0]['msg']}") from error
    if len(examples) < minimum_examples:
        raise ValueError(
            f"Need at least {minimum_examples} recruiter-reviewed examples; found {len(examples)}."
        )
    return examples


def _prompt_content(example: TrainingExample) -> str:
    return json.dumps(
        {
            "task": example.task,
            "source_text": example.source_text,
            "instructions": EXTRACTION_PROMPTS[example.task],
        },
        ensure_ascii=False,
    )


def _tokenize_examples(examples, tokenizer, max_length: int):
    records = []
    for index, example in enumerate(examples, 1):
        user_content = _prompt_content(example)
        prompt_ids = tokenizer.apply_chat_template(
            [
                {"role": "system", "content": EXTRACTION_PROMPTS[example.task]},
                {"role": "user", "content": user_content},
            ],
            tokenize=True,
            add_generation_prompt=True,
        )
        complete_ids = tokenizer.apply_chat_template(
            [
                {"role": "system", "content": EXTRACTION_PROMPTS[example.task]},
                {"role": "user", "content": user_content},
                {
                    "role": "assistant",
                    "content": json.dumps(example.target, ensure_ascii=False),
                },
            ],
            tokenize=True,
            add_generation_prompt=False,
        )
        if complete_ids[: len(prompt_ids)] != prompt_ids:
            raise ValueError(f"Tokenizer chat template did not preserve the prompt prefix at example {index}.")
        if len(complete_ids) > max_length:
            raise ValueError(
                f"Training example {index} exceeds {max_length} tokens; shorten its resume text before training."
            )
        records.append(
            {
                "input_ids": complete_ids,
                "labels": [-100] * len(prompt_ids) + complete_ids[len(prompt_ids) :],
            }
        )
    return records


def score_extraction_predictions(
    examples: list[TrainingExample], predictions: list[str]
) -> dict[str, int | float | None]:
    """Measure output format and evidence quote presence, not extraction relevance."""
    if len(examples) != len(predictions):
        raise ValueError("The number of predictions must match the number of examples.")

    parseable_json = 0
    schema_valid = 0
    resume_examples = sum(example.task == "resume" for example in examples)
    job_description_examples = sum(example.task == "job_description" for example in examples)
    evidence_quotes = 0
    supported_evidence_quotes = 0
    for example, prediction in zip(examples, predictions):
        try:
            parsed = json.loads(prediction)
        except (json.JSONDecodeError, TypeError):
            continue
        parseable_json += 1
        try:
            if example.task == "resume":
                result = StructuredResume.model_validate(parsed)
                quotes = [item.evidence for item in result.evidence]
                evidence_quotes += len(quotes)
                # Substring support prevents invented quotes but does not judge their relevance.
                supported_evidence_quotes += sum(
                    quote.casefold() in example.source_text.casefold() for quote in quotes
                )
            else:
                JobDescriptionProfile.model_validate(parsed)
        except ValidationError:
            continue
        schema_valid += 1

    total = len(examples)
    return {
        "examples": total,
        "parseable_json_examples": parseable_json,
        "parseable_json_rate": parseable_json / total if total else None,
        "schema_valid_examples": schema_valid,
        "schema_valid_rate": schema_valid / total if total else None,
        "resume_examples": resume_examples,
        "job_description_examples": job_description_examples,
        "resume_evidence_quotes": evidence_quotes,
        "resume_evidence_quotes_supported": supported_evidence_quotes,
        "resume_evidence_support_rate": (
            supported_evidence_quotes / evidence_quotes if evidence_quotes else None
        ),
    }


def _generate_predictions(model, tokenizer, examples: list[TrainingExample], max_length: int) -> list[str]:
    """Generate deterministic outputs for held-out examples without updating model weights."""
    import torch

    was_training = model.training
    model.eval()
    predictions = []
    try:
        for index, example in enumerate(examples, 1):
            prompt_ids = tokenizer.apply_chat_template(
                [
                    {"role": "system", "content": EXTRACTION_PROMPTS[example.task]},
                    {"role": "user", "content": _prompt_content(example)},
                ],
                tokenize=True,
                add_generation_prompt=True,
            )
            max_new_tokens = max_length - len(prompt_ids)
            if max_new_tokens < 1:
                raise ValueError(f"Evaluation prompt {index} leaves no room for generated output.")
            input_ids = torch.tensor([prompt_ids], dtype=torch.long, device=model.device)
            with torch.inference_mode():
                generated = model.generate(
                    input_ids=input_ids,
                    max_new_tokens=max_new_tokens,
                    do_sample=False,
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )
            predictions.append(tokenizer.decode(generated[0, len(prompt_ids) :], skip_special_tokens=True))
    finally:
        model.train(was_training)
    return predictions


def train(
    args: argparse.Namespace,
    examples: list[TrainingExample],
    validation_examples: list[TrainingExample] | None = None,
    test_examples: list[TrainingExample] | None = None,
) -> None:
    try:
        import torch
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
            Trainer,
            TrainingArguments,
        )
    except ImportError as error:
        raise RuntimeError(
            "Install backend/requirements-training.txt in a CUDA-enabled WSL2 environment first."
        ) from error

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU unavailable. Run QLoRA training inside WSL2 with CUDA enabled.")
    if validation_examples is None and len(examples) < 20:
        raise RuntimeError("At least 20 reviewed examples are required to create a train/validation split.")
    if validation_examples is None:
        shuffled = list(examples)
        random.Random(args.seed).shuffle(shuffled)
        validation_count = max(5, round(len(shuffled) * 0.1))
        validation_examples = shuffled[:validation_count]
        training_examples = shuffled[validation_count:]
    else:
        training_examples = examples
    if not training_examples or not validation_examples:
        raise RuntimeError("Training and validation splits must both contain reviewed examples.")
    split_hashes = {
        name: {hashlib.sha256(item.source_text.casefold().encode("utf-8")).digest() for item in split}
        for name, split in (
            ("training", training_examples),
            ("validation", validation_examples),
            ("test", test_examples or []),
        )
    }
    split_names = ["training", "validation"] + (["test"] if test_examples else [])
    for index, first in enumerate(split_names):
        for second in split_names[index + 1 :]:
            if split_hashes[first] & split_hashes[second]:
                raise RuntimeError(f"Duplicate source text found across {first} and {second} splits.")
    compute_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=compute_dtype,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        quantization_config=quantization,
        device_map="auto",
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model = get_peft_model(
        model,
        LoraConfig(
            r=args.lora_rank,
            lora_alpha=2 * args.lora_rank,
            lora_dropout=0.05,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            task_type="CAUSAL_LM",
        ),
    )

    from torch.nn.utils.rnn import pad_sequence
    from torch.utils.data import Dataset

    class TokenizedRecords(Dataset):
        def __init__(self, records):
            self.records = records

        def __len__(self):
            return len(self.records)

        def __getitem__(self, index):
            record = self.records[index]
            return {
                "input_ids": torch.tensor(record["input_ids"], dtype=torch.long),
                "labels": torch.tensor(record["labels"], dtype=torch.long),
            }

    def collate(features):
        input_ids = pad_sequence(
            [feature["input_ids"] for feature in features],
            batch_first=True,
            padding_value=tokenizer.pad_token_id,
        )
        labels = pad_sequence(
            [feature["labels"] for feature in features],
            batch_first=True,
            padding_value=-100,
        )
        return {
            "input_ids": input_ids,
            "labels": labels,
            "attention_mask": input_ids.ne(tokenizer.pad_token_id),
        }

    training_dataset = TokenizedRecords(_tokenize_examples(training_examples, tokenizer, args.max_length))
    validation_dataset = TokenizedRecords(_tokenize_examples(validation_examples, tokenizer, args.max_length))
    output_dir = args.output_dir.resolve()
    trainer = Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=str(output_dir / "checkpoints"),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=1,
            per_device_eval_batch_size=1,
            gradient_accumulation_steps=8,
            learning_rate=2e-4,
            warmup_ratio=0.05,
            logging_steps=5,
            eval_strategy="epoch",
            save_strategy="epoch",
            load_best_model_at_end=True,
            metric_for_best_model="eval_loss",
            greater_is_better=False,
            fp16=compute_dtype == torch.float16,
            bf16=compute_dtype == torch.bfloat16,
            gradient_checkpointing=True,
            optim="paged_adamw_8bit",
            report_to="none",
            remove_unused_columns=False,
            save_total_limit=2,
            seed=args.seed,
        ),
        train_dataset=training_dataset,
        eval_dataset=validation_dataset,
        data_collator=collate,
    )
    trainer.train()
    if test_examples:
        test_dataset = TokenizedRecords(_tokenize_examples(test_examples, tokenizer, args.max_length))
        test_metrics = trainer.evaluate(eval_dataset=test_dataset, metric_key_prefix="test")
        output_dir = args.output_dir.resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "test_metrics.json").write_text(
            json.dumps(test_metrics, indent=2, default=float) + "\n", encoding="utf-8"
        )
        # Keep test generations separate from training and report aggregate metrics only.
        extraction_metrics = score_extraction_predictions(
            test_examples,
            _generate_predictions(model, tokenizer, test_examples, args.max_length),
        )
        (output_dir / "extraction_metrics.json").write_text(
            json.dumps(extraction_metrics, indent=2) + "\n", encoding="utf-8"
        )
        print(
            "Held-out extraction quality: "
            f"schema-valid={extraction_metrics['schema_valid_rate']}, "
            f"resume evidence supported={extraction_metrics['resume_evidence_support_rate']}"
        )

    adapter_dir = output_dir / "adapter"
    adapter_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    (output_dir / "Modelfile").write_text(
        f"FROM {args.ollama_base_tag}\nADAPTER ./adapter\nPARAMETER temperature 0\n",
        encoding="utf-8",
    )
    print(f"LoRA adapter saved to {adapter_dir}")
    print(f"Create the local Ollama model with: ollama create recruitai-screening -f {output_dir / 'Modelfile'}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="QLoRA fine-tune the local resume evaluator.")
    parser.add_argument("--dataset", type=Path, required=True, help="Recruiter-reviewed JSONL examples.")
    parser.add_argument("--validation-dataset", type=Path, help="Optional separate reviewed validation JSONL split.")
    parser.add_argument("--test-dataset", type=Path, help="Optional held-out reviewed test JSONL split.")
    parser.add_argument("--minimum-examples", type=int, default=100)
    parser.add_argument(
        "--allow-synthetic-data",
        action="store_true",
        help="Allow unreviewed, explicitly synthetic examples for a controlled pilot.",
    )
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument("--ollama-base-tag", default="qwen2.5:1.5b")
    parser.add_argument("--output-dir", type=Path, default=Path("backend/training/output/recruitai-screening"))
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument("--lora-rank", type=int, choices=(4, 8, 16, 32), default=16)
    parser.add_argument("--epochs", type=float, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        examples = load_training_examples(args.dataset, args.minimum_examples, args.allow_synthetic_data)
        validation_examples = (
            load_training_examples(args.validation_dataset, minimum_examples=1, allow_synthetic=args.allow_synthetic_data)
            if args.validation_dataset else None
        )
        test_examples = (
            load_training_examples(args.test_dataset, minimum_examples=1, allow_synthetic=args.allow_synthetic_data)
            if args.test_dataset else None
        )
        print(
            f"Validated {len(examples)} training examples"
            + (f", {len(validation_examples)} validation examples" if validation_examples else "")
            + (f", {len(test_examples)} held-out test examples." if test_examples else ".")
        )
        if not args.validate_only:
            train(args, examples, validation_examples, test_examples)
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
