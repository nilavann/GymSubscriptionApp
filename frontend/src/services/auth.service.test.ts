import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../lib/supabase-client', () => ({ supabase: { auth } }));

import { authService } from './auth.service';

beforeEach(() => {
  Object.values(auth).forEach((mock) => mock.mockReset());
});

describe('authService', () => {
  it('signs in with email and password', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await authService.signInWithPassword('a@b.co', 'secret');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret' });
  });

  it('throws the Supabase error on a failed sign-in so the login screen can show it', async () => {
    const failure = new Error('Invalid login credentials');
    auth.signInWithPassword.mockResolvedValue({ error: failure });
    await expect(authService.signInWithPassword('a@b.co', 'bad')).rejects.toBe(failure);
  });

  it('starts Google OAuth redirecting back to the site root', async () => {
    auth.signInWithOAuth.mockResolvedValue({ error: null });
    await authService.signInWithOAuth('google');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  });

  it('sends the password reset link to the BARE origin, not /reset-password', async () => {
    // A sub-path is rejected by Supabase unless allow-listed, silently dropping the recovery token
    // (see the comment in auth.service.ts) — pinning this stops a well-meaning "fix".
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await authService.resetPasswordForEmail('a@b.co');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: window.location.origin });
  });

  it('updates the password and surfaces errors', async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    await authService.updatePassword('new-secret');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-secret' });

    const failure = new Error('weak password');
    auth.updateUser.mockResolvedValue({ error: failure });
    await expect(authService.updatePassword('x')).rejects.toBe(failure);
  });

  it('signs out without throwing even if Supabase reports nothing back', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await expect(authService.signOut()).resolves.toBeUndefined();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
