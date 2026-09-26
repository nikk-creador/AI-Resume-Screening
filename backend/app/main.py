from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import re
from uuid import uuid4

from docx import Document
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from strawberry.fastapi import GraphQLRouter
from pydantic import BaseModel
from pypdf import PdfReader
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from .database import Base, UPLOAD_DIR, engine, get_db
from .graphql_schema import schema
from .models import Resume, Screening

MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_JOB_DESCRIPTION_CHARS = 10_000
MIN_JOB_DESCRIPTION_WORDS = 20
RESUME_EXTENSIONS = {".pdf", ".doc", ".docx"}
JOB_EXTENSIONS = {".pdf", ".docx", ".txt"}


class BulkDeleteResumes(BaseModel):
    resume_ids: list[str]


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="RecruitAI Resume Screening API",
    version="0.3.0",
    description="API for storing resume screening sessions and uploaded documents.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def graphql_context(db: Session = Depends(get_db)) -> dict[str, Session]:
    return {"db": db}


app.include_router(GraphQLRouter(schema, context_getter=graphql_context), prefix="/graphql")


def count_words(value: str) -> int:
    return len(re.findall(r"\b[\w]+(?:['-][\w]+)*\b", value, flags=re.UNICODE))


def safe_filename(upload: UploadFile) -> str:
    raw_name = (upload.filename or "").replace("\\", "/")
    filename = Path(raw_name).name.strip()
    if not filename or filename in {".", ".."}:
        raise HTTPException(status_code=400, detail="Every uploaded file must have a filename.")
    return filename[:255]


async def read_upload(upload: UploadFile, allowed_extensions: set[str]) -> tuple[str, bytes]:
    filename = safe_filename(upload)
    if Path(filename).suffix.lower() not in allowed_extensions:
        allowed = ", ".join(sorted(allowed_extensions))
        raise HTTPException(status_code=415, detail=f"{filename}: supported file types are {allowed}.")
    content = await upload.read(MAX_FILE_SIZE + 1)
    if not content:
        raise HTTPException(status_code=400, detail=f"{filename}: the file is empty.")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"{filename}: files must be 10 MB or smaller.")
    return filename, content


def extract_job_description(filename: str, content: bytes) -> str:
    extension = Path(filename).suffix.lower()
    try:
        if extension == ".txt":
            return content.decode("utf-8-sig")
        if extension == ".pdf":
            return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(content)).pages)
        if extension == ".docx":
            document = Document(BytesIO(content))
            parts = [paragraph.text for paragraph in document.paragraphs]
            parts.extend(cell.text for table in document.tables for row in table.rows for cell in row.cells)
            return "\n".join(parts)
    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail="Could not read text from the job description file. Use a searchable PDF, DOCX, or plain text file.",
        ) from error
    raise HTTPException(status_code=415, detail="Use a PDF, DOCX, or TXT job description.")


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def screening_payload(screening: Screening) -> dict:
    return {
        "id": screening.id,
        "created_at": iso_utc(screening.created_at),
        "job_description_text": screening.job_description_text,
        "job_description_filename": screening.job_description_filename,
        "resumes": [
            {
                "id": resume.id,
                "filename": resume.filename,
                "size_bytes": resume.size_bytes,
                "content_type": resume.content_type,
                "created_at": iso_utc(resume.created_at),
            }
            for resume in screening.resumes
        ],
    }


