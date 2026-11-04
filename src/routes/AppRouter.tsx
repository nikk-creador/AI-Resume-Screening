import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { publicPaths, routes } from './paths';
import PublicHomePage from './PublicHomePage';
import RequireAuth from './RequireAuth';
import type { AuthMode } from '../features/auth/components/SignIn';
import SignIn from '../features/auth/components/SignIn';
import AcceptInvitationPage from '../features/organization/components/AcceptInvitationPage';
import type { AuthActionResponse } from '../services/authApi';
import type { AuthUser } from '../types/auth';
const WorkspaceLayout = lazy(() => import('./WorkspaceLayout'));

interface AppRouterProps {
  user: AuthUser | null;
  checkingSession: boolean;
  signingIn: boolean;
  authError: string;
  onClearAuthError: () => void;
  onSignIn: (email: string, password: string) => Promise<void>;
  onGoogleSignIn: (credential: string) => Promise<void>;
  onSignOut: () => void;
  onRegister: (fullName: string, email: string, password: string) => Promise<AuthActionResponse>;
  onVerifyEmail: (token: string) => Promise<AuthActionResponse>;
  onRequestPasswordReset: (email: string) => Promise<AuthActionResponse>;
  onResetPassword: (token: string, password: string) => Promise<AuthActionResponse>;
}

export default function AppRouter({
  user,
  checkingSession,
  signingIn,
  authError,
  onClearAuthError,
  onSignIn,
  onGoogleSignIn,
  onSignOut,
  onRegister,
  onVerifyEmail,
  onRequestPasswordReset,
  onResetPassword,
}: AppRouterProps) {
  const location = useLocation();
  const requestedLocation = (
    location.state as {
      from?: { pathname?: string; search?: string; hash?: string };
    } | null
  )?.from;
  const requestedPath = requestedLocation?.pathname;
  const returnTo =
    requestedPath?.startsWith('/') &&
    !requestedPath.startsWith('//') &&
    !publicPaths.includes(requestedPath)
      ? {
          pathname: requestedPath,
          search: requestedLocation?.search ?? '',
          hash: requestedLocation?.hash ?? '',
        }
      : routes.home;

  if (checkingSession) {
    return (
      <main className="auth-loading" aria-busy="true" aria-label="Checking sign-in session">
        <span className="brand-mark">R</span>
      </main>
    );
  }

  const authPage = (mode: AuthMode) =>
    user ? (
      <Navigate to={returnTo} replace />
    ) : (
      <SignIn
        mode={mode}
        error={authError}
        loading={signingIn}
        onClearError={onClearAuthError}
        onSubmit={onSignIn}
        onGoogleSignIn={onGoogleSignIn}
        onRegister={onRegister}
        onVerifyEmail={onVerifyEmail}
        onRequestPasswordReset={onRequestPasswordReset}
        onResetPassword={onResetPassword}
      />
    );

  return (
    <Routes>
      <Route path={routes.signIn} element={authPage('signin')} />
      <Route path={routes.register} element={authPage('register')} />
      <Route path={routes.forgotPassword} element={authPage('forgot')} />
      <Route path={routes.verifyEmail} element={authPage('verify')} />
      <Route path={routes.resetPassword} element={authPage('reset')} />
      <Route path={routes.acceptInvitation} element={<AcceptInvitationPage user={user} />} />
      <Route path={routes.publicHome} element={<PublicHomePage />} />
      {!user && <Route path={routes.home} element={<Navigate to={routes.signIn} replace />} />}
      <Route element={<RequireAuth user={user} />}>
        {user && (
          <Route
            path="*"
            element={
              <Suspense
                fallback={
                  <main className="auth-loading" aria-busy="true" aria-label="Loading workspace">
                    <span className="brand-mark">R</span>
                  </main>
                }
              >
                <WorkspaceLayout key={user.id} user={user} onSignOut={onSignOut} />
              </Suspense>
            }
          />
        )}
      </Route>
      {!user && (
        <Route
          path="*"
          element={<Navigate to={routes.signIn} replace state={{ from: location }} />}
        />
      )}
    </Routes>
  );
}
