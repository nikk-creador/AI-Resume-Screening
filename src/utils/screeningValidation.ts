import {
  JOB_DESCRIPTION_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_JOB_DESCRIPTION_CHARS,
  MIN_JOB_DESCRIPTION_WORDS,
  RESUME_EXTENSIONS,
} from '../constants/screening';
import type { ResumeRow } from '../types/screening';

export function getExtension(filename = ''): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

export function getWordCount(value = ''): number {
  return value.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function validateFile(
  file: { name: string; size?: number } | null | undefined,
  allowedExtensions: readonly string[],
  label: string,
): string {
  if (!file?.name) return `Choose a ${label.toLowerCase()} file.`;
  if (!allowedExtensions.includes(getExtension(file.name))) {
    return `${file.name}: choose a supported ${label.toLowerCase()} file (${allowedExtensions.join(', ').toUpperCase()}).`;
  }
  if (file.size === 0) return `${file.name}: this file is empty.`;
  if (file.size !== undefined && file.size > MAX_FILE_SIZE_BYTES)
    return `${file.name}: the maximum file size is 10 MB.`;
  return '';
}

export function validateResume(file: File, existingResumes: ResumeRow[] = []): string {
  const fileError = validateFile(file, RESUME_EXTENSIONS, 'Resume');
  if (fileError) return fileError;
  const duplicate = existingResumes.some(
    (resume) => resume.name.toLowerCase() === file.name.toLowerCase() && resume.size === file.size,
  );
  return duplicate ? `${file.name} is already in this screening.` : '';
}

export function validateJobDescription(
  jobText: string,
  jobFile: File | { name: string; stored: true } | null,
): string {
  const text = jobText.trim();
  if (!text && !jobFile) return 'Add a job description to continue.';
  if (text.length > MAX_JOB_DESCRIPTION_CHARS) {
    return `Keep the job description under ${MAX_JOB_DESCRIPTION_CHARS.toLocaleString()} characters.`;
  }
  if (text && getWordCount(text) < MIN_JOB_DESCRIPTION_WORDS) {
    return `Add at least ${MIN_JOB_DESCRIPTION_WORDS} words to the job description. It currently has ${getWordCount(text)}.`;
  }
  if (jobFile) return validateFile(jobFile, JOB_DESCRIPTION_EXTENSIONS, 'Job description');
  return '';
}

export function displayName(filename = ''): string {
  return (
    filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || filename
  );
}

export function formatFileSize(size = 0): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return 'Pending upload';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}
