import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Input,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';

import { DeleteOutlined, EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import type { AITestResponse } from '../../../services/screeningApi';
import { getErrorMessage, testAIService } from '../../../services/screeningApi';
import { COLORS } from '../../../theme/colors';
import type { JobRequirement, ResumeRow, ScreeningListItem } from '../../../types/screening';
import { useAllScreenings } from '../hooks/useScreenings';

const { Paragraph, Text, Title } = Typography;

interface AIServicePanelProps {
  screeningId: string | null;
  screeningName: string;
  resumes: ResumeRow[];
  jobRequirements: JobRequirement[];
  stopping: boolean;
  deletingId: string | null;
  onStop: () => void;
  onDeleteScreening: (screeningId: string) => Promise<boolean>;
  onViewScreening: (screeningId: string) => void;
  onSaveRequirements: (requirements: JobRequirement[]) => Promise<void>;
}

export default function AIServicePanel({
  screeningId,
  screeningName,
  resumes,
  jobRequirements,
  stopping,
  deletingId,
  onStop,
  onDeleteScreening,
  onViewScreening,
  onSaveRequirements,
}: AIServicePanelProps) {
  const [draftRequirements, setDraftRequirements] = useState<JobRequirement[]>(jobRequirements);
  const [savingRequirements, setSavingRequirements] = useState(false);
  const [result, setResult] = useState<AITestResponse | null>(null);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const {
    data: screenings = [],
    isFetching: loadingScreenings,
    error: screeningsError,
  } = useAllScreenings();
  const testMutation = useMutation({ mutationFn: testAIService });
  const rows = useMemo(
    () =>
      resumes
        .flatMap((resume) => {
          const { evaluation } = resume;
          if (!resume.stored || !resume.id || !evaluation) return [];
          return [
            {
              key: resume.id,
              candidate: resume.name,
              status: evaluation.status,
              attempts: evaluation.attempts,
              error: evaluation.error_message,
              updatedAt: evaluation.updated_at,
            },
          ];
        })
        .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)),
    [resumes],
  );
  const activeCount = rows.filter(
    (row) => row.status === 'queued' || row.status === 'processing',
  ).length;
  const failedCount = rows.filter((row) => row.status === 'failed').length;

  const runTest = async () => {
    setError('');
    setResult(null);
    try {
      setResult(await testMutation.mutateAsync());
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, 'The AI service test failed.'));
    }
  };

  const removeScreeningFromList = async (id: string) => {
    if (await onDeleteScreening(id)) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.screenings.all });
    }
  };

  const columns = [
    { title: 'Candidate file', dataIndex: 'candidate', key: 'candidate' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: (typeof rows)[number]['status']) => (
        <Tag
          color={
            value === 'completed'
              ? COLORS.success
              : value === 'failed'
                ? COLORS.danger
                : COLORS.primary
          }
        >
          {value}
        </Tag>
      ),
      width: 140,
    },
    { title: 'Attempts', dataIndex: 'attempts', key: 'attempts', width: 100 },
    {
      title: 'Last update',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (value: string) => new Date(value).toLocaleString(),
      width: 220,
    },
    {
      title: 'Message',
      dataIndex: 'error',
      key: 'error',
      render: (value: string | null) => value || <Text type="secondary">—</Text>,
    },
  ];

  const screeningColumns = [
    {
      title: 'Screening',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, screening: ScreeningListItem) => (
        <Space>
          <Text strong>{name}</Text>
          {screening.id === screeningId && <Tag color={COLORS.primary}>Current</Tag>}
        </Space>
      ),
    },
    {
      title: 'Reference',
      dataIndex: 'id',
      key: 'id',
      render: (id: string) => (
        <Text code copyable={{ text: id }}>
          {id}
        </Text>
      ),
      width: 280,
    },
    { title: 'Candidates', dataIndex: 'resume_count', key: 'resume_count', width: 110 },
    { title: 'Completed', dataIndex: 'completed_count', key: 'completed_count', width: 110 },
    { title: 'Active', dataIndex: 'active_count', key: 'active_count', width: 90 },
    { title: 'Failed', dataIndex: 'failed_count', key: 'failed_count', width: 90 },
    {
      title: 'Action',
      key: 'action',
      width: 245,
      render: (_: unknown, screening: ScreeningListItem) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            disabled={screening.id === screeningId}
            onClick={() => onViewScreening(screening.id)}
          >
            View
          </Button>
          <Popconfirm
            title={`Delete “${screening.name}”?`}
            description={`Reference: ${screening.id}. This permanently deletes its files and results.`}
            okText="Delete screening"
            cancelText="Cancel"
            okButtonProps={{ danger: true, loading: deletingId === screening.id }}
            onConfirm={() => removeScreeningFromList(screening.id)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === screening.id}
              aria-label={`Delete screening ${screening.name}`}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <main id="main" className="main-content">
      <div className="page-heading">
        <div>
          <Text className="eyebrow">SCREENING MONITOR</Text>
          <Title level={1}>AI activity</Title>
          <Paragraph className="page-description">
            View every screening service, then select one to monitor its live candidate evaluations.
          </Paragraph>
        </div>
      </div>

      {error && <Alert className="page-error" type="error" showIcon title={error} />}
      {result && (
        <Alert
          className="page-error"
          type="success"
          showIcon
          title={`${result.model} responded successfully in ${(result.latency_ms / 1000).toFixed(2)} seconds.`}
        />
      )}

      {screeningsError && (
        <Alert
          className="page-error"
          type="error"
          showIcon
          title={getErrorMessage(screeningsError, 'Could not load screenings.')}
        />
      )}

      <Card className="ai-service-card" title="All screening services">
        <Paragraph type="secondary">
          Select a screening to make it the current view and monitor its candidate evaluations.
        </Paragraph>
        <Table<ScreeningListItem>
          rowKey="id"
          columns={screeningColumns}
          dataSource={screenings}
          loading={loadingScreenings}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: 'No screenings found.' }}
        />
      </Card>

      <Card className="ai-service-card">
        <Space className="ai-service-summary" size="large" wrap>
          <Statistic title="Current screening" value={screeningId ? screeningName : 'None open'} />
          <div className="ai-screening-reference">
            <Text type="secondary">Screening reference</Text>
            <Text code copyable={screeningId ? { text: screeningId } : false}>
              {screeningId || '—'}
            </Text>
          </div>
          <Statistic title="Candidates in this view" value={rows.length} />
          <Statistic title="Queued or processing" value={activeCount} />
          <Statistic title="Failed" value={failedCount} />
          <Button type="primary" onClick={runTest} loading={testMutation.isPending}>
            Test AI service
          </Button>
          {screeningId && activeCount > 0 && (
            <Popconfirm
              title="Stop this screening?"
              description="Queued evaluations will stop. Any model call already running may finish, but its result will not be saved."
              okText="Stop screening"
              cancelText="Keep running"
              okButtonProps={{ danger: true, loading: stopping }}
              onConfirm={onStop}
            >
              <Button danger icon={<StopOutlined />} loading={stopping}>
                Stop evaluations
              </Button>
            </Popconfirm>
          )}
          {screeningId && (
            <Popconfirm
              title={`Delete “${screeningName}”?`}
              description={`Reference: ${screeningId}. This permanently removes its candidate files, job description, and evaluation results.`}
              okText="Delete screening"
              cancelText="Cancel"
              okButtonProps={{ danger: true, loading: deletingId === screeningId }}
              onConfirm={async () => {
                if (screeningId) await onDeleteScreening(screeningId);
              }}
            >
              <Button danger icon={<DeleteOutlined />} loading={deletingId === screeningId}>
                Delete screening
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Card>

      {screeningId && (
        <Card className="ai-service-card" title="Review job requirements">
          <Paragraph type="secondary">
            Check the extracted requirements before saving. Saving reruns this screening against the
            reviewed list.
          </Paragraph>
          {draftRequirements.map((requirement, index) => (
            <Space
              key={requirement.id}
              align="start"
              wrap
              style={{ display: 'flex', marginBottom: 12 }}
            >
              <Input.TextArea
                aria-label={`Requirement ${index + 1}`}
                value={requirement.text}
                autoSize={{ minRows: 1, maxRows: 3 }}
                onChange={(event) =>
                  setDraftRequirements((items) =>
                    items.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            text: event.target.value,
                            normalized_concept:
                              event.target.value.trim().toLocaleLowerCase() ||
                              item.normalized_concept,
                          }
                        : item,
                    ),
                  )
                }
                style={{ width: 360 }}
              />
              <Select
                aria-label={`Requirement class ${index + 1}`}
                value={requirement.requirement_class}
                options={[
                  { value: 'must_have', label: 'Must have' },
                  { value: 'nice_to_have', label: 'Nice to have' },
                ]}
                onChange={(value: JobRequirement['requirement_class']) =>
                  setDraftRequirements((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, requirement_class: value } : item,
                    ),
                  )
                }
              />
              <Button
                danger
                onClick={() => setDraftRequirements((items) => items.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </Space>
          ))}
          <Space wrap>
            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                setDraftRequirements((items) => [
                  ...items,
                  {
                    id: crypto.randomUUID(),
                    text: 'New requirement',
                    normalized_concept: 'new requirement',
                    requirement_type: 'skill',
                    requirement_class: 'must_have',
                    priority: 3,
                    evidence_needed: 'Direct resume evidence',
                    minimum_years: null,
                  },
                ])
              }
            >
              Add requirement
            </Button>
            <Button
              type="primary"
              loading={savingRequirements}
              disabled={
                !draftRequirements.length ||
                draftRequirements.some((item) => item.text.trim().length < 3)
              }
              onClick={async () => {
                setSavingRequirements(true);
                try {
                  await onSaveRequirements(draftRequirements);
                } finally {
                  setSavingRequirements(false);
                }
              }}
            >
              Save and rerun evaluations
            </Button>
          </Space>
        </Card>
      )}

      {!screeningId && (
        <Alert
          className="page-error"
          type="info"
          showIcon
          title="Open a screening to see its candidate activity here."
        />
      )}

      <Card className="ai-service-card" title={screeningName || 'Current screening activity'}>
        <Paragraph type="secondary">
          This list refreshes while candidates are queued or processing. Resume contents and model
          prompts are not displayed.
        </Paragraph>
        <Table
          rowKey="key"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: 'No candidate evaluations in this screening yet.' }}
        />
      </Card>
    </main>
  );
}
