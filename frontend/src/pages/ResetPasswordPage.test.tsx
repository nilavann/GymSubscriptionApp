import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResetPasswordPage } from './ResetPasswordPage';
import { adminProfile, fakeAuth, setAuth } from '../test/mocks';

const session = { user: { id: 'u1' } } as never;

function renderPage(auth: ReturnType<typeof fakeAuth>) {
  setAuth(auth);
  return render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  );
}
const pw = () => document.getElementById('new-password') as HTMLInputElement;
const confirm = () => document.getElementById('confirm-password') as HTMLInputElement;

describe('Reset password page (REQ-AUTH-005)', () => {
  beforeEach(() => vi.useRealTimers());
  const recovery = () => fakeAuth(adminProfile, { needsPasswordReset: true, session });

  it('reached directly without a recovery session -> sent away (login when signed out)', () => {
    renderPage(fakeAuth(null));
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });

  it('signed-in user without recovery session is sent home', () => {
    renderPage(fakeAuth(adminProfile, { session }));
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('an expired/used link shows the error instead of silently redirecting', () => {
    renderPage(fakeAuth(null, { authLinkError: 'Email link is invalid or has expired' }));
    expect(screen.getByText('Email link is invalid or has expired')).toBeInTheDocument();
  });

  it('submit is disabled for passwords shorter than 6 chars or mismatched', async () => {
    const user = userEvent.setup();
    renderPage(recovery());
    const submit = screen.getByRole('button', { name: /update|set|save|reset/i });
    await user.type(pw(), '12345');
    await user.type(confirm(), '12345');
    expect(submit).toBeDisabled();
    await user.type(pw(), '6');
    expect(submit).toBeDisabled(); // confirm still 12345
    await user.type(confirm(), '6');
    expect(submit).toBeEnabled();
  });

  it('a valid new password is set and the user lands in the app', async () => {
    const auth = recovery();
    const user = userEvent.setup();
    renderPage(auth);
    await user.type(pw(), 'brand-new-pass');
    await user.type(confirm(), 'brand-new-pass');
    await user.click(screen.getByRole('button', { name: /update|set|save|reset/i }));
    expect(auth.updatePassword).toHaveBeenCalledWith('brand-new-pass');
    expect(await screen.findByText('HOME')).toBeInTheDocument();
  });

  it('a failing update keeps the form and reports the failure', async () => {
    const auth = fakeAuth(adminProfile, { needsPasswordReset: true, session, updatePassword: vi.fn().mockRejectedValue(new Error('weak')) });
    const user = userEvent.setup();
    renderPage(auth);
    await user.type(pw(), 'brand-new-pass');
    await user.type(confirm(), 'brand-new-pass');
    await user.click(screen.getByRole('button', { name: /update|set|save|reset/i }));
    expect(await screen.findByText(/Could not update your password/)).toBeInTheDocument();
  });
});
