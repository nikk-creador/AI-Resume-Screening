import type { CompanyAccess } from './organization';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  default_company_id: string | null;
  companies: CompanyAccess[];
}
