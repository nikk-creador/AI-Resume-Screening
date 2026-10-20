import { apiRequest as request } from './api/client';

export interface CompanyReviewer {
  user_id: string;
  full_name: string;
  email: string;
}

export interface CandidateAssignmentRecord {
  reviewer_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  assigned_at: string;
}

export interface CandidateTeamReviewRecord {
  reviewer_id: string;
  full_name: string;
  score: number;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface CandidateTeamReviewSummary {
  resume_id: string;
  assignments: CandidateAssignmentRecord[];
  reviews: CandidateTeamReviewRecord[];
}

export async function listCompanyReviewers(companyId: string): Promise<CompanyReviewer[]> {
  const result = await request<{ reviewers: CompanyReviewer[] }>(
    `/api/companies/${encodeURIComponent(companyId)}/reviewers`,
  );
  return result.reviewers;
}

export async function listScreeningTeamReviews(
  screeningId: string,
): Promise<CandidateTeamReviewSummary[]> {
  const result = await request<{ candidates: CandidateTeamReviewSummary[] }>(
    `/api/screenings/${encodeURIComponent(screeningId)}/team-reviews`,
  );
  return result.candidates;
}

export function updateCandidateAssignments(
  resumeId: string,
  reviewerIds: string[],
): Promise<{ resume_id: string; reviewer_ids: string[] }> {
  return request(`/api/resumes/${encodeURIComponent(resumeId)}/assignments`, {
    method: 'PUT',
    body: JSON.stringify({ reviewer_ids: reviewerIds }),
  });
}

export function saveCandidateTeamReview(
  resumeId: string,
  score: number,
  note: string,
): Promise<{
  resume_id: string;
  reviewer_id: string;
  score: number;
  note: string;
  updated_at: string;
}> {
  return request(`/api/resumes/${encodeURIComponent(resumeId)}/team-review`, {
    method: 'PUT',
    body: JSON.stringify({ score, note }),
  });
}
