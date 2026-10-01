import { Button, Col, Input, Row, Select, Typography } from 'antd';

import { MAX_EVALUATION_CRITERIA } from '../../../constants/screening';
import type { EvaluationCriterion } from '../../../types/screening';

const { Text, Title } = Typography;

interface ScreeningCriteriaEditorProps {
  criteria: EvaluationCriterion[];
  disabled: boolean;
  canSuggest: boolean;
  isSuggesting: boolean;
  onChange: (criteria: EvaluationCriterion[]) => void;
  onSuggest: () => void;
}

export default function ScreeningCriteriaEditor({
  criteria,
  disabled,
  canSuggest,
  isSuggesting,
  onChange,
  onSuggest,
}: ScreeningCriteriaEditorProps) {
  const updateCriterion = (id: string, changes: Partial<EvaluationCriterion>) => {
    onChange(
      criteria.map((criterion) => (criterion.id === id ? { ...criterion, ...changes } : criterion)),
    );
  };

  return (
    <section className="section-card criteria-card">
      <div className="criteria-heading">
        <div>
          <Text className="eyebrow">OPTIONAL ADD-ONS</Text>
          <Title level={3}>Preferred to have</Title>
          <Text type="secondary">
            The job description always drives the ranking. Add preferences only if you want them to
            contribute a smaller share of the score.
          </Text>
        </div>
        <div className="criteria-actions">
          <Button disabled={disabled || !canSuggest} loading={isSuggesting} onClick={onSuggest}>
            Suggest preferences
          </Button>
          <Button
            disabled={disabled || criteria.length >= MAX_EVALUATION_CRITERIA}
            onClick={() =>
              onChange([
                ...criteria,
                { id: crypto.randomUUID(), name: '', required: false, weight: 3 },
              ])
            }
          >
            Add preference
          </Button>
        </div>
      </div>

      {criteria.length === 0 ? (
        <Text type="secondary">
          No extra preferences. Candidates will be ranked from the job description.
        </Text>
      ) : (
        <Row gutter={[12, 12]} className="criteria-list">
          {criteria.map((criterion, index) => (
            <Col span={24} key={criterion.id}>
              <Row gutter={[8, 8]} align="middle">
                <Col xs={24} md={15}>
                  <Input
                    aria-label={`Preferred qualification ${index + 1}`}
                    maxLength={200}
                    placeholder="e.g. Experience with cloud deployment"
                    value={criterion.name}
                    disabled={disabled}
                    onChange={(event) =>
                      updateCriterion(criterion.id, { name: event.target.value })
                    }
                  />
                </Col>
                <Col xs={16} md={5}>
                  <Select
                    aria-label={`Criterion weight ${index + 1}`}
                    value={criterion.weight}
                    disabled={disabled}
                    options={[1, 2, 3, 4, 5].map((weight) => ({
                      value: weight,
                      label: `Weight ${weight}`,
                    }))}
                    onChange={(weight: number) => updateCriterion(criterion.id, { weight })}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col xs={8} md={4}>
                  <Button
                    danger
                    disabled={disabled}
                    onClick={() => onChange(criteria.filter((item) => item.id !== criterion.id))}
                  >
                    Remove
                  </Button>
                </Col>
              </Row>
            </Col>
          ))}
        </Row>
      )}
    </section>
  );
}
