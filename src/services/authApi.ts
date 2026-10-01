import { ApiError, apiRequest } from './api/client';
import { API_TIMEOUT_MS } from './api/config';
import type { AuthUser } from '../types/auth';

interface AuthResponse {
  user: AuthUser;
}

export async function loadCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await apiRequest<AuthResponse | null>(
      '/api/auth/me',
      {},
      { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
    );
    if (!response) throw new ApiError('Could not verify your session.', 500);
    return response.user;
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
  return response.user;
}

export async function signInWithGoogle(credential: string): Promise<AuthUser> {
  const response = await apiRequest<AuthResponse | null>(
    '/api/auth/google',
    { method: 'POST', body: JSON.stringify({ credential }) },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
  if (!response) throw new ApiError('Could not start your Google session.', 500);
  return response.user;
}

export async function signOut(): Promise<void> {
  await apiRequest<null>(
    '/api/auth/logout',
    { method: 'POST' },
    { timeoutMs: API_TIMEOUT_MS, notifyUnauthorized: false },
  );
}
