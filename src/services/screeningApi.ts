import { apiRequest as request } from './api/client';
import type {
  EvaluationCriterion,
  CandidatePipelineStage,
  RetryMode,
  ScreeningApiRecord,
  ScreeningCreateInput,
  ScreeningListResponse,
} from '../types/screening';

export { getErrorMessage } from '../utils/errors';

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

export { ApiError } from './api/client';

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

export function updateCandidatePipelineStage(
  resumeId: string,
  stage: CandidatePipelineStage,
): Promise<{ resume_id: string; pipeline_stage: CandidatePipelineStage }> {
  return request(`/api/resumes/${encodeURIComponent(resumeId)}/pipeline-stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage }),
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

export function retryResume(resumeId: string): Promise<{ resume_id: string; status: 'queued' }> {
  return request(`/api/resumes/${encodeURIComponent(resumeId)}/retry`, { method: 'POST' });
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
  jobRequirements,
  scoringConfig,
}: ScreeningCreateInput): Promise<ScreeningApiRecord> {
  const formData = new FormData();
  formData.append('screening_name', name);
  formData.append('job_description_text', jobText);
  formData.append('evaluation_criteria', JSON.stringify(criteria));
  formData.append('job_requirements', JSON.stringify(jobRequirements));
  if (scoringConfig) formData.append('scoring_config', JSON.stringify(scoringConfig));
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
