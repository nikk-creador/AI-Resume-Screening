from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
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

    reviewed: Literal[True]
    task: Literal["resume", "job_description"]
    source_text: str = Field(min_length=20, max_length=MAX_RESUME_TEXT_CHARS)
    target: dict

    @model_validator(mode="after")
    def validate_labels(self) -> TrainingExample:
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


def load_training_examples(dataset_path: Path, minimum_examples: int = 100) -> list[TrainingExample]:
    if not dataset_path.is_file():
        raise ValueError(f"Training dataset not found: {dataset_path}")
    examples: list[TrainingExample] = []
    for line_number, line in enumerate(dataset_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            examples.append(TrainingExample.model_validate_json(line))
        except ValidationError as error:
            raise ValueError(f"Invalid training example on line {line_number}: {error.errors()[0]['msg']}") from error
    if len(examples) < minimum_examples:
        raise ValueError(
            f"Need at least {minimum_examples} recruiter-reviewed examples; found {len(examples)}."
        )
    return examples


def _tokenize_examples(examples, tokenizer, max_length: int):
    records = []
    for index, example in enumerate(examples, 1):
        user_content = json.dumps(
            {
                "task": example.task,
                "source_text": example.source_text,
                "instructions": EXTRACTION_PROMPTS[example.task],
            },
            ensure_ascii=False,
        )
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


def train(args: argparse.Namespace, examples: list[TrainingExample]) -> None:
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
    if len(examples) < 20:
        raise RuntimeError("At least 20 reviewed examples are required to create a train/validation split.")

    shuffled = list(examples)
    random.Random(args.seed).shuffle(shuffled)
    validation_count = max(5, round(len(shuffled) * 0.1))
    validation_examples = shuffled[:validation_count]
    training_examples = shuffled[validation_count:]
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
            r=16,
            lora_alpha=32,
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
            evaluation_strategy="epoch",
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
    parser.add_argument("--minimum-examples", type=int, default=100)
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument("--ollama-base-tag", default="qwen2.5:1.5b")
    parser.add_argument("--output-dir", type=Path, default=Path("backend/training/output/recruitai-screening"))
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument("--epochs", type=float, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        examples = load_training_examples(args.dataset, args.minimum_examples)
        print(f"Validated {len(examples)} recruiter-reviewed examples.")
        if not args.validate_only:
            train(args, examples)
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
