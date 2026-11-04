import type {
  EvaluationCriterion,
  JobDescriptionFile,
  JobRequirement,
  ResumeRow,
  ScreeningState,
} from '../../../types/screening';

interface ScreeningDraftState {
  initialized: boolean;
  screeningId: string | null;
  resumes: ResumeRow[];
  jobFile: JobDescriptionFile | null;
  jobText: string;
  screeningName: string;
  criteria: EvaluationCriterion[];
  jobRequirements: JobRequirement[];
  scoringConfig: ScreeningState['scoringConfig'];
  archivedAt: ScreeningState['archivedAt'];
}

type ScreeningDraftAction =
  | { type: 'hydrate'; screening: ScreeningState; pendingResumes: ResumeRow[] }
  | { type: 'initialize'; value: string | null }
  | { type: 'reset' }
  | { type: 'screening-id'; value: string | null }
  | { type: 'resumes'; value: ResumeRow[] }
  | { type: 'job-file'; value: JobDescriptionFile | null }
  | { type: 'job-text'; value: string }
  | { type: 'screening-name'; value: string }
  | { type: 'criteria'; value: EvaluationCriterion[] }
  | { type: 'job-requirements'; value: JobRequirement[] }
  | { type: 'scoring-config'; value: ScreeningState['scoringConfig'] };

export function createScreeningDraft(screeningId: string | null): ScreeningDraftState {
  return {
    initialized: false,
    screeningId,
    resumes: [],
    jobFile: null,
    jobText: '',
    screeningName: '',
    criteria: [],
    jobRequirements: [],
    scoringConfig: null,
    archivedAt: null,
  };
}

export function screeningDraftReducer(
  state: ScreeningDraftState,
  action: ScreeningDraftAction,
): ScreeningDraftState {
  switch (action.type) {
    case 'hydrate':
      return {
        initialized: true,
        screeningId: action.screening.id,
        resumes: [...action.screening.resumes, ...action.pendingResumes],
        jobFile: action.screening.jobFile,
        jobText: action.screening.jobText,
        screeningName: action.screening.name,
        criteria: action.screening.criteria,
        jobRequirements: action.screening.jobRequirements,
        scoringConfig: action.screening.scoringConfig,
        archivedAt: action.screening.archivedAt,
      };
    case 'initialize':
      return action.value === state.screeningId
        ? { ...state, initialized: true }
        : { ...createScreeningDraft(action.value), initialized: true };
    case 'reset':
      return { ...createScreeningDraft(null), initialized: true };
    case 'screening-id':
      return { ...state, screeningId: action.value };
    case 'resumes':
      return { ...state, resumes: action.value };
    case 'job-file':
      return { ...state, jobFile: action.value };
    case 'job-text':
      return { ...state, jobText: action.value };
    case 'screening-name':
      return { ...state, screeningName: action.value };
    case 'criteria':
      return { ...state, criteria: action.value };
    case 'job-requirements':
      return { ...state, jobRequirements: action.value };
    case 'scoring-config':
      return { ...state, scoringConfig: action.value };
  }
}
