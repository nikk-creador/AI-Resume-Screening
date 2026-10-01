import { API_BASE_URL } from './config';

interface ApiErrorPayload {
  detail?: unknown;
}

interface RequestConfig {
  timeoutMs?: number;
  notifyUnauthorized?: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getApiErrorDetail(payload: ApiErrorPayload): string | undefined {
  if (Array.isArray(payload.detail)) {
    return payload.detail
      .map((item: unknown) => {
        if (typeof item === 'object' && item !== null && 'msg' in item) {
          return String(item.msg);
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return typeof payload.detail === 'string' ? payload.detail : undefined;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  config: RequestConfig = {},
): Promise<T> {
  let response: Response;
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? options.headers
    : { 'Content-Type': 'application/json', ...options.headers };

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      ...(config.timeoutMs && !options.signal
        ? { signal: AbortSignal.timeout(config.timeoutMs) }
        : {}),
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiError("Can't reach the backend. Check that the API is running and try again.", 0);
  }

  if (response.status === 204) return null as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && config.notifyUnauthorized !== false) {
      window.dispatchEvent(new Event('recruitai:unauthorized'));
    }
    const detail = getApiErrorDetail(data as ApiErrorPayload);
    throw new ApiError(
      detail || `Request failed (${response.status}). Try again.`,
      response.status,
    );
  }

  return data as T;
}
