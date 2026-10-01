import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';
import { Alert, Col, Input, message, Row, Typography, Upload } from 'antd';
import type { Key } from 'react';
import { matchPath, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { useQueryClient } from '@tanstack/react-query';

import NotFoundPage from './NotFoundPage';
import { routes, screeningDetailRoute } from './paths';
import {
  JOB_DESCRIPTION_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  RESUME_UPLOAD_BATCH_SIZE,
  SCREENING_STORAGE_KEY,
} from '../constants/screening';
import AIServicePanel from '../features/screening/components/AIServicePanel';
import CandidateResults from '../features/screening/components/CandidateResults';
import JobDescriptionInput from '../features/screening/components/JobDescriptionInput';
import ResumeUploader from '../features/screening/components/ResumeUploader';
import ScreeningCriteriaEditor from '../features/screening/components/ScreeningCriteriaEditor';
import ScreeningsList from '../features/screening/components/ScreeningsList';
import ScreeningSummary from '../features/screening/components/ScreeningSummary';
import { useScreeningActions, useScreeningDetail } from '../features/screening/hooks/useScreenings';
import {
  createScreeningDraft,
  screeningDraftReducer,
} from '../features/screening/state/screeningDraft';
import WorkspaceShell from '../layouts/WorkspaceShell';
import { queryKeys } from '../services/api/queryKeys';
import { ApiError, getErrorMessage, loadScreening } from '../services/screeningApi';
import type { AuthUser } from '../types/auth';
import type { ResumeRow, RetryMode, ScreeningApiRecord, ScreeningState } from '../types/screening';
import { getExtension, validateJobDescription, validateResume } from '../utils/screeningValidation';

const { Paragraph, Text, Title } = Typography;

function localResume(file: File): ResumeRow {
  return {
    key: `local-${crypto.randomUUID()}`,
    id: null,
    name: file.name,
    size: file.size,
    createdAt: new Date().toISOString(),
    file,
    stored: false,
    languageCode: null,
    evaluation: null,
  };
}

function normalizeScreening(data: ScreeningApiRecord): ScreeningState {
  return {
    id: data.id,
    name: data.name,
    resumes: data.resumes.map((resume) => ({
      key: resume.id,
      id: resume.id,
      name: resume.filename,
      size: resume.size_bytes,
      createdAt: resume.created_at,
      file: null,
      stored: true,
      languageCode: resume.language_code,
      evaluation: resume.evaluation,
    })),
    jobFile: data.job_description_filename
      ? { name: data.job_description_filename, stored: true }
      : null,
    jobText: data.job_description_text || '',
    criteria: data.criteria,
    jobRequirements: data.job_requirements || [],
  };
}

interface WorkspaceLayoutProps {
  user: AuthUser;
  onSignOut: () => void;
}

export default function WorkspaceLayout({ user, onSignOut }: WorkspaceLayoutProps) {
  const [draft, dispatchDraft] = useReducer(screeningDraftReducer, null, createScreeningDraft);
  const { screeningId, resumes, jobFile, jobText, screeningName, criteria, jobRequirements } =
    draft;
  const resumesRef = useRef<ResumeRow[]>(resumes);
  const location = useLocation();
  const isNewScreeningRoute = location.pathname === routes.newScreening;
  const routeScreeningId = isNewScreeningRoute
    ? null
    : (matchPath(`${routes.screening}/:id`, location.pathname)?.params.id ?? null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screeningActions = useScreeningActions();
  const [openingScreening, setOpeningScreening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestingCriteria, setSuggestingCriteria] = useState(false);
  const [retryingMode, setRetryingMode] = useState<RetryMode | null>(null);
  const [stopping, setStopping] = useState(false);
  const [deletingScreeningId, setDeletingScreeningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [jobError, setJobError] = useState('');
  const [pageError, setPageError] = useState('');
  const [messageApi, contextHolder] = message.useMessage();
  const screeningQuery = useScreeningDetail(screeningId, { pollWhileEvaluating: true });
  const loading =
    !draft.initialized || openingScreening || Boolean(screeningId && screeningQuery.isPending);
  const fetchScreening = (id: string) =>
    queryClient.fetchQuery({
      queryKey: queryKeys.screenings.detail(id),
      queryFn: () => loadScreening(id),
      staleTime: 0,
    });

  const updateResumes = (next: ResumeRow[]) => {
    resumesRef.current = next;
    dispatchDraft({ type: 'resumes', value: next });
  };
  const setScreeningId = (value: string | null) => dispatchDraft({ type: 'screening-id', value });
  const setJobFile = (value: typeof jobFile) => dispatchDraft({ type: 'job-file', value });
  const setJobText = (value: string) => dispatchDraft({ type: 'job-text', value });
  const setScreeningName = (value: string) => dispatchDraft({ type: 'screening-name', value });
  const setCriteria = (value: typeof criteria) => dispatchDraft({ type: 'criteria', value });
  const setJobRequirements = (value: typeof jobRequirements) =>
    dispatchDraft({ type: 'job-requirements', value });
  const syncSavedScreening = useEffectEvent(
    (data: ScreeningApiRecord | undefined, error: Error | null, isPending: boolean) => {
      if (!screeningId || isPending) return;
      if (error) {
        if (error instanceof ApiError && error.status === 404) {
          window.localStorage.removeItem(SCREENING_STORAGE_KEY);
          dispatchDraft({ type: 'reset' });
        }
        return;
      }
      if (!data) return;

      const pendingResumes = resumesRef.current.filter(
        (resume) => resume.id === null && resume.file,
      );
      resumesRef.current = [...normalizeScreening(data).resumes, ...pendingResumes];
      dispatchDraft({
        type: 'hydrate',
        screening: normalizeScreening(data),
        pendingResumes,
      });
    },
  );
  useEffect(() => {
    dispatchDraft({
      type: 'initialize',
      value: isNewScreeningRoute
        ? null
        : (routeScreeningId ?? window.localStorage.getItem(SCREENING_STORAGE_KEY)),
    });
  }, [isNewScreeningRoute, routeScreeningId]);
  useEffect(() => {
    syncSavedScreening(screeningQuery.data, screeningQuery.error, screeningQuery.isPending);
  }, [screeningId, screeningQuery.data, screeningQuery.error, screeningQuery.isPending]);

  const addResume = (file: File): typeof Upload.LIST_IGNORE => {
    const error = validateResume(file, resumesRef.current);
    if (error) {
      setUploadError(error);
      return Upload.LIST_IGNORE;
    }
    const next = [...resumesRef.current, localResume(file)];
    updateResumes(next);
    setUploadError('');
    setPageError('');
    setSelectedKeys([]);
    return Upload.LIST_IGNORE;
  };

  const addJobFile = async (file: File): Promise<typeof Upload.LIST_IGNORE> => {
    const allowed: readonly string[] = JOB_DESCRIPTION_EXTENSIONS;
    const extension = getExtension(file.name);
    if (!allowed.includes(extension)) {
      setJobError('Choose a PDF, DOCX, or TXT job description.');
      return Upload.LIST_IGNORE;
    }
    if (file.size === 0) {
      setJobError('This job description file is empty.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setJobError('The maximum job description file size is 10 MB.');
      return Upload.LIST_IGNORE;
    }
    setJobFile(file);
    setJobError('');
    setPageError('');
    if (extension === 'txt') {
      try {
        const text = await file.text();
        setJobText(text);
        const validationError = validateJobDescription(text, file);
        setJobError(validationError);
      } catch {
        setJobText('');
        setJobError('Could not read this text file. Try pasting the job description instead.');
      }
    } else {
      setJobText('');
    }
    return Upload.LIST_IGNORE;
  };

  const saveScreening = async () => {
    setPageError('');
    setUploadError('');
    const descriptionError = validateJobDescription(jobText, jobFile);
    setJobError(descriptionError);
    if (resumes.length === 0) {
      setPageError('Add at least one resume before saving this screening.');
      return;
    }
    if (screeningName.trim().length < 2) {
      setPageError('Enter a screening name with at least two characters.');
      return;
    }
    if (criteria.some((criterion) => criterion.name.trim().length < 2)) {
      setPageError('Add a name of at least two characters for each preferred qualification.');
      return;
    }
    if (descriptionError) return;

    setSaving(true);
    try {
      let activeScreeningId = screeningId;
      if (!activeScreeningId) {
        const data = await screeningActions.create({
          name: screeningName.trim(),
          jobFile,
          jobText,
          criteria,
          jobRequirements,
        });
        const saved = normalizeScreening(data);
        activeScreeningId = saved.id;
        setScreeningId(saved.id);
        setScreeningName(saved.name);
        setJobFile(saved.jobFile);
        setJobText(saved.jobText);
        window.localStorage.setItem(SCREENING_STORAGE_KEY, saved.id);
      }

      const pendingResumes = resumesRef.current.filter(
        (resume) => resume.id === null && resume.file,
      );
      for (let offset = 0; offset < pendingResumes.length; offset += RESUME_UPLOAD_BATCH_SIZE) {
        const batch = pendingResumes.slice(offset, offset + RESUME_UPLOAD_BATCH_SIZE);
        const batchFiles = batch
          .map((resume) => resume.file)
          .filter((file): file is File => file !== null);
        const data = await screeningActions.upload({
          screeningId: activeScreeningId,
          files: batchFiles,
        });
        const saved = normalizeScreening(data);
        const batchKeys = new Set(batch.map((resume) => resume.key));
        const remainingLocal = resumesRef.current.filter(
          (resume) => resume.id === null && resume.file && !batchKeys.has(resume.key),
        );
        updateResumes([...saved.resumes, ...remainingLocal]);
        setCriteria(saved.criteria);
        setJobRequirements(saved.jobRequirements);
      }
      setSelectedKeys([]);
      messageApi.success('Resumes queued for local evaluation.');
    } catch (error: unknown) {
      setPageError(
        getErrorMessage(
          error,
          'Could not upload the full batch. Saved resumes are retained; retry to continue.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const suggestCriteria = async () => {
    const descriptionError = validateJobDescription(jobText, jobFile);
    setJobError(descriptionError);
    if (descriptionError) return;
    setPageError('');
    setSuggestingCriteria(true);
    try {
      setCriteria(
        await screeningActions.suggestCriteria({
          jobText,
          jobFile: jobFile instanceof File ? jobFile : null,
        }),
      );
    } catch (error: unknown) {
      setPageError(
        getErrorMessage(error, 'Could not suggest criteria. Add them manually and try again.'),
      );
    } finally {
      setSuggestingCriteria(false);
    }
  };

  const retryScreening = async (mode: RetryMode) => {
    if (!screeningId) return;
    setRetryingMode(mode);
    setPageError('');
    try {
      const result = await screeningActions.retry({ screeningId, mode });
      const saved = normalizeScreening(await fetchScreening(screeningId));
      updateResumes(saved.resumes);
      messageApi.success(
        result.queued_count === 0
          ? 'There are no candidates to retry.'
          : `${result.queued_count} ${result.queued_count === 1 ? 'resume' : 'resumes'} queued for evaluation.`,
      );
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, 'Could not retry this screening.'));
    } finally {
      setRetryingMode(null);
    }
  };

  const stopCurrentScreening = async () => {
    if (!screeningId) return;
    setStopping(true);
    setPageError('');
    try {
      const result = await screeningActions.stop(screeningId);
      const saved = normalizeScreening(await fetchScreening(screeningId));
      updateResumes(saved.resumes);
      messageApi.success(
        result.stopped_count === 0
          ? 'There are no active candidates to stop.'
          : `${result.stopped_count} ${result.stopped_count === 1 ? 'candidate' : 'candidates'} stopped.`,
      );
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Could not stop this screening.'));
    } finally {
      setStopping(false);
    }
  };

  const deleteScreeningFromAI = async (id: string): Promise<boolean> => {
    setDeletingScreeningId(id);
    try {
      await screeningActions.deleteScreening(id);
      if (id === screeningId) {
        startNewScreening();
        navigate(routes.screenings);
      }
      messageApi.success('Screening and its stored files were deleted.');
      return true;
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Could not delete this screening.'));
      return false;
    } finally {
      setDeletingScreeningId(null);
    }
  };

  const removeResumes = async (keys: string[]): Promise<void> => {
    const targets = resumesRef.current.filter((resume) => keys.includes(resume.key));
    if (!targets.length) return;
    const storedIds = targets.map((resume) => resume.id).filter((id): id is string => id !== null);
    setDeleting(true);
    setPageError('');
    try {
      if (storedIds.length) await screeningActions.deleteResumes(storedIds);
      const targetKeys = new Set(targets.map((resume) => resume.key));
      const remaining = resumesRef.current.filter((resume) => !targetKeys.has(resume.key));
      updateResumes(remaining);
      setSelectedKeys((current) => current.filter((key) => !targetKeys.has(key)));
      setPage((current) => Math.min(current, Math.max(1, Math.ceil(remaining.length / pageSize))));
      messageApi.success(
        targets.length === 1 ? 'Resume removed.' : `${targets.length} resumes removed.`,
      );
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, 'Could not remove the selected resumes. Try again.'));
    } finally {
      setDeleting(false);
    }
  };

  function startNewScreening() {
    window.localStorage.removeItem(SCREENING_STORAGE_KEY);
    setScreeningId(null);
    resumesRef.current = [];
    dispatchDraft({ type: 'reset' });
    setQuery('');
    setPage(1);
    setSelectedKeys([]);
    setPageError('');
    setJobError('');
    setUploadError('');
  }

  const handleNewScreening = () => {
    startNewScreening();
    navigate(routes.newScreening);
  };

  const openSavedScreening = async (id: string): Promise<boolean> => {
    if (resumesRef.current.some((resume) => resume.id === null && resume.file)) {
      messageApi.warning('Upload or remove the pending resumes before opening another screening.');
      return false;
    }
    setOpeningScreening(true);
    setPageError('');
    try {
      const saved = normalizeScreening(await fetchScreening(id));
      setScreeningId(saved.id);
      setScreeningName(saved.name);
      updateResumes(saved.resumes);
      setJobFile(saved.jobFile);
      setJobText(saved.jobText);
      setCriteria(saved.criteria);
      setJobRequirements(saved.jobRequirements);
      window.localStorage.setItem(SCREENING_STORAGE_KEY, saved.id);
      setQuery('');
      setPage(1);
      setSelectedKeys([]);
      return true;
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Could not open this screening.'));
      return false;
    } finally {
      setOpeningScreening(false);
    }
  };

  const openScreeningInList = async (id: string) => {
    if (await openSavedScreening(id)) navigate(screeningDetailRoute(id));
  };

  const viewScreeningInAI = async (id: string) => {
    if (await openSavedScreening(id)) navigate(screeningDetailRoute(id));
  };

  const saveDisabled =
    loading ||
    saving ||
    (Boolean(screeningId) && !resumes.some((resume) => resume.id === null && resume.file));
  const screeningLoadError =
    screeningId &&
    screeningQuery.error &&
    !(screeningQuery.error instanceof ApiError && screeningQuery.error.status === 404)
      ? getErrorMessage(screeningQuery.error, 'Could not load or refresh the saved screening.')
      : '';
  return (
    <WorkspaceShell
      user={user}
      notificationHolder={contextHolder}
      onNewScreening={handleNewScreening}
      onShowScreenings={() => navigate(routes.screenings)}
      onShowAI={() => navigate(routes.ai)}
      onSignOut={onSignOut}
    >
      <Routes>
        <Route index element={<Navigate to={routes.screenings} replace />} />
        <Route
          path={`${routes.screening.slice(1)}/:id`}
          element={
            <main id="main" className="main-content">
              <div className="page-heading">
                <div>
                  <Text className="eyebrow">AI-ASSISTED HIRING</Text>
                  <Title level={1}>Resume screening</Title>
                  <Paragraph className="page-description">
                    Prepare applicant files and role requirements in one workspace.
                  </Paragraph>
                </div>
                <div className="step-indicator">
                  <span className="step-dot" />
                  {screeningId ? 'Screening ready' : 'New screening'}
                </div>
              </div>

              {!screeningId && (
                <div className="screening-name-control">
                  <Text strong>
                    Screening name <Text type="danger">*</Text>
                  </Text>
                  <Input
                    aria-label="Screening name"
                    placeholder="e.g. Senior backend engineer · September hiring"
                    maxLength={160}
                    value={screeningName}
                    onChange={(event) => setScreeningName(event.target.value)}
                  />
                </div>
              )}

              {(pageError || screeningLoadError) && (
                <Alert
                  className="page-error"
                  type="error"
                  showIcon
                  title={pageError || screeningLoadError}
                  closable={{
                    onClose: () => {
                      setPageError('');
                    },
                  }}
                />
              )}

              <ScreeningSummary
                resumeCount={resumes.length}
                hasJobDescription={Boolean(jobFile || jobText.trim())}
                isSaved={Boolean(screeningId)}
                isLoading={loading}
              />

              <Row gutter={[16, 16]} className="intake-row">
                <Col xs={24} lg={14}>
                  <ResumeUploader
                    disabled={loading || Boolean(screeningId)}
                    onBeforeUpload={addResume}
                    resumeCount={resumes.length}
                  />
                  {uploadError && (
                    <Text className="validation-error" type="danger">
                      {uploadError}
                    </Text>
                  )}
                </Col>
                <Col xs={24} lg={10}>
                  <JobDescriptionInput
                    disabled={loading || Boolean(screeningId)}
                    jobFile={jobFile}
                    jobText={jobText}
                    error={jobError}
                    onFile={addJobFile}
                    onRemoveFile={() => {
                      setJobFile(null);
                      setJobText('');
                      setJobError('');
                    }}
                    onTextChange={(value) => {
                      setJobText(value);
                      if (value.trim()) setJobFile(null);
                      setJobError('');
                    }}
                    screeningId={screeningId}
                  />
                </Col>
              </Row>

              <ScreeningCriteriaEditor
                criteria={criteria}
                disabled={loading || Boolean(screeningId)}
                canSuggest={Boolean(jobFile || jobText.trim())}
                isSuggesting={suggestingCriteria}
                onChange={setCriteria}
                onSuggest={suggestCriteria}
              />

              <CandidateResults
                resumes={resumes}
                screeningId={screeningId}
                query={query}
                page={page}
                pageSize={pageSize}
                selectedKeys={selectedKeys}
                onQueryChange={(value) => {
                  setQuery(value);
                  setPage(1);
                  setSelectedKeys([]);
                }}
                onPageChange={(nextPage: number, nextPageSize: number) => {
                  setPage(nextPage);
                  setPageSize(nextPageSize);
                }}
                onSelectionChange={(keys: Key[]) => {
                  setSelectedKeys(keys.map(String));
                }}
                onDeleteSelected={() => removeResumes(selectedKeys)}
                onDeleteOne={(key) => removeResumes([key])}
                deleting={deleting}
                onSave={saveScreening}
                canSave={!saveDisabled}
                isSaving={saving}
                isSaved={Boolean(screeningId)}
                retryingMode={retryingMode}
                stopping={stopping}
                onRetry={retryScreening}
                onStop={stopCurrentScreening}
                onReview={async (resumeId, score, note) => {
                  try {
                    await screeningActions.review({ resumeId, score, note });
                    if (screeningId) {
                      const saved = normalizeScreening(await fetchScreening(screeningId));
                      updateResumes(saved.resumes);
                    }
                    messageApi.success('Recruiter score and reason saved.');
                  } catch (error: unknown) {
                    messageApi.error(getErrorMessage(error, 'Could not save the review.'));
                    throw error;
                  }
                }}
              />
              <footer className="page-footer">
                AI output supports recruiter review. Final hiring decisions remain with people.
              </footer>
            </main>
          }
        />

        <Route
          path={routes.screenings.slice(1)}
          element={
            <main id="main" className="main-content">
              <div className="page-heading">
                <div>
                  <Text className="eyebrow">AI-ASSISTED HIRING</Text>
                  <Title level={1}>Screening history</Title>
                  <Paragraph className="page-description">
                    Reopen a screening to review its candidate rankings and evidence.
                  </Paragraph>
                </div>
              </div>
              <ScreeningsList onOpen={openScreeningInList} onNewScreening={handleNewScreening} />
            </main>
          }
        />
        <Route
          path={routes.ai.slice(1)}
          element={
            <AIServicePanel
              key={screeningId ?? 'none'}
              screeningId={screeningId}
              screeningName={screeningName}
              resumes={resumes}
              jobRequirements={jobRequirements}
              stopping={stopping}
              deletingId={deletingScreeningId}
              onStop={stopCurrentScreening}
              onDeleteScreening={deleteScreeningFromAI}
              onViewScreening={viewScreeningInAI}
              onSaveRequirements={async (requirements) => {
                if (!screeningId) return;
                try {
                  const result = await screeningActions.updateRequirements({
                    screeningId,
                    requirements,
                  });
                  setJobRequirements(result.requirements);
                  const saved = normalizeScreening(await fetchScreening(screeningId));
                  updateResumes(saved.resumes);
                  messageApi.success(
                    'Requirements saved; candidate evaluations were queued again.',
                  );
                } catch (error: unknown) {
                  messageApi.error(getErrorMessage(error, 'Could not save job requirements.'));
                }
              }}
            />
          }
        />
        <Route path={routes.notFound} element={<NotFoundPage isAuthenticated />} />
      </Routes>
    </WorkspaceShell>
  );
}
