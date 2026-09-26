export const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
export const SCREENING_STORAGE_KEY = 'resume-screening:last-id';
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_JOB_DESCRIPTION_CHARS = 10_000;
export const MIN_JOB_DESCRIPTION_WORDS = 20;
export const RESUME_EXTENSIONS = ['pdf', 'doc', 'docx'];
export const JOB_DESCRIPTION_EXTENSIONS = ['pdf', 'docx', 'txt'];
