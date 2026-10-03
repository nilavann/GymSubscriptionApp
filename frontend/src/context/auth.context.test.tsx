import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

// A controllable stand-in for supabase.auth: tests push session/auth events through it.
const auth = vi.hoisted(() => {
  const state: { listener: ((event: string, session: unknown) => void) | null; session: unknown } = { listener: null, session: null };
  return {
    state,
    getSession: vi.fn(async () => ({ data: { session: state.session } })),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      state.listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
});
vi.mock('../lib/supabase-client', () => ({
  supabase: { auth: { getSession: auth.getSession, onAuthStateChange: auth.onAuthStateChange } },
  SESSION_EXPIRED_EVENT: 'supabase:session-expired',
}));

const profileRepository = { getById: vi.fn() };
const authService = {
  signOut: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
};
vi.mock('./services.context', () => ({ useServices: () => ({ authService, profileRepository }) }));

import { AuthProvider, useAuth } from './auth.context';

function Probe() {
  const a = useAuth();
  return (
    <div>
      <span data-testid="init">{String(a.isInitialising)}</span>
      <span data-testid="profile">{a.currentProfile?.full_name ?? 'none'}</span>
      <span data-testid="blocked">{a.blockedMessage ?? ''}</span>
      <span data-testid="link-error">{a.authLinkError ?? ''}</span>
      <span data-testid="needs-reset">{String(a.needsPasswordReset)}</span>
      <button onClick={() => a.updatePassword('x')}>update</button>
    </div>
  );
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);
const sess = { user: { id: 'u1' } };
const active = { id: 'u1', full_name: 'Sam Staff', roles: ['staff'], is_active: true };

describe('AuthProvider (REQ-AUTH-001/003/004, REQ-ADMIN-006 deactivation)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    auth.state.session = null;
    auth.state.listener = null;
    profileRepository.getById.mockReset();
    authService.signOut.mockReset().mockResolvedValue(undefined);
    authService.updatePassword.mockReset().mockResolvedValue(undefined);
    window.history.replaceState(null, '', '/');
  });

  it('no session: initialised, no profile, nothing blocked', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('init')).toHaveTextContent('false'));
    expect(screen.getByTestId('profile')).toHaveTextContent('none');
    expect(screen.getByTestId('blocked')).toHaveTextContent('');
  });

  it('REQ-AUTH-004: any sign-in method resolves to the same active profile and role set', async () => {
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValue(active);
    mount();
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam Staff'));
    expect(profileRepository.getById).toHaveBeenCalledWith('u1');
  });

  it('REQ-AUTH-003: a session with NO profile row (e.g. Google, never invited) is blocked, message shown, session signed back out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValue(null);
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); }); // covers the single retry delay
    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent("This email hasn't been invited — contact your admin."));
    expect(screen.getByTestId('profile')).toHaveTextContent('none');
    expect(authService.signOut).toHaveBeenCalled();
    expect(profileRepository.getById).toHaveBeenCalledTimes(2); // one retry absorbs the invite-trigger race
  });

  it('a brand-new invited account whose profile appears on the retry is let in (race absorbed)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValueOnce(null).mockResolvedValueOnce(active);
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam Staff'));
    expect(authService.signOut).not.toHaveBeenCalled();
  });

  it('a deactivated account gets the distinct deactivation message and is signed out (REQ-ADMIN-004)', async () => {
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValue({ ...active, is_active: false });
    mount();
    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent('Your account has been deactivated. Contact an admin.'));
    expect(screen.getByTestId('profile')).toHaveTextContent('none');
    expect(authService.signOut).toHaveBeenCalled();
  });

  it('a transient profile-fetch failure is NOT reported as "not invited" and does not sign the user out', async () => {
    auth.state.session = sess;
    profileRepository.getById.mockRejectedValue(new Error('Failed to fetch'));
    mount();
    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent(/Couldn't verify your account/));
    expect(screen.getByTestId('blocked')).not.toHaveTextContent('invited');
    expect(authService.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('profile')).toHaveTextContent('none');
  });

  it('a later auth event with no session clears the profile (sign out)', async () => {
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValue(active);
    mount();
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam Staff'));
    await act(async () => { auth.state.listener?.('SIGNED_OUT', null); });
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('none'));
  });

  it('REQ-AUTH-005: PASSWORD_RECOVERY flags needsPasswordReset until the password is updated', async () => {
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValue(active);
    mount();
    await waitFor(() => expect(screen.getByTestId('init')).toHaveTextContent('false'));
    await act(async () => { auth.state.listener?.('PASSWORD_RECOVERY', sess); });
    expect(screen.getByTestId('needs-reset')).toHaveTextContent('true');
    await act(async () => { screen.getByText('update').click(); });
    await waitFor(() => expect(screen.getByTestId('needs-reset')).toHaveTextContent('false'));
    expect(authService.updatePassword).toHaveBeenCalledWith('x');
  });

  it('a stale recovery flag is dropped when the session goes away', async () => {
    mount();
    await act(async () => { auth.state.listener?.('PASSWORD_RECOVERY', sess); });
    await act(async () => { auth.state.listener?.('SIGNED_OUT', null); });
    expect(screen.getByTestId('needs-reset')).toHaveTextContent('false');
  });

  it('an expired/used auth link in the URL hash is surfaced as authLinkError and removed from the address bar', async () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    mount();
    await waitFor(() => expect(screen.getByTestId('link-error')).toHaveTextContent('Email link is invalid or has expired'));
    expect(window.location.hash).toBe('');
  });

  it('a mid-session 401 (SESSION_EXPIRED event) drops the profile and explains why', async () => {
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValue(active);
    mount();
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam Staff'));
    await act(async () => { window.dispatchEvent(new Event('supabase:session-expired')); });
    expect(screen.getByTestId('profile')).toHaveTextContent('none');
    expect(screen.getByTestId('blocked')).toHaveTextContent('Your session has expired. Please sign in again.');
  });

  it('tab regaining focus re-validates the account (a deactivation while backgrounded is caught)', async () => {
    auth.state.session = sess;
    profileRepository.getById.mockResolvedValueOnce(active).mockResolvedValue({ ...active, is_active: false });
    mount();
    await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Sam Staff'));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(screen.getByTestId('blocked')).toHaveTextContent(/deactivated/));
  });
});
