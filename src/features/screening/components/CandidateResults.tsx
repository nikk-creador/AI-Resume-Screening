import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { DownloadOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';

import TeamReviewPanel from './TeamReviewPanel';
import { downloadApiFile } from '../../../services/api/client';
import type {
  CandidatePipelineStage,
  CandidateRow,
  ResumeRow,
  RetryMode,
} from '../../../types/screening';
import { getErrorMessage } from '../../../utils/errors';
import {
  displayName,
  formatFileSize,
  formatLocalDateTime,
} from '../../../utils/screeningValidation';

const { Text, Title } = Typography;
const pipelineStageOptions: { value: CandidatePipelineStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'in_review', label: 'In Review' },
  { value: 'interview', label: 'Interview' },
  { value: 'decision', label: 'Decision' },
];

function getKeyedEvidence(criterionId: string, evidence: string[]) {
  const occurrences = new Map<string, number>();
  return evidence.map((quote) => {
    const occurrence = occurrences.get(quote) ?? 0;
    occurrences.set(quote, occurrence + 1);
    return { key: JSON.stringify([criterionId, quote, occurrence]), quote };
  });
}

interface CandidateResultsProps {
  resumes: ResumeRow[];
  screeningId: string | null;
  screeningName: string;
  companyId: string;
  currentUserId: string;
  canEdit: boolean;
  canDownload: boolean;
  query: string;
  page: number;
  pageSize: number;
  selectedKeys: string[];
  onQueryChange: (value: string) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onSelectionChange: (keys: string[]) => void;
  onDeleteSelected: () => void;
  onDeleteOne: (key: string) => void;
  deleting: boolean;
  onSave: () => void;
  canSave: boolean;
  isSaving: boolean;
  isSaved: boolean;
  retryingMode: RetryMode | null;
  stopping: boolean;
  onRetry: (mode: RetryMode) => void;
  onRetryOne: (resumeId: string) => Promise<void>;
  onStop: () => void;
  onReview: (resumeId: string, score: number, note: string) => Promise<void>;
  onPipelineStageChange: (resumeId: string, stage: CandidatePipelineStage) => Promise<void>;
}

