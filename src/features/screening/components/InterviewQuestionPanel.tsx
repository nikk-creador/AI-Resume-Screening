import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, List, Modal, Select, Space, Tag, Typography } from 'antd';

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import { suggestInterviewQuestions } from '../../../services/interviewQuestionApi';
import type { ResumeRow } from '../../../types/screening';
import { getErrorMessage } from '../../../utils/errors';
import { displayName } from '../../../utils/screeningValidation';

const { Paragraph, Text } = Typography;

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
  const questionsQuery = useQuery({
    queryKey: queryKeys.interviewQuestions(selectedResumeId ?? ''),
    queryFn: () => suggestInterviewQuestions(selectedResumeId!),
    enabled: open && Boolean(selectedResumeId),
  });

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
      title="Draft interview questions"
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Text type="secondary">
          Suggested follow-up questions are tied to this candidate’s evaluated role criteria and
          recorded resume evidence. Review them before using them in an interview.
        </Text>
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
        {questionsQuery.error && (
          <Alert
            type="error"
            showIcon
            title={getErrorMessage(questionsQuery.error, 'Could not draft interview questions.')}
            action={<Button onClick={() => void questionsQuery.refetch()}>Retry</Button>}
          />
        )}
        {questionsQuery.isLoading ? (
          <Text type="secondary">Preparing evidence-based questions…</Text>
        ) : questionsQuery.data?.length ? (
          <List
            dataSource={questionsQuery.data}
            renderItem={(suggestion) => (
              <List.Item key={suggestion.criterion_id}>
                <Card
                  size="small"
                  title={
                    <Space wrap>
                      <Tag>{suggestion.criterion_type}</Tag>
                      <Text strong>{suggestion.criterion}</Text>
                    </Space>
                  }
                  style={{ width: '100%' }}
                >
                  <Paragraph>{suggestion.question}</Paragraph>
                  <Space wrap>
                    <Tag color={suggestion.status === 'matched' ? 'green' : 'default'}>
                      {suggestion.status.replaceAll('_', ' ')}
                    </Tag>
                    {suggestion.score !== null && <Tag>{suggestion.score}/100</Tag>}
                    <Text type="secondary">{suggestion.grounding}</Text>
                  </Space>
                  {suggestion.evidence.length > 0 && (
                    <div className="interview-question-evidence">
                      <Text strong>Resume evidence</Text>
                      {suggestion.evidence.map((quote, index) => (
                        <Text type="secondary" key={`${suggestion.criterion_id}-${index}`}>
                          “{quote}”
                        </Text>
                      ))}
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
