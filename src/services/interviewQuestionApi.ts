import { apiRequest as request } from './api/client';

export interface InterviewQuestion {
  criterion_id: string;
  criterion: string;
  criterion_type: 'Must-have' | 'Nice-to-have';
  score: number | null;
  status: string;
  question: string;
  grounding: string;
  evidence: string[];
}

export async function suggestInterviewQuestions(resumeId: string): Promise<InterviewQuestion[]> {
  const result = await request<{ resume_id: string; questions: InterviewQuestion[] }>(
    `/api/resumes/${encodeURIComponent(resumeId)}/interview-questions`,
  );
  return result.questions;
}
