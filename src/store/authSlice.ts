import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import { loadCurrentUser, signIn, signInWithGoogle, signOut } from '../services/authApi';
import { getErrorMessage } from '../services/screeningApi';
import type { AuthUser } from '../types/auth';

interface AuthState {
  user: AuthUser | null;
  checkingSession: boolean;
  sessionInitialized: boolean;
  signingIn: boolean;
  error: string;
}

const initialState: AuthState = {
  user: null,
  checkingSession: true,
  sessionInitialized: false,
  signingIn: false,
  error: '',
};

export const initializeSession = createAsyncThunk('auth/initializeSession', async () =>
  loadCurrentUser(),
);

export const signInUser = createAsyncThunk(
  'auth/signIn',
  async ({ email, password }: { email: string; password: string }) => signIn(email, password),
);

export const signInWithGoogleUser = createAsyncThunk(
  'auth/signInWithGoogle',
  async (credential: string) => signInWithGoogle(credential),
);

export const signOutUser = createAsyncThunk('auth/signOut', async () => signOut());

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearAuthError(state) {
      state.error = '';
    },
    skipSessionCheck(state) {
      state.checkingSession = false;
    },
    sessionExpired(state) {
      state.user = null;
      state.error = 'Your session has expired. Sign in again.';
    },
  },
  extraReducers(builder) {
    builder
      .addCase(initializeSession.pending, (state) => {
        state.checkingSession = true;
        state.error = '';
      })
      .addCase(initializeSession.fulfilled, (state, action) => {
        state.user = action.payload;
        state.checkingSession = false;
        state.sessionInitialized = true;
      })
      .addCase(initializeSession.rejected, (state, action) => {
        state.checkingSession = false;
        state.sessionInitialized = true;
        state.error = getErrorMessage(action.error, 'Could not check your sign-in session.');
      })
      .addCase(signInUser.pending, (state) => {
        state.signingIn = true;
        state.error = '';
      })
      .addCase(signInUser.fulfilled, (state, action) => {
        state.user = action.payload;
        state.signingIn = false;
      })
      .addCase(signInUser.rejected, (state, action) => {
        state.signingIn = false;
        state.error = getErrorMessage(
          action.error,
          'Could not sign in. Check your details and try again.',
        );
      })
      .addCase(signInWithGoogleUser.pending, (state) => {
        state.signingIn = true;
        state.error = '';
      })
      .addCase(signInWithGoogleUser.fulfilled, (state, action) => {
        state.user = action.payload;
        state.signingIn = false;
      })
      .addCase(signInWithGoogleUser.rejected, (state, action) => {
        state.signingIn = false;
        state.error = getErrorMessage(action.error, 'Could not sign in with Google. Try again.');
      })
      .addCase(signOutUser.fulfilled, (state) => {
        state.user = null;
        state.error = '';
      })
      .addCase(signOutUser.rejected, (state, action) => {
        state.error = getErrorMessage(action.error, 'Could not sign out. Try again.');
      });
  },
});

export const { clearAuthError, sessionExpired, skipSessionCheck } = authSlice.actions;
export default authSlice.reducer;
