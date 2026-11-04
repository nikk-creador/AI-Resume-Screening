# RecruitAI

RecruitAI is an AI-assisted resume screening platform that helps teams evaluate candidates
consistently and transparently. Instead of keyword matching or gut feel, the system parses a
role's requirements, compares them against submitted resumes using semantic similarity,
grounds every signal in a quoted resume excerpt, and presents the evidence side-by-side with
the scorecard so reviewers can make the final decision.

## Architecture overview

The application follows a classic three-tier structure:

- **Frontend** — React 18 + Vite + TypeScript + Ant Design. A responsive SPA handling
  authentication, screening creation/editing, resume uploads, candidate reviews, and team
  collaboration.
- **Backend** — Python 3.11 + FastAPI (Uvicorn). A RESTful API that orchestrates the business
  logic, exposes the WebSocket/streaming endpoints for long-running evaluations, and manages
  the SQLite/PostgreSQL database.
- **Evaluation worker** — A separate Python process that runs the resume parsing and scoring
  pipeline. It can be threaded inside the API (default) or run as a dedicated process
  (`npm run backend:worker`) to keep hot-reload cycles fast during development.

```
┌──────────────┐   ┌──────────────┐   ┌────────────────────┐
│   Browser    │──▶│   Vite + React│─▶│   FastAPI (Port 8000)  │
│   (5173)     │   │   (Vite)      │   │   + Uvicorn        │
└──────────────┘   └──────────────┘   └─────────┬──────────┘
                                                │
                                            ┌──▼───┐
                                            │ DB   │  SQLite or PostgreSQL
                                            └──┬───┘
                                               │
                                               ▼
                                          ┌──────────────┐
                                          │ Eval Worker  │  Python process
                                          │   (async)    │  — resume parsing
                                          └──────────────┘     + scoring
```


﻿# RecruitAI

RecruitAI is a screening workspace for reviewing resumes against a job description and evaluating candidate fit.

## Requirements

- Node.js 18+
- Python 3.11+
- npm

## Environment setup

Copy the example environment file in the project root:

```powershell
Copy-Item .env.example .env
```

Create a persistent local signing key once. The backend loads it from the Git-ignored `.env.local`, so Uvicorn reloads do not invalidate your session:

```powershell
python -c "from pathlib import Path; import secrets; p=Path('.env.local'); p.write_text(f'AUTH_SECRET_KEY={secrets.token_urlsafe(48)}\n', encoding='utf-8') if not p.exists() else None"
```

Production deployments must provide their own `AUTH_SECRET_KEY` through the deployment environment.

### Database

The default `DATABASE_URL` in `.env.example` uses SQLite at `backend/data/screening.db`. The app creates the data directory, tables, and schema migrations when the backend starts; SQLite needs no separate service.

For a local PostgreSQL installation, set `DATABASE_URL` and `POSTGRES_SERVICE_NAME` in `.env`, for example:

```env
DATABASE_URL=postgresql+psycopg2://USER:PASSWORD@localhost:5432/recruitai
POSTGRES_SERVICE_NAME=postgresql-x64-18
START_POSTGRES_SERVICE=true
```

`npm run backend` starts that local service through `npm run db:start`. For a remote or separately managed PostgreSQL server, set `START_POSTGRES_SERVICE=false` so the script skips local service startup.

Notes:
- `.env` is tracked in this checkout; keep private credentials in the Git-ignored `.env.local`.
- No external API key is needed for the default local screening workflow.

## Install

### Frontend

```powershell
npm install
```

### Backend

From the project root:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

## Run

### Start the frontend

```powershell
npm run frontend
```

Open:

```text
http://127.0.0.1:5173
```

### Start the backend

```powershell
npm run backend
```

The API starts the resume evaluation worker in its own background thread by default (`RUN_EVALUATION_WORKER=true`). To run it as a separate process, set `RUN_EVALUATION_WORKER=false`, start the backend, then run this in another terminal:

```powershell
npm run backend:worker
```

Use one resume evaluation worker at a time. The separate worker command is for use when automatic worker startup is disabled.

API docs:

```text
http://127.0.0.1:8000/docs
```

## Project setup notes

- Demo account seeding is disabled by default. Register through the app, or enable local demo seeding with `SEED_DEMO_USER=true` and a `DEMO_USER_PASSWORD` in `.env`.
- The backend is a minimal screening API for the project flow.
- No external AI key is required for the default setup.

## Useful commands

```powershell
npm run typecheck
npm run lint
```
