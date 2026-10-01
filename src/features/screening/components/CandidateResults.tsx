import { useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Popover,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { ReloadOutlined, StopOutlined } from '@ant-design/icons';

import { API_BASE_URL } from '../../../services/api/config';
import type { CandidateRow, ResumeRow, RetryMode } from '../../../types/screening';
import {
  displayName,
  formatFileSize,
  formatLocalDateTime,
} from '../../../utils/screeningValidation';

const { Text, Title } = Typography;

interface CandidateResultsProps {
  resumes: ResumeRow[];
  screeningId: string | null;
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
  onStop: () => void;
  onReview: (resumeId: string, score: number, note: string) => Promise<void>;
}

export default function CandidateResults({
  resumes,
  screeningId,
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
  onStop,
  onReview,
}: CandidateResultsProps) {
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<ResumeRow | null>(null);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const filteredResumes = resumes.filter(
    (resume) => !query.trim() || resume.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const rankedResumes = resumes
    .filter((resume) => resume.evaluation?.status === 'completed')
    .sort((a, b) => (b.evaluation?.score ?? -1) - (a.evaluation?.score ?? -1));
  const ranks = new Map(rankedResumes.map((resume, index) => [resume.key, index + 1]));
  const rows = filteredResumes
    .map((resume) => ({
      ...resume,
      candidate: displayName(resume.name),
      rank: ranks.get(resume.key) ?? null,
    }))
    .sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.candidate.localeCompare(b.candidate);
    });
  const completedCount = resumes.filter(
    (resume) => resume.evaluation?.status === 'completed',
  ).length;
  const activeCount = resumes.filter(
    (resume) =>
      resume.evaluation?.status === 'queued' || resume.evaluation?.status === 'processing',
  ).length;
  const failedCount = resumes.filter((resume) => resume.evaluation?.status === 'failed').length;
  const stoppedCount = resumes.filter((resume) => resume.evaluation?.status === 'stopped').length;
  const retryableCount = failedCount + stoppedCount;

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
        const assessments = evaluation.assessments || [];
        const jobEvidence = evaluation.job_evidence || [];
        return (
          <div className="candidate-score">
            <Text strong>{evaluation.score ?? 0}/100</Text>
            <Text type="secondary">
              Must-have fit {evaluation.job_match_score ?? '—'}/100
              {evaluation.preferred_score !== null
                ? ` · Preferences ${evaluation.preferred_score}/100 · Bonus +${evaluation.bonus_points ?? 0}`
                : ''}
            </Text>
            {evaluation.preferred_score !== null && (
              <Text type={evaluation.required_checks_passed ? 'success' : 'secondary'}>
                {evaluation.required_checks_passed
                  ? 'All required job checks passed; preference bonus applied.'
                  : 'Required job checks were not all verified; no preference bonus.'}
              </Text>
            )}
            <Text type="secondary">{evaluation.explanation}</Text>
            <Popover
              title="Match evidence"
              trigger="click"
              content={
                <div className="candidate-evidence">
                  <div>
                    <Text strong>
                      Job description match · {evaluation.job_match_score ?? '—'}/100
                    </Text>
                    {jobEvidence.length ? (
                      <ul>
                        {jobEvidence.map((quote) => (
                          <li key={quote}>“{quote}”</li>
                        ))}
                      </ul>
                    ) : (
                      <Text type="secondary">No verified excerpts for the overall job match.</Text>
                    )}
                  </div>
                  {(evaluation.required_checks || []).map((check) => (
                    <div key={check.name}>
                      <Text strong>
                        {check.met ? 'Passed' : 'Not verified'}: {check.name}
                      </Text>
                      {check.evidence.length ? (
                        <ul>
                          {check.evidence.map((quote) => (
                            <li key={quote}>“{quote}”</li>
                          ))}
                        </ul>
                      ) : (
                        <Text type="secondary">No verifiable resume quote.</Text>
                      )}
                    </div>
                  ))}
                  {assessments.map((assessment) => (
                    <div key={assessment.criterion_id}>
                      <Text strong>
                        {assessment.required ? 'Must-have' : 'Nice-to-have'} Â·{' '}
                        {assessment.status || 'scored'} · {assessment.name} Â· {assessment.score}
                        /100
                      </Text>
                      <Text type="secondary">
                        Exact: {assessment.exact_match ? 'yes' : 'no'} Â· Semantic:{' '}
                        {assessment.semantic_score === null ||
                        assessment.semantic_score === undefined
                          ? 'unavailable'
                          : `${assessment.semantic_score}/100`}
                        Â· Reranker:{' '}
                        {assessment.reranker_score === null ||
                        assessment.reranker_score === undefined
                          ? 'unavailable'
                          : `${assessment.reranker_score}/100`}
                        {assessment.experience_match === null ||
                        assessment.experience_match === undefined
                          ? ''
                          : ` Â· Experience: ${assessment.experience_match ? 'met' : 'not met'}`}
                      </Text>
                      {assessment.evidence.length ? (
                        <ul>
                          {assessment.evidence.map((quote) => (
                            <li key={quote}>“{quote}”</li>
                          ))}
                        </ul>
                      ) : (
                        <Text type="secondary">No clear excerpt found in the resume.</Text>
                      )}
                    </div>
                  ))}
                </div>
              }
            >
              <Button type="link" size="small">
                Evidence
              </Button>
            </Popover>
          </div>
        );
      },
    },
    {
      title: 'STATUS',
      key: 'status',
      width: 135,
      render: (_, resume) => (
        <Tag className="status-tag">
          {resume.evaluation?.status === 'completed'
            ? 'Evaluated'
            : resume.evaluation?.status === 'failed'
              ? 'Needs review'
              : resume.evaluation?.status === 'stopped'
                ? 'Stopped'
                : resume.evaluation?.status === 'processing'
                  ? 'Processing'
                  : resume.evaluation?.status === 'queued'
                    ? 'Queued'
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
          {resume.id && (
            <a href={`${API_BASE_URL}/api/resumes/${encodeURIComponent(resume.id)}/download`}>
              Download
            </a>
          )}
          {resume.id && resume.evaluation?.status === 'completed' && (
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
        </div>
      ),
    },
  ];

  return (
    <section className="section-card results-card">
      <div className="results-header">
        <div>
          <Text className="eyebrow">SCREENING WORKSPACE</Text>
          <Title level={3}>{isSaved ? 'Candidate rankings' : 'Resume files'}</Title>
          <Text type="secondary">
            {isSaved
              ? 'Completed candidates are ordered by final score. Pending candidates receive a rank as local evaluation finishes.'
              : 'Candidates will be ranked against the job description. Optional preferred criteria add a smaller secondary score.'}
          </Text>
        </div>
        <div className="results-actions">
          {isSaved && resumes.length > 0 && (
            <Button
              icon={<ReloadOutlined />}
              loading={retryingMode !== null}
              disabled={retryingMode !== null}
              onClick={() => setRetryDialogOpen(true)}
            >
              Retry screening
            </Button>
          )}
          {isSaved && activeCount > 0 && (
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
          <Button
            danger
            disabled={!selectedKeys.length || deleting}
            loading={deleting}
            onClick={onDeleteSelected}
          >
            Delete selected
          </Button>
        </div>
      </div>

      <Table
        className="candidate-table"
        rowKey="key"
        columns={columns}
        dataSource={rows}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          preserveSelectedRowKeys: true,
          onChange: (keys) => {
            onSelectionChange(keys.map(String));
          },
        }}
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
    </section>
  );
}
