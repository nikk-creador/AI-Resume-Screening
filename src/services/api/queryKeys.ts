import { getActiveCompanyId } from './client';

export const queryKeys = {
  auth: {
    currentUser: ['auth', 'current-user'] as const,
  },
  screenings: {
    root: ['screenings'] as const,
    all: () => [...queryKeys.screenings.root, getActiveCompanyId() ?? 'unselected'] as const,
    lists: () => [...queryKeys.screenings.all(), 'list'] as const,
    list: (skip: number, limit: number, search: string) =>
      [...queryKeys.screenings.lists(), { skip, limit, search }] as const,
    details: () => [...queryKeys.screenings.all(), 'detail'] as const,
    detail: (id: string) => [...queryKeys.screenings.details(), id] as const,
  },
  screeningTemplates: (companyId: string) => ['screening-templates', companyId] as const,
  teamReviews: (screeningId: string) => ['team-reviews', screeningId] as const,
  companyReviewers: (companyId: string) => ['company-reviewers', companyId] as const,
  interviewQuestions: (resumeId: string) => ['interview-questions', resumeId] as const,
  organization: {
    root: ['organization'] as const,
    members: (companyId: string) => [...queryKeys.organization.root, 'members', companyId] as const,
    invitations: (companyId: string) =>
      [...queryKeys.organization.root, 'invitations', companyId] as const,
    auditLog: (companyId: string) =>
      [...queryKeys.organization.root, 'audit-log', companyId] as const,
    companies: (organizationId: string) =>
      [...queryKeys.organization.root, 'companies', organizationId] as const,
  },
  invitations: {
    root: ['invitation'] as const,
    token: (token: string) => [...queryKeys.invitations.root, token] as const,
  },
  aiService: ['ai-service'] as const,
};
