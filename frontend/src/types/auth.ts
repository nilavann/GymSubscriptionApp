import type { Session } from '@supabase/supabase-js';
import type { Profile } from './profile';

/** See spec/frontend/auth.md §3.1. */
export interface AuthContextValue {
  currentProfile: Profile | null;
  session: Session | null;
  isInitialising: boolean;
  /** Set once, briefly, on a blocked sign-in attempt (deactivated / not invited) so the Login page can render it. */
  blockedMessage: string | null;
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
