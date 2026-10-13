import { useState } from 'react';
import type { MenuProps } from 'antd';
import { Button, Dropdown } from 'antd';
import { useMatch } from 'react-router-dom';

import {
  ApiOutlined,
  DownOutlined,
  LogoutOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';

import OrganizationManager from '../../features/organization/components/OrganizationManager';
import { routes } from '../../routes/paths';
import type { AuthUser } from '../../types/auth';
import type { CompanyAccess } from '../../types/organization';

interface AppHeaderProps {
  user: AuthUser;
  companies: CompanyAccess[];
  activeCompany: CompanyAccess;
  onSelectCompany: (companyId: string) => void;
  onCompanyCreated: (company: CompanyAccess) => void;
  onCompanyArchived: (companyId: string) => void;
  onCompanyRestored: () => Promise<void>;
  onShowScreenings: () => void;
  onShowAI: () => void;
  onSignOut: () => void;
}

const ORGANIZATION_MENU_KEY = 'organization';
const SIGN_OUT_MENU_KEY = 'sign-out';

export default function AppHeader({
  user,
  companies,
  activeCompany,
  onSelectCompany,
  onCompanyCreated,
  onCompanyArchived,
  onCompanyRestored,
  onShowScreenings,
  onShowAI,
  onSignOut,
}: AppHeaderProps) {
  const [organizationPanelOpen, setOrganizationPanelOpen] = useState(false);
  const isShowingScreenings = Boolean(useMatch(routes.screenings));
  const isShowingAI = Boolean(useMatch(routes.ai));
  const initials = user.full_name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
  const accountMenuItems: MenuProps['items'] = [
    {
      key: ORGANIZATION_MENU_KEY,
      icon: <UserOutlined />,
      label: 'My Profile',
      onClick: () => setOrganizationPanelOpen(true),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      onClick: () => setOrganizationPanelOpen(true),
    },
    { type: 'divider' },
    {
      type: 'group',
      label: 'Switch Organization',
      children: companies.map((company) => ({
        key: company.id,
        label: `${company.organization_name} / ${company.name}`,
        onClick: () => onSelectCompany(company.id),
      })),
    },
    { type: 'divider' },
    {
      key: SIGN_OUT_MENU_KEY,
      icon: <LogoutOutlined />,
      label: 'Sign out',
      danger: true,
      onClick: onSignOut,
    },
  ];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#main" aria-label="RecruitAI home">
          <span className="brand-mark">R</span>
          <span>
            Recruit<span className="brand-accent">AI</span>
          </span>
        </a>
        <nav className="topbar-navigation" aria-label="Workspace navigation">
          <Button
            className={`topbar-nav-link${isShowingScreenings ? ' is-active' : ''}`}
            type="text"
            size="middle"
            icon={<UnorderedListOutlined />}
            aria-current={isShowingScreenings ? 'page' : undefined}
            aria-label="All screenings"
            title="All screenings"
            onClick={onShowScreenings}
          >
            <span className="topbar-button-label">Screenings</span>
          </Button>
          <Button
            className={`topbar-nav-link${isShowingAI ? ' is-active' : ''}`}
            type="text"
            size="middle"
            icon={<ApiOutlined />}
            aria-current={isShowingAI ? 'page' : undefined}
            aria-label="AI service"
            title="AI service"
            onClick={onShowAI}
          >
            <span className="topbar-button-label">AI service</span>
          </Button>
        </nav>
        <Dropdown
          menu={{ items: accountMenuItems, selectedKeys: [activeCompany.id], selectable: true }}
          trigger={['click']}
          placement="bottomRight"
          rootClassName="topbar-account-menu"
        >
          <button
            type="button"
            className="topbar-account"
            aria-label="Account menu"
            aria-haspopup="menu"
          >
            <span className="workspace-avatar" title={user.full_name} aria-hidden="true">
              {initials || 'AI'}
            </span>
            <span className="workspace-label">{user.full_name}</span>
            <DownOutlined className="topbar-account-caret" aria-hidden="true" />
          </button>
        </Dropdown>
      </div>
      <OrganizationManager
        open={organizationPanelOpen}
        activeCompany={activeCompany}
        companies={companies}
        onClose={() => setOrganizationPanelOpen(false)}
        onCompanyCreated={onCompanyCreated}
        onCompanyArchived={onCompanyArchived}
        onCompanyRestored={onCompanyRestored}
      />
    </header>
  );
}
