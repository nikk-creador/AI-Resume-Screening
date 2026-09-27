import type { UploadProps } from 'antd';
import type { JobDescriptionFile } from '../../types/screening';
import { Button, Card, Input, Typography, Upload } from 'antd';
import {
  API_URL,
  JOB_DESCRIPTION_EXTENSIONS,
  MAX_JOB_DESCRIPTION_CHARS,
  MIN_JOB_DESCRIPTION_WORDS,
} from '../../constants/screening';
import { getWordCount } from '../../utils/screeningValidation';

const { Text, Title } = Typography;

interface JobDescriptionInputProps {
  disabled: boolean;
  jobFile: JobDescriptionFile | null;
  jobText: string;
  error: string;
  onFile: NonNullable<UploadProps['beforeUpload']>;
  onRemoveFile: () => void;
  onTextChange: (value: string) => void;
  screeningId: string | null;
}

export default function JobDescriptionInput({
  disabled,
  jobFile,
  jobText,
  error,
  onFile,
  onRemoveFile,
  onTextChange,
  screeningId,
}: JobDescriptionInputProps) {
  const wordCount = getWordCount(jobText);
  const textIsShort = jobText.trim().length > 0 && wordCount < MIN_JOB_DESCRIPTION_WORDS;
  return (
    <Card className="section-card job-card" variant="borderless">
      <div className="section-heading">
        <div className="section-number">02</div>
        <div>
          <Title level={4}>Job description</Title>
          <Text type="secondary">Use a file or paste the role requirements.</Text>
        </div>
      </div>
      <Upload
        accept={JOB_DESCRIPTION_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
        maxCount={1}
        showUploadList={false}
        disabled={disabled}
        beforeUpload={onFile}
      >
        <Button className="job-upload-button">
          {jobFile ? 'Replace job description' : 'Upload a file'}
        </Button>
      </Upload>
      {jobFile && (
        <div className="job-file-row">
          <span className="file-type">{jobFile.name.split('.').pop()?.toUpperCase()}</span>
          <span className="job-file-name" title={jobFile.name}>
            {jobFile.name}
          </span>
          {!(jobFile instanceof File) && screeningId && (
            <a
              href={`${API_URL}/api/screenings/${encodeURIComponent(screeningId)}/job-description`}
            >
              Download
            </a>
          )}
          {!disabled && (
            <Button type="text" size="small" onClick={onRemoveFile}>
              Remove
            </Button>
          )}
        </div>
      )}
      <div className="or-divider">
        <span>OR PASTE DESCRIPTION</span>
      </div>
      <Input.TextArea
        value={jobText}
        onChange={(event) => {
          onTextChange(event.target.value);
        }}
        placeholder="Include the role summary, key responsibilities, and required skills…"
        disabled={disabled}
        autoSize={{ minRows: 5, maxRows: 9 }}
        maxLength={MAX_JOB_DESCRIPTION_CHARS}
        showCount
        aria-label="Job description text"
        status={error || textIsShort ? 'error' : undefined}
      />
      <div className="job-description-meta">
        <Text type={error || textIsShort ? 'danger' : 'secondary'}>
          {error ||
            (textIsShort
              ? `Add ${MIN_JOB_DESCRIPTION_WORDS - wordCount} more words to reach the ${MIN_JOB_DESCRIPTION_WORDS}-word minimum.`
              : `Minimum ${MIN_JOB_DESCRIPTION_WORDS} words${jobText.trim() ? ` · ${wordCount} entered` : ''}.`)}
        </Text>
        <Text type="secondary">Avoid unnecessary personal information.</Text>
      </div>
    </Card>
  );
}
