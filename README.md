# AI Resume Screening

Starter project with a React JavaScript frontend, Ant Design components, and a Python FastAPI backend.

## Requirements

- Node.js and npm
- Python 3.10+

## Frontend

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The health endpoint is available at `http://127.0.0.1:8000/health`, and the API docs are at `http://127.0.0.1:8000/docs`.
