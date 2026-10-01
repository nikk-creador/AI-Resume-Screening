import { Button } from 'antd';
import { useMatch } from 'react-router-dom';

import {
  ApiOutlined,
  LogoutOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';

import { routes } from '../../routes/paths';
import type { AuthUser } from '../../types/auth';

interface AppHeaderProps {
  user: AuthUser;
  onNewScreening: () => void;
  onShowScreenings: () => void;
  onShowAI: () => void;
  onSignOut: () => void;
}

export default function AppHeader({
  user,
  onNewScreening,
  onShowScreenings,
  onShowAI,
  onSignOut,
}: AppHeaderProps) {
  const isShowingScreenings = Boolean(useMatch(routes.screenings));
  const isShowingAI = Boolean(useMatch(routes.ai));
  const initials = user.full_name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#main" aria-label="RecruitAI home">
          <span className="brand-mark">R</span>
          <span>
            Recruit<span className="brand-accent">AI</span>
          </span>
        </a>
        <div className="topbar-right">
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
            <Button
              className="topbar-new-screening"
              type="primary"
              size="middle"
              icon={<PlusOutlined />}
              aria-label="New screening"
              title="New screening"
              onClick={onNewScreening}
            >
              <span className="topbar-button-label">New screening</span>
            </Button>
          </nav>
          <div className="topbar-account">
            <span className="workspace-avatar" title={user.full_name} aria-hidden="true">
              {initials || 'AI'}
            </span>
            <span className="workspace-label">{user.full_name}</span>
            <Button
              className="topbar-sign-out"
              type="text"
              size="middle"
              icon={<LogoutOutlined />}
              aria-label="Sign out"
              title="Sign out"
              onClick={onSignOut}
            >
              <span className="topbar-button-label">Sign out</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
