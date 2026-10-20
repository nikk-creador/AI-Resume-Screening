import { apiRequest as request } from './api/client';
import type { ScreeningTemplate } from '../types/screening';

export interface ScreeningTemplateInput {
  name: string;
  criteria: ScreeningTemplate['criteria'];
  job_requirements: ScreeningTemplate['job_requirements'];
  scoring_config: ScreeningTemplate['scoring_config'] | null;
}

export async function listScreeningTemplates(): Promise<ScreeningTemplate[]> {
  const result = await request<{ templates: ScreeningTemplate[] }>('/api/screening-templates');
  return result.templates;
}

export function createScreeningTemplate(input: ScreeningTemplateInput): Promise<ScreeningTemplate> {
  return request<ScreeningTemplate>('/api/screening-templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteScreeningTemplate(
  templateId: string,
): Promise<{ deleted: boolean; template_id: string }> {
  return request(`/api/screening-templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
  });
}
