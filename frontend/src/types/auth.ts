import type { Session } from '@supabase/supabase-js';
import type { Profile } from './profile';

/** See spec/frontend/auth.md §3.1. */
export interface AuthContextValue {
  currentProfile: Profile | null;
  session: Session | null;
  isInitialising: boolean;
  /** Set once, briefly, on a blocked sign-in attempt (deactivated / not invited) so the Login page can render it. */
  blockedMessage: string | null;
  /**
   * True only for the specific "a live session went stale mid-use" path (a 401 from
   * authAwareFetch, lib/supabase-client.ts) - distinct from every other blockedMessage cause
   * (deactivated, not invited, verify error), which are all about a sign-in attempt itself,
   * not an already-authenticated session going bad. Login page uses this (not blockedMessage)
   * to decide whether to show the dedicated "You're signed out" screen (v2 -
   * design_handoff_flexhub_v2/README.md §1) instead of the plain error banner. Never set by a
   * manual Settings sign-out - that calls signOut() directly, not through this path.
   */
  sessionExpired: boolean;
  /** Login page calls this once it's done showing the signed-out screen, so a later re-render (or a subsequent unrelated blockedMessage) doesn't show it again. */
  clearSessionExpired(): void;
  /** Set once, on initial load, if the URL carries a Supabase Auth redirect error (e.g. an
   *  expired or already-used password-reset link: `#error=...&error_description=...`).
   *  Supabase attaches this instead of a session when the link itself failed server-side -
   *  distinct from blockedMessage, which is about a valid session belonging to a blocked
   *  account. See auth.context.tsx. */
  authLinkError: string | null;
  /** True from the moment Supabase's PASSWORD_RECOVERY auth event fires (recovery-link click)
   *  until updatePassword() succeeds. Gates access to every other route via RequireAuth, so a
   *  recovery session can only be used to set a new password, never to skip straight into the app. */
  needsPasswordReset: boolean;
  signInWithPassword(email: string, password: string): Promise<void>;
  signInWithOAuth(provider: 'google'): Promise<void>;
  resetPasswordForEmail(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  signOut(): Promise<void>;
}
