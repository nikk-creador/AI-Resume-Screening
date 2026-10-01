import { Navigate, Route, Routes } from 'react-router-dom';

import NotFoundPage from './NotFoundPage';
import { routes } from './paths';
import RequireAuth from './RequireAuth';
import WorkspaceLayout from './WorkspaceLayout';
import SignIn from '../features/auth/components/SignIn';
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
}: AppRouterProps) {
  if (checkingSession) {
    return (
      <main className="auth-loading" aria-busy="true" aria-label="Checking sign-in session">
        <span className="brand-mark">R</span>
      </main>
    );
  }

  return (
    <Routes>
      <Route
        path={routes.signIn}
        element={
          !user ? (
            <SignIn
              error={authError}
              loading={signingIn}
              onClearError={onClearAuthError}
              onSubmit={onSignIn}
              onGoogleSignIn={onGoogleSignIn}
            />
          ) : (
            <Navigate to={routes.home} replace />
          )
        }
      />
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
