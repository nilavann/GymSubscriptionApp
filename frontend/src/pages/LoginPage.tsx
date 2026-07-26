import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Mail, Lock, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { LoadingView } from '../components/LoadingView';
import { withTimeout } from '../lib/with-timeout';
import './LoginPage.css';

type ViewState = 'idle' | 'submitting' | 'reset-sent';

const SIGN_IN_TIMEOUT_MS = 15000;

export function LoginPage() {
  const {
    currentProfile,
    isInitialising,
    blockedMessage,
    authLinkError,
    needsPasswordReset,
    signInWithPassword,
    signInWithOAuth,
    resetPasswordForEmail,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [error, setError] = useState<string | null>(null);

  // blockedMessage is set asynchronously by AuthContext, *after* signInWithPassword
  // below has already resolved successfully (it's a separate post-login profile
  // check) - so it can't just be read once at mount. Without this effect, a
  // deactivated/not-invited/verify-error result never reaches the screen and the
  // form stays stuck on "Signing in..." forever (see the bug this fixes).
  useEffect(() => {
    if (blockedMessage) {
      setError(blockedMessage);
      setViewState('idle');
    }
  }, [blockedMessage]);

  // Surfaces a rejected/expired/already-used auth link (password reset, invite, OAuth)
  // instead of silently landing here with no explanation — see auth.context.tsx.
  useEffect(() => {
    if (authLinkError) {
      setError(authLinkError);
    }
  }, [authLinkError]);

  if (isInitialising) return <LoadingView />;

  // A password-recovery session takes priority over "already signed in" - it must
  // finish at ResetPasswordPage before anything else, even if the recovery link
  // happened to resolve to a currently-valid, already-active profile.
  if (needsPasswordReset) {
    return <Navigate to="/reset-password" replace />;
  }

  // Already signed in with an active profile — no reason to see the login form.
  if (currentProfile) {
    return <Navigate to="/" replace />;
  }

  const canSubmit = email.trim() !== '' && password !== '' && viewState !== 'submitting';

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setViewState('submitting');
    try {
      await withTimeout(signInWithPassword(email, password), SIGN_IN_TIMEOUT_MS, new Error('sign-in-timeout'));
    } catch (err) {
      if (err instanceof Error && err.message === 'sign-in-timeout') {
        setError('This is taking longer than expected. Check your connection and try again.');
      } else {
        // Never confirm/deny whether the email is registered.
        setError('Wrong email or password.');
      }
      setPassword('');
      setViewState('idle');
    }
    // On success, viewState intentionally stays 'submitting' here - the real
    // outcome (redirect to / vs. blocked-with-a-message) depends on AuthContext's
    // separate post-login profile check, which the effect above reacts to.
  }

  async function handleGoogleSignIn() {
    setError(null);
    try {
      await signInWithOAuth('google');
    } catch {
      setError('Could not start Google sign-in. Please try again.');
    }
  }

  async function handleForgotPassword() {
    if (email.trim() === '') {
      setError('Enter your email above first, then click "Forgot password?".');
      return;
    }
    setError(null);
    try {
      await resetPasswordForEmail(email);
    } finally {
      // Generic confirmation either way — never reveals whether the email exists.
      setViewState('reset-sent');
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-brand">Fit &amp; Fine</h1>
        <p className="login-subtitle">Sign in to manage members and subscriptions</p>

        {error && <div className="login-error">{error}</div>}
        {viewState === 'reset-sent' && (
          <div className="login-notice">If that email is registered, a reset link has been sent.</div>
        )}

        <form onSubmit={handleSignIn} className="login-form">
          <label className="login-label" htmlFor="email">
            Email
          </label>
          <div className="login-input-wrap">
            <Mail size={18} strokeWidth={2} className="login-input-icon" aria-hidden="true" />
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={viewState === 'submitting'}
              className="login-input"
            />
          </div>

          <label className="login-label" htmlFor="password">
            Password
          </label>
          <div className="login-input-wrap">
            <Lock size={18} strokeWidth={2} className="login-input-icon" aria-hidden="true" />
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={viewState === 'submitting'}
              className="login-input"
            />
          </div>

          <button type="button" className="login-forgot-link" onClick={handleForgotPassword}>
            Forgot password?
          </button>

          <button type="submit" className="login-submit" disabled={!canSubmit}>
            {viewState === 'submitting' && <RefreshCw size={18} strokeWidth={2} className="login-spin" />}
            {viewState === 'submitting' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-divider">or</div>

        <button type="button" className="login-google" onClick={handleGoogleSignIn}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
