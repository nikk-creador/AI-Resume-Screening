import type { ScreeningApiRecord, ScreeningCreateInput } from '../types/screening';
import { API_URL } from '../constants/screening';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorPayload {
  detail?: unknown;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, options);
  } catch {
    throw new ApiError("Can't reach the backend. Check that the API is running and try again.", 0);
  }

  if (response.status === 204) return null as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as ApiErrorPayload;
    const detail = Array.isArray(payload.detail)
      ? payload.detail
          .map((item: unknown) => {
            if (typeof item === 'object' && item !== null && 'msg' in item) {
              return String(item.msg);
            }
            return '';
          })
          .filter(Boolean)
          .join(' ')
      : typeof payload.detail === 'string'
        ? payload.detail
        : undefined;
    throw new ApiError(
      detail || `Request failed (${response.status}). Try again.`,
      response.status,
    );
  }
  return data as T;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function graphQLRequest<T>(
  query: string,
  variables: Record<string, string | string[]>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new ApiError(
      "Can't reach the GraphQL API. Check that the backend is running and try again.",
      0,
    );
  }

  const result = (await response.json().catch(() => ({}))) as GraphQLResponse<T>;
  if (!response.ok || result.errors?.length || !result.data) {
    throw new ApiError(
      result.errors?.map((error) => error.message).join(' ') ||
        `GraphQL request failed (${response.status}).`,
      response.status,
    );
  }
  return result.data;
}

export async function loadScreening(screeningId: string): Promise<ScreeningApiRecord> {
  const result = await graphQLRequest<{ screening: ScreeningApiRecord | null }>(
    `query ScreeningById($id: ID!) {
      screening(id: $id) {
        id
        created_at: createdAt
        job_description_text: jobDescriptionText
        job_description_filename: jobDescriptionFilename
        resumes {
          id
          filename
          size_bytes: sizeBytes
          content_type: contentType
          created_at: createdAt
        }
      }
    }`,
    { id: screeningId },
  );
  if (!result.screening) throw new ApiError('Screening not found.', 404);
  return result.screening;
}

export async function createScreening({
  resumes,
  jobFile,
  jobText,
}: ScreeningCreateInput): Promise<ScreeningApiRecord> {
  const formData = new FormData();
  formData.append('job_description_text', jobText);
  if (jobFile instanceof File) formData.append('job_description_file', jobFile);
  resumes.forEach((resume) => {
    if (resume.file) formData.append('resumes', resume.file);
  });
  return request<ScreeningApiRecord>('/api/screenings', { method: 'POST', body: formData });
}

export async function deleteResumes(
  resumeIds: string[],
): Promise<{ deleted_count: number; deleted_ids: string[] }> {
  const result = await graphQLRequest<{
    delete_resumes: { deleted_count: number; deleted_ids: string[] };
  }>(
    `mutation DeleteResumes($ids: [ID!]!) {
      delete_resumes(ids: $ids) {
        deleted_count: deletedCount
        deleted_ids: deletedIds
      }
    }`,
    { ids: resumeIds },
  );
  return result.delete_resumes;
}
