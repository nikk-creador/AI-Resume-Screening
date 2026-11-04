import { apiRequest } from './api/client';
import type { AuthUser } from '../types/auth';
import type {
  CompanyAccess,
  CompanyAuditEvent,
  CompanyInvitation,
  CompanyMember,
  CompanyPermissions,
  CompanyRetentionPolicy,
  OrganizationCompany,
} from '../types/organization';

type CompanyRetentionPolicyInput = Pick<
  CompanyRetentionPolicy,
  'enabled' | 'resume_after_days' | 'resume_action' | 'screening_after_days' | 'screening_action'
>;

export async function getCompanyRetentionPolicy(
  companyId: string,
): Promise<CompanyRetentionPolicy> {
  return apiRequest(`/api/companies/${encodeURIComponent(companyId)}/retention-policy`);
}

export async function updateCompanyRetentionPolicy(
  companyId: string,
  policy: CompanyRetentionPolicyInput,
): Promise<CompanyRetentionPolicy> {
  return apiRequest(`/api/companies/${encodeURIComponent(companyId)}/retention-policy`, {
    method: 'PUT',
    body: JSON.stringify(policy),
  });
}

interface OrganizationCreateResult {
  organization_id: string;
  organization_name: string;
  company_id: string;
  company_name: string;
}

interface CompanyCreateResult {
  id: string;
  name: string;
  organization_id: string;
  parent_company_id: string | null;
}

interface InvitationCreateResult {
  invitation: CompanyInvitation;
  action_url: string | null;
}

export async function resendCompanyInvitation(
  companyId: string,
  invitationId: string,
): Promise<InvitationCreateResult> {
  return apiRequest(
    `/api/companies/${encodeURIComponent(companyId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
    { method: 'POST' },
  );
}

export async function archiveCompany(companyId: string): Promise<void> {
  await apiRequest(`/api/companies/${encodeURIComponent(companyId)}/archive`, { method: 'POST' });
}

export async function restoreCompany(companyId: string): Promise<void> {
  await apiRequest(`/api/companies/${encodeURIComponent(companyId)}/restore`, { method: 'POST' });
}

export async function listOrganizationCompanies(
  organizationId: string,
): Promise<OrganizationCompany[]> {
  const response = await apiRequest<{ companies: OrganizationCompany[] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/companies`,
  );
  return response.companies;
}

export async function createOrganization(
  name: string,
  initialCompanyName: string,
): Promise<OrganizationCreateResult> {
  return apiRequest('/api/organizations', {
    method: 'POST',
    body: JSON.stringify({ name, initial_company_name: initialCompanyName }),
  });
}

export async function createCompany(
  organizationId: string,
  name: string,
  parentCompanyId: string | null,
): Promise<CompanyCreateResult> {
  return apiRequest(`/api/organizations/${encodeURIComponent(organizationId)}/companies`, {
    method: 'POST',
    body: JSON.stringify({ name, parent_company_id: parentCompanyId }),
  });
}

export async function listCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const response = await apiRequest<{ members: CompanyMember[] }>(
    `/api/companies/${encodeURIComponent(companyId)}/members`,
  );
  return response.members;
}

export async function updateCompanyMember(
  companyId: string,
  userId: string,
  permissions: Partial<CompanyPermissions>,
): Promise<void> {
  await apiRequest(
    `/api/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ...(permissions.view === undefined ? {} : { can_view: permissions.view }),
        ...(permissions.edit === undefined ? {} : { can_edit: permissions.edit }),
        ...(permissions.download === undefined ? {} : { can_download: permissions.download }),
        ...(permissions.manage_members === undefined
          ? {}
          : { can_manage_members: permissions.manage_members }),
      }),
    },
  );
}

export async function revokeCompanyMember(companyId: string, userId: string): Promise<void> {
  await apiRequest(
    `/api/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export async function inviteCompanyMember(
  companyId: string,
  email: string,
  permissions: CompanyPermissions,
): Promise<InvitationCreateResult> {
  return apiRequest(`/api/companies/${encodeURIComponent(companyId)}/invitations`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      ...{
        can_view: permissions.view,
        can_edit: permissions.edit,
        can_download: permissions.download,
        can_manage_members: permissions.manage_members,
      },
    }),
  });
}

export async function listCompanyInvitations(companyId: string): Promise<CompanyInvitation[]> {
  const response = await apiRequest<{ invitations: CompanyInvitation[] }>(
    `/api/companies/${encodeURIComponent(companyId)}/invitations`,
  );
  return response.invitations;
}

export async function revokeCompanyInvitation(
  companyId: string,
  invitationId: string,
): Promise<void> {
  await apiRequest(
    `/api/companies/${encodeURIComponent(companyId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: 'DELETE' },
  );
}

export async function loadInvitation(token: string): Promise<{
  company_id: string;
  email: string;
  company_name: string;
  organization_name: string;
  permissions: Pick<CompanyPermissions, 'view' | 'edit' | 'download'>;
  expires_at: string;
}> {
  return apiRequest(`/api/invitations/${encodeURIComponent(token)}`);
}

export async function acceptInvitation(
  token: string,
  password?: string,
  fullName?: string,
): Promise<{ user: AuthUser }> {
  return apiRequest('/api/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({
      token,
      ...(password ? { password } : {}),
      ...(fullName ? { full_name: fullName } : {}),
    }),
  });
}

export async function listCompanies(): Promise<{
  default_company_id: string | null;
  companies: CompanyAccess[];
}> {
  return apiRequest('/api/companies');
}

export async function listCompanyAuditLog(
  companyId: string,
): Promise<{ events: CompanyAuditEvent[] }> {
  return apiRequest(`/api/companies/${encodeURIComponent(companyId)}/audit-log`);
}