export default function CandidateResults({
  resumes,
  screeningId,
  screeningName,
  companyId,
  currentUserId,
  canEdit,
  canDownload,
  query,
  page,
  pageSize,
  selectedKeys,
  onQueryChange,
  onPageChange,
  onSelectionChange,
  onDeleteSelected,
  onDeleteOne,
  deleting,
  onSave,
  canSave,
  isSaving,
  isSaved,
  retryingMode,
  stopping,
  onRetry,
  onRetryOne,
  onStop,
  onReview,
  onPipelineStageChange,
}: CandidateResultsProps) {
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [teamReviewOpen, setTeamReviewOpen] = useState(false);
  const [comparisonKeys, setComparisonKeys] = useState<string[]>([]);
  const [reviewTarget, setReviewTarget] = useState<ResumeRow | null>(null);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [retryingResumeId, setRetryingResumeId] = useState<string | null>(null);
  const [updatingPipelineStageId, setUpdatingPipelineStageId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const filteredResumes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resumes.filter(
      (resume) => !normalizedQuery || resume.name.toLowerCase().includes(normalizedQuery),
    );
  }, [query, resumes]);
  const { ranks, completedCount, activeCount, failedCount, stoppedCount } = useMemo(() => {
    const rankedResumes = resumes
      .filter((resume) => resume.evaluation?.status === 'completed')
      .sort((first, second) => (second.evaluation?.score ?? -1) - (first.evaluation?.score ?? -1));
    const ranks = new Map<string, number>();
    let previousScore: number | null = null;
    let currentRank = 0;
    rankedResumes.forEach((resume, index) => {
      const score = resume.evaluation?.score ?? -1;
      if (score !== previousScore) currentRank = index + 1;
      ranks.set(resume.key, currentRank);
      previousScore = score;
    });

    return {
      ranks,
      completedCount: resumes.filter((resume) => resume.evaluation?.status === 'completed').length,
      activeCount: resumes.filter(
        (resume) =>
          resume.evaluation?.status === 'queued' || resume.evaluation?.status === 'processing',
      ).length,
      failedCount: resumes.filter((resume) => resume.evaluation?.status === 'failed').length,
      stoppedCount: resumes.filter((resume) => resume.evaluation?.status === 'stopped').length,
    };
  }, [resumes]);
  const rows = useMemo(
    () =>
      filteredResumes
        .map((resume) => ({
          ...resume,
          candidate: displayName(resume.name),
          rank: ranks.get(resume.key) ?? null,
        }))
        .sort((first, second) => {
          if (first.rank !== null && second.rank !== null) return first.rank - second.rank;
          if (first.rank !== null) return -1;
          if (second.rank !== null) return 1;
          return first.candidate.localeCompare(second.candidate);
        }),
    [filteredResumes, ranks],
  );
  const retryableCount = failedCount + stoppedCount;
  const comparableResumes = useMemo(
    () => resumes.filter((resume) => resume.id && resume.evaluation?.status === 'completed'),
    [resumes],
  );
  const comparisonResumes = comparisonKeys
    .map((key) => comparableResumes.find((resume) => resume.key === key))
    .filter((resume): resume is ResumeRow => Boolean(resume));
  const comparisonCriteria = Array.from(
    new Map(
      comparisonResumes.flatMap((resume) =>
        (resume.evaluation?.assessments ?? []).map((assessment) => [
          assessment.criterion_id,
          assessment,
        ]),
      ),
    ).values(),
  ).sort((first, second) => {
    if (first.required !== second.required) return first.required ? -1 : 1;
    return first.name.localeCompare(second.name);
  });
  const downloadResume = async (resumeId: string, filename: string) => {
    try {
      await downloadApiFile(`/api/resumes/${encodeURIComponent(resumeId)}/download`, filename);
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Could not download this resume.'));
    }
  };
  const updatePipelineStage = async (resumeId: string, stage: CandidatePipelineStage) => {
    setUpdatingPipelineStageId(resumeId);
    try {
      await onPipelineStageChange(resumeId, stage);
      messageApi.success('Candidate stage updated.');
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Could not update the candidate stage.'));
    } finally {
      setUpdatingPipelineStageId(null);
    }
  };
  const retryOne = async (resumeId: string) => {
    setRetryingResumeId(resumeId);
    try {
      await onRetryOne(resumeId);
      messageApi.success('Candidate queued for parsing and evaluation.');
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Could not retry this candidate.'));
    } finally {
      setRetryingResumeId(null);
    }
  };
  const exportScorecard = () => {
    const headers = [
      'Screening',
      'Rank',
      'Candidate',
      'Resume file',
      'Uploaded at',
      'Evaluation status',
      'Final score',
      'Model score',
      'Job match score',
      'Preferred score',
      'Preferred bonus points',
      'Required checks passed',
      'Required checks and evidence',
      'Criterion assessments and evidence',
      'Evaluation explanation',
      'Reviewer override score',
      'Reviewer note',
      'Review updated at',
    ];
    const records = [...resumes]
      .sort((first, second) => {
        const firstRank = ranks.get(first.key) ?? null;
        const secondRank = ranks.get(second.key) ?? null;
        if (firstRank !== null && secondRank !== null) return firstRank - secondRank;
        if (firstRank !== null) return -1;
        if (secondRank !== null) return 1;
        return displayName(first.name).localeCompare(displayName(second.name));
      })
      .map((resume) => {
        const evaluation = resume.evaluation;
        const requiredChecks = (evaluation?.required_checks ?? [])
          .map(
            (check) =>
              `${check.met ? 'Passed' : 'Not verified'}: ${check.name}${check.evidence.length ? ` — evidence: ${check.evidence.map((quote) => `“${quote}”`).join('; ')}` : ''}`,
          )
          .join('\n');
        const assessments = (evaluation?.assessments ?? [])
          .map((assessment) => {
            const category = assessment.required ? 'Must-have' : 'Nice-to-have';
            const evidence = assessment.evidence.map((quote) => `“${quote}”`).join('; ');
            return `${assessment.name} (${category}) — ${assessment.score}/100, ${assessment.status || 'scored'}${evidence ? `; evidence: ${evidence}` : '; no evidence recorded'}`;
          })
          .join('\n');
        return [
          screeningName,
          ranks.get(resume.key) ?? '',
          displayName(resume.name),
          resume.name,
          resume.createdAt,
          evaluation?.status ?? (resume.id ? 'stored' : 'ready to upload'),
          evaluation?.score ?? '',
          evaluation?.model_score ?? '',
          evaluation?.job_match_score ?? '',
          evaluation?.preferred_score ?? '',
          evaluation?.bonus_points ?? '',
          evaluation?.required_checks_passed === null ||
          evaluation?.required_checks_passed === undefined
            ? ''
            : evaluation.required_checks_passed
              ? 'Yes'
              : 'No',
          requiredChecks,
          assessments,
          evaluation?.explanation ?? '',
          evaluation?.reviewer_override_score ?? '',
          evaluation?.reviewer_override_note ?? '',
          evaluation?.reviewer_updated_at ?? '',
        ];
      });
    const csv = [headers, ...records]
      .map((record) => record.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = screeningName
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, '-');
    link.href = url;
    link.download = `${safeName || 'screening'}-scorecard-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const columns: ColumnsType<CandidateRow> = [
    {
      title: 'RANK',
      dataIndex: 'rank',
      key: 'rank',
      width: 80,
      render: (rank: number | null, resume: CandidateRow) => {
        if (rank !== null) return <Text strong>#{rank}</Text>;
        if (resume.evaluation?.status === 'failed') return <Text type="danger">Retry</Text>;
        if (resume.evaluation?.status === 'stopped') return <Text type="secondary">Stopped</Text>;
        if (resume.evaluation?.status === 'queued' || resume.evaluation?.status === 'processing') {
          return <Text type="secondary">Pending</Text>;
        }
        return <Text type="secondary">—</Text>;
      },
    },
    {
      title: 'CANDIDATE FILE',
      dataIndex: 'candidate',
      key: 'candidate',
      sorter: (a, b) => a.candidate.localeCompare(b.candidate),
      render: (name: string, resume: CandidateRow) => (
        <div className="candidate-cell">
          <span className="candidate-avatar" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="candidate-details">
            <Text strong>{name}</Text>
            <Text type="secondary" className="candidate-file">
              {resume.name} · {formatFileSize(resume.size)}
              {resume.languageCode && resume.languageCode !== 'und' && (
                <Tag
                  className="language-tag"
                  title={
                    new Intl.DisplayNames(undefined, { type: 'language' }).of(
                      resume.languageCode,
                    ) || resume.languageCode
                  }
                >
                  {resume.languageCode.toUpperCase()}
                </Tag>
              )}
            </Text>
          </span>
        </div>
      ),
    },
    {
      title: 'UPLOADED · LOCAL TIME',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 175,
      render: (_, resume) => {
        const localTime = formatLocalDateTime(resume.createdAt);
        const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
        return <Text title={`${localTime} (${timezone})`}>{localTime}</Text>;
      },
    },
    {
      title: 'MATCH SCORE',
      key: 'score',
      width: 300,
      render: (_, resume) => {
        const { evaluation } = resume;
        if (!evaluation || evaluation.status !== 'completed') {
          return (
            <Text type={evaluation?.status === 'failed' ? 'danger' : 'secondary'}>
              {evaluation?.status === 'failed'
                ? evaluation.error_message || 'Evaluation failed'
                : evaluation?.status === 'processing'
                  ? 'Evaluating…'
                  : evaluation?.status === 'queued'
                    ? 'Queued'
                    : 'Not evaluated'}
            </Text>
          );
        }
        const requiredAssessments = (evaluation.assessments || []).filter(
          (assessment) => assessment.required,
        );
        const matchingDetails = evaluation.matching_details;
        const scoreLabel = (value: number | null | undefined, suffix = '/100') =>
          value === null || value === undefined ? 'Not available' : `${value}${suffix}`;
        return (
          <div className="candidate-score">
            <Text strong>{evaluation.score ?? 0}/100</Text>
            <Popover
              title="Detailed match score"
              trigger="click"
              content={
                <div className="candidate-evidence candidate-score-details">
                  <Text>Final score: {evaluation.score ?? '—'}/100</Text>
                  <Text type="secondary">
                    Model score: {evaluation.model_score ?? evaluation.score ?? '—'}/100
                  </Text>
                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="Job match">
                      {scoreLabel(evaluation.job_match_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Must-have average">
                      {scoreLabel(matchingDetails?.must_have_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Nice-to-have average">
                      {scoreLabel(matchingDetails?.nice_to_have_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Preferred score / bonus">
                      {scoreLabel(evaluation.preferred_score)} · {evaluation.bonus_points ?? 0}{' '}
                      points
                    </Descriptions.Item>
                    <Descriptions.Item label="Keyword match">
                      {scoreLabel(matchingDetails?.keyword_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Semantic match">
                      {scoreLabel(matchingDetails?.semantic_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Mean cosine similarity">
                      {scoreLabel(matchingDetails?.mean_cosine_similarity, '')}
                    </Descriptions.Item>
                    <Descriptions.Item label="Skill score">
                      {scoreLabel(matchingDetails?.skill_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Experience score">
                      {scoreLabel(matchingDetails?.experience_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Qualification score">
                      {scoreLabel(matchingDetails?.qualification_score)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Matching method">
                      {matchingDetails?.matching_method || 'Not available'}
                    </Descriptions.Item>
                  </Descriptions>
                  {evaluation.reviewer_override_score !== null &&
                    evaluation.reviewer_override_score !== undefined && (
                      <Text>Recruiter review score: {evaluation.reviewer_override_score}/100</Text>
                    )}
                  {evaluation.reviewer_override_note && (
                    <Text type="secondary">Review note: {evaluation.reviewer_override_note}</Text>
                  )}
                  <Text type="secondary">{evaluation.explanation}</Text>
                  {(evaluation.required_checks || []).map((check) => (
                    <Text key={check.name}>
                      {check.met ? 'Passed' : 'Not verified'}: {check.name}
                    </Text>
                  ))}
                  {requiredAssessments.map((assessment) => (
                    <Text key={assessment.criterion_id}>
                      Required metric: {assessment.name} · {assessment.status || 'scored'} ·{' '}
                      {assessment.score}/100
                    </Text>
                  ))}
                  <Text strong>All requirement details</Text>
                  {(evaluation.assessments || []).map((assessment) => (
                    <div className="candidate-assessment-detail" key={assessment.criterion_id}>
                      <Text strong>
                        {assessment.name} · {assessment.required ? 'Must-have' : 'Nice-to-have'}
                      </Text>
                      <Text>
                        {assessment.status || 'Scored'} · Requirement score {assessment.score}/100
                      </Text>
                      <Text type="secondary">
                        Exact:{' '}
                        {assessment.exact_match === undefined
                          ? 'Not available'
                          : assessment.exact_match
                            ? 'Yes'
                            : 'No'}
                        {' · '}Keyword: {scoreLabel(assessment.keyword_score)}
                        {' · '}Semantic: {scoreLabel(assessment.semantic_score)}
                      </Text>
                      <Text type="secondary">
                        Cosine: {scoreLabel(assessment.cosine_similarity, '')}
                        {' · '}Reranker: {scoreLabel(assessment.reranker_score)}
                        {' · '}Experience:{' '}
                        {assessment.experience_match === null ||
                        assessment.experience_match === undefined
                          ? 'Not available'
                          : assessment.experience_match
                            ? 'Met'
                            : 'Not met'}
                        {assessment.experience_score !== null &&
                        assessment.experience_score !== undefined
                          ? ` (${assessment.experience_score}/100)`
                          : ''}
                      </Text>
                      <Text type="secondary">
                        Qualification: {scoreLabel(assessment.qualification_score)}
                        {' · '}Evidence strength: {assessment.evidence_strength ?? 'Not available'}
                      </Text>
                      {getKeyedEvidence(assessment.criterion_id, assessment.evidence || []).map(
                        ({ key, quote }) => (
                          <Text key={key}>Evidence: “{quote}”</Text>
                        ),
                      )}
                    </div>
                  ))}
                </div>
              }
            >
              <Button type="link" size="small">
                Details
              </Button>
            </Popover>
          </div>
        );
      },
    },
    {
      title: 'PIPELINE STAGE',
      dataIndex: 'pipelineStage',
      key: 'pipelineStage',
      width: 145,
      render: (stage: CandidatePipelineStage, resume: CandidateRow) =>
        canEdit && resume.id ? (
          <Select
            size="small"
            value={stage}
            loading={updatingPipelineStageId === resume.id}
            disabled={updatingPipelineStageId !== null}
            options={pipelineStageOptions}
            aria-label={`Pipeline stage for ${resume.candidate}`}
            onChange={(value: CandidatePipelineStage) =>
              void updatePipelineStage(resume.id!, value)
            }
            style={{ minWidth: 120 }}
          />
        ) : (
          <Tag>{pipelineStageOptions.find((option) => option.value === stage)?.label ?? 'New'}</Tag>
        ),
    },
    {
      title: 'STATUS',
      key: 'status',
      width: 175,
      render: (_, resume) => (
        <Tag className="status-tag">
          {resume.evaluation?.status === 'completed'
            ? 'Evaluated'
            : resume.evaluation?.status === 'failed'
              ? 'Parsing/evaluation failed'
              : resume.evaluation?.status === 'stopped'
                ? 'Stopped'
                : resume.evaluation?.status === 'processing'
                  ? 'Parsing and evaluating'
                  : resume.evaluation?.status === 'queued'
                    ? 'Queued for parsing'
                    : resume.id
                      ? 'Stored'
                      : 'Ready to upload'}
        </Tag>
      ),
    },
    {
      title: 'ACTIONS',
      key: 'action',
      width: 175,
      align: 'right',
      render: (_, resume) => (
        <div className="row-actions">
          {canEdit &&
            resume.id &&
            (resume.evaluation?.status === 'failed' || resume.evaluation?.status === 'stopped') && (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={retryingResumeId === resume.id}
                disabled={retryingResumeId !== null || retryingMode !== null}
                onClick={() => void retryOne(resume.id!)}
              >
                Retry file
              </Button>
            )}
          {resume.id && canDownload && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                if (resume.id) void downloadResume(resume.id, resume.name);
              }}
            >
              Download
            </Button>
          )}
          {canEdit && resume.id && resume.evaluation?.status === 'completed' && (
            <Button
              size="small"
              onClick={() => {
                setReviewTarget(resume);
                setReviewScore(resume.evaluation?.score ?? null);
                setReviewNote(resume.evaluation?.reviewer_override_note ?? '');
              }}
            >
              Review score
            </Button>
          )}
          {canEdit && (
            <Button
              type="text"
              danger
              disabled={deleting}
              onClick={() => {
                onDeleteOne(resume.key);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className="section-card results-card">
      {contextHolder}
      <div className="results-header">
        <div>
          <Text className="eyebrow">SCREENING WORKSPACE</Text>
          <Title level={3}>{isSaved ? 'Candidate rankings' : 'Resume files'}</Title>
          <Text type="secondary">
            {isSaved
              ? 'Completed candidates are ordered by final score. Candidates with the same score share a rank; pending candidates are not ranked.'
              : 'Candidates will be ranked against the job description. Optional preferred criteria add a smaller secondary score.'}
          </Text>
        </div>
        <div className="results-actions">
          {isSaved && comparableResumes.length > 1 && (
            <Button onClick={() => setComparisonOpen(true)}>Compare candidates</Button>
          )}
          {isSaved && resumes.length > 0 && (
            <Button icon={<DownloadOutlined />} onClick={exportScorecard}>
              Export scorecard
            </Button>
          )}
          {isSaved && resumes.some((resume) => resume.id) && (
            <Button onClick={() => setTeamReviewOpen(true)}>Team reviews</Button>
          )}
          {canEdit && isSaved && resumes.length > 0 && (
            <Button
              icon={<ReloadOutlined />}
              loading={retryingMode !== null}
              disabled={retryingMode !== null}
              onClick={() => setRetryDialogOpen(true)}
            >
              Retry screening
            </Button>
          )}
          {canEdit && isSaved && activeCount > 0 && (
            <Popconfirm
              title="Stop this screening?"
              description="Queued candidates will stop. A model request already in progress may finish, but its result will be discarded."
              okText="Stop screening"
              cancelText="Keep running"
              okButtonProps={{ danger: true, loading: stopping }}
              onConfirm={onStop}
            >
              <Button
                danger
                icon={<StopOutlined />}
                loading={stopping}
                disabled={stopping || retryingMode !== null}
              >
                Stop screening
              </Button>
            </Popconfirm>
          )}
          {canEdit && (
            <Button
              type="primary"
              className="screen-button"
              loading={isSaving}
              disabled={!canSave || isSaving || isSaved}
              onClick={onSave}
            >
              {isSaving
                ? 'Uploading resumes…'
                : isSaved
                  ? resumes.some((resume) => resume.id === null && resume.file)
                    ? 'Upload remaining resumes'
                    : 'Screening saved'
                  : 'Start screening'}
            </Button>
          )}
        </div>
      </div>

      {isSaved && (
        <div className="ranking-progress" aria-live="polite">
          <Text strong>
            {completedCount} of {resumes.length} ranked
          </Text>
          <Text type="secondary">
            {activeCount} queued or processing · {failedCount} failed
          </Text>
        </div>
      )}

      <Modal
        title="Compare shortlisted candidates"
        open={comparisonOpen}
        onCancel={() => setComparisonOpen(false)}
        footer={null}
        width={1200}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text type="secondary">
            Compare completed evaluations from this screening against the same job criteria. Scores
            and evidence are shown for each requirement.
          </Text>
          <Select
            mode="multiple"
            value={comparisonKeys}
            onChange={(keys: string[]) => {
              if (keys.length > 4) {
                messageApi.info('Compare up to four candidates at a time.');
                setComparisonKeys(keys.slice(0, 4));
                return;
              }
              setComparisonKeys(keys);
            }}
            options={comparableResumes.map((resume) => ({
              value: resume.key,
              label: `${displayName(resume.name)} · ${resume.evaluation?.score ?? '—'}/100`,
            }))}
            placeholder="Choose up to four candidates"
            style={{ width: '100%' }}
          />
          {comparisonResumes.length > 0 ? (
            <Table
              className="candidate-comparison-table"
              rowKey="criterion_id"
              dataSource={comparisonCriteria}
              pagination={false}
              scroll={{ x: 560 + comparisonResumes.length * 260 }}
              columns={[
                {
                  title: 'JOB CRITERION',
                  dataIndex: 'name',
                  key: 'criterion',
                  fixed: 'left',
                  width: 240,
                  render: (name: string, assessment) => (
                    <Space direction="vertical" size={4}>
                      <Text strong>{name}</Text>
                      <Tag>{assessment.required ? 'Must-have' : 'Nice-to-have'}</Tag>
                    </Space>
                  ),
                },
                ...comparisonResumes.map((resume) => ({
                  title: (
                    <Space direction="vertical" size={0}>
                      <Text strong>{displayName(resume.name)}</Text>
                      <Text type="secondary">
                        Final score: {resume.evaluation?.score ?? '—'}/100
                      </Text>
                    </Space>
                  ),
                  key: resume.key,
                  width: 260,
                  render: (_: unknown, criterion: (typeof comparisonCriteria)[number]) => {
                    const assessment = resume.evaluation?.assessments?.find(
                      (item) => item.criterion_id === criterion.criterion_id,
                    );
                    if (!assessment) return <Text type="secondary">No assessment</Text>;
                    return (
                      <div className="candidate-comparison-cell">
                        <Text strong>
                          {assessment.score}/100 · {assessment.status || 'Scored'}
                        </Text>
                        {assessment.evidence.length ? (
                          assessment.evidence.map((quote, index) => (
                            <Text type="secondary" key={`${assessment.criterion_id}-${index}`}>
                              “{quote}”
                            </Text>
                          ))
                        ) : (
                          <Text type="secondary">No resume evidence recorded.</Text>
                        )}
                      </div>
                    );
                  },
                })),
              ]}
              locale={{
                emptyText: 'Selected candidates have no criterion assessments to compare.',
              }}
            />
          ) : (
            <Empty description="Select at least one candidate to view scores and evidence." />
          )}
        </Space>
      </Modal>

      <Modal
        title={
          reviewTarget?.evaluation?.reviewer_override_score === null ||
          reviewTarget?.evaluation?.reviewer_override_score === undefined
            ? 'Record recruiter override'
            : 'Update recruiter override'
        }
        open={Boolean(reviewTarget)}
        confirmLoading={savingReview}
        okText="Save review"
        okButtonProps={{ disabled: reviewScore === null || reviewNote.trim().length < 3 }}
        onCancel={() => setReviewTarget(null)}
        onOk={async () => {
          if (!reviewTarget?.id || reviewScore === null) return;
          setSavingReview(true);
          try {
            await onReview(reviewTarget.id, reviewScore, reviewNote);
            setReviewTarget(null);
          } finally {
            setSavingReview(false);
          }
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>
            Model score:{' '}
            {reviewTarget?.evaluation?.model_score ?? reviewTarget?.evaluation?.score ?? '—'}
          </Text>
          <InputNumber
            min={0}
            max={100}
            value={reviewScore}
            onChange={(value) => setReviewScore(value)}
            addonAfter="/ 100"
            style={{ width: 160 }}
          />
          <Input.TextArea
            rows={3}
            maxLength={2000}
            placeholder="Reason for changing the score"
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
          />
        </Space>
      </Modal>

      <Modal
        title="Retry screening"
        open={retryDialogOpen}
        centered
        onCancel={() => setRetryDialogOpen(false)}
        footer={
          <Space wrap>
            <Button disabled={retryingMode !== null} onClick={() => setRetryDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={retryingMode !== null || retryableCount === 0}
              onClick={() => {
                setRetryDialogOpen(false);
                onRetry('failed');
              }}
            >
              Failed or stopped ({retryableCount})
            </Button>
            <Button
              type="primary"
              loading={retryingMode === 'all'}
              disabled={retryingMode !== null}
              onClick={() => {
                setRetryDialogOpen(false);
                onRetry('all');
              }}
            >
              Run all ({resumes.length})
            </Button>
          </Space>
        }
      >
        <Text>
          Failed or stopped only leaves completed rankings intact. Run all clears current results
          and evaluates every resume again.
        </Text>
      </Modal>

      {isSaved && (
        <Alert
          className="service-notice"
          type={failedCount || stoppedCount ? 'warning' : activeCount ? 'info' : 'success'}
          showIcon
          title={
            activeCount
              ? `Evaluating ${completedCount} of ${resumes.length} resumes`
              : 'Screening results'
          }
          description={
            activeCount
              ? `${activeCount} queued or processing. ${failedCount} failed. ${stoppedCount} stopped. Results refresh automatically while this screen is open.`
              : `${completedCount} evaluated. ${failedCount} failed. ${stoppedCount} stopped. Review the evidence before making any hiring decision.`
          }
        />
      )}

      <div className="table-toolbar">
        <div className="table-selection-summary">
          <Text strong>
            {resumes.length} {resumes.length === 1 ? 'resume' : 'resumes'}
          </Text>
          {selectedKeys.length > 0 && <Text type="secondary">{selectedKeys.length} selected</Text>}
        </div>
        <div className="table-tools">
          <Input.Search
            className="candidate-search"
            placeholder="Search resume files"
            allowClear
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            aria-label="Search resumes"
          />
          {canEdit && (
            <Button
              danger
              disabled={!selectedKeys.length || deleting}
              loading={deleting}
              onClick={onDeleteSelected}
            >
              Delete selected
            </Button>
          )}
        </div>
      </div>

      <Table
        className="candidate-table"
        rowKey="key"
        columns={columns}
        dataSource={rows}
        rowSelection={
          canEdit
            ? {
                selectedRowKeys: selectedKeys,
                preserveSelectedRowKeys: true,
                onChange: (keys) => {
                  onSelectionChange(keys.map(String));
                },
              }
            : undefined
        }
        pagination={{
          current: page,
          pageSize,
          total: rows.length,
          showSizeChanger: true,
          pageSizeOptions: [5, 10, 20, 50],
          showTotal: (total, range) =>
            total ? `${range[0]}–${range[1]} of ${total}` : '0 resumes',
          onChange: onPageChange,
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={query ? 'No files match this search.' : 'No resumes added yet'}
            >
              {!query && <Text type="secondary">Add resume files above to get started.</Text>}
            </Empty>
          ),
        }}
        scroll={{ x: 1000 }}
      />
      {screeningId && (
        <Text className="record-hint" type="secondary">
          Screening reference: {screeningId.slice(0, 8)}
        </Text>
      )}
      <TeamReviewPanel
        open={teamReviewOpen}
        onClose={() => setTeamReviewOpen(false)}
        screeningId={screeningId}
        companyId={companyId}
        currentUserId={currentUserId}
        canAssign={canEdit}
        resumes={resumes}
      />
    </section>
  );
}
