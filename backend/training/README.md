# Local Model Fine-Tuning

Core resume extraction and matching run locally with deterministic evidence rules and the configured FastEmbed embedding model; neither needs an LLM or an API key. Ollama is optional and used only for generation features such as the service probe and preferred-criteria suggestions. The QLoRA workflow below tunes structured extraction. A separate encoder workflow uses the checked-in JD/resume pairs and triplets to improve semantic ranking; neither workflow predicts hiring outcomes. Training artifacts are local and ignored by Git.

## Ranking encoder fine-tuning

The encoder trainer fine-tunes `sentence-transformers/all-mpnet-base-v2` by default. `backend/pairs.jsonl` contains binary job/resume relevance labels, while `backend/triplets.jsonl` contains job, relevant resume, and hard-negative resume examples. The trainer uses Multiple Negatives Ranking Loss (MNRL) on positive pairs, treating other pairs in each batch as in-batch negatives, plus explicit hard-triplet loss. Negative-labeled pairs are excluded from MNRL; hard negatives are learned from the triplet dataset. Splits are grouped by job description, and the trainer keeps the base weights if validation quality does not improve. Its test report includes pair AUC, Precision@5, Recall@5, NDCG@5, and triplet accuracy; these metrics validate ranking against these dataset labels and do not establish hiring quality.

Production matching uses requirement-level semantic embeddings blended with BM25 keyword relevance and exact concept matches. Configure `MATCH_SEMANTIC` and `MATCH_BM25` in `.env` to adjust their relative contribution; exact certification/tool terms are preserved as a lexical signal rather than relying on semantic similarity alone.

Install CUDA-enabled PyTorch for the local GPU, then install the training requirements and validate the data split before training:

```bash
python -m pip install -r backend/requirements.txt
python -m pip install -r backend/requirements-training.txt
python -m backend.training.finetune_encoder --validate-only
python -m backend.training.finetune_encoder --epochs 1
```

The MPNet encoder is larger and slower than MiniLM and may require reducing `--batch-size` or `--max-seq-length` on GPUs with limited memory. The trainer defaults to a 2-sample batch, gradient accumulation, a 256-token limit, and one epoch. `--device cpu` is available for a slow CPU run. It writes `metrics.json`, a Sentence Transformers checkpoint, and a FastEmbed-compatible ONNX export under `backend/training/output/resume-encoder`.

After reviewing the test report, activate the exported encoder in the ignored root `.env` and restart the backend:

```dotenv
MATCH_EMBEDDING_PATH=backend/training/output/resume-encoder/fastembed
```

The general application default `MATCH_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2` stays unchanged until you explicitly set `MATCH_EMBEDDING_PATH`; FastEmbed loads the fine-tuned MPNet ONNX files from the local path.

## Dataset

Create a UTF-8 JSONL file outside source control. Each line is one human-reviewed example for either `resume` or `job_description` extraction. Every resume evidence quote must occur verbatim in its source. Do not include hiring outcomes as labels or model-generated results without human correction. Include both tasks and each language expected in production.

```json
{"reviewed":true,"task":"resume","source_text":"A redacted, fictional resume excerpt: Built production backend services for three years.","target":{"evidence":[{"normalized_concept":"backend engineering","evidence":"Built production backend services for three years.","section":"Experience","source_type":"professional","start_year":2021,"end_year":2024}]}}
{"reviewed":true,"task":"job_description","source_text":"A sufficiently detailed job description requiring production Python experience and preferring Docker.","target":{"role":"Backend engineer","requirements":[{"id":"python","text":"Production Python experience","normalized_concept":"python","requirement_type":"skill","requirement_class":"must_have","priority":5,"evidence_needed":"Production work evidence","minimum_years":null},{"id":"docker","text":"Docker experience","normalized_concept":"docker","requirement_type":"skill","requirement_class":"nice_to_have","priority":2,"evidence_needed":"Direct resume evidence","minimum_years":null}]}}
```

Keep the dataset local and permissioned. Resume text contains personal data; redact contact details and any information not needed for the evaluation task. Use recruiter judgments about job-related evidence, not past hiring decisions as ground truth.

