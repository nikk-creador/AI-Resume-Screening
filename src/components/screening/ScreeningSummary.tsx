import { Card, Col, Row, Statistic, Typography } from 'antd';

const { Text } = Typography;

interface ScreeningSummaryProps {
  resumeCount: number;
  hasJobDescription: boolean;
  isSaved: boolean;
  isLoading: boolean;
}

export default function ScreeningSummary({ resumeCount, hasJobDescription, isSaved, isLoading }: ScreeningSummaryProps) {
  return (
    <Row gutter={[16, 16]} className="summary-row">
      <Col xs={24} sm={12} lg={8}>
        <Card className="summary-card" bordered={false}>
          <Statistic title="RESUMES IN THIS SCREENING" value={resumeCount} />
          <Text className="stat-caption">Add as many supported resume files as you need.</Text>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card className="summary-card" bordered={false}>
          <Statistic title="JOB DESCRIPTION" value={hasJobDescription ? 'Added' : 'Needed'} valueStyle={{ fontSize: 22 }} />
          <Text className="stat-caption">{hasJobDescription ? 'Ready for validation' : 'Upload a file or paste the role details'}</Text>
        </Card>
      </Col>
      <Col xs={24} sm={24} lg={8}>
        <Card className="summary-card" bordered={false}>
          <Statistic title="WORKSPACE STATUS" value={isLoading ? 'Loading' : isSaved ? 'Screening ready' : 'Draft'} valueStyle={{ fontSize: 22 }} />
          <Text className="stat-caption">{isSaved ? 'Your screening is available in this workspace.' : 'Save your setup when you’re ready.'}</Text>
        </Card>
      </Col>
    </Row>
  );
}
