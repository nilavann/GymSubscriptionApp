import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { adminProfile, fakeAuth, setAuth } from '../test/mocks';

function renderLogin(auth = fakeAuth(null)) {
  setAuth(auth);
  const utils = render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/reset-password" element={<div>RESET PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
  return { auth, ...utils, rerenderWith: (a: ReturnType<typeof fakeAuth>) => { setAuth(a); utils.rerender(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/reset-password" element={<div>RESET PAGE</div>} />
      </Routes>
    </MemoryRouter>); } };
}

const email = () => document.getElementById('email') as HTMLInputElement;
const password = () => document.getElementById('password') as HTMLInputElement;

describe('Login page (REQ-AUTH-001/002/005)', () => {
  beforeEach(() => vi.useRealTimers());

  it('REQ-AUTH-001: sign in is disabled until both email and password are typed', async () => {
    const user = userEvent.setup();
    renderLogin();
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();
    await user.type(email(), 'a@b.co');
    expect(submit).toBeDisabled();
    await user.type(password(), 'secret');
    expect(submit).toBeEnabled();
  });

  it('REQ-AUTH-001: submitting calls signInWithPassword with the typed credentials', async () => {
    const user = userEvent.setup();
    const { auth } = renderLogin();
    await user.type(email(), 'a@b.co');
    await user.type(password(), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith('a@b.co', 'secret');
  });

  it('REQ-AUTH-001: wrong credentials show ONE generic message (no hint whether the email exists) and clear the password', async () => {
    const auth = fakeAuth(null, { signInWithPassword: vi.fn().mockRejectedValue(new Error('Invalid login credentials')) });
    const user = userEvent.setup();
    renderLogin(auth);
    await user.type(email(), 'nobody@b.co');
    await user.type(password(), 'bad');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
    expect(password()).toHaveValue('');
    expect(email()).toHaveValue('nobody@b.co');
    expect(screen.queryByText(/not registered|no account|not found|user does not exist/i)).toBeNull();
  });

  it('a hung sign-in surfaces a timeout message rather than spinning forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const auth = fakeAuth(null, { signInWithPassword: vi.fn().mockReturnValue(new Promise(() => {})) });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderLogin(auth);
    await user.type(email(), 'a@b.co');
    await user.type(password(), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await screen.findByText(/taking longer than expected/i)).toBeInTheDocument();
  });

  it('REQ-AUTH-003: a blocked account (not invited / deactivated) message from AuthContext is displayed on the form', async () => {
    const { rerenderWith } = renderLogin();
    rerenderWith(fakeAuth(null, { blockedMessage: "This email hasn't been invited — contact your admin." }));
    expect(await screen.findByText("This email hasn't been invited — contact your admin.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled(); // fields empty again, not stuck on "Signing in…"
  });

  it('REQ-AUTH-002: "Continue with Google" starts the Google OAuth flow; a failure is reported', async () => {
    const user = userEvent.setup();
    const { auth } = renderLogin();
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith('google');
  });

  it('REQ-AUTH-002: Google start failure shows an error', async () => {
    const auth = fakeAuth(null, { signInWithOAuth: vi.fn().mockRejectedValue(new Error('x')) });
    const user = userEvent.setup();
    renderLogin(auth);
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(await screen.findByText(/Could not start Google sign-in/)).toBeInTheDocument();
  });

  it('REQ-AUTH-005: "Forgot password?" without an email asks for it first', async () => {
    const user = userEvent.setup();
    const { auth } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText(/Enter your email above first/)).toBeInTheDocument();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('REQ-AUTH-005: with an email, requests a reset and shows a generic confirmation', async () => {
    const user = userEvent.setup();
    const { auth } = renderLogin();
    await user.type(email(), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co');
    expect(await screen.findByText(/if .*account.*exists|check your email|reset/i)).toBeInTheDocument();
  });

  it('REQ-AUTH-005: the confirmation is identical whether or not the request errored (no email enumeration)', async () => {
    const ok = fakeAuth(null);
    const failing = fakeAuth(null, { resetPasswordForEmail: vi.fn().mockRejectedValue(new Error('User not found')) });
    const messages: string[] = [];
    for (const auth of [ok, failing]) {
      const user = userEvent.setup();
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      const { unmount } = renderLogin(auth);
      await user.type(email(), 'a@b.co');
      await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
      await waitFor(() => expect(document.querySelector('.login-card')?.textContent).toMatch(/reset|sent|email/i));
      messages.push((document.querySelector('.login-card') as HTMLElement).textContent!.replace(/\s+/g, ' '));
      process.off('unhandledRejection', unhandled);
      unmount();
    }
    expect(messages[0]).toBe(messages[1]);
  });

  it('shows password-link errors (expired/used reset link) on the login form', () => {
    renderLogin(fakeAuth(null, { authLinkError: 'Email link is invalid or has expired' }));
    expect(screen.getByText('Email link is invalid or has expired')).toBeInTheDocument();
  });

  it('an already signed-in active user is redirected away from /login', () => {
    renderLogin(fakeAuth(adminProfile));
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('a password-recovery session goes to the reset page even if signed in', () => {
    renderLogin(fakeAuth(adminProfile, { needsPasswordReset: true }));
    expect(screen.getByText('RESET PAGE')).toBeInTheDocument();
  });

  it('show/hide password toggle', async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(password()).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password()).toHaveAttribute('type', 'text');
  });
});
