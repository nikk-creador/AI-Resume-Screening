import { ApiError, apiRequest, getActiveCompanyId, setActiveCompanyId } from './api/client';
import { API_TIMEOUT_MS } from './api/config';
import type { AuthUser } from '../types/auth';

interface AuthResponse {
  user: AuthUser;
}

function applyCompanyPreference(user: AuthUser): AuthUser {
  const validCompanyIds = new Set(user.companies.map((company) => company.id));
  const savedCompanyId = getActiveCompanyId();
  const companyId =
    savedCompanyId && validCompanyIds.has(savedCompanyId)
      ? savedCompanyId
      : user.default_company_id && validCompanyIds.has(user.default_company_id)
        ? user.default_company_id
        : (user.companies[0]?.id ?? null);
  setActiveCompanyId(companyId);
  return user;
}

export interface AuthActionResponse {
  message: string;
  action_url?: string | null;
}

export async function registerAccount(
  fullName: string,
  email: string,
  password: string,
): Promise<AuthActionResponse> {
  return apiRequest<AuthActionResponse>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify({ full_name: fullName, email, password }) },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
}

export async function completeEmailVerification(token: string): Promise<AuthActionResponse> {
  return apiRequest<AuthActionResponse>(
    '/api/auth/verification/complete',
    { method: 'POST', body: JSON.stringify({ token }) },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
}

export async function requestPasswordReset(email: string): Promise<AuthActionResponse> {
  return apiRequest<AuthActionResponse>(
    '/api/auth/password-reset/request',
    { method: 'POST', body: JSON.stringify({ email }) },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
}

export async function completePasswordReset(
  token: string,
  password: string,
): Promise<AuthActionResponse> {
  return apiRequest<AuthActionResponse>(
    '/api/auth/password-reset/complete',
    { method: 'POST', body: JSON.stringify({ token, password }) },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
}

export async function loadCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await apiRequest<AuthResponse | null>(
      '/api/auth/me',
      {},
      { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
    );
    if (!response) throw new ApiError('Could not verify your session.', 500);
    return applyCompanyPreference(response.user);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const response = await apiRequest<AuthResponse | null>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
  if (!response) throw new ApiError('Could not start your session.', 500);
  return applyCompanyPreference(response.user);
}

export async function signInWithGoogle(credential: string): Promise<AuthUser> {
  const response = await apiRequest<AuthResponse | null>(
    '/api/auth/google',
    { method: 'POST', body: JSON.stringify({ credential }) },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
  if (!response) throw new ApiError('Could not start your Google session.', 500);
  return applyCompanyPreference(response.user);
}

export async function signOut(): Promise<void> {
  await apiRequest<null>(
    '/api/auth/logout',
    { method: 'POST' },
    { timeoutMs: API_TIMEOUT_MS },
  );
}
