import { RefreshCw } from 'lucide-react';
import './LoadingView.css';

/** Full-screen loading state while AuthProvider resolves the initial session
 * (app-shell.md §2.3: "centered spinner + 'Loading…' text"). */
export function LoadingView() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        background: 'var(--color-surface-page)',
        color: 'var(--color-text-secondary)',
        fontSize: '0.85rem',
      }}
    >
      <RefreshCw size={28} strokeWidth={2} className="loading-view-spin" aria-hidden="true" style={{ color: 'var(--tint-accent)' }} />
      Loading…
    </div>
  );
}
