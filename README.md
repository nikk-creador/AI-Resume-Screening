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

The API docs are at `http://127.0.0.1:8000/docs`. Configure `DATABASE_URL` in the root `.env` file. The default database is local SQLite; PostgreSQL uses a `postgresql+psycopg2://...` URL.

## Local evaluation model

Install [Ollama](https://ollama.com/download). The application runs inference locally through Ollama; it does not send resume text to a hosted model API. It defaults to the local `qwen2.5:1.5b` model — a 1.5 B parameter variant that runs roughly 4–5× faster on CPU than the 7 B model while remaining capable for structured JSON extraction; switch to `qwen2.5:3b` for higher quality or `qwen2.5:7b` for maximum quality if you have a GPU with sufficient VRAM. No fine-tuned weights or recruiter-reviewed training data are bundled with this project. After training and registering the adapter, set `OLLAMA_MODEL=recruitai-screening` in `.env` to use it.

Download the default local model:

```powershell
ollama pull qwen2.5:1.5b
```

Set `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_KEEP_ALIVE`, and `OLLAMA_TIMEOUT_SECONDS` in the root `.env` if needed. The API starts one persistent evaluation worker automatically, so starting the backend is enough to process queued candidates. To run only the API and manage the worker separately, set `RUN_EVALUATION_WORKER=false`; then start the worker with:

```powershell
npm run backend:worker
```

Do not start the separate worker while automatic worker startup is enabled.

The worker sends resume text only to the local Ollama endpoint and stores criterion scores and evidence excerpts, not extracted full-text resumes. It processes one candidate at a time, retries temporary model failures up to three times, and resumes interrupted work after restart. Keep one worker running for the local SQLite queue. The selected model and 200+ resume throughput must be benchmarked on the target workstation before production use.

Use **AI service** in the signed-in workspace to send a small test prompt to the configured local model and inspect the latest evaluation statuses and errors for your own screenings. The activity view does not expose resume text or prompts.

Copy `.env.example` to `.env` before starting the backend. On first startup, a local demo user is created unless `SEED_DEMO_USER=false`:

- Email: `demo@recruitai.local`
- Password: `RecruitAI-Demo-2026!`

The frontend shows these demo credentials only during local development. Demo user seeding is disabled when `APP_ENV=production`. Set a unique `AUTH_SECRET_KEY` and the deployed frontend origins in `CORS_ORIGINS` before deployment. Set a strong `DEMO_USER_PASSWORD` if demo seeding is intentionally enabled outside local development.

Sign-in uses an HTTP-only, eight-hour session cookie. Screenings and resume downloads are scoped to the signed-in account. Open both the frontend and backend with the same local hostname (`127.0.0.1`) so the browser sends the session cookie.

The API uses REST endpoints for authentication, screening records, resume management, and document uploads and downloads.

## Screening inputs

- Each screening requires a recruiter-provided name. Screening history displays and searches by that name, not the job description.
- Resume formats: searchable PDF and DOCX. Scanned PDFs and legacy DOC are not supported yet. Each file can be up to 10 MB and uploads are sent in batches of 10; there is no total resume count cap.
- Job description formats: searchable PDF, DOCX, TXT, or pasted text. Job descriptions require at least 20 readable words and may contain up to 10,000 characters.
- Resume rows support search, pagination, individual removal, and multi-select removal.
- Original files are stored under `backend/storage/`; database tables store their metadata and screening details.

The job description alone drives candidate evaluation by default; recruiters do not need to add evaluation criteria. Optional preferred qualifications can be suggested by the local model or added manually. They add up to 20 points only when every explicit must-have extracted from the job description has verifiable resume evidence; otherwise the bonus is zero. Completed candidates show the job-fit score, any preference bonus, the required-check gate, and exact evidence. Results support recruiter review and do not make hiring decisions.
