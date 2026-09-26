import { Button } from 'antd';

interface AppHeaderProps {
  hasSavedScreening: boolean;
  onNewScreening: () => void;
}

export default function AppHeader({ hasSavedScreening, onNewScreening }: AppHeaderProps) {
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
          <span className="workspace-label">HIRING WORKSPACE</span>
          {hasSavedScreening && (
            <Button size="small" onClick={onNewScreening}>
              New screening
            </Button>
          )}
          <span className="workspace-avatar">AI</span>
        </div>
      </div>
    </header>
  );
}
