export interface CompanyPermissions {
  view: boolean;
  edit: boolean;
  download: boolean;
  manage_members: boolean;
}

export interface CompanyAccess {
  id: string;
  name: string;
  organization_id: string;
  organization_name: string;
  organization_role: 'admin' | 'member' | null;
  parent_company_id: string | null;
  role: 'company_admin' | 'recruiter' | 'viewer';
  permissions: CompanyPermissions;
}

export interface CompanyMember {
  user_id: string;
  email: string;
  full_name: string;
  role: CompanyAccess['role'];
  is_active: boolean;
  permissions: CompanyPermissions;
}

export interface CompanyInvitation {
  id: string;
  email: string;
  role: CompanyAccess['role'];
  permissions: CompanyPermissions;
  expires_at: string;
}

export interface CompanyAuditEvent {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface CompanyRetentionPolicy {
  company_id: string;
  enabled: boolean;
  resume_after_days: number;
  resume_action: 'archive' | 'delete';
  screening_after_days: number;
  screening_action: 'archive' | 'delete';
  updated_at: string | null;
}

export interface OrganizationCompany {
  id: string;
  name: string;
  parent_company_id: string | null;
  is_active: boolean;
}
