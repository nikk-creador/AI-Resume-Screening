import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import {
  listCompanyReviewers,
  listScreeningTeamReviews,
  saveCandidateTeamReview,
  updateCandidateAssignments,
} from '../../../services/teamReviewApi';
import type { ResumeRow } from '../../../types/screening';
import { getErrorMessage } from '../../../utils/errors';
import { displayName } from '../../../utils/screeningValidation';

const { Paragraph, Text, Title } = Typography;

interface TeamReviewPanelProps {
  open: boolean;
  onClose: () => void;
  screeningId: string | null;
  companyId: string;
  currentUserId: string;
  canAssign: boolean;
  canSubmitReview: boolean;
  resumes: ResumeRow[];
}

export default function TeamReviewPanel({
  open,
  onClose,
  screeningId,
  companyId,
  currentUserId,
  canAssign,
  canSubmitReview,
  resumes,
}: TeamReviewPanelProps) {
  const storedResumes = useMemo(() => resumes.filter((resume) => resume.id), [resumes]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | undefined>(
    storedResumes[0]?.id ?? undefined,
  );
  const [assignedReviewerIds, setAssignedReviewerIds] = useState<string[]>([]);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const reviewsQuery = useQuery({
    queryKey: queryKeys.teamReviews(screeningId ?? ''),
    queryFn: () => listScreeningTeamReviews(screeningId!),
    enabled: open && Boolean(screeningId),
  });
  const reviewersQuery = useQuery({
    queryKey: queryKeys.companyReviewers(companyId),
    queryFn: () => listCompanyReviewers(companyId),
    enabled: open && canAssign && Boolean(companyId),
  });
  const teamReview = reviewsQuery.data?.find((item) => item.resume_id === selectedResumeId);
  const selectedResume = storedResumes.find((resume) => resume.id === selectedResumeId);
  const canEditSelectedResume = Boolean(
    selectedResume && !selectedResume.archivedAt && canSubmitReview,
  );
  const canAssignSelectedResume = canAssign && canEditSelectedResume;
  const activeAssignments = useMemo(
    () => teamReview?.assignments.filter((item) => item.is_active) ?? [],
    [teamReview],
  );
  const ownReview = teamReview?.reviews.find((item) => item.reviewer_id === currentUserId);
  const isAssigned = activeAssignments.some((item) => item.reviewer_id === currentUserId);
  const invalidateTeamReviews = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.teamReviews(screeningId ?? '') });
  const assignmentsMutation = useMutation({
    mutationFn: () =>
      selectedResumeId
        ? updateCandidateAssignments(selectedResumeId, assignedReviewerIds)
        : Promise.reject(new Error('Choose a candidate first.')),
    onSuccess: async () => {
      await invalidateTeamReviews();
      messageApi.success('Candidate reviewers updated.');
    },
    onError: (error: unknown) =>
      messageApi.error(getErrorMessage(error, 'Could not update candidate reviewers.')),
  });
  const reviewMutation = useMutation({
    mutationFn: () =>
      selectedResumeId && reviewScore !== null
        ? saveCandidateTeamReview(selectedResumeId, reviewScore, reviewNote.trim())
        : Promise.reject(new Error('Enter a score and review note.')),
    onSuccess: async () => {
      await invalidateTeamReviews();
      messageApi.success('Your independent review was saved.');
    },
    onError: (error: unknown) =>
      messageApi.error(getErrorMessage(error, 'Could not save your review.')),
  });

  useEffect(() => {
    if (storedResumes.length && !storedResumes.some((resume) => resume.id === selectedResumeId)) {
      setSelectedResumeId(storedResumes[0].id ?? undefined);
    }
  }, [selectedResumeId, storedResumes]);

  useEffect(() => {
    setAssignedReviewerIds(activeAssignments.map((assignment) => assignment.reviewer_id));
    setReviewScore(ownReview?.score ?? null);
    setReviewNote(ownReview?.note ?? '');
  }, [activeAssignments, ownReview, selectedResumeId]);

  return (
    <Modal
      title="Team review"
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      {contextHolder}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Text type="secondary">
          Assign reviewers and collect their independent scores and notes. These assessments stay
          separate from the model score and recruiter override.
        </Text>
        <Select
          value={selectedResumeId}
          placeholder="Choose a candidate"
          options={storedResumes.map((resume) => ({
            value: resume.id!,
            label: `${displayName(resume.name)} · ${resume.evaluation?.status ?? 'not evaluated'}`,
          }))}
          onChange={setSelectedResumeId}
          style={{ width: '100%' }}
        />
        {reviewsQuery.error && (
          <Alert
            type="error"
            showIcon
            title={getErrorMessage(reviewsQuery.error, 'Could not load team reviews.')}
            action={<Button onClick={() => void reviewsQuery.refetch()}>Retry</Button>}
          />
        )}
        {canAssignSelectedResume && (
          <Card size="small" title="Assigned reviewers">
            <Space direction="vertical" style={{ width: '100%' }}>
              {reviewersQuery.error && (
                <Alert
                  type="error"
                  showIcon
                  title={getErrorMessage(reviewersQuery.error, 'Could not load company reviewers.')}
                  action={<Button onClick={() => void reviewersQuery.refetch()}>Retry</Button>}
                />
              )}
              <Select
                mode="multiple"
                value={assignedReviewerIds}
                loading={reviewersQuery.isLoading}
                options={(reviewersQuery.data ?? []).map((reviewer) => ({
                  value: reviewer.user_id,
                  label: reviewer.full_name,
                }))}
                placeholder="Select company reviewers"
                onChange={setAssignedReviewerIds}
                style={{ width: '100%' }}
              />
              <Button
                type="primary"
                disabled={!selectedResumeId || reviewersQuery.isLoading}
                loading={assignmentsMutation.isPending}
                onClick={() => assignmentsMutation.mutate()}
              >
                Save assignments
              </Button>
            </Space>
          </Card>
        )}
        {!canAssignSelectedResume && (
          <div>
            <Text strong>Assigned reviewers</Text>
            <div className="team-review-assignees">
              {activeAssignments.length ? (
                activeAssignments.map((assignment) => (
                  <Tag key={assignment.reviewer_id}>{assignment.full_name}</Tag>
                ))
              ) : (
                <Text type="secondary">No reviewers assigned.</Text>
              )}
            </div>
          </div>
        )}
        <Divider style={{ marginBlock: 4 }} />
        <div>
          <Title level={5}>Independent assessments</Title>
          {teamReview?.reviews.length ? (
            <List
              dataSource={teamReview.reviews}
              renderItem={(review) => (
                <List.Item key={review.reviewer_id}>
                  <div className="team-review-entry">
                    <div className="team-review-heading">
                      <Text strong>{review.full_name}</Text>
                      <Tag color="blue">{review.score}/100</Tag>
                    </div>
                    <Text type="secondary">
                      Updated {new Date(review.updated_at).toLocaleString()}
                    </Text>
                    <Paragraph>{review.note}</Paragraph>
                  </div>
                </List.Item>
              )}
            />
          ) : (
            <Text type="secondary">No independent reviews have been submitted.</Text>
          )}
        </div>
        {isAssigned && canEditSelectedResume ? (
          <Card
            size="small"
            title={ownReview ? 'Update your assessment' : 'Submit your assessment'}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <InputNumber
                min={0}
                max={100}
                value={reviewScore}
                onChange={(value) => setReviewScore(value)}
                addonAfter="/ 100"
                aria-label="Independent review score"
                style={{ width: 170 }}
              />
              <Input.TextArea
                rows={3}
                maxLength={2000}
                value={reviewNote}
                placeholder="Your independent assessment and supporting reasons"
                onChange={(event) => setReviewNote(event.target.value)}
              />
              <Button
                type="primary"
                disabled={reviewScore === null || reviewNote.trim().length < 3}
                loading={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate()}
              >
                Save my review
              </Button>
            </Space>
          </Card>
        ) : (
          <Alert
            type="info"
            showIcon
            title={
              selectedResume?.archivedAt
                ? 'Archived candidates are available for review only.'
                : isAssigned
                  ? 'Your access does not allow editing this review.'
                  : 'You need an assignment to submit an independent review.'
            }
          />
        )}
      </Space>
    </Modal>
  );
}
