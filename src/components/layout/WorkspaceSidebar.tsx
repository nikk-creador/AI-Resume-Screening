import { Button } from 'antd';
import { useMatch } from 'react-router-dom';

import { MenuFoldOutlined, MenuUnfoldOutlined, UnorderedListOutlined } from '@ant-design/icons';

import { routes } from '../../routes/paths';

interface WorkspaceSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onShowScreenings: () => void;
}

export default function WorkspaceSidebar({
  collapsed,
  onToggle,
  onShowScreenings,
}: WorkspaceSidebarProps) {
  const isShowingScreenings = Boolean(useMatch(routes.screenings));

  return (
    <aside className={`workspace-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="workspace-sidebar-heading">
        {!collapsed && <span className="workspace-sidebar-title">Workspace</span>}
        <Button
          className="workspace-sidebar-toggle"
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={onToggle}
        />
      </div>
      <nav
        id="workspace-sidebar-navigation"
        className="workspace-sidebar-navigation"
        aria-label="Workspace navigation"
      >
        <Button
          className={`workspace-sidebar-link${isShowingScreenings ? ' is-active' : ''}`}
          type="text"
          icon={<UnorderedListOutlined />}
          aria-label="Screenings"
          aria-current={isShowingScreenings ? 'page' : undefined}
          title={collapsed ? 'Screenings' : undefined}
          onClick={onShowScreenings}
        >
          {!collapsed && 'Screenings'}
        </Button>
      </nav>
    </aside>
  );
}
