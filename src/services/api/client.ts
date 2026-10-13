import { API_BASE_URL } from './config';

export const ACTIVE_COMPANY_STORAGE_KEY = 'recruitai:active-company-id';

export function getActiveCompanyId(): string | null {
  return typeof window === 'undefined'
    ? null
    : window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY);
}

export function setActiveCompanyId(companyId: string | null): void {
  if (typeof window === 'undefined') return;
  if (companyId) window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
  else window.localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
}

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

function createRequestHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const activeCompanyId = getActiveCompanyId();
  if (activeCompanyId) headers.set('X-Company-Id', activeCompanyId);
  return headers;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  config: RequestConfig = {},
): Promise<T> {
  let response: Response;
  const headers = createRequestHeaders(options);

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
    if (response.status === 404 && detail === 'Company not found.') {
      window.dispatchEvent(
        new CustomEvent('recruitai:company-access-denied', { detail: getActiveCompanyId() }),
      );
    }
    if (
      response.status === 403 &&
      detail === "You do not have permission to view this company's data."
    ) {
      window.dispatchEvent(
        new CustomEvent('recruitai:company-view-access-denied', { detail: getActiveCompanyId() }),
      );
    }
    throw new ApiError(
      detail || `Request failed (${response.status}). Try again.`,
      response.status,
    );
  }

  return data as T;
}

export async function downloadApiFile(path: string, filename: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: createRequestHeaders({}),
    });
  } catch {
    throw new ApiError("Can't reach the backend. Check that the API is running and try again.", 0);
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('recruitai:unauthorized'));
    }
    const data: unknown = await response.json().catch(() => ({}));
    const detail = getApiErrorDetail(data as ApiErrorPayload);
    if (response.status === 404 && detail === 'Company not found.') {
      window.dispatchEvent(
        new CustomEvent('recruitai:company-access-denied', { detail: getActiveCompanyId() }),
      );
    }
    if (
      response.status === 403 &&
      detail === "You do not have permission to view this company's data."
    ) {
      window.dispatchEvent(
        new CustomEvent('recruitai:company-view-access-denied', { detail: getActiveCompanyId() }),
      );
    }
    throw new ApiError(
      detail || `Request failed (${response.status}). Try again.`,
      response.status,
    );
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}
