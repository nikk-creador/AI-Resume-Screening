# RecruitAI

RecruitAI is a resume and job-description review workspace built with React, TypeScript, Ant Design, FastAPI, and SQLAlchemy.

## Frontend

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Run the TypeScript checker with `npm run typecheck`.

## Backend

From the project root:

```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --app-dir backend --env-file .env
```

The API docs are at `http://127.0.0.1:8000/docs`. Configure `DATABASE_URL` in the root `.env` file. The default database is local SQLite; PostgreSQL uses a `postgresql+psycopg2://...` URL.

GraphQL is available at `http://127.0.0.1:8000/graphql`. Screening lookup and bulk resume deletion use GraphQL; document uploads and downloads stay on the REST endpoints because they use multipart file transfer.

## Screening inputs

- Resume formats: PDF, DOC, DOCX. There is no resume count cap; each file can be up to 10 MB.
- Job description formats: searchable PDF, DOCX, TXT, or pasted text. Job descriptions require at least 20 readable words and may contain up to 10,000 characters.
- Resume rows support search, pagination, individual removal, and multi-select removal.
- Original files are stored under `backend/storage/`; database tables store their metadata and screening details.

The workspace does not calculate candidate scores yet. Matching remains a later backend feature.
