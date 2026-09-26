export interface ResumeRow {
  key: string;
  id: string | null;
  name: string;
  size: number;
  createdAt: string;
  file: File | null;
  stored: boolean;
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
}

export interface ScreeningApiRecord {
  id: string;
  created_at: string;
  job_description_text: string;
  job_description_filename: string | null;
  resumes: ResumeApiRecord[];
}

export interface ScreeningCreateInput {
  resumes: ResumeRow[];
  jobFile: JobDescriptionFile | null;
  jobText: string;
}

export interface ScreeningState {
  id: string;
  resumes: ResumeRow[];
  jobFile: JobDescriptionFile | null;
  jobText: string;
}

export interface CandidateRow extends ResumeRow {
  candidate: string;
}
