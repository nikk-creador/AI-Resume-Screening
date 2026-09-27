import type { ColumnsType } from 'antd/es/table';
import type { CandidateRow, ResumeRow } from '../../types/screening';
import { Alert, Button, Empty, Input, Table, Tag, Typography } from 'antd';
import { API_URL } from '../../constants/screening';
import { displayName, formatFileSize, formatLocalDateTime } from '../../utils/screeningValidation';

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
}: CandidateResultsProps) {
  const rows = resumes
    .filter(
      (resume) => !query.trim() || resume.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .map((resume) => ({ ...resume, candidate: displayName(resume.name) }));

  const columns: ColumnsType<CandidateRow> = [
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
      width: 130,
      render: () => <Text type="secondary">Available after matching</Text>,
    },
    {
      title: 'STATUS',
      key: 'status',
      width: 135,
      render: (_, resume) => (
        <Tag className="status-tag">{resume.id ? 'In workspace' : 'Ready to save'}</Tag>
      ),
    },
    {
      title: 'ACTIONS',
      key: 'action',
      width: 130,
      align: 'right',
      render: (_, resume) => (
        <div className="row-actions">
          {resume.id && (
            <a href={`${API_URL}/api/resumes/${encodeURIComponent(resume.id)}/download`}>
              Download
            </a>
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
          <Title level={3}>Resume files</Title>
          <Text type="secondary">
            Review uploaded files here. Matching scores will appear after the matching service is
            added.
          </Text>
        </div>
        <Button
          type="primary"
          className="screen-button"
          loading={isSaving}
          disabled={!canSave || isSaving || isSaved}
          onClick={onSave}
        >
          {isSaved ? 'Screening ready' : isSaving ? 'Saving files…' : 'Save screening'}
        </Button>
      </div>

      {isSaved && (
        <Alert
          className="service-notice"
          type="success"
          showIcon
          title="Screening is ready"
          description="Your job description and resume files are available in the workspace. Matching scores have not been generated yet."
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
        scroll={{ x: 720 }}
      />
      {screeningId && (
        <Text className="record-hint" type="secondary">
          Screening reference: {screeningId.slice(0, 8)}
        </Text>
      )}
    </section>
  );
}
