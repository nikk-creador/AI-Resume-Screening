New accounts must verify their email before password sign-in. Password reset and verification links expire after 30 minutes. For local development, the auth screens show the generated link directly when SendGrid is not configured. Before production, set `APP_BASE_URL` to the public frontend URL, configure `SENDGRID_API_KEY` with a key that has Mail Send permission, and set `SENDGRID_FROM_EMAIL` to an authenticated sender address. Keep the API key in `.env`, not in source control or `.env.example`. Team invitations are not enabled because the current workspace has no team or membership model; use account registration for individual access.
New accounts must verify their email before password sign-in. Password reset and verification links expire after 30 minutes. For local development, the auth screens show the generated link directly when SendGrid is not configured. Before production, set `APP_BASE_URL` to the public frontend URL, configure `SENDGRID_API_KEY` with a key that has Mail Send permission, and set `SENDGRID_FROM_EMAIL` to an authenticated sender address. Keep the API key in `.env`, not in source control or `.env.example`. Team invitations are not enabled because the current workspace has no team or membership model; use account registration for individual access.
# RecruitAI

RecruitAI is a resume and job-description review workspace built with React, TypeScript, Ant Design, FastAPI, and SQLAlchemy.

## Frontend

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Run the TypeScript checker with `npm run typecheck`.
Run strict ESLint checks with `npm run lint`.
Format the project with `npm run format` and verify it with `npm run format:check`.
UI colors are centralized in `src/theme/colors.ts`; ESLint rejects hard-coded colors in components and stylesheets.

## Backend

One-time setup from the project root:

```powershell
Copy-Item .env.example .env
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

From the project root, start the configured PostgreSQL service if needed and launch the FastAPI backend with:

```powershell
npm run backend
```

To start only PostgreSQL, use `npm run db:start`. Set `POSTGRES_SERVICE_NAME` in `.env` if your Windows service uses a different name; set `START_POSTGRES_SERVICE=false` if another tool manages PostgreSQL. SQLite needs no separate database service.

The API docs are at `http://127.0.0.1:8000/docs`. Configure `DATABASE_URL` in the root `.env` file. The default database is local SQLite; PostgreSQL uses a `postgresql+psycopg2://...` URL. The backend reads the root `.env`, not `.env.example`; restart it after changing configuration.

## Evaluation model and matching

