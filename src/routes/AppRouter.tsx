import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { routes } from './paths';
import RequireAuth from './RequireAuth';
import PublicHomePage from './PublicHomePage';
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
  if (checkingSession) {
    return (
      <main className="auth-loading" aria-busy="true" aria-label="Checking sign-in session">
        <span className="brand-mark">R</span>
      </main>
    );
  }

  const authPage = (mode: AuthMode) =>
    user ? (
      <Navigate to={routes.home} replace />
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
      {!user && <Route path={routes.home} element={<PublicHomePage />} />}
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
      {!user && <Route path="*" element={<Navigate to={routes.signIn} replace />} />}
    </Routes>
  );
}
