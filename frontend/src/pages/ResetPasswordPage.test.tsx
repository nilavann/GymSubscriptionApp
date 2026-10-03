import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ResetPasswordPage } from './ResetPasswordPage';
import { buildAuth } from '../test/auth';
import { renderRoutes } from '../test/render';
import { buildProfile } from '../test/builders';
import type { AuthContextValue } from '../types/auth';

function renderReset(auth: Partial<AuthContextValue> = {}) {
  return renderRoutes(
    [
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/login', element: <p>Login screen</p> },
      { path: '/', element: <p>Members screen</p> },
      { path: '/action-center', element: <p>Action Center screen</p> },
    ],
    { route: '/reset-password', auth }
  );
}

// A genuine recovery session: signed in via the emailed link, flagged as needing a new password.
const recovery = (overrides: Partial<AuthContextValue> = {}) => ({
  currentProfile: buildProfile(),
  needsPasswordReset: true,
  ...overrides,
});

const newPassword = () => screen.getByLabelText('New password');
const confirm = () => screen.getByLabelText('Confirm new password');
const submit = () => screen.getByRole('button', { name: /^Update password$|^Updating…$/ });

describe('ResetPasswordPage — who is allowed to see it', () => {
  it('shows the loading view while the session resolves', () => {
    renderReset({ isInitialising: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('explains a rejected or expired link instead of silently redirecting, and points back to sign-in', () => {
    renderReset({ currentProfile: null, needsPasswordReset: false, authLinkError: 'Email link is invalid or has expired' });
    expect(screen.getByText('Email link is invalid or has expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor who typed the URL to /login', () => {
    renderReset({ currentProfile: null, session: null, needsPasswordReset: false });
    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });

  it('sends a signed-in user who is not in recovery back to the app', () => {
    renderReset({ currentProfile: buildProfile(), needsPasswordReset: false });
    expect(screen.getByText('Members screen')).toBeInTheDocument();
  });

  it('sends a recovery attempt that ended with no session (blocked account) to /login', () => {
    renderReset({ needsPasswordReset: true, currentProfile: null, session: null });
    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });
});

describe('ResetPasswordPage — setting the new password', () => {
  it('keeps Update password disabled until the password is 6+ characters AND confirmed', async () => {
    const { user } = renderReset(recovery());
    expect(submit()).toBeDisabled();

    await user.type(newPassword(), 'abc');
    await user.type(confirm(), 'abc');
    expect(submit()).toBeDisabled(); // matching but too short

    await user.clear(newPassword());
    await user.clear(confirm());
    await user.type(newPassword(), 'secret1');
    await user.type(confirm(), 'secret2');
    expect(submit()).toBeDisabled(); // long enough but not matching

    await user.clear(confirm());
    await user.type(confirm(), 'secret1');
    expect(submit()).toBeEnabled();
  });

  it('hints the browser that these are NEW passwords (so password managers offer to save, not fill)', () => {
    renderReset(recovery());
    expect(newPassword()).toHaveAttribute('autocomplete', 'new-password');
    expect(confirm()).toHaveAttribute('autocomplete', 'new-password');
  });

  it('updates the password and goes to the Action Center', async () => {
    const { user, auth } = renderReset(recovery());
    await user.type(newPassword(), 'secret1');
    await user.type(confirm(), 'secret1');
    await user.click(submit());

    expect(auth.updatePassword).toHaveBeenCalledWith('secret1');
    expect(await screen.findByText('Action Center screen')).toBeInTheDocument();
  });

  it('locks the form while updating', async () => {
    const { user, auth } = renderReset(recovery());
    (auth.updatePassword as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => undefined));
    await user.type(newPassword(), 'secret1');
    await user.type(confirm(), 'secret1');
    await user.click(submit());

    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    expect(newPassword()).toBeDisabled();
    expect(confirm()).toBeDisabled();
  });

  it('a failed update shows a message, keeps the user here and re-enables the form', async () => {
    const { user, auth } = renderReset(recovery());
    (auth.updatePassword as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('weak password'));
    await user.type(newPassword(), 'secret1');
    await user.type(confirm(), 'secret1');
    await user.click(submit());

    expect(await screen.findByText('Could not update your password. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/weak password/)).not.toBeInTheDocument();
    expect(newPassword()).toBeEnabled();
    expect(screen.queryByText('Action Center screen')).not.toBeInTheDocument();
  });
});

describe('buildAuth', () => {
  it('derives the session from the profile, so "no profile" really means signed out', () => {
    expect(buildAuth({ currentProfile: null }).session).toBeNull();
    expect(buildAuth().session).not.toBeNull();
  });
});
