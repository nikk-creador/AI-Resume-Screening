import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../services/api/queryKeys';
import {
  completeEmailVerification,
  completePasswordReset,
  loadCurrentUser,
  registerAccount,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signOut,
} from '../services/authApi';
import { ApiError } from '../services/api/client';

const currentUserKey = ['auth', 'current-user'] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: loadCurrentUser,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      signIn(email, password),
    onSuccess: (user) => queryClient.setQueryData(currentUserKey, user),
  });
}

export function useGoogleSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signInWithGoogle,
    onSuccess: (user) => queryClient.setQueryData(currentUserKey, user),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.setQueryData(currentUserKey, null);
      queryClient.removeQueries({ queryKey: queryKeys.screenings.all });
    },
  });
}

export const useRegister = () =>
  useMutation({
    mutationFn: ({
      fullName,
      email,
      password,
    }: {
      fullName: string;
      email: string;
      password: string;
    }) => registerAccount(fullName, email, password),
  });
export const useVerifyEmail = () => useMutation({ mutationFn: completeEmailVerification });
export const useRequestPasswordReset = () => useMutation({ mutationFn: requestPasswordReset });
export const useResetPassword = () =>
  useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      completePasswordReset(token, password),
  });

export { ApiError };
