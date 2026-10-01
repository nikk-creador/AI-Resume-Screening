import { apiRequest as request } from './api/client';
import type {
  EvaluationCriterion,
  JobRequirement,
  RetryMode,
  ScreeningApiRecord,
  ScreeningCreateInput,
  ScreeningListResponse,
} from '../types/screening';

export { ApiError } from './api/client';

export interface AITestResponse {
  ok: boolean;
  model: string;
  latency_ms: number;
}

export function testAIService(): Promise<AITestResponse> {
  return request<AITestResponse>('/api/ai/test', { method: 'POST' });
}

export async function suggestScreeningCriteria(
  jobDescriptionText: string,
  jobDescriptionFile: File | null,
): Promise<EvaluationCriterion[]> {
  const formData = new FormData();
  formData.append('job_description_text', jobDescriptionText);
  if (jobDescriptionFile) formData.append('job_description_file', jobDescriptionFile);
  const result = await request<{ criteria: EvaluationCriterion[] }>(
    '/api/screenings/suggest-criteria',
    { method: 'POST', body: formData },
  );
  return result.criteria;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return typeof error.message === 'string' ? error.message : fallback;
  }
  return fallback;
}

export async function loadScreening(screeningId: string): Promise<ScreeningApiRecord> {
  return request<ScreeningApiRecord>(`/api/screenings/${encodeURIComponent(screeningId)}`);
}

export async function updateScreening(
  screeningId: string,
  changes: { name: string; job_description_text: string; criteria: EvaluationCriterion[] },
): Promise<ScreeningApiRecord> {
  return request<ScreeningApiRecord>(`/api/screenings/${encodeURIComponent(screeningId)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export function updateScreeningRequirements(
  screeningId: string,
  requirements: JobRequirement[],
): Promise<{ requirements: JobRequirement[]; queued_count: number }> {
  return request<{ requirements: JobRequirement[]; queued_count: number }>(
    `/api/screenings/${encodeURIComponent(screeningId)}/requirements`,
    { method: 'PUT', body: JSON.stringify({ requirements }) },
  );
}

export function reviewResumeScore(
  resumeId: string,
  score: number,
  note: string,
): Promise<{ score: number; model_score: number; reviewer_note: string }> {
  return request(`/api/resumes/${encodeURIComponent(resumeId)}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ score, note }),
  });
}

export async function deleteScreening(
  screeningId: string,
): Promise<{ deleted: boolean; screening_id: string }> {
  return request<{ deleted: boolean; screening_id: string }>(
    `/api/screenings/${encodeURIComponent(screeningId)}`,
    { method: 'DELETE' },
  );
}

export async function listScreenings(
  skip: number,
  limit: number,
  search: string,
): Promise<ScreeningListResponse> {
  const parameters = new URLSearchParams({ skip: String(skip), limit: String(limit) });
  if (search.trim()) parameters.set('search', search.trim());
  return request<ScreeningListResponse>(`/api/screenings?${parameters.toString()}`);
}

export async function retryScreening(
  screeningId: string,
  mode: RetryMode,
): Promise<{ queued_count: number; mode: RetryMode }> {
  const parameters = new URLSearchParams({ mode });
  return request<{ queued_count: number; mode: RetryMode }>(
    `/api/screenings/${encodeURIComponent(screeningId)}/retry?${parameters.toString()}`,
    { method: 'POST' },
  );
}

export async function stopScreening(screeningId: string): Promise<{ stopped_count: number }> {
  return request<{ stopped_count: number }>(
    `/api/screenings/${encodeURIComponent(screeningId)}/stop`,
    { method: 'POST' },
  );
}

export async function createScreening({
  name,
  jobFile,
  jobText,
  criteria,
}: ScreeningCreateInput): Promise<ScreeningApiRecord> {
  const formData = new FormData();
  formData.append('screening_name', name);
  formData.append('job_description_text', jobText);
  formData.append('evaluation_criteria', JSON.stringify(criteria));
  if (jobFile instanceof File) formData.append('job_description_file', jobFile);
  return request<ScreeningApiRecord>('/api/screenings', { method: 'POST', body: formData });
}

export async function uploadResumeBatch(
  screeningId: string,
  resumes: File[],
): Promise<ScreeningApiRecord> {
  const formData = new FormData();
  resumes.forEach((resume) => formData.append('resumes', resume));
  return request<ScreeningApiRecord>(`/api/screenings/${encodeURIComponent(screeningId)}/resumes`, {
    method: 'POST',
    body: formData,
  });
}

export async function deleteResumes(
  resumeIds: string[],
): Promise<{ deleted_count: number; deleted_ids: string[] }> {
  return request<{ deleted_count: number; deleted_ids: string[] }>('/api/resumes/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ resume_ids: resumeIds }),
  });
}
