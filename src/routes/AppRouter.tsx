import { Navigate, Route, Routes } from 'react-router-dom';

import NotFoundPage from './NotFoundPage';
import { routes } from './paths';
import RequireAuth from './RequireAuth';
import WorkspaceLayout from './WorkspaceLayout';
import type { AuthMode } from '../features/auth/components/SignIn';
import SignIn from '../features/auth/components/SignIn';
import type { AuthActionResponse } from '../services/authApi';
import type { AuthUser } from '../types/auth';

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
      {!user && <Route path={routes.home} element={<Navigate to={routes.signIn} replace />} />}
      <Route element={<RequireAuth user={user} />}>
        {user && (
          <Route
            path="*"
            element={<WorkspaceLayout key={user.id} user={user} onSignOut={onSignOut} />}
          />
        )}
      </Route>
      {!user && <Route path={routes.notFound} element={<NotFoundPage isAuthenticated={false} />} />}
    </Routes>
  );
}
