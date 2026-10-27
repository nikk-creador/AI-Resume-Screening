import { useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  message,
  Modal,
  Popconfirm,
  Progress,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import { loadScreening } from '../../../services/screeningApi';
import { COLORS } from '../../../theme/colors';
import type { ScreeningApiRecord, ScreeningListItem } from '../../../types/screening';
import { getErrorMessage } from '../../../utils/errors';
import { formatLocalDateTime, getWordCount } from '../../../utils/screeningValidation';
import { useScreeningMutations, useScreenings } from '../hooks/useScreenings';

const { Text, Title } = Typography;
const PAGE_SIZE = 25;

interface ScreeningsListProps {
  onOpen: (screeningId: string) => void;
  onNewScreening: () => void;
  onDeleted: (screeningId: string) => void;
  canEdit: boolean;
}

export default function ScreeningsList({
  onOpen,
  onNewScreening,
  onDeleted,
  canEdit,
}: ScreeningsListProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [editingScreening, setEditingScreening] = useState<ScreeningApiRecord | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingJobDescription, setEditingJobDescription] = useState('');
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const {
    data,
    isFetching: loading,
    error: listError,
  } = useScreenings((page - 1) * PAGE_SIZE, PAGE_SIZE, search);
  const { duplicateMutation, updateMutation, deleteMutation } = useScreeningMutations();
  const items = data?.screenings ?? [];
  const total = data?.total ?? 0;

  const openEditor = async (screeningId: string) => {
    setLoadingEditId(screeningId);
    try {
      const screening = await queryClient.fetchQuery({
        queryKey: queryKeys.screenings.detail(screeningId),
        queryFn: () => loadScreening(screeningId),
      });
      setEditingScreening(screening);
      setEditingName(screening.name);
      setEditingJobDescription(screening.job_description_text);
      setError('');
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, 'Could not load this screening for editing.'));
    } finally {
      setLoadingEditId(null);
    }
  };

  const saveEdit = async () => {
    if (!editingScreening) return;
    setSavingEdit(true);
    try {
      await updateMutation.mutateAsync({
        screeningId: editingScreening.id,
        changes: {
          name: editingName.trim(),
          job_description_text: editingJobDescription,
          criteria: editingScreening.criteria,
        },
      });
      setEditingScreening(null);
      setError('');
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, 'Could not update this screening.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const duplicateScreening = async (screeningId: string) => {
    setDuplicatingId(screeningId);
    try {
      const screening = await queryClient.fetchQuery({
        queryKey: queryKeys.screenings.detail(screeningId),
        queryFn: () => loadScreening(screeningId),
      });
      await duplicateMutation.mutateAsync(screening);
      setPage(1);
      setError('');
      messageApi.success('Screening duplicated. Upload candidates to start a new screening.');
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, 'Could not duplicate this screening.'));
    } finally {
      setDuplicatingId(null);
    }
  };

  const removeScreening = async (screeningId: string) => {
    setDeletingId(screeningId);
    try {
      await deleteMutation.mutateAsync(screeningId);
      onDeleted(screeningId);
      if (items.length === 1 && page > 1) setPage((current) => current - 1);
      setError('');
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, 'Could not delete this screening.'));
    } finally {
      setDeletingId(null);
    }
  };

  const columns: ColumnsType<ScreeningListItem> = [
    {
      title: 'SCREENING',
      key: 'job',
      render: (_, screening) => (
        <div className="screening-list-job">
          <Text strong>{screening.name}</Text>
          {screening.archived_at && (
            <Tag className="screening-archive-tag" color={COLORS.primary}>
              Archived
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'CREATED',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (value: string) => formatLocalDateTime(value),
    },
    {
      title: 'CANDIDATES',
      dataIndex: 'resume_count',
      key: 'resume_count',
      width: 110,
      render: (count: number) => <Tag className="screening-count-tag">{count}</Tag>,
    },
    {
      title: 'PROGRESS',
      key: 'progress',
      width: 160,
      render: (_, screening) => {
        const total = Math.max(screening.resume_count, 1);
        const percent = Math.round((screening.completed_count / total) * 100);
        return (
          <div className="screening-list-progress">
            <div className="screening-progress-label">
              <Text strong>{percent}%</Text>
              <Text type="secondary">
                {screening.completed_count}/{screening.resume_count} ranked
              </Text>
            </div>
            <Progress
              percent={percent}
              showInfo={false}
              size="small"
              status={screening.failed_count ? 'exception' : undefined}
            />
            <Text className="screening-progress-meta" type="secondary">
              {screening.active_count} active · {screening.failed_count} failed ·{' '}
              {screening.stopped_count} stopped
            </Text>
          </div>
        );
      },
    },
    {
      title: 'AVG. SCORE',
      dataIndex: 'average_score',
      key: 'average_score',
      width: 130,
      render: (score: number | null) =>
        score === null ? (
          <Text type="secondary">—</Text>
        ) : (
          <div className="screening-average-score">
            <Progress type="circle" percent={score} size={34} format={() => String(score)} />
            <Text type="secondary">avg.</Text>
          </div>
        ),
    },
    {
      title: 'ACTIONS',
      key: 'action',
      width: 144,
      align: 'right',
      render: (_, screening) =>
        canEdit ? (
          <div className="screening-row-actions">
            <Button
              type="text"
              icon={<CopyOutlined />}
              title="Duplicate screening"
              aria-label="Duplicate screening"
              loading={duplicatingId === screening.id}
              onClick={(event) => {
                event.stopPropagation();
                void duplicateScreening(screening.id);
              }}
            />
            {!screening.archived_at && (
              <Button
                type="text"
                icon={<EditOutlined />}
                title="Edit screening"
                aria-label="Edit screening"
                loading={loadingEditId === screening.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void openEditor(screening.id);
                }}
              />
            )}
            <Popconfirm
              title="Delete this screening?"
              description="Uploaded resumes, results, and the job description file will be deleted."
              okText="Delete screening"
              cancelText="Cancel"
              okButtonProps={{ danger: true, loading: deletingId === screening.id }}
              onConfirm={() => removeScreening(screening.id)}
            >
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                title="Delete screening"
                aria-label="Delete screening"
                loading={deletingId === screening.id}
                onClick={(event) => event.stopPropagation()}
              />
            </Popconfirm>
          </div>
        ) : null,
    },
  ];

  return (
    <section className="screenings-list">
      {contextHolder}
      <div className="screenings-list-heading">
        <div>
          <Text className="eyebrow">SCREENING HISTORY</Text>
          <Title level={3}>All screenings</Title>
          <Text type="secondary">Browse candidate rankings from previous roles.</Text>
        </div>
        {canEdit && (
          <Button type="primary" onClick={onNewScreening}>
            New screening
          </Button>
        )}
      </div>

      {(error || listError) && (
        <Alert
          className="page-error"
          type="error"
          showIcon
          title={error || getErrorMessage(listError, 'Could not load screenings.')}
        />
      )}

      <div className="screenings-list-toolbar">
        <Text strong>
          {total} {total === 1 ? 'screening' : 'screenings'}
        </Text>
        <Input.Search
          className="screenings-search"
          placeholder="Search screening names"
          allowClear
          value={searchInput}
          onChange={(event) => {
            const { value } = event.target;
            setSearchInput(value);
            if (!value.trim()) {
              setPage(1);
              setSearch('');
            }
          }}
          onSearch={(value) => {
            setPage(1);
            setSearch(value);
          }}
        />
      </div>

      <Table
        className="screenings-table"
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        onRow={(screening) => ({
          className: `screening-row-clickable${screening.archived_at ? ' screening-row-archived' : ''}`,
          tabIndex: 0,
          onClick: () => onOpen(screening.id),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen(screening.id);
            }
          },
        })}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: (nextPage) => {
            setPage(nextPage);
          },
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={search ? 'No screenings match this search.' : 'No screenings yet'}
            >
              {!search && canEdit && (
                <Button onClick={onNewScreening}>Create your first screening</Button>
              )}
            </Empty>
          ),
        }}
        scroll={{ x: 850 }}
      />
      <Modal
        title="Edit screening"
        open={editingScreening !== null}
        confirmLoading={savingEdit}
        okText="Save and rerank"
        okButtonProps={{
          disabled: editingName.trim().length < 2 || getWordCount(editingJobDescription) < 20,
        }}
        onCancel={() => setEditingScreening(null)}
        onOk={saveEdit}
      >
        <Text strong>Screening name</Text>
        <Input
          className="screening-edit-name"
          maxLength={160}
          value={editingName}
          onChange={(event) => setEditingName(event.target.value)}
          aria-label="Screening name"
        />
        <Text type="secondary">
          Updating the job description clears previous scores and queues candidates for evaluation
          again. Optional preferences are preserved.
        </Text>
        <Input.TextArea
          className="screening-edit-description"
          rows={10}
          maxLength={10_000}
          showCount
          value={editingJobDescription}
          onChange={(event) => setEditingJobDescription(event.target.value)}
        />
        <Text type={getWordCount(editingJobDescription) < 20 ? 'danger' : 'secondary'}>
          {getWordCount(editingJobDescription)} of at least 20 words
        </Text>
      </Modal>
    </section>
  );
}
