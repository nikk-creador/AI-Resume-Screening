import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';

import { FileTextOutlined, FolderOpenOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import {
  createScreeningTemplate,
  deleteScreeningTemplate,
  listScreeningTemplates,
} from '../../../services/screeningTemplateApi';
import type {
  EvaluationCriterion,
  JobRequirement,
  MatchingScoringConfig,
  ScreeningTemplate,
} from '../../../types/screening';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface ScreeningTemplateControlsProps {
  companyId: string;
  screeningName: string;
  criteria: EvaluationCriterion[];
  jobRequirements: JobRequirement[];
  scoringConfig: MatchingScoringConfig | null;
  canManage: boolean;
  canApply: boolean;
  onApply: (template: ScreeningTemplate) => void;
}

export default function ScreeningTemplateControls({
  companyId,
  screeningName,
  criteria,
  jobRequirements,
  scoringConfig,
  canManage,
  canApply,
  onApply,
}: ScreeningTemplateControlsProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: queryKeys.screeningTemplates(companyId),
    queryFn: listScreeningTemplates,
    enabled: canManage && Boolean(companyId),
  });
  useEffect(() => {
    if (loadOpen && templatesQuery.error) {
      messageApi.error(getErrorMessage(templatesQuery.error, 'Could not load templates.'));
    }
  }, [loadOpen, messageApi, templatesQuery.error]);
  const saveMutation = useMutation({
    mutationFn: createScreeningTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.screeningTemplates(companyId) });
      setSaveOpen(false);
      setTemplateName('');
      messageApi.success('Screening template saved for this company.');
    },
    onError: (error: unknown) =>
      messageApi.error(getErrorMessage(error, 'Could not save this template.')),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteScreeningTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.screeningTemplates(companyId) });
      setSelectedTemplateId(undefined);
      messageApi.success('Screening template deleted.');
    },
    onError: (error: unknown) =>
      messageApi.error(getErrorMessage(error, 'Could not delete this template.')),
  });
  const templates = templatesQuery.data ?? [];
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

  return (
    <div className="screening-template-controls">
      {contextHolder}
      <div className="template-control-heading">
        <span className="template-control-icon" aria-hidden="true">
          <FileTextOutlined />
        </span>
        <div className="template-control-copy">
          <Text strong>Reusable templates</Text>
          <Text type="secondary">Start from saved role criteria and scoring settings.</Text>
        </div>
        <Tag className="template-count-tag">{templates.length} saved</Tag>
      </div>
      <div className="template-control-actions">
        <Button
          icon={<FolderOpenOutlined />}
          disabled={!canManage || templates.length === 0 || templatesQuery.isLoading}
          onClick={() => setLoadOpen(true)}
        >
          Use template
        </Button>
        <Button
          icon={<SaveOutlined />}
          disabled={!canManage}
          onClick={() => {
            setTemplateName(screeningName.trim());
            setSaveOpen(true);
          }}
        >
          Save current setup
        </Button>
      </div>

      <Modal
        className="feature-modal template-modal"
        title="Save reusable screening template"
        open={saveOpen}
        confirmLoading={saveMutation.isPending}
        okText="Save template"
        okButtonProps={{ disabled: templateName.trim().length < 2 }}
        onCancel={() => setSaveOpen(false)}
        onOk={() =>
          saveMutation.mutate({
            name: templateName.trim(),
            criteria,
            job_requirements: jobRequirements,
            scoring_config: scoringConfig,
          })
        }
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">
            Save role requirements, preferred criteria and matching weights. The job description and
            candidate files are not included.
          </Text>
          <Input
            autoFocus
            maxLength={160}
            placeholder="Template name"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            onPressEnter={() => {
              if (templateName.trim().length >= 2) {
                saveMutation.mutate({
                  name: templateName.trim(),
                  criteria,
                  job_requirements: jobRequirements,
                  scoring_config: scoringConfig,
                });
              }
            }}
          />
        </Space>
      </Modal>

      <Modal
        className="feature-modal template-modal"
        title="Load screening template"
        open={loadOpen}
        confirmLoading={templatesQuery.isFetching}
        okText="Apply template"
        okButtonProps={{ disabled: !selectedTemplate || !canApply }}
        onCancel={() => setLoadOpen(false)}
        onOk={() => {
          if (!selectedTemplate) return;
          onApply(selectedTemplate);
          setLoadOpen(false);
          messageApi.success('Template applied. Review the criteria before starting screening.');
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {!canApply && (
            <Alert
              type="info"
              showIcon
              title="Open a new screening to apply a template. You can save the current settings here."
            />
          )}
          {templatesQuery.error && (
            <Button type="link" onClick={() => void templatesQuery.refetch()}>
              Retry loading templates
            </Button>
          )}
          <Select
            value={selectedTemplateId}
            loading={templatesQuery.isLoading}
            options={templates.map((template) => ({ value: template.id, label: template.name }))}
            placeholder="Choose a template"
            onChange={setSelectedTemplateId}
            style={{ width: '100%' }}
          />
          {selectedTemplate && (
            <div className="screening-template-summary">
              <Text strong>{selectedTemplate.name}</Text>
              <Space wrap>
                <Tag>{selectedTemplate.job_requirements.length} role requirements</Tag>
                <Tag>{selectedTemplate.criteria.length} preferred criteria</Tag>
                <Popconfirm
                  title="Delete this template?"
                  description="This removes it for everyone in the active company."
                  okText="Delete"
                  cancelText="Keep template"
                  okButtonProps={{ danger: true, loading: deleteMutation.isPending }}
                  onConfirm={() => deleteMutation.mutate(selectedTemplate.id)}
                >
                  <Button danger type="link" size="small" disabled={deleteMutation.isPending}>
                    Delete template
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          )}
          {!templatesQuery.isLoading && templates.length === 0 && (
            <Text type="secondary">No templates saved for this company yet.</Text>
          )}
        </Space>
      </Modal>
    </div>
  );
}
