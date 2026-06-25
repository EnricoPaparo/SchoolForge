import type { ReactNode } from 'react';
import { useAuth } from '../../lib/auth.js';
import { LoginPage } from './LoginPage.js';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <LoginPage />;
  return <>{children}</>;
}
