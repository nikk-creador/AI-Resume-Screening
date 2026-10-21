import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  useCurrentUser,
  useGoogleSignIn,
  useRegister,
  useRequestPasswordReset,
  useResetPassword,
  useSignIn,
  useSignOut,
  useVerifyEmail,
} from './hooks/useAuth';
import { queryClient } from './lib/queryClient';
import AppRouter from './routes/AppRouter';
import { routes } from './routes/paths';
import { queryKeys } from './services/api/queryKeys';
import type { AuthActionResponse } from './services/authApi';
import { getErrorMessage } from './utils/errors';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const signInMutation = useSignIn();
  const googleSignInMutation = useGoogleSignIn();
  const signOutMutation = useSignOut();
  const registerMutation = useRegister();
  const verifyEmailMutation = useVerifyEmail();
  const requestPasswordResetMutation = useRequestPasswordReset();
  const resetPasswordMutation = useResetPassword();
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const handleUnauthorized = () => {
      queryClient.setQueryData(queryKeys.auth.currentUser, null);
      queryClient.removeQueries({ queryKey: queryKeys.screenings.root });
      queryClient.removeQueries({ queryKey: queryKeys.organization.root });
      queryClient.removeQueries({ queryKey: queryKeys.invitations.root });
      setAuthError('Your session has expired. Sign in again.');
      if (location.pathname !== routes.signIn) {
        navigate(routes.signIn, { replace: true, state: { from: location } });
      }
    };

    window.addEventListener('recruitai:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('recruitai:unauthorized', handleUnauthorized);
  }, [location, navigate]);

  const runAuthAction = async <T,>(action: () => Promise<T>, fallback: string): Promise<T> => {
    setAuthError('');
    try {
      return await action();
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, fallback));
      throw error;
    }
  };

  return (
    <AppRouter
      user={currentUser.data ?? null}
      checkingSession={currentUser.isPending}
      signingIn={signInMutation.isPending || googleSignInMutation.isPending}
      authError={
        authError ||
        (currentUser.error
          ? getErrorMessage(currentUser.error, 'Could not check your sign-in session.')
          : '')
      }
      onClearAuthError={() => setAuthError('')}
      onSignIn={(email, password) =>
        runAuthAction(
          () => signInMutation.mutateAsync({ email, password }),
          'Could not sign in. Check your details and try again.',
        ).then(() => undefined)
      }
      onGoogleSignIn={(credential) =>
        runAuthAction(
          () => googleSignInMutation.mutateAsync(credential),
          'Could not sign in with Google. Try again.',
        ).then(() => undefined)
      }
      onSignOut={() => {
        void runAuthAction(() => signOutMutation.mutateAsync(), 'Could not sign out. Try again.');
      }}
      onRegister={(fullName, email, password): Promise<AuthActionResponse> =>
        runAuthAction(
          () => registerMutation.mutateAsync({ fullName, email, password }),
          'Could not create your account. Try again.',
        )
      }
      onVerifyEmail={(token) =>
        runAuthAction(
          () => verifyEmailMutation.mutateAsync(token),
          'Could not verify your email address. Try again.',
        )
      }
      onRequestPasswordReset={(email) =>
        runAuthAction(
          () => requestPasswordResetMutation.mutateAsync(email),
          'Could not request a password reset. Try again.',
        )
      }
      onResetPassword={(token, password) =>
        runAuthAction(
          () => resetPasswordMutation.mutateAsync({ token, password }),
          'Could not reset your password. Try again.',
        )
      }
    />
  );
}
