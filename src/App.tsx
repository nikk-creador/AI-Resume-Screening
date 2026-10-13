import { useState } from 'react';

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
import AppRouter from './routes/AppRouter';
import type { AuthActionResponse } from './services/authApi';
import { getErrorMessage } from './utils/errors';

export default function App() {
  const currentUser = useCurrentUser();
  const signInMutation = useSignIn();
  const googleSignInMutation = useGoogleSignIn();
  const signOutMutation = useSignOut();
  const registerMutation = useRegister();
  const verifyEmailMutation = useVerifyEmail();
  const requestPasswordResetMutation = useRequestPasswordReset();
  const resetPasswordMutation = useResetPassword();
  const [authError, setAuthError] = useState('');

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
