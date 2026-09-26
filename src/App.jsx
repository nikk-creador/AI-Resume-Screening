import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  message,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';

const { Dragger } = Upload;
const { Paragraph, Text, Title } = Typography;
const RESUME_TYPES = ['pdf', 'doc', 'docx'];
const JOB_TYPES = ['pdf', 'doc', 'docx', 'txt'];
const MAX_FILE_SIZE_MB = 10;
const MAX_RESUMES = 25;

function extensionOf(filename) {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function displayName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename;
}

function isDuplicate(files, file) {
  return files.some((item) => item.name === file.name && item.size === file.size);
}

function formatSize(size) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const [resumes, setResumes] = useState([]);
  const [jobFile, setJobFile] = useState(null);
  const [jobText, setJobText] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [messageApi, contextHolder] = message.useMessage();

  const addResumes = (file) => {
    const ext = extensionOf(file.name);
    if (!RESUME_TYPES.includes(ext)) {
      messageApi.error(`${file.name}: upload a PDF, DOC, or DOCX resume.`);
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      messageApi.error(`${file.name}: files must be ${MAX_FILE_SIZE_MB} MB or smaller.`);
      return Upload.LIST_IGNORE;
    }
    if (isDuplicate(resumes, file)) {
      messageApi.warning(`${file.name} has already been added.`);
      return Upload.LIST_IGNORE;
    }
    if (resumes.length >= MAX_RESUMES) {
      messageApi.error(`You can add up to ${MAX_RESUMES} resumes per screening.`);
      return Upload.LIST_IGNORE;
    }
    setResumes((current) => {
      if (current.length >= MAX_RESUMES || isDuplicate(current, file)) return current;
      return [...current, file];
    });
    return Upload.LIST_IGNORE;
  };

  const addJobFile = (file) => {
    const ext = extensionOf(file.name);
    if (!JOB_TYPES.includes(ext)) {
      messageApi.error('Upload a PDF, DOC, DOCX, or TXT job description.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      messageApi.error(`The job description must be ${MAX_FILE_SIZE_MB} MB or smaller.`);
      return Upload.LIST_IGNORE;
    }
    setJobFile(file);
    messageApi.success('Job description added.');
    return Upload.LIST_IGNORE;
  };

  const filteredResumes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resumes
      .filter((file) => !normalizedQuery || file.name.toLowerCase().includes(normalizedQuery))
      .map((file, index) => ({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        rank: index + 1,
        candidate: displayName(file.name),
        file,
      }));
  }, [query, resumes]);

  const columns = [
    {
      title: 'CANDIDATE',
      dataIndex: 'candidate',
      key: 'candidate',
      sorter: (a, b) => a.candidate.localeCompare(b.candidate),
      render: (name, record) => (
        <div className="candidate-cell">
          <span className="candidate-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          <span className="candidate-details">
            <Text strong>{name}</Text>
            <Text type="secondary" className="candidate-file">{record.file.name}</Text>
          </span>
        </div>
      ),
    },
    {
      title: 'MATCH SCORE',
      key: 'score',
      width: 145,
      render: () => <Text type="secondary">—</Text>,
    },
    {
      title: 'STATUS',
      key: 'status',
      width: 155,
      render: () => <Tag className="status-tag">Ready to screen</Tag>,
    },
    {
      title: '',
      key: 'action',
      width: 88,
      align: 'right',
      render: (_, record) => (
        <Button
          type="text"
          danger
          aria-label={`Remove ${record.file.name}`}
          onClick={() => {
            setResumes((current) => current.filter((file) => file !== record.file));
            setPage((current) => Math.max(1, Math.min(current, Math.ceil((resumes.length - 1) / pageSize) || 1)));
          }}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div className="app-shell">
      {contextHolder}
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#main" aria-label="Resume Screening home">
            <span className="brand-mark">R</span>
            <span>screen<span className="brand-accent">wise</span></span>
          </a>
          <div className="topbar-right">
            <span className="workspace-label">WORKSPACE</span>
            <span className="workspace-avatar">G3</span>
          </div>
        </div>
      </header>

      <main id="main" className="main-content">
        <div className="page-heading">
          <div>
            <Text className="eyebrow">AI-ASSISTED HIRING</Text>
            <Title level={1}>Resume screening</Title>
            <Paragraph className="page-description">
              Add a role and its applicants to prepare an evidence-based shortlist.
            </Paragraph>
          </div>
          <div className="step-indicator"><span className="step-dot" /> New screening</div>
        </div>

        <Row gutter={[18, 18]} className="summary-row">
          <Col xs={24} sm={12} lg={8}>
            <Card className="summary-card" bordered={false}>
              <Statistic title="RESUMES ADDED" value={resumes.length} suffix={<span className="stat-cap">/ {MAX_RESUMES}</span>} />
              <Progress percent={Math.min(100, Math.round((resumes.length / MAX_RESUMES) * 100))} showInfo={false} strokeColor="#3d7bf6" trailColor="#e9eef6" />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card className="summary-card" bordered={false}>
              <Statistic title="JOB DESCRIPTION" value={jobFile || jobText.trim() ? 'Added' : 'Needed'} valueStyle={{ fontSize: 22, color: jobFile || jobText.trim() ? '#167a58' : '#596579' }} />
              <Text className="stat-caption">{jobFile?.name ?? (jobText.trim() ? 'Description entered' : 'Upload a file or paste role details')}</Text>
            </Card>
          </Col>
          <Col xs={24} sm={24} lg={8}>
            <Card className="summary-card summary-readiness" bordered={false}>
              <Statistic title="SCREENING STATUS" value="Setup in progress" valueStyle={{ fontSize: 22 }} />
              <Text className="stat-caption">Scores appear after screening service is connected.</Text>
            </Card>
          </Col>
        </Row>

        <Row gutter={[18, 18]} className="intake-row">
          <Col xs={24} lg={14}>
            <Card className="section-card intake-card" bordered={false}>
              <div className="section-heading">
                <div className="section-number">01</div>
                <div>
                  <Title level={4}>Upload resumes</Title>
                  <Text type="secondary">Add up to {MAX_RESUMES} applicants for this role.</Text>
                </div>
              </div>
              <Dragger
                className="upload-zone resume-dropzone"
                accept=".pdf,.doc,.docx"
                multiple
                showUploadList={false}
                beforeUpload={addResumes}
              >
                <div className="upload-symbol" aria-hidden="true">↑</div>
                <Paragraph className="drop-title"><strong>Click to upload</strong> or drag files here</Paragraph>
                <Text type="secondary">PDF, DOC, or DOCX · Up to {MAX_FILE_SIZE_MB} MB each</Text>
              </Dragger>
              <div className="privacy-note"><span className="privacy-dot" /> Files remain in this browser until screening is connected.</div>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card className="section-card job-card" bordered={false}>
              <div className="section-heading">
                <div className="section-number">02</div>
                <div>
                  <Title level={4}>Job description</Title>
                  <Text type="secondary">Add the requirements to compare against.</Text>
                </div>
              </div>
              <Upload
                accept=".pdf,.doc,.docx,.txt"
                maxCount={1}
                showUploadList={false}
                beforeUpload={addJobFile}
              >
                <Button className="job-upload-button">{jobFile ? 'Replace job description' : 'Upload a file'}</Button>
              </Upload>
              {jobFile && (
                <div className="job-file-row">
                  <span className="file-type">{extensionOf(jobFile.name).toUpperCase()}</span>
                  <span className="job-file-name" title={jobFile.name}>{jobFile.name}</span>
                  <Button type="text" size="small" aria-label="Remove job description" onClick={() => setJobFile(null)}>Remove</Button>
                </div>
              )}
              <div className="or-divider"><span>OR PASTE DESCRIPTION</span></div>
              <Input.TextArea
                value={jobText}
                onChange={(event) => setJobText(event.target.value)}
                placeholder="Paste the role summary, required skills, and experience…"
                autoSize={{ minRows: 4, maxRows: 7 }}
                maxLength={10000}
                showCount
                aria-label="Job description text"
              />
              <Text className="field-hint">Maximum 10,000 characters. Avoid including unnecessary personal information.</Text>
            </Card>
          </Col>
        </Row>

        <Card className="section-card results-card" bordered={false}>
          <div className="results-header">
            <div>
              <Text className="eyebrow">SCREENING OUTPUT</Text>
              <Title level={3}>Candidate list</Title>
              <Text type="secondary">Uploaded applicants are listed here. No match scores have been generated yet.</Text>
            </div>
            <Button type="primary" disabled className="screen-button">Screen candidates</Button>
          </div>

          <Alert
            className="service-notice"
            type="info"
            showIcon
            message="Screening is not connected yet"
            description="The Python API currently provides a health check only. Candidate scores and rankings will appear here once matching is implemented."
          />

          <div className="table-toolbar">
            <Text strong>{resumes.length} {resumes.length === 1 ? 'applicant' : 'applicants'}</Text>
            <Input.Search
              className="candidate-search"
              placeholder="Search filenames"
              allowClear
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              aria-label="Search resumes"
            />
          </div>

          <Table
            className="candidate-table"
            columns={columns}
            dataSource={filteredResumes}
            pagination={{
              current: page,
              pageSize,
              total: filteredResumes.length,
              showSizeChanger: true,
              pageSizeOptions: [5, 10, 20],
              showTotal: (total, range) => total ? `${range[0]}–${range[1]} of ${total}` : '0 applicants',
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize);
              },
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={query ? 'No resumes match your search.' : 'No resumes added yet'}
                >
                  {!query && <Text type="secondary">Upload resumes above to build the candidate list.</Text>}
                </Empty>
              ),
            }}
            scroll={{ x: 640 }}
          />
        </Card>
        <footer className="page-footer">AI output is intended to support recruiter review. Final hiring decisions remain with people.</footer>
      </main>
    </div>
  );
}
