import type { ReactNode } from 'react';
import { useAuth } from '../context/auth.context';

/** Guards every admin-only route (REQ-ADMIN-*) — Plans, Branches, Settings, Manage Users, Invite User. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { currentProfile } = useAuth();
  if (!currentProfile?.roles.includes('admin')) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-primary)' }}>
        Access denied — this page is admin-only.
      </div>
    );
  }
  return <>{children}</>;
}
