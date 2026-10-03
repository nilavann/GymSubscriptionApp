import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { allowConsoleError } from '../test/console';
import { fakeServices } from '../test/fakes';
import { buildProfile } from '../test/builders';

// The provider reads the REAL supabase client for the session and auth events (everything else — the profile
// lookup and sign-out — comes through useServices(), so those are plain fakes).
const supabaseAuth = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('../lib/supabase-client', () => ({
  supabase: { auth: supabaseAuth },
  SESSION_EXPIRED_EVENT: 'supabase:session-expired',
}));

import { AuthProvider, useAuth } from './auth.context';
import { ServicesProvider } from './services.context';

const SESSION = { user: { id: 'u1', email: 'priya@fitandfine.in' } } as unknown as Session;
const ACTIVE = buildProfile({ id: 'u1', full_name: 'Priya Sharma', is_active: true });

let emit: (event: AuthChangeEvent, session: Session | null) => void;
const unsubscribe = vi.fn();

function setup(options: { getById?: ReturnType<typeof vi.fn>; session?: Session | null } = {}) {
  const { getById = vi.fn().mockResolvedValue(ACTIVE), session = SESSION } = options;
  const authService = {
    signOut: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    signInWithPassword: vi.fn().mockResolvedValue(undefined),
    signInWithOAuth: vi.fn().mockResolvedValue(undefined),
    resetPasswordForEmail: vi.fn().mockResolvedValue(undefined),
  };
  supabaseAuth.getSession.mockResolvedValue({ data: { session } });
  supabaseAuth.onAuthStateChange.mockImplementation((callback: typeof emit) => {
    emit = callback;
    return { data: { subscription: { unsubscribe } } };
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={fakeServices({ authService, profileRepository: { getById } })}>
      <AuthProvider>{children}</AuthProvider>
    </ServicesProvider>
  );
  const utils = renderHook(() => useAuth(), { wrapper });
  return { ...utils, authService, getById };
}

beforeEach(() => {
  supabaseAuth.getSession.mockReset();
  supabaseAuth.onAuthStateChange.mockReset();
  unsubscribe.mockReset();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
});

/** NOTE: with fake timers, use `vi.waitFor` (it advances them) — RTL's `waitFor` drains with a setTimeout(0) that the fake
 *  clock freezes, so it hangs. The 500ms profile-retry timer is only CREATED after getSession() and the first lookup have settled, so
 *  flush those microtasks first — advancing the clock before the timer exists would advance nothing. */
async function waitOutProfileRetry() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
  });
}

describe('AuthProvider — resolving the session on load', () => {
  it('is initialising until the session check finishes, then signed out when there is none', async () => {
    const { result } = setup({ session: null });
    expect(result.current.isInitialising).toBe(true);
    await waitFor(() => expect(result.current.isInitialising).toBe(false));
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it('signs in a session whose profile is active, clearing any earlier block', async () => {
    const { result, getById } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));
    expect(result.current.session).toBe(SESSION);
    expect(result.current.isInitialising).toBe(false);
    expect(result.current.blockedMessage).toBeNull();
    expect(getById).toHaveBeenCalledWith('u1');
  });

  it('absorbs the invite race: retries ONCE after a short wait when the profile row does not exist yet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const getById = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ACTIVE);
    const { result } = setup({ getById });

    await waitOutProfileRetry();
    await vi.waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE)); // vi.waitFor, not RTL's: see waitOutProfileRetry
    expect(getById).toHaveBeenCalledTimes(2);
    expect(result.current.blockedMessage).toBeNull();
  });
});

describe('AuthProvider — accounts that must never keep a session', () => {
  it('a user who was never invited (still no profile after the retry) is blocked AND signed out of Supabase', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result, authService } = setup({ getById: vi.fn().mockResolvedValue(null) });

    await waitOutProfileRetry();
    await vi.waitFor(() => expect(result.current.blockedMessage).toBe("This email hasn't been invited — contact your admin."));
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.session).toBeNull();
    expect(authService.signOut).toHaveBeenCalledTimes(1);
  });

  it('a deactivated user is blocked with its own message and signed out', async () => {
    const { result, authService } = setup({ getById: vi.fn().mockResolvedValue({ ...ACTIVE, is_active: false }) });
    await waitFor(() => expect(result.current.blockedMessage).toBe('Your account has been deactivated. Contact an admin.'));
    expect(result.current.currentProfile).toBeNull();
    expect(authService.signOut).toHaveBeenCalledTimes(1);
  });

  it('a profile LOOKUP FAILURE withholds access but does NOT sign the user out (it is not the account’s fault)', async () => {
    const { result, authService } = setup({ getById: vi.fn().mockRejectedValue(new Error('Failed to fetch')) });
    await waitFor(() =>
      expect(result.current.blockedMessage).toBe("Couldn't verify your account — check your connection and try again.")
    );
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.isInitialising).toBe(false);
    expect(authService.signOut).not.toHaveBeenCalled();
  });

  it('never lets a slow, stale lookup undo a newer sign-out', async () => {
    let resolveSlow!: (profile: typeof ACTIVE) => void;
    const getById = vi.fn().mockReturnValue(new Promise((resolve) => (resolveSlow = resolve)));
    const { result } = setup({ getById });
    await waitFor(() => expect(getById).toHaveBeenCalled());

    act(() => emit('SIGNED_OUT', null)); // the user signs out while the first lookup is still in flight
    await waitFor(() => expect(result.current.isInitialising).toBe(false));

    await act(async () => resolveSlow(ACTIVE)); // …then the stale lookup finally returns
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.session).toBeNull();
  });
});