@app.get("/health", tags=["system"])
def health_check(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@app.post("/api/screenings", status_code=status.HTTP_201_CREATED, tags=["screenings"])
async def create_screening(
    resumes: list[UploadFile] = File(...),
    job_description_text: str = Form(default=""),
    job_description_file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
):
    if not resumes:
        raise HTTPException(status_code=422, detail="Add at least one resume.")
    if len(job_description_text) > MAX_JOB_DESCRIPTION_CHARS:
        raise HTTPException(status_code=422, detail=f"Keep the job description under {MAX_JOB_DESCRIPTION_CHARS:,} characters.")

    clean_job_text = job_description_text.strip()
    if clean_job_text and count_words(clean_job_text) < MIN_JOB_DESCRIPTION_WORDS:
        raise HTTPException(status_code=422, detail=f"Job description must contain at least {MIN_JOB_DESCRIPTION_WORDS} words.")

    uploaded_paths: list[Path] = []
    screening = Screening(id=str(uuid4()), job_description_text=clean_job_text)
    try:
        if job_description_file is not None:
            filename, content = await read_upload(job_description_file, JOB_EXTENSIONS)
            extracted_text = extract_job_description(filename, content).strip()
            if len(extracted_text) > MAX_JOB_DESCRIPTION_CHARS:
                raise HTTPException(status_code=422, detail=f"Keep the job description under {MAX_JOB_DESCRIPTION_CHARS:,} characters.")
            if not clean_job_text:
                if count_words(extracted_text) < MIN_JOB_DESCRIPTION_WORDS:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Job description file must contain at least {MIN_JOB_DESCRIPTION_WORDS} readable words. Try a searchable PDF or paste the text.",
                    )
                screening.job_description_text = extracted_text
            storage_name = f"{uuid4().hex}{Path(filename).suffix.lower()}"
            file_path = UPLOAD_DIR / storage_name
            file_path.write_bytes(content)
            uploaded_paths.append(file_path)
            screening.job_description_filename = filename
            screening.job_description_content_type = job_description_file.content_type
            screening.job_description_storage_name = storage_name

        seen_files: set[tuple[str, int]] = set()
        for upload in resumes:
            filename, content = await read_upload(upload, RESUME_EXTENSIONS)
            duplicate_key = (filename.casefold(), len(content))
            if duplicate_key in seen_files:
                raise HTTPException(status_code=422, detail=f"{filename} was included more than once.")
            seen_files.add(duplicate_key)
            storage_name = f"{uuid4().hex}{Path(filename).suffix.lower()}"
            file_path = UPLOAD_DIR / storage_name
            file_path.write_bytes(content)
            uploaded_paths.append(file_path)
            screening.resumes.append(
                Resume(
                    id=str(uuid4()),
                    filename=filename,
                    content_type=upload.content_type,
                    size_bytes=len(content),
                    storage_name=storage_name,
                )
            )

        db.add(screening)
        db.commit()
        db.refresh(screening)
        return screening_payload(screening)
    except HTTPException:
        db.rollback()
        for file_path in uploaded_paths:
            file_path.unlink(missing_ok=True)
        raise
    except Exception:
        db.rollback()
        for file_path in uploaded_paths:
            file_path.unlink(missing_ok=True)
        raise


@app.get("/api/screenings/{screening_id}", tags=["screenings"])
def get_screening(screening_id: str, db: Session = Depends(get_db)):
    screening = db.scalar(
        select(Screening).options(selectinload(Screening.resumes)).where(Screening.id == screening_id)
    )
    if screening is None:
        raise HTTPException(status_code=404, detail="Screening not found.")
    return screening_payload(screening)


@app.get("/api/resumes/{resume_id}/download", tags=["resumes"])
def download_resume(resume_id: str, db: Session = Depends(get_db)):
    resume = db.get(Resume, resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume not found.")
    file_path = UPLOAD_DIR / resume.storage_name
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Stored resume file is missing.")
    return FileResponse(file_path, media_type=resume.content_type or "application/octet-stream", filename=resume.filename)


@app.get("/api/screenings/{screening_id}/job-description", tags=["screenings"])
def download_job_description(screening_id: str, db: Session = Depends(get_db)):
    screening = db.get(Screening, screening_id)
    if screening is None or not screening.job_description_storage_name:
        raise HTTPException(status_code=404, detail="Uploaded job description not found.")
    file_path = UPLOAD_DIR / screening.job_description_storage_name
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Stored job description file is missing.")
    return FileResponse(
        file_path,
        media_type=screening.job_description_content_type or "application/octet-stream",
        filename=screening.job_description_filename,
    )


@app.post("/api/resumes/bulk-delete", tags=["resumes"])
def bulk_delete_resumes(payload: BulkDeleteResumes, db: Session = Depends(get_db)):
    resume_ids = list(dict.fromkeys(payload.resume_ids))
    if not resume_ids:
        raise HTTPException(status_code=422, detail="Select at least one resume to remove.")
    records = list(db.scalars(select(Resume).where(Resume.id.in_(resume_ids))).all())
    for record in records:
        db.delete(record)
    db.commit()
    for record in records:
        (UPLOAD_DIR / record.storage_name).unlink(missing_ok=True)
    return {"deleted_count": len(records), "deleted_ids": [record.id for record in records]}
