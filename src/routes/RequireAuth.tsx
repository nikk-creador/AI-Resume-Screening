import { Navigate, Outlet } from 'react-router-dom';

import { routes } from './paths';
import type { AuthUser } from '../types/auth';

interface RequireAuthProps {
  user: AuthUser | null;
}

export default function RequireAuth({ user }: RequireAuthProps) {
  if (!user) {
    return <Navigate to={routes.signIn} replace />;
  }
  return <Outlet />;
}
