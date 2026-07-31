import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches a failed lazy-route `import()` — e.g. a browser tab still holding a previous
 * deploy's HTML, referencing a chunk hash that no longer exists once a new deploy
 * replaces it. Without this, that's an unhandled rejection that blanks the whole app
 * instead of a recoverable per-route failure. React has no hook equivalent of
 * `componentDidCatch`, so this has to be a class component. See spec/frontend/
 * performance.md §2.3.
 */
export class ChunkLoadErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            background: 'var(--color-surface-page)',
            color: 'var(--color-text-primary)',
            padding: '1.5rem',
            textAlign: 'center',
          }}
        >
          <p>Something went wrong — reload to get the latest version.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 44,
              padding: '0.6rem 1.5rem',
              borderRadius: 8,
              border: 'none',
              background: 'var(--tint-accent)',
              color: 'var(--color-text-inverse)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
