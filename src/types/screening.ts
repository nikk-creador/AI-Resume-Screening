export interface ResumeRow {
  key: string;
  id: string | null;
  name: string;
  size: number;
  createdAt: string;
  file: File | null;
  stored: boolean;
  languageCode: string | null;
  evaluation: ResumeEvaluation | null;
}

export interface EvaluationCriterion {
  id: string;
  name: string;
  required: boolean;
  weight: number;
}

export interface CriterionAssessment {
  criterion_id: string;
  name: string;
  required: boolean;
  score: number;
  evidence: string[];
  requirement_type?: 'skill' | 'experience' | 'education' | 'responsibility' | 'certification' | 'other';
  priority?: number;
  exact_match?: boolean;
  semantic_score?: number | null;
  reranker_score?: number | null;
  experience_match?: boolean | null;
  evidence_strength?: number;
  status?: 'matched' | 'partially_matched' | 'missing' | 'insufficient_evidence';
}

export interface JobRequirement {
  id: string;
  text: string;
  normalized_concept: string;
  requirement_type: 'skill' | 'experience' | 'education' | 'responsibility' | 'certification' | 'other';
  requirement_class: 'must_have' | 'nice_to_have';
  priority: number;
  evidence_needed: string;
  minimum_years: number | null;
}

export interface ResumeEvaluation {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'stopped';
  score: number | null;
  model_score?: number | null;
  reviewer_override_score?: number | null;
  reviewer_override_note?: string | null;
  reviewer_id?: string | null;
  reviewer_updated_at?: string | null;
  job_match_score: number | null;
  preferred_score: number | null;
  bonus_points: number | null;
  required_checks_passed: boolean | null;
  required_checks: RequiredJobCheck[] | null;
  job_evidence: string[] | null;
  explanation: string | null;
  assessments: CriterionAssessment[] | null;
  error_message: string | null;
  attempts: number;
  updated_at: string;
  matching_details: {
    matching_method: string;
    weights: Record<string, number>;
    must_have_score: number | null;
    nice_to_have_score: number | null;
  } | null;
}

export interface RequiredJobCheck {
  name: string;
  met: boolean;
  evidence: string[];
}

export interface StoredJobFile {
  name: string;
  stored: true;
}

export type JobDescriptionFile = File | StoredJobFile;

export interface ResumeApiRecord {
  id: string;
  filename: string;
  size_bytes: number;
  content_type: string | null;
  created_at: string;
  language_code: string | null;
  evaluation: ResumeEvaluation | null;
}

export interface ScreeningApiRecord {
  id: string;
  name: string;
  created_at: string;
  job_description_text: string;
  job_description_filename: string | null;
  criteria: EvaluationCriterion[];
  job_requirements: JobRequirement[] | null;
  scoring_config: Record<string, number> | null;
  resumes: ResumeApiRecord[];
}

export interface ScreeningListItem {
  id: string;
  name: string;
  created_at: string;
  resume_count: number;
  completed_count: number;
  active_count: number;
  failed_count: number;
  stopped_count: number;
  average_score: number | null;
}

export interface ScreeningListResponse {
  total: number;
  skip: number;
  limit: number;
  screenings: ScreeningListItem[];
}

export type RetryMode = 'all' | 'failed';

export interface ScreeningCreateInput {
  name: string;
  jobFile: JobDescriptionFile | null;
  jobText: string;
  criteria: EvaluationCriterion[];
  jobRequirements: JobRequirement[];
}

export interface ScreeningState {
  id: string;
  name: string;
  resumes: ResumeRow[];
  jobFile: JobDescriptionFile | null;
  jobText: string;
  criteria: EvaluationCriterion[];
  jobRequirements: JobRequirement[];
}

export interface CandidateRow extends ResumeRow {
  candidate: string;
  rank: number | null;
}
