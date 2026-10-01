import type { ReactNode } from 'react';

import AppHeader from '../components/layout/AppHeader';
import type { AuthUser } from '../types/auth';

interface WorkspaceShellProps {
  user: AuthUser;
  notificationHolder: ReactNode;
  onNewScreening: () => void;
  onShowScreenings: () => void;
  onShowAI: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

export default function WorkspaceShell({
  user,
  notificationHolder,
  onNewScreening,
  onShowScreenings,
  onShowAI,
  onSignOut,
  children,
}: WorkspaceShellProps) {
  return (
    <div className="app-shell">
      {notificationHolder}
      <AppHeader
        user={user}
        onNewScreening={onNewScreening}
        onShowScreenings={onShowScreenings}
        onShowAI={onShowAI}
        onSignOut={onSignOut}
      />
      {children}
    </div>
  );
}
