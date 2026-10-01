# Local evidence-based screening architecture

## Current implementation

The screening worker extracts searchable document text, asks the local Ollama model for structured JD requirements and resume evidence, and validates every returned resume quote. `backend/app/matching.py` computes scores; an LLM response never supplies the final candidate score. Profiles and JD requirements are cached as JSON on their screening/resume records so retries use the same extracted evidence. Recruiters can edit extracted requirements, inspect evidence, and record a score override with a reason. Model score, override, reviewer, and timestamp are stored separately; active ranking uses the override when present.

```text
PDF/DOCX -> text extraction (+ optional Tesseract OCR)
          -> local Qwen structured JD requirements (cached per screening)
          -> local Qwen resume evidence extraction (cached per resume)
          -> alias-aware exact match + multilingual embedding similarity
          -> local cross-encoder evidence reranking (top five evidence excerpts per requirement)
          -> configurable must-have/nice-to-have aggregation
          -> score + verified evidence + deterministic explanation -> recruiter review
```

The present flow is intentionally simpler than extracting names and locations: identity and protected characteristics are not ranking features. The extractor is instructed not to return them. Evidence is kept because an auditable decision needs the exact source text; the raw resume remains in private local storage.

## Model choices and hardware

The inspected workstation has a GTX 1650 with 4 GB VRAM. PyTorch, Sentence Transformers, FAISS, and FastEmbed were not installed in the current backend environment. The local Ollama installation has Qwen2.5 7B. The primary implementation keeps Qwen inference in Ollama and runs the smaller ONNX embedding/reranking models on CPU so they do not compete with the 7B model for VRAM.

- Text extraction uses PyMuPDF where installed and retains pypdf as a searchable-PDF fallback. Scanned pages use Tesseract when installed and configured with `TESSERACT_CMD`.
- Embeddings default to `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` through FastEmbed's quantized ONNX runtime. It supports multilingual sentence similarity and is about 0.22 GB in FastEmbed's supported-model inventory.
- The optional multilingual cross encoder defaults to `jinaai/jina-reranker-v2-base-multilingual`, about 1.11 GB in FastEmbed's inventory. Its current upstream license is CC-BY-NC-4.0; confirm that license fits the research and deployment use before distributing it. If the model is unavailable, the scorer records null reranker scores and continues with exact/semantic/evidence components.
- BGE-M3 and BGE reranker v2 M3 remain research comparison candidates. Their larger footprint is not a good default alongside local 7B generation on 4 GB VRAM. CPU ONNX model downloads happen on first use; no resume is sent to a remote inference API.
- FAISS is not on the hot path yet: each candidate currently has a small list of extracted evidence passages, for which batched dot products are cheaper and simpler. Add a per-screening FAISS index only when profiling shows the evidence corpus is large enough to benefit.

## Schemas

JD requirement JSON (`backend/app/matching.py::JobRequirement`):

```json
{
  "id": "req-react-years",
  "text": "At least two years of professional React development",
  "normalized_concept": "react",
  "requirement_type": "experience",
  "requirement_class": "must_have",
  "priority": 5,
  "evidence_needed": "Professional employment evidence and duration",
  "minimum_years": 2
}
```

Resume evidence JSON (`ResumeEvidence`) deliberately contains an exact quote, section and source category rather than an opaque LLM confidence value. Quotes are discarded unless they occur in the extracted resume text.

## Matching and scoring

Each requirement is matched against each verified resume evidence item. Exact concept matching uses a small explicit alias map (`React.js`/`ReactJS` -> `react`; `NodeJS`/`Node.js` -> `node.js`). Related technologies stay distinct (`React Native` != `React`, `TypeScript` != `JavaScript`, `AWS` != `Azure`). Semantic cosine similarity and cross-encoder scores are separate recorded components. Experience requirements only accept professional/internship evidence; project and course evidence cannot satisfy a stated professional-years minimum. The explanation is currently a deterministic, evidence-grounded summary, avoiding a second LLM call and unsupported prose.

Provisional component weights are stored with each evaluation and configurable through `.env` (`MATCH_EXACT`, `MATCH_SEMANTIC`, `MATCH_RERANKER`, `MATCH_EVIDENCE`). Unavailable model components are omitted and remaining weights renormalized. Each requirement's priority (1-5) weights its group average. Default overall score is 80% must-have average and 20% nice-to-have average; if a group is absent, the present group's weight is renormalized. These values are research starting points, not claims of optimality. Tune only on development/validation splits and report results on a held-out set.

Requirement states are `matched`, `partially_matched`, `missing`, and `insufficient_evidence`. The UI surfaces exact, semantic, reranker, experience and evidence-source details beside the verified quote. A deterministic summary explains the computed count and score; it cannot add unsupported candidate facts.

## Fine-tuning

Fine-tune for structured extraction (resume evidence and JD requirements), never for hiring outcomes or final scores. Use recruiter-reviewed, consented, de-identified examples with verbatim evidence labels. The workstation's 4 GB GPU is too constrained for the existing 3B/4K-token QLoRA defaults; a 1.5B Qwen2.5 instruct base, 2K context, 4-bit QLoRA in CUDA WSL2 is the practical starting point. Training still requires a representative dataset and measured validation; no model is described as fine-tuned until that run exists.

## Human review and research evaluation

Evidence and requirement statuses remain inspectable in the candidate UI. Recruiters can correct requirement text/class and record a separate score override with a reason. Automated feedback is not training data by default.

Use identical candidate/JD splits and compare exact matching, semantic matching, hybrid matching, and hybrid plus cross-encoder. Report Precision@K, Recall@K, nDCG@K, Spearman and Kendall rank correlation, requirement-level precision/recall/F1, evidence coverage, latency per resume, and unsupported explanation rate. Do not claim superiority before the held-out evaluation. The scorer exposes component values and weights so these experiments can be reproduced.

## Known limits

- Structured extraction can miss a requirement or misclassify must-have language; review the extracted JD profile before relying on rankings.
- The current in-worker reranker runs on each candidate's top five evidence passages. A screening-wide top-K candidate rerank phase is still needed for thousands of resumes.
- The multilingual Jina reranker carries a non-commercial license and runs on CPU by default.
- OCR is best-effort and requires a separate Tesseract installation and language packs.
- Weight defaults and thresholds are provisional; no labeled evaluation dataset was supplied, so no accuracy metric or calibration claim is available.
- Resume evidence and extracted profiles are sensitive personal data. The database is local, but at-rest encryption, retention controls and a formal privacy review remain deployment work.

## Queue and service diagnostics

The API starts one background evaluation worker at startup unless `RUN_EVALUATION_WORKER=false`. AI activity shows each candidate's queued/processing/failed state, retry attempts, and latest error. A 503 from `POST /api/ai/test` means the configured local Ollama endpoint/model did not answer; the detail message is surfaced in the UI. The first candidate in a screening performs the JD extraction, and every uncached resume performs local extraction before deterministic scoring. Later candidates reuse the cached JD profile. This is local model inference rather than a hosted API, but extraction latency depends on the configured model and hardware. A stop operation only cancels queued work; a model call already in progress is allowed to finish and its result is discarded.
