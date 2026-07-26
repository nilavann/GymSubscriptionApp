import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/auth.context';
import { LoadingView } from './LoadingView';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { currentProfile, isInitialising, needsPasswordReset } = useAuth();
  if (isInitialising) return <LoadingView />;
  if (!currentProfile) return <Navigate to="/login" replace />;
  // A session that arrived via a password-reset link is good for exactly one thing:
  // setting a new password. Everything else in the app stays gated until that's done.
  if (needsPasswordReset) return <Navigate to="/reset-password" replace />;
  return <>{children}</>;
}
