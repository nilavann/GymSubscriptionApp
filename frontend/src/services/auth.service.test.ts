import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(), signInWithOAuth: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(),
}));
vi.mock('../lib/supabase-client', () => ({ supabase: { auth } }));
import { authService } from './auth.service';

beforeEach(() => Object.values(auth).forEach((f) => f.mockReset().mockResolvedValue({ error: null })));

describe('authService', () => {
  it('REQ-AUTH-001: password sign-in passes the credentials through', async () => {
    await authService.signInWithPassword('a@b.co', 'pw');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' });
  });
  it('REQ-AUTH-001: a Supabase error is thrown to the caller', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') });
    await expect(authService.signInWithPassword('a@b.co', 'x')).rejects.toThrow('Invalid login credentials');
  });
  it('REQ-AUTH-002: Google OAuth redirects back to the app origin (not a sub-path that may not be allow-listed)', async () => {
    await authService.signInWithOAuth('google');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: window.location.origin } });
  });
  it('REQ-AUTH-005: reset email uses the bare origin as redirectTo', async () => {
    await authService.resetPasswordForEmail('a@b.co');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: window.location.origin });
  });
  it('REQ-AUTH-005: updatePassword calls updateUser', async () => {
    await authService.updatePassword('new');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new' });
  });
  it('updatePassword surfaces errors', async () => {
    auth.updateUser.mockResolvedValue({ error: new Error('weak') });
    await expect(authService.updatePassword('x')).rejects.toThrow('weak');
  });
  it('signOut calls Supabase', async () => {
    await authService.signOut();
    expect(auth.signOut).toHaveBeenCalled();
  });
});
