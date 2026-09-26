import { useEffect, useRef, useState } from 'react';
import type { Key } from 'react';
import { Alert, Col, message, Row, Typography, Upload } from 'antd';
import AppHeader from './components/layout/AppHeader';
import CandidateResults from './components/screening/CandidateResults';
import JobDescriptionInput from './components/screening/JobDescriptionInput';
import ResumeUploader from './components/screening/ResumeUploader';
import ScreeningSummary from './components/screening/ScreeningSummary';
import {
  SCREENING_STORAGE_KEY,
  MAX_FILE_SIZE_BYTES,
  JOB_DESCRIPTION_EXTENSIONS,
} from './constants/screening';
import {
  createScreening,
  deleteResumes,
  ApiError,
  getErrorMessage,
  loadScreening,
} from './services/screeningApi';
import { getExtension, validateJobDescription, validateResume } from './utils/screeningValidation';
import type {
  JobDescriptionFile,
  ResumeRow,
  ScreeningApiRecord,
  ScreeningState,
} from './types/screening';

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
  };
}

function normalizeScreening(data: ScreeningApiRecord): ScreeningState {
  return {
    id: data.id,
    resumes: data.resumes.map((resume) => ({
      key: resume.id,
      id: resume.id,
      name: resume.filename,
      size: resume.size_bytes,
      createdAt: resume.created_at,
      file: null,
      stored: true,
    })),
    jobFile: data.job_description_filename
      ? { name: data.job_description_filename, stored: true }
      : null,
    jobText: data.job_description_text || '',
  };
}

export default function App() {
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const resumesRef = useRef<ResumeRow[]>(resumes);
  const [jobFile, setJobFile] = useState<JobDescriptionFile | null>(null);
  const [jobText, setJobText] = useState('');
  const [screeningId, setScreeningId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [jobError, setJobError] = useState('');
  const [pageError, setPageError] = useState('');
  const [messageApi, contextHolder] = message.useMessage();

  const updateResumes = (next: ResumeRow[]) => {
    resumesRef.current = next;
    setResumes(next);
  };

  useEffect(() => {
    let mounted = true;
    const loadSavedScreening = async () => {
      const savedId = window.localStorage.getItem(SCREENING_STORAGE_KEY);
      if (!savedId) {
        setLoading(false);
        return;
      }
      try {
        const data = await loadScreening(savedId);
        if (!mounted) return;
        const saved = normalizeScreening(data);
        setScreeningId(saved.id);
        updateResumes(saved.resumes);
        setJobFile(saved.jobFile);
        setJobText(saved.jobText);
      } catch (error: unknown) {
        if (!mounted) return;
        if (error instanceof ApiError && error.status === 404)
          window.localStorage.removeItem(SCREENING_STORAGE_KEY);
        else setPageError(getErrorMessage(error, 'Could not load the saved screening.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadSavedScreening();
    return () => {
      mounted = false;
    };
  }, []);

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
    if (descriptionError) return;

    setSaving(true);
    try {
      const data = await createScreening({ resumes, jobFile, jobText });
      const saved = normalizeScreening(data);
      setScreeningId(saved.id);
      updateResumes(saved.resumes);
      setJobFile(saved.jobFile);
      setJobText(saved.jobText);
      window.localStorage.setItem(SCREENING_STORAGE_KEY, saved.id);
      setSelectedKeys([]);
      messageApi.success('Screening is ready. Your files are available in the workspace.');
    } catch (error: unknown) {
      setPageError(
        getErrorMessage(error, 'Could not save the screening. Check your files and try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const removeResumes = async (keys: string[]): Promise<void> => {
    const targets = resumesRef.current.filter((resume) => keys.includes(resume.key));
    if (!targets.length) return;
    const storedIds = targets.map((resume) => resume.id).filter((id): id is string => id !== null);
    setDeleting(true);
    setPageError('');
    try {
      if (storedIds.length) await deleteResumes(storedIds);
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

  const startNewScreening = () => {
    window.localStorage.removeItem(SCREENING_STORAGE_KEY);
    setScreeningId(null);
    updateResumes([]);
    setJobFile(null);
    setJobText('');
    setQuery('');
    setPage(1);
    setSelectedKeys([]);
    setPageError('');
    setJobError('');
    setUploadError('');
  };

  const saveDisabled = loading || saving || Boolean(screeningId);

  return (
    <div className="app-shell">
      {contextHolder}
      <AppHeader hasSavedScreening={Boolean(screeningId)} onNewScreening={startNewScreening} />
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

        {pageError && (
          <Alert
            className="page-error"
            type="error"
            showIcon
            message={pageError}
            closable
            onClose={() => setPageError('')}
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
          onSelectionChange={(keys: Key[]) => setSelectedKeys(keys.map(String))}
          onDeleteSelected={() => removeResumes(selectedKeys)}
          onDeleteOne={(key) => removeResumes([key])}
          deleting={deleting}
          onSave={saveScreening}
          canSave={!saveDisabled}
          isSaving={saving}
          isSaved={Boolean(screeningId)}
        />
        <footer className="page-footer">
          AI output supports recruiter review. Final hiring decisions remain with people.
        </footer>
      </main>
    </div>
  );
}
