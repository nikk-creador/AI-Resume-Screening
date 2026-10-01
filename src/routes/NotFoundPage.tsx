import { Button, Result, Space } from 'antd';
import { useNavigate } from 'react-router-dom';

import { routes } from './paths';

interface NotFoundPageProps {
  isAuthenticated: boolean;
}

export default function NotFoundPage({ isAuthenticated }: NotFoundPageProps) {
  const navigate = useNavigate();

  return (
    <main id="main" className="main-content">
      <Result
        status="404"
        title="Page not found"
        subTitle="The page you requested does not exist or may have moved."
        extra={
          <Space wrap>
            <Button type="primary" onClick={() => navigate(routes.home, { replace: true })}>
              Go to workspace
            </Button>
            {!isAuthenticated && (
              <Button onClick={() => navigate(routes.signIn, { replace: true })}>Sign in</Button>
            )}
          </Space>
        }
      />
    </main>
  );
}