import { supabase } from '../lib/supabase-client';

/** Thin wrapper over supabase.auth.* — see spec/backend/auth.md §4. No Edge Function involved. */
export const authService = {
  async signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  async signInWithOAuth(provider: 'google') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  },

  async resetPasswordForEmail(email: string) {
    // Deliberately the bare origin, not `${origin}/reset-password` - Supabase Auth validates
    // `redirectTo` server-side against Authentication -> URL Configuration -> Redirect URLs,
    // an *exact* match unless a wildcard is configured there. The bare origin is virtually
    // guaranteed to already be allow-listed (Google OAuth above needs it too); a specific
    // sub-path easily isn't, and when Supabase rejects a redirectTo it doesn't ever attach the
    // recovery token - it silently falls back to the project's Site URL instead, which is
    // exactly "redirected to the app, reset page never appears." AuthContext's global
    // PASSWORD_RECOVERY listener doesn't care which page the tokens land on (see auth.context.tsx),
    // so routing to /reset-password from there instead of via this URL works regardless of
    // which allow-listed page Supabase actually redirects to.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  },

  async updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  async signOut() {
    await supabase.auth.signOut();
  },
};

export type AuthService = typeof authService;
