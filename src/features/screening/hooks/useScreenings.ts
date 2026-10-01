import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import {
  createScreening,
  deleteResumes,
  deleteScreening,
  listScreenings,
  loadScreening,
  retryScreening,
  reviewResumeScore,
  stopScreening,
  suggestScreeningCriteria,
  updateScreening,
  updateScreeningRequirements,
  uploadResumeBatch,
} from '../../../services/screeningApi';
import type {
  EvaluationCriterion,
  JobRequirement,
  RetryMode,
  ScreeningCreateInput,
} from '../../../types/screening';

export function useScreenings(skip: number, limit: number, search: string) {
  return useQuery({
    queryKey: queryKeys.screenings.list(skip, limit, search),
    queryFn: () => listScreenings(skip, limit, search),
  });
}

export function useAllScreenings() {
  return useQuery({
    queryKey: [...queryKeys.screenings.all, 'all'] as const,
    queryFn: async () => {
      const screenings = [];
      let skip = 0;
      let total = Number.POSITIVE_INFINITY;

      while (skip < total) {
        const { screenings: pageScreenings, total: pageTotal } = await listScreenings(
          skip,
          100,
          '',
        );
        screenings.push(...pageScreenings);
        total = pageTotal;
        skip += pageScreenings.length;
        if (!pageScreenings.length) break;
      }

      return screenings;
    },
  });
}

export function useScreeningDetail(
  screeningId: string | null,
  options: { pollWhileEvaluating?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.screenings.detail(screeningId ?? ''),
    queryFn: () => loadScreening(screeningId!),
    enabled: Boolean(screeningId),
    refetchInterval: (query) => {
      if (!options.pollWhileEvaluating) return false;
      const hasActiveEvaluations = query.state.data?.resumes.some(
        (resume) =>
          resume.evaluation?.status === 'queued' || resume.evaluation?.status === 'processing',
      );
      return hasActiveEvaluations ? 2500 : false;
    },
  });
}

export function useScreeningMutations() {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (input: {
      screeningId: string;
      changes: { name: string; job_description_text: string; criteria: EvaluationCriterion[] };
    }) => updateScreening(input.screeningId, input.changes),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.screenings.detail(input.screeningId),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteScreening,
    onSuccess: (_result, screeningId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
      void queryClient.removeQueries({ queryKey: queryKeys.screenings.detail(screeningId) });
    },
  });

  return { updateMutation, deleteMutation };
}

export function useScreeningActions() {
  const queryClient = useQueryClient();
  const invalidateScreening = (screeningId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.detail(screeningId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
  };

  const createMutation = useMutation({
    mutationFn: (input: ScreeningCreateInput) => createScreening(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
    },
  });
  const uploadMutation = useMutation({
    mutationFn: ({ screeningId, files }: { screeningId: string; files: File[] }) =>
      uploadResumeBatch(screeningId, files),
    onSuccess: (_result, input) => invalidateScreening(input.screeningId),
  });
  const deleteResumesMutation = useMutation({
    mutationFn: deleteResumes,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
    },
  });
  const deleteScreeningMutation = useMutation({
    mutationFn: deleteScreening,
    onSuccess: (_result, screeningId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
      void queryClient.removeQueries({ queryKey: queryKeys.screenings.detail(screeningId) });
    },
  });
  const retryMutation = useMutation({
    mutationFn: ({ screeningId, mode }: { screeningId: string; mode: RetryMode }) =>
      retryScreening(screeningId, mode),
    onSuccess: (_result, input) => invalidateScreening(input.screeningId),
  });
  const stopMutation = useMutation({
    mutationFn: stopScreening,
    onSuccess: (_result, screeningId) => invalidateScreening(screeningId),
  });
  const reviewMutation = useMutation({
    mutationFn: ({ resumeId, score, note }: { resumeId: string; score: number; note: string }) =>
      reviewResumeScore(resumeId, score, note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
    },
  });
  const requirementsMutation = useMutation({
    mutationFn: ({
      screeningId,
      requirements,
    }: {
      screeningId: string;
      requirements: JobRequirement[];
    }) => updateScreeningRequirements(screeningId, requirements),
    onSuccess: (_result, input) => invalidateScreening(input.screeningId),
  });
  const suggestCriteriaMutation = useMutation({
    mutationFn: ({ jobText, jobFile }: { jobText: string; jobFile: File | null }) =>
      suggestScreeningCriteria(jobText, jobFile),
  });

  return {
    create: createMutation.mutateAsync,
    upload: uploadMutation.mutateAsync,
    deleteResumes: deleteResumesMutation.mutateAsync,
    deleteScreening: deleteScreeningMutation.mutateAsync,
    retry: retryMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    review: reviewMutation.mutateAsync,
    updateRequirements: requirementsMutation.mutateAsync,
    suggestCriteria: suggestCriteriaMutation.mutateAsync,
  };
}
