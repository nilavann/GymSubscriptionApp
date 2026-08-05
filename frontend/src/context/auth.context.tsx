import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, SESSION_EXPIRED_EVENT } from '../lib/supabase-client';
import { useServices } from './services.context';
import { withTimeout } from '../lib/with-timeout';
import type { AuthContextValue } from '../types/auth';
import type { Profile } from '../types/profile';

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_INVITED_MESSAGE = "This email hasn't been invited — contact your admin.";
const DEACTIVATED_MESSAGE = 'Your account has been deactivated. Contact an admin.';
const VERIFY_ERROR_MESSAGE = "Couldn't verify your account — check your connection and try again.";
const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

// The profiles row is created by a database trigger a moment after auth.users
// gets its row (invite-user flow / Google's first-ever sign-in). One short
// retry absorbs that race instead of misreporting a brand-new, valid account
// as "not invited".
const PROFILE_RETRY_DELAY_MS = 500;

// Bounds how long a profile lookup can hang (bad network, backend outage) so
// resolveSession always reaches a conclusion instead of leaving isInitialising
// / the login form stuck indefinitely.
const PROFILE_FETCH_TIMEOUT_MS = 10000;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { authService, profileRepository } = useServices();
  const [session, setSession] = useState<Session | null>(null);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [isInitialising, setIsInitialising] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);
  const [authLinkError, setAuthLinkError] = useState<string | null>(null);

  // Bumped on every resolveSession call so a slow/stale lookup can't clobber
  // state after a newer one has already resolved (e.g. rapid sign-out/in).
  const requestIdRef = useRef(0);

  // A password-reset (or invite/OAuth) link that's expired, already used, or otherwise
  // rejected server-side redirects back here with an error attached instead of a session -
  // e.g. `#error=access_denied&error_code=otp_expired&error_description=...` - rather than
  // silently landing on the app with nothing to show for it. Checked once on mount, before
  // supabase-js's own detectSessionInUrl consumes/clears the hash for the success case.
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const description = hashParams.get('error_description') ?? searchParams.get('error_description');
    if (description) {
      // URLSearchParams already decodes both %XX escapes and `+` as space.
      setAuthLinkError(description);
      // Drop the error params from the visible URL so a refresh/share of the link doesn't
      // re-show a stale error and the address bar doesn't linger with auth internals in it.
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    async function resolveSession(nextSession: Session | null) {
      const requestId = ++requestIdRef.current;

      if (!nextSession) {
        setSession(null);
        setCurrentProfile(null);
        setIsInitialising(false);
        return;
      }

      let profile: Profile | null = null;
      let fetchFailed = false;
      try {
        profile = await withTimeout(
          profileRepository.getById(nextSession.user.id),
          PROFILE_FETCH_TIMEOUT_MS,
          new Error('profile-fetch-timeout')
        );
        if (!profile) {
          await wait(PROFILE_RETRY_DELAY_MS);
          profile = await withTimeout(
            profileRepository.getById(nextSession.user.id),
            PROFILE_FETCH_TIMEOUT_MS,
            new Error('profile-fetch-timeout')
          );
        }
      } catch {
        // A real failure (network blip, timeout, backend/RLS error) — NOT the
        // same thing as "no profiles row exists". Handled separately below so
        // it isn't misreported as "not invited".
        fetchFailed = true;
      }

      if (requestId !== requestIdRef.current) return; // superseded by a newer resolution

      if (profile?.is_active) {
        setBlockedMessage(null);
        setSession(nextSession);
        setCurrentProfile(profile);
        setIsInitialising(false);
        return;
      }

      if (fetchFailed) {
        // We couldn't determine the account's status at all — don't force a
        // sign-out over a transient error we can't attribute to the account;
        // just withhold access for now and let the next auth event or focus
        // revalidation (see the visibilitychange listener below) retry.
        setBlockedMessage(VERIFY_ERROR_MESSAGE);
        setCurrentProfile(null);
        setIsInitialising(false);
        return;
      }

      // Either no profiles row at all (never invited, or the invite trigger's
      // one retry above still lost the race) or one that's been deactivated —
      // either way, the Supabase Auth session must never be allowed to persist.
      setBlockedMessage(profile ? DEACTIVATED_MESSAGE : NOT_INVITED_MESSAGE);
      setSession(null);
      setCurrentProfile(null);
      setIsInitialising(false);
      await authService.signOut();
    }

    supabase.auth.getSession().then(({ data }) => resolveSession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Fired when the user lands here via a password-reset email link (before any
      // password has actually been changed) - see ResetPasswordPage. Cleared again once
      // updatePassword() succeeds, or the session goes away for any other reason, so a
      // stale flag from an earlier recovery attempt can never stick around and block a
      // later, ordinary sign-in.
      if (event === 'PASSWORD_RECOVERY') {
        setNeedsPasswordReset(true);
      }
      if (event === 'SIGNED_OUT' || !nextSession) {
        setNeedsPasswordReset(false);
      }
      resolveSession(nextSession);
    });

    // supabase-js keeps the access token silently refreshed in the background
    // (autoRefreshToken, on by default) — that's the proactive half of "don't
    // expire". This is the reactive half: when the tab regains focus, re-check
    // with Supabase rather than trusting in-memory state, so a refresh token
    // that expired/was revoked, or an account deactivated, while the tab was
    // backgrounded gets caught on return instead of silently staying "signed in".
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      supabase.auth.getSession().then(({ data }) => resolveSession(data.session));
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      listener.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authService, profileRepository]);

  // A 401 on any REST/RPC/Storage/Edge-Function call (authAwareFetch, lib/supabase-client.ts)
  // means the access token itself is dead — mid-session, not just "not signed in yet". Clearing
  // currentProfile here makes RequireAuth redirect to /login (same mechanism as the deactivated/
  // not-invited cases above), and blockedMessage carries the reason there instead of whatever
  // page was open showing a raw/generic fetch failure. signOut() is best-effort local cleanup —
  // the server-side session is already invalid either way.
  useEffect(() => {
    function handleSessionExpired() {
      setSession(null);
      setCurrentProfile(null);
      setBlockedMessage(SESSION_EXPIRED_MESSAGE);
      authService.signOut().catch(() => {});
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [authService]);

  async function updatePassword(newPassword: string) {
    await authService.updatePassword(newPassword);
    setNeedsPasswordReset(false);
  }

  const value: AuthContextValue = {
    currentProfile,
    session,
    isInitialising,
    blockedMessage,
    authLinkError,
    needsPasswordReset,
    signInWithPassword: authService.signInWithPassword,
    signInWithOAuth: authService.signInWithOAuth,
    resetPasswordForEmail: authService.resetPasswordForEmail,
    updatePassword,
    signOut: authService.signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
