import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { googleLogout } from '@react-oauth/google';

import { useAppDispatch, useAppSelector } from './hooks/redux';
import AppRouter from './routes/AppRouter';
import { routes } from './routes/paths';
import {
  clearAuthError,
  initializeSession,
  sessionExpired,
  signInUser,
  signInWithGoogleUser,
  signOutUser,
  skipSessionCheck,
} from './store/authSlice';

export default function App() {
  const dispatch = useAppDispatch();
  const {
    user,
    checkingSession,
    sessionInitialized,
    signingIn,
    error: authError,
  } = useAppSelector((state) => state.auth);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleUnauthorized = () => dispatch(sessionExpired());
    window.addEventListener('recruitai:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('recruitai:unauthorized', handleUnauthorized);
    };
  }, [dispatch]);

  useEffect(() => {
    if (location.pathname === routes.signIn) {
      dispatch(skipSessionCheck());
      return;
    }
    if (!sessionInitialized) void dispatch(initializeSession());
  }, [dispatch, location.pathname, sessionInitialized]);

  const handleSignIn = async (email: string, password: string) => {
    await dispatch(signInUser({ email, password })).unwrap();
  };

  const handleGoogleSignIn = async (credential: string) => {
    await dispatch(signInWithGoogleUser(credential)).unwrap();
  };

  const handleSignOut = () => {
    void dispatch(signOutUser());
    navigate(routes.signIn, { replace: true });
    googleLogout();
  };

  return (
    <AppRouter
      user={user}
      checkingSession={checkingSession}
      signingIn={signingIn}
      authError={authError}
      onClearAuthError={() => dispatch(clearAuthError())}
      onSignIn={handleSignIn}
      onGoogleSignIn={handleGoogleSignIn}
      onSignOut={handleSignOut}
    />
  );
}
