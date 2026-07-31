import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Mail, Lock, Dumbbell, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { LoadingView } from '../components/LoadingView';
import { withTimeout } from '../lib/with-timeout';
import './LoginPage.css';

type ViewState = 'idle' | 'submitting' | 'reset-sent';

const SIGN_IN_TIMEOUT_MS = 15000;

// Inline (not hotlinked) so the login screen never depends on a third-party
// asset host being reachable - see brand guidelines for the "Sign in with
// Google" button's official four-color G mark.
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);
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
        <div className="login-badge" aria-hidden="true">
          <Dumbbell size={26} strokeWidth={2} />
        </div>
        <h1 className="login-brand">Welcome to Fit &amp; Fine</h1>
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
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={viewState === 'submitting'}
              className="login-input login-input-has-toggle"
            />
            <button
              type="button"
              className="login-toggle-visibility"
              onClick={() => setShowPassword((v) => !v)}
              disabled={viewState === 'submitting'}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
            </button>
          </div>

          <button type="button" className="login-forgot-link" onClick={handleForgotPassword}>
            Forgot password?
          </button>

          <button type="submit" className="login-submit" disabled={!canSubmit}>
            {viewState === 'submitting' && <RefreshCw size={18} strokeWidth={2} className="login-spin" />}
            {viewState === 'submitting' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-divider">or sign in with</div>

        <button type="button" className="login-google" onClick={handleGoogleSignIn}>
          <GoogleGlyph />
          Continue with Google
        </button>

        <p className="login-footer">Fit &amp; Fine Gym · v1.0.0</p>
      </div>
    </div>
  );
}
