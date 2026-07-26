import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { LoadingView } from '../components/LoadingView';
import './ResetPasswordPage.css';

type ViewState = 'idle' | 'submitting' | 'done';

/**
 * Completes the REQ-AUTH-005 password-reset flow. Reached only via the link in the
 * reset email (or a first-time password setup for a Google-only account) - Supabase
 * parses that link's token into a session and fires a PASSWORD_RECOVERY auth event,
 * which AuthContext turns into needsPasswordReset=true. This screen is the only place
 * that's allowed to act on that session; RequireAuth redirects every other route here
 * until updatePassword() succeeds.
 */
export function ResetPasswordPage() {
  const { session, isInitialising, needsPasswordReset, authLinkError, updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (isInitialising) return <LoadingView />;

  // Reached directly with a rejected/expired/already-used link (Supabase's redirectTo is
  // the same for success and failure, so this page can be exactly where that lands) -
  // surface it here rather than silently redirecting away with no explanation.
  if (!needsPasswordReset && authLinkError) {
    return (
      <div className="reset-password-page">
        <div className="reset-password-card">
          <h1 className="reset-password-brand">Fit &amp; Fine</h1>
          <div className="reset-password-error">{authLinkError}</div>
          <p className="reset-password-subtitle">
            Go back to <a href="/login">sign in</a> and request a new reset link.
          </p>
        </div>
      </div>
    );
  }

  // Not a recovery session and no link error either (e.g. someone bookmarked/typed this
  // URL directly) - nothing to do here, send them wherever they'd otherwise land.
  if (!needsPasswordReset) {
    return <Navigate to={session ? '/' : '/login'} replace />;
  }

  // The recovery link resolved to a blocked account (deactivated / never invited) -
  // AuthContext has already signed it back out and set blockedMessage for the login
  // screen to show; there's no session left here to set a password on.
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const canSubmit = password.length >= 6 && password === confirmPassword && viewState !== 'submitting';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setViewState('submitting');
    try {
      await updatePassword(password);
      setViewState('done');
    } catch {
      setError('Could not update your password. Please try again.');
      setViewState('idle');
    }
  }

  if (viewState === 'done') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="reset-password-page">
      <div className="reset-password-card">
        <h1 className="reset-password-brand">Fit &amp; Fine</h1>
        <p className="reset-password-subtitle">Choose a new password for your account</p>

        {error && <div className="reset-password-error">{error}</div>}

        <form onSubmit={handleSubmit} className="reset-password-form">
          <label className="reset-password-label" htmlFor="new-password">
            New password
          </label>
          <div className="reset-password-input-wrap">
            <Lock size={18} strokeWidth={2} className="reset-password-input-icon" aria-hidden="true" />
            <input
              id="new-password"
              type="password"
              required
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={viewState === 'submitting'}
              className="reset-password-input"
            />
          </div>

          <label className="reset-password-label" htmlFor="confirm-password">
            Confirm new password
          </label>
          <div className="reset-password-input-wrap">
            <Lock size={18} strokeWidth={2} className="reset-password-input-icon" aria-hidden="true" />
            <input
              id="confirm-password"
              type="password"
              required
              autoComplete="new-password"
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={viewState === 'submitting'}
              className="reset-password-input"
            />
          </div>

          <button type="submit" className="reset-password-submit" disabled={!canSubmit}>
            {viewState === 'submitting' && <RefreshCw size={18} strokeWidth={2} className="reset-password-spin" />}
            {viewState === 'submitting' ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
