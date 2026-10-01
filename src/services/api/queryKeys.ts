export const queryKeys = {
  screenings: {
    all: ['screenings'] as const,
    lists: () => [...queryKeys.screenings.all, 'list'] as const,
    list: (skip: number, limit: number, search: string) =>
      [...queryKeys.screenings.lists(), { skip, limit, search }] as const,
    details: () => [...queryKeys.screenings.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.screenings.details(), id] as const,
  },
  aiService: ['ai-service'] as const,
};