Resume and job-description extraction default to deterministic local rules and local embeddings; the core screening workflow requires no API key or hosted AI request. To use structured local Qwen extraction, install [Ollama](https://ollama.com/download), pull the configured model, and set `AI_EXTRACTION_ENABLED=true` with `AI_PROVIDER=ollama` in the private `.env`. Model output is schema-checked and resume evidence quotes are verified against the source text; failed extraction falls back to the deterministic rules. Resume extraction is restricted to loopback Ollama and is never sent to a hosted provider. Ollama is also used for the AI service probe and optional criteria suggestions. An OpenAI-compatible provider is an opt-in integration for those generation features only; set `AI_PROVIDER=openai_compatible` and `AI_BASE_URL` to use it. For Groq, set `RM_AI_KEY` in the root `.env`; it takes precedence over `AI_API_KEY`.

The local semantic encoder defaults to `sentence-transformers/all-MiniLM-L6-v2` through FastEmbed. It runs on CPU and uses a compatible GPU automatically when FastEmbed/ONNX Runtime detects one. Set `MATCH_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5` to compare the supported alternative. The MiniLM model card declares Apache-2.0; BGE-small declares MIT. Model files are downloaded on first use and reused from the local model cache; set `HF_HUB_OFFLINE=1` after downloading to prevent model-hub requests. Embedding vectors are cached in process memory. Missing or failed semantic inference is shown as unavailable instead of being reported as a semantic score. The model identifier and CPU thread count are configurable with `MATCH_EMBEDDING_MODEL` and `MATCH_CPU_THREADS`. MiniLM and BGE-small are English-focused; validate other languages before research use.

Each candidate shows a lexical-overlap baseline, mean raw cosine similarity (not a suitability probability), and a provisional hybrid score. The hybrid starts with experimental weights of 40% explicit skill match, 35% normalized semantic similarity `(cosine + 1) / 2`, 15% determinable experience, and 10% determinable qualification match; unavailable experience/qualification components are omitted and the remaining weights are renormalized. Set `MATCH_SKILL_WEIGHT`, `MATCH_SEMANTIC_WEIGHT`, `MATCH_EXPERIENCE_WEIGHT`, and `MATCH_QUALIFICATION_WEIGHT` for controlled changes. These starting weights are not validated or optimal. Required checks remain a separate evidence gate and are displayed as “Not verified” when the resume does not substantiate them. Scores support recruiter review and never automatically reject a candidate.

For a reproducible comparison, prepare a permissioned UTF-8 JSONL dataset with one record per candidate/job pair, `candidate_id`, a `group_id` that joins related candidates/documents, `job_id`, explicit `train`/`dev`/`test` split, the same `job_text` for candidates in a job, `resume_text`, and graded `relevance` (0–3). Candidate and group IDs may not cross splits; duplicate candidate/job pairs are rejected. The tool compares BM25, embedding cosine similarity, and the **production requirement-level matcher** on the identical held-out test pairs. Optional `requirement_labels` maps extracted requirement IDs to independently reviewed booleans for requirement precision/recall/F1; optional `job_family` enables family breakdowns. For a fairness audit, include a pseudonymous `audit_group` only when the research protocol permits it. Groups with fewer than five candidates are suppressed; fairness metrics are descriptive and do not establish fairness or legal compliance. The runner reports NDCG@10, Precision@5, Recall@10, MRR, Spearman and Kendall rank correlation, requirement metrics where labels are supplied, family breakdowns, and elapsed time per resume:

```powershell
backend\.venv\Scripts\python.exe -m backend.app.research --dataset data\reviewed-pairs.jsonl --dataset-version v1
```

The runner validates train/dev/test membership and evaluates only the held-out test split; it does not tune automatically. Keep test labels untouched during any development-data tuning. Use recruiter-reviewed labels and a documented, immutable dataset version. Metrics with insufficient labels are returned as unavailable. The explanation check measures quote grounding; recruiter explanation usability still requires a separate task-based study. No research outcomes or improvements are bundled or claimed.

The API starts one persistent evaluation worker automatically. To run only the API and manage the worker separately, set `RUN_EVALUATION_WORKER=false`; then start the worker with:

```powershell
npm run backend:worker
```

Do not start the separate worker while automatic worker startup is enabled.

The worker stores criterion scores and verified evidence excerpts, not extracted full-text resumes. It processes one candidate at a time, retries temporary failures up to three times, and resumes interrupted work after restart. Keep one worker for the local SQLite queue. No fine-tuned weights or recruiter-reviewed training data are bundled. The training script requires permissioned, recruiter-reviewed examples and creates an Ollama adapter; fine-tuning quality and ranking thresholds must be validated against held-out reviewed data before use.

Use **AI service** in the signed-in workspace to send a small test prompt to the configured model and inspect the latest evaluation statuses and errors for your own screenings. The activity view does not expose resume text or prompts.

Copy `.env.example` to `.env` before starting the backend. Demo-user seeding is disabled by default; to enable it for local development, set `SEED_DEMO_USER=true` and choose a strong `DEMO_USER_PASSWORD` in the private `.env` file. Never commit demo credentials. Set a unique `AUTH_SECRET_KEY` and the deployed frontend origins in `CORS_ORIGINS` before deployment.

Sign-in uses an HTTP-only, eight-hour session cookie. Screenings and resume downloads are scoped to the signed-in account. Open both the frontend and backend with the same local hostname (`127.0.0.1`) so the browser sends the session cookie.

New accounts must verify their email before password sign-in. Password reset and verification links expire after 30 minutes. For local development, the auth screens show the generated link directly when SMTP is not configured. Before production, set `APP_BASE_URL` to the public frontend URL and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USE_TLS`, and, if required by the provider, `SMTP_USERNAME` and `SMTP_PASSWORD`. Team invitations are not enabled because the current workspace has no team or membership model; use account registration for individual access.

The API uses REST endpoints for authentication, screening records, resume management, and document uploads and downloads.

## Screening inputs

- Each screening requires a recruiter-provided name. Screening history displays and searches by that name, not the job description.
- Resume formats: searchable PDF and DOCX. Scanned PDFs and legacy DOC are not supported yet. Each file can be up to 10 MB and uploads are sent in batches of 10; there is no total resume count cap.
- Job description formats: searchable PDF, DOCX, TXT, or pasted text. Job descriptions require at least 20 readable words and may contain up to 10,000 characters.
- Resume rows support search, pagination, individual removal, and multi-select removal.
- Original files are stored under `backend/storage/`; database tables store their metadata and screening details.

The job description alone drives candidate evaluation by default; recruiters do not need to add evaluation criteria. Optional preferred qualifications can be suggested by the configured model or added manually. They add up to 20 points only when every explicit must-have extracted from the job description has verifiable resume evidence; otherwise the bonus is zero. Completed candidates show the job-fit score, any preference bonus, the required-check gate, and exact evidence. Results support recruiter review and do not make hiring decisions.
