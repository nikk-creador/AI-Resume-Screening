import type { UploadProps } from 'antd';
import { Card, Tag, Typography, Upload } from 'antd';

import { InboxOutlined } from '@ant-design/icons';

import { MAX_FILE_SIZE_BYTES, RESUME_EXTENSIONS } from '../../../constants/screening';
import { formatFileSize } from '../../../utils/screeningValidation';

const { Dragger } = Upload;
const { Paragraph, Text, Title } = Typography;

interface ResumeUploaderProps {
  disabled: boolean;
  onBeforeUpload: NonNullable<UploadProps['beforeUpload']>;
  resumeCount: number;
}

export default function ResumeUploader({
  disabled,
  onBeforeUpload,
  resumeCount,
}: ResumeUploaderProps) {
  return (
    <Card className="section-card intake-card" variant="borderless">
      <div className="section-heading">
        <div className="section-number">01</div>
        <div className="upload-heading-copy">
          <Title level={4}>Upload resumes</Title>
          <Text type="secondary">Select one or more files. You can add more before saving.</Text>
        </div>
        <Tag className="upload-count-tag">{resumeCount} added</Tag>
      </div>
      <Dragger
        className="upload-zone resume-dropzone"
        accept={RESUME_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
        multiple
        showUploadList={false}
        disabled={disabled}
        beforeUpload={onBeforeUpload}
      >
        <div className="upload-symbol" aria-hidden="true">
          <InboxOutlined />
        </div>
        <Paragraph className="drop-title">
          <strong>Choose resume files</strong> or drag them here
        </Paragraph>
        <Text type="secondary">
          PDF, DOC, or DOCX · Up to {formatFileSize(MAX_FILE_SIZE_BYTES)} per file
        </Text>
      </Dragger>
      <div className="privacy-note">
        <span className="privacy-dot" /> Files are sent to the workspace when you save this
        screening. Each file shows its parsing and evaluation status and can be retried on its own
        if it fails.
      </div>
    </Card>
  );
}
