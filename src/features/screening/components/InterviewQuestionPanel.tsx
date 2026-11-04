import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  List,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';

import { MessageOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import { suggestInterviewQuestions } from '../../../services/interviewQuestionApi';
import { COLORS } from '../../../theme/colors';
import type { ResumeRow } from '../../../types/screening';
import { getErrorMessage } from '../../../utils/errors';
import { displayName } from '../../../utils/screeningValidation';

const { Paragraph, Text } = Typography;

function getKeyedQuestionEvidence(criterionId: string, evidence: string[]) {
  const occurrences = new Map<string, number>();
  return evidence.map((quote) => {
    const occurrence = occurrences.get(quote) ?? 0;
    occurrences.set(quote, occurrence + 1);
    return { key: JSON.stringify([criterionId, quote, occurrence]), quote };
  });
}

interface InterviewQuestionPanelProps {
  open: boolean;
  onClose: () => void;
  resumes: ResumeRow[];
}

export default function InterviewQuestionPanel({
  open,
  onClose,
  resumes,
}: InterviewQuestionPanelProps) {
  const completedResumes = useMemo(
    () => resumes.filter((resume) => resume.id && resume.evaluation?.status === 'completed'),
    [resumes],
  );
  const [selectedResumeId, setSelectedResumeId] = useState<string | undefined>(
    completedResumes[0]?.id ?? undefined,
  );
  const [messageApi, contextHolder] = message.useMessage();
  const questionsQuery = useQuery({
    queryKey: queryKeys.interviewQuestions(selectedResumeId ?? ''),
    queryFn: () => suggestInterviewQuestions(selectedResumeId!),
    enabled: open && Boolean(selectedResumeId),
  });

  useEffect(() => {
    if (open && questionsQuery.error) {
      messageApi.error(
        getErrorMessage(questionsQuery.error, 'Could not draft interview questions.'),
      );
    }
  }, [messageApi, open, questionsQuery.error]);

  useEffect(() => {
    if (
      open &&
      completedResumes.length > 0 &&
      !completedResumes.some((resume) => resume.id === selectedResumeId)
    ) {
      setSelectedResumeId(completedResumes[0].id ?? undefined);
    }
  }, [completedResumes, open, selectedResumeId]);

  return (
    <Modal
      className="feature-modal interview-question-modal"
      title={
        <span className="feature-modal-title">
          <span className="feature-modal-icon">
            <MessageOutlined />
          </span>
          <span>Interview questions</span>
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      <Space className="interview-question-content" direction="vertical" size="middle">
        {contextHolder}
        <div className="feature-modal-intro">
          <Text type="secondary">
            Questions connect the candidate’s evaluated role criteria to evidence in the resume.
            Review the evidence before using each prompt.
          </Text>
          {questionsQuery.data && (
            <Tag color={COLORS.primary}>{questionsQuery.data.length} prompts</Tag>
          )}
        </div>
        <div className="interview-question-picker">
          <Text strong>Candidate</Text>
          <Select
            value={selectedResumeId}
            options={completedResumes.map((resume) => ({
              value: resume.id!,
              label: `${displayName(resume.name)} · ${resume.evaluation?.score ?? '—'}/100`,
            }))}
            placeholder="Choose a completed candidate"
            onChange={setSelectedResumeId}
            style={{ width: '100%' }}
          />
        </div>
        {questionsQuery.error && (
          <Button type="link" onClick={() => void questionsQuery.refetch()}>
            Retry drafting questions
          </Button>
        )}
        {questionsQuery.isLoading ? (
          <div className="interview-question-loading">
            <Spin size="small" />
            <Text type="secondary">Preparing evidence-based questions…</Text>
          </div>
        ) : questionsQuery.data?.length ? (
          <List
            className="interview-question-list"
            dataSource={questionsQuery.data}
            renderItem={(suggestion, index) => (
              <List.Item className="interview-question-list-item" key={suggestion.criterion_id}>
                <Card
                  className="interview-question-card"
                  size="small"
                  title={
                    <div className="interview-question-heading">
                      <span className="interview-question-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <Tag>{suggestion.criterion_type}</Tag>
                      <Text strong>{suggestion.criterion}</Text>
                    </div>
                  }
                >
                  <Paragraph className="interview-question-prompt">{suggestion.question}</Paragraph>
                  <Space className="interview-question-meta" wrap>
                    <Tag color={suggestion.status === 'matched' ? COLORS.success : 'default'}>
                      {suggestion.status.replaceAll('_', ' ')}
                    </Tag>
                    {suggestion.score !== null && <Tag>{suggestion.score}/100</Tag>}
                  </Space>
                  <Text className="interview-question-grounding" type="secondary">
                    {suggestion.grounding}
                  </Text>
                  {suggestion.evidence.length > 0 && (
                    <div className="interview-question-evidence">
                      <Text strong>Resume evidence</Text>
                      {getKeyedQuestionEvidence(suggestion.criterion_id, suggestion.evidence).map(
                        ({ key, quote }) => (
                          <Text type="secondary" key={key}>
                            “{quote}”
                          </Text>
                        ),
                      )}
                    </div>
                  )}
                </Card>
              </List.Item>
            )}
          />
        ) : (
          !questionsQuery.error && (
            <Alert
              type="info"
              showIcon
              title={
                selectedResumeId
                  ? 'No role criteria were recorded for this candidate.'
                  : 'No completed candidates are available yet.'
              }
            />
          )
        )}
      </Space>
    </Modal>
  );
}