describe('AuthProvider — auth events', () => {
  it('a new session arriving later signs the user in', async () => {
    const { result } = setup({ session: null });
    await waitFor(() => expect(result.current.isInitialising).toBe(false));

    await act(async () => emit('SIGNED_IN', SESSION));
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));
  });

  it('PASSWORD_RECOVERY flags that a new password is required, until updatePassword succeeds', async () => {
    const { result, authService } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));

    await act(async () => emit('PASSWORD_RECOVERY', SESSION));
    expect(result.current.needsPasswordReset).toBe(true);

    await act(() => result.current.updatePassword('new-secret'));
    expect(authService.updatePassword).toHaveBeenCalledWith('new-secret');
    expect(result.current.needsPasswordReset).toBe(false);
  });

  it('a failed updatePassword keeps the flag set (the user must still set one)', async () => {
    const { result, authService } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));
    await act(async () => emit('PASSWORD_RECOVERY', SESSION));
    authService.updatePassword.mockRejectedValue(new Error('weak'));

    await expect(act(() => result.current.updatePassword('x'))).rejects.toThrow('weak');
    expect(result.current.needsPasswordReset).toBe(true);
  });

  it('signing out clears a stale recovery flag so it can never block a later ordinary sign-in', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));
    await act(async () => emit('PASSWORD_RECOVERY', SESSION));
    expect(result.current.needsPasswordReset).toBe(true);

    await act(async () => emit('SIGNED_OUT', null));
    expect(result.current.needsPasswordReset).toBe(false);
  });

  it('re-checks the session when the tab becomes visible again (a token revoked or account deactivated while backgrounded)', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));
    expect(supabaseAuth.getSession).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(supabaseAuth.getSession).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(supabaseAuth.getSession).toHaveBeenCalledTimes(2);
  });
});

describe('AuthProvider — a mid-session 401', () => {
  it('signs the user out locally, explains why, and flags the signed-out screen', async () => {
    const { result, authService } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));

    act(() => {
      window.dispatchEvent(new Event('supabase:session-expired'));
    });

    expect(result.current.currentProfile).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.sessionExpired).toBe(true);
    expect(result.current.blockedMessage).toBe('Your session has expired. Please sign in again.');
    expect(authService.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not surface a failing best-effort sign-out cleanup', async () => {
    const { result, authService } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));
    authService.signOut.mockRejectedValue(new Error('already invalid'));

    expect(() =>
      act(() => {
        window.dispatchEvent(new Event('supabase:session-expired'));
      })
    ).not.toThrow();
    expect(result.current.sessionExpired).toBe(true);
  });

  it('clearSessionExpired dismisses the flag', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.currentProfile).toEqual(ACTIVE));
    act(() => {
      window.dispatchEvent(new Event('supabase:session-expired'));
    });
    act(() => result.current.clearSessionExpired());
    expect(result.current.sessionExpired).toBe(false);
  });
});

describe('AuthProvider — a rejected link (expired reset / invite / OAuth)', () => {
  it('surfaces the link’s error description and tidies it out of the address bar', async () => {
    window.history.replaceState(null, '', '/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    const { result } = setup({ session: null });

    await waitFor(() => expect(result.current.authLinkError).toBe('Email link is invalid or has expired'));
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/reset-password');
  });

  it('also reads the error from the query string', async () => {
    window.history.replaceState(null, '', '/login?error_description=Invite+expired');
    const { result } = setup({ session: null });
    await waitFor(() => expect(result.current.authLinkError).toBe('Invite expired'));
  });

  it('has no link error on a normal load', async () => {
    const { result } = setup({ session: null });
    await waitFor(() => expect(result.current.isInitialising).toBe(false));
    expect(result.current.authLinkError).toBeNull();
  });
});

describe('AuthProvider — wiring', () => {
  it('exposes the auth service actions', async () => {
    const { result, authService } = setup({ session: null });
    await waitFor(() => expect(result.current.isInitialising).toBe(false));
    await result.current.signInWithPassword('a@b.co', 'pw');
    await result.current.signOut();
    expect(authService.signInWithPassword).toHaveBeenCalledWith('a@b.co', 'pw');
    expect(authService.signOut).toHaveBeenCalledTimes(1);
  });

  it('cleans up its listeners on unmount', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const { unmount, result } = setup({ session: null });
    await waitFor(() => expect(result.current.isInitialising).toBe(false));

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(docRemove.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true);
    expect(add.mock.calls.some(([type]) => type === 'supabase:session-expired')).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === 'supabase:session-expired')).toBe(true);
  });

  it('useAuth outside the provider throws a clear error', () => {
    allowConsoleError(/useAuth must be used inside AuthProvider/, /The above error occurred/);
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used inside AuthProvider');
  });
});