### Synthetic Hugging Face starter data

The optional importer supports [`sukhrobnurali/resume-parsing-vision`](https://huggingface.co/datasets/sukhrobnurali/resume-parsing-vision), a CC-BY-4.0 synthetic, English-text dataset with frozen train/validation/test splits (850/75/75). Its source schema includes personal fields, so the importer retains only text and skill evidence, removes names/contact details/address/date-of-birth lines, and emits **unreviewed** drafts. It does not auto-approve labels. The source is limited to software roles and its canonical skills are not the same as this application's evidence taxonomy; review and correct every example before training. Cite and link the dataset if you use it.

Install the trainer requirements, then prepare drafts:

```bash
python -m pip install -r backend/requirements-training.txt
python -m backend.training.prepare_hf_dataset
```

Review each `*.draft.jsonl` file with a person who can verify both the target and exact evidence quotes. Correct targets, remove questionable rows, and set `reviewed` to `true` only after review; save the approved split files separately (for example `train.jsonl`, `validation.jsonl`, and `test.jsonl`). By default, the loader rejects drafts with `reviewed:false`. For a controlled synthetic-only pilot, the importer sets `synthetic:true`, every evidence quote is checked verbatim against its source, and the explicit `--allow-synthetic-data` flag permits training without claiming recruiter review. That pilot evaluates extraction on synthetic skill labels only and does not establish real-world screening accuracy.

## Training

Run QLoRA in a CUDA-enabled Windows or Linux environment. Install a CUDA-enabled PyTorch build for your platform, then install the app and optional trainer dependencies:

```bash
python -m pip install -r backend/requirements.txt
python -m pip install -r backend/requirements-training.txt
python -m backend.training.finetune --dataset /path/to/train.jsonl --validation-dataset /path/to/validation.jsonl --test-dataset /path/to/test.jsonl --validate-only
python -m backend.training.finetune --dataset /path/to/train.jsonl --validation-dataset /path/to/validation.jsonl --test-dataset /path/to/test.jsonl
```

For the synthetic pilot files, add `--allow-synthetic-data` to both commands above.

When separate split files are supplied, the trainer preserves them and reports held-out test loss to `test_metrics.json` after training. It also generates outputs for the held-out examples and writes aggregate JSON/schema validity and resume evidence-quote support metrics to `extraction_metrics.json`. The report does not include resume text or generated outputs. Quote support means a returned quote appears as a case-insensitive substring in the source; it does not establish that the quote is relevant, complete, or factually representative. The test split is never used for gradient updates or checkpoint selection. If no separate validation file is supplied, the trainer makes a seeded 10% validation split from the training file. Test loss and these automated metrics are not hiring-quality measures; manually review outputs before use. Generating held-out outputs adds inference time after training.

Training requires a CUDA GPU, uses 4-bit LoRA adapters, and refuses examples over 2,048 tokens rather than silently truncating evidence. LoRA rank defaults to 16; pass `--lora-rank 8` to reduce adapter size and optimizer memory, at some cost to adapter capacity. This may not prevent out-of-memory errors if model activations exceed available GPU memory. Review representative extraction quality before using an adapter. Lower the context setting only after filtering examples that exceed it. This synthetic starter has English prose, so it does not measure multilingual extraction quality.

The run writes a PEFT adapter and an Ollama `Modelfile` under `backend/training/output/recruitai-screening`. Pull the matching base tag once, then from that directory create and smoke-test the local model:

```bash
ollama pull qwen2.5:1.5b
ollama create recruitai-screening -f Modelfile
```

After validating it, set `OLLAMA_MODEL=recruitai-screening` in the root `.env`, then restart the API. The API starts the evaluation worker automatically by default. It keeps the model loaded (`OLLAMA_KEEP_ALIVE=-1`) so Ollama does not repeatedly load weights between candidates. This uses model memory while the worker is running; set a duration such as `10m` if you prefer Ollama to unload it when idle. Keep adapter weights and the reviewed dataset out of Git.
