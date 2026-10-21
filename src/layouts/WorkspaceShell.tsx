import type { ReactNode } from 'react';

import AppHeader from '../components/layout/AppHeader';
import type { AuthUser } from '../types/auth';
import type { CompanyAccess } from '../types/organization';

interface WorkspaceShellProps {
  user: AuthUser;
  companies: CompanyAccess[];
  activeCompany: CompanyAccess;
  onSelectCompany: (companyId: string) => void;
  onCompanyCreated: (company: CompanyAccess) => void;
  onCompanyArchived: (companyId: string) => void;
  onCompanyRestored: () => Promise<void>;
  notificationHolder: ReactNode;
  onShowScreenings: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

export default function WorkspaceShell({
  user,
  companies,
  activeCompany,
  onSelectCompany,
  onCompanyCreated,
  onCompanyArchived,
  onCompanyRestored,
  notificationHolder,
  onShowScreenings,
  onSignOut,
  children,
}: WorkspaceShellProps) {
  return (
    <div className="app-shell">
      {notificationHolder}
      <AppHeader
        user={user}
        companies={companies}
        activeCompany={activeCompany}
        onSelectCompany={onSelectCompany}
        onCompanyCreated={onCompanyCreated}
        onCompanyArchived={onCompanyArchived}
        onCompanyRestored={onCompanyRestored}
        onShowScreenings={onShowScreenings}
        onSignOut={onSignOut}
      />
      {children}
    </div>
  );
}
