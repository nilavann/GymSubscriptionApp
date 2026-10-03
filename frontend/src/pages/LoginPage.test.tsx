import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
import { renderRoutes } from '../test/render';
import { buildProfile } from '../test/builders';
import type { AuthContextValue } from '../types/auth';

function renderLogin(auth: Partial<AuthContextValue> = {}) {
  return renderRoutes(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/action-center', element: <p>Action Center screen</p> },
      { path: '/reset-password', element: <p>Reset password screen</p> },
    ],
    { route: '/login', auth: { currentProfile: null, ...auth } }
  );
}

const email = () => screen.getByLabelText('Email');
const password = () => screen.getByLabelText('Password', { exact: true });
const signIn = () => screen.getByRole('button', { name: /^Sign in$|^Signing in…$/ });

afterEach(() => {
  vi.useRealTimers();
});

describe('LoginPage — routing around it', () => {
  it('shows the loading view, not the form, while the session resolves', () => {
    renderLogin({ isInitialising: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('sends an already-signed-in user straight to the Action Center', () => {
    renderLogin({ currentProfile: buildProfile() });
    expect(screen.getByText('Action Center screen')).toBeInTheDocument();
  });

  it('sends a password-recovery session to /reset-password — even if the profile is valid', () => {
    renderLogin({ currentProfile: buildProfile(), needsPasswordReset: true });
    expect(screen.getByText('Reset password screen')).toBeInTheDocument();
  });
});

describe('LoginPage — the form', () => {
  it('presents the brand and the two fields, with Sign in disabled until both are filled', async () => {
    const { user } = renderLogin();
    expect(screen.getByRole('heading', { name: 'Welcome to Fit & Fine' })).toBeInTheDocument();
    expect(signIn()).toBeDisabled();

    await user.type(email(), 'priya@fitandfine.in');
    expect(signIn()).toBeDisabled();
    await user.type(password(), 'secret');
    expect(signIn()).toBeEnabled();
  });

  it('uses the right input types and autocomplete hints (so password managers and phone keyboards work)', () => {
    renderLogin();
    expect(email()).toHaveAttribute('type', 'email');
    expect(email()).toHaveAttribute('autocomplete', 'email');
    expect(password()).toHaveAttribute('type', 'password');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
  });

  it('can reveal and re-hide the password', async () => {
    const { user } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password()).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password()).toHaveAttribute('type', 'password');
  });

  it('signs in with the typed email and password and locks the form while it works', async () => {
    const { user, auth } = renderLogin();
    (auth.signInWithPassword as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => undefined));
    await user.type(email(), 'priya@fitandfine.in');
    await user.type(password(), 'secret');
    await user.click(signIn());

    expect(auth.signInWithPassword).toHaveBeenCalledWith('priya@fitandfine.in', 'secret');
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(email()).toBeDisabled();
    expect(password()).toBeDisabled();
  });

  it('a wrong password shows a generic message (never confirming the email exists), clears the password and re-enables the form', async () => {
    const { user, auth } = renderLogin();
    (auth.signInWithPassword as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Invalid login credentials'));
    await user.type(email(), 'priya@fitandfine.in');
    await user.type(password(), 'wrong');
    await user.click(signIn());

    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
    expect(password()).toHaveValue('');
    expect(email()).toHaveValue('priya@fitandfine.in');
    expect(email()).toBeEnabled();
  });

  it('times out a hung sign-in after 15s with its own message', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { auth } = renderLogin();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    (auth.signInWithPassword as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => undefined));
    await user.type(email(), 'priya@fitandfine.in');
    await user.type(password(), 'secret');
    await user.click(signIn());

    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(await screen.findByText('This is taking longer than expected. Check your connection and try again.')).toBeInTheDocument();
  });
});

describe('LoginPage — Google and password reset', () => {
  it('Continue with Google starts the OAuth flow', async () => {
    const { user, auth } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith('google');
  });

  it('says so when Google sign-in cannot start', async () => {
    const { user, auth } = renderLogin();
    (auth.signInWithOAuth as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('popup blocked'));
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Could not start Google sign-in. Please try again.')).toBeInTheDocument();
  });

  it('Forgot password needs an email first', async () => {
    const { user, auth } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText('Enter your email above first, then click "Forgot password?".')).toBeInTheDocument();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('Forgot password sends the link and confirms WITHOUT revealing whether the email exists', async () => {
    const { user, auth } = renderLogin();
    await user.type(email(), 'nobody@fitandfine.in');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('nobody@fitandfine.in');
    expect(await screen.findByText('If that email is registered, a reset link has been sent.')).toBeInTheDocument();
  });

  it('gives the same confirmation even if sending fails (no enumeration via errors)', async () => {
    const { user, auth } = renderLogin();
    (auth.resetPasswordForEmail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('smtp'));
    await user.type(email(), 'x@fitandfine.in');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(await screen.findByText('If that email is registered, a reset link has been sent.')).toBeInTheDocument();
  });
});

describe('LoginPage — messages handed over by the auth layer', () => {
  it('shows a blocked-account message (deactivated / not invited) as an error', () => {
    renderLogin({ blockedMessage: 'Your account has been deactivated. Contact an admin.' });
    expect(screen.getByText('Your account has been deactivated. Contact an admin.')).toBeInTheDocument();
  });

  it('shows a rejected auth link (e.g. an expired reset link)', () => {
    renderLogin({ authLinkError: 'Email link is invalid or has expired' });
    expect(screen.getByText('Email link is invalid or has expired')).toBeInTheDocument();
  });
});

describe('LoginPage — the signed-out screen after a mid-session expiry', () => {
  it('replaces the form with a reassuring screen — not an error banner on top of it', () => {
    renderLogin({ sessionExpired: true, blockedMessage: 'Your session has expired. Please sign in again.' });
    expect(screen.getByRole('heading', { name: "You're signed out" })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByText('Your session has expired. Please sign in again.')).not.toBeInTheDocument();
  });

  it('"Sign in again" dismisses it immediately', async () => {
    const { user, auth } = renderLogin({ sessionExpired: true });
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(auth.clearSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('dismisses itself after 2.5 seconds', async () => {
    vi.useFakeTimers();
    const { auth } = renderLogin({ sessionExpired: true });
    expect(auth.clearSessionExpired).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(auth.clearSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('cancels that timer if the screen goes away first', async () => {
    vi.useFakeTimers();
    const { auth, unmount } = renderLogin({ sessionExpired: true });
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(auth.clearSessionExpired).not.toHaveBeenCalled();
  });
});
