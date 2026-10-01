# Local Model Fine-Tuning

The evaluator runs locally through Ollama; it does not send resumes to a hosted model API. Its current base default is `qwen2.5:1.5b` (a 1.5 B parameter model chosen for fast CPU inference; switch to `qwen2.5:7b` for maximum quality if you have a GPU with sufficient VRAM). Fine-tuning teaches structured resume evidence and JD requirement extraction; it does not train on hiring outcomes or predict scores. On the inspected 4 GB GTX 1650, the training default is Qwen2.5 1.5B with a 2K context. No trained weights are included: a permissioned, recruiter-reviewed extraction dataset is required. The trainer requires 100 examples by default and refuses unreviewed examples.

## Dataset

Create a UTF-8 JSONL file outside source control. Each line is one human-reviewed example for either `resume` or `job_description` extraction. Every resume evidence quote must occur verbatim in its source. Do not include hiring outcomes as labels or model-generated results without human correction. Include both tasks and each language expected in production.

```json
{"reviewed":true,"task":"resume","source_text":"A redacted, fictional resume excerpt: Built production backend services for three years.","target":{"evidence":[{"normalized_concept":"backend engineering","evidence":"Built production backend services for three years.","section":"Experience","source_type":"professional","start_year":2021,"end_year":2024}]}}
{"reviewed":true,"task":"job_description","source_text":"A sufficiently detailed job description requiring production Python experience and preferring Docker.","target":{"role":"Backend engineer","requirements":[{"id":"python","text":"Production Python experience","normalized_concept":"python","requirement_type":"skill","requirement_class":"must_have","priority":5,"evidence_needed":"Production work evidence","minimum_years":null},{"id":"docker","text":"Docker experience","normalized_concept":"docker","requirement_type":"skill","requirement_class":"nice_to_have","priority":2,"evidence_needed":"Direct resume evidence","minimum_years":null}]}}
```

Keep the dataset local and permissioned. Resume text contains personal data; redact contact details and any information not needed for the evaluation task. Use recruiter judgments about job-related evidence, not past hiring decisions as ground truth.

## Training

Run QLoRA in CUDA-enabled WSL2/Linux. Install a CUDA-enabled PyTorch build for the WSL environment, then install the optional trainer dependencies:

```bash
python -m pip install -r backend/requirements.txt
python -m pip install -r backend/requirements-training.txt
python -m backend.training.finetune --dataset /path/to/reviewed-examples.jsonl --validate-only
python -m backend.training.finetune --dataset /path/to/reviewed-examples.jsonl
```

Before creating the Ollama model, pull its base model once: `ollama pull qwen2.5:3b`.

Training holds out 10% for validation, requires a CUDA GPU, uses 4-bit LoRA adapters, and refuses examples over 2,048 tokens rather than silently truncating evidence. Review validation loss and representative multilingual extraction quality before using an adapter. With only 4 GB VRAM, reduce batch/context settings further if CUDA memory runs out.

The run writes a PEFT adapter and an Ollama `Modelfile` under `backend/training/output/recruitai-screening`. Pull the matching base tag once, then from that directory create and smoke-test the local model:

```bash
ollama pull qwen2.5:1.5b
ollama create recruitai-screening -f Modelfile
```

After validating it, set `OLLAMA_MODEL=recruitai-screening` in the root `.env`, then restart the API. The API starts the evaluation worker automatically by default. It keeps the model loaded (`OLLAMA_KEEP_ALIVE=-1`) so Ollama does not repeatedly load weights between candidates. This uses model memory while the worker is running; set a duration such as `10m` if you prefer Ollama to unload it when idle. Keep adapter weights and the reviewed dataset out of Git.
