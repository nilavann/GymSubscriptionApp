import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { InviteUserPage } from './InviteUserPage';
import { userService as realUserService } from '../services/user.service';
import { adminProfile, fakeAuth, setAuth, setServices } from '../test/mocks';

let invite: ReturnType<typeof vi.fn>;
function renderPage() {
  invite = vi.fn().mockResolvedValue(undefined);
  setAuth(fakeAuth(adminProfile));
  setServices({
    userService: { ...realUserService, invite } as never,
    roleRepository: { getAllActive: vi.fn().mockResolvedValue([{ id: 1, name: 'admin' }, { id: 2, name: 'staff' }]) } as never,
  });
  return render(
    <MemoryRouter initialEntries={['/users/invite']}>
      <Routes>
        <Route path="/users/invite" element={<InviteUserPage />} />
        <Route path="/users" element={<div>USERS LIST</div>} />
      </Routes>
    </MemoryRouter>
  );
}
const el = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('Invite user (REQ-ADMIN-004 -> invite-user flow)', () => {
  beforeEach(() => vi.useRealTimers());

  it('requires email, name and a role', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Send Invitation' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Select at least one role')).toBeInTheDocument();
    expect(invite).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(el('invite-email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('sends the invite with the chosen role(s) and returns to Manage Users', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(el('invite-email'), 'new@gym.test');
    await user.type(el('invite-full-name'), 'New Coach');
    await user.click(await within(screen.getByRole('group', { name: 'Roles' })).findByRole('button', { name: 'staff' }));
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ email: 'new@gym.test', full_name: 'New Coach', roles: ['staff'] }));
    expect(await screen.findByText('USERS LIST')).toBeInTheDocument();
  });

  it('an email that already has an account shows a specific message', async () => {
    const user = userEvent.setup();
    renderPage();
    invite.mockRejectedValue(new Error('This email is already registered.'));
    await user.type(el('invite-email'), 'dup@gym.test');
    await user.type(el('invite-full-name'), 'Dup Person');
    await user.click(await within(screen.getByRole('group', { name: 'Roles' })).findByRole('button', { name: 'staff' }));
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(await screen.findByText('This email is already registered.')).toBeInTheDocument();
  });

  it('shows a connectivity message on network failure and keeps the form', async () => {
    const user = userEvent.setup();
    renderPage();
    invite.mockRejectedValue(new Error('Failed to fetch'));
    await user.type(el('invite-email'), 'a@gym.test');
    await user.type(el('invite-full-name'), 'Ann Person');
    await user.click(await within(screen.getByRole('group', { name: 'Roles' })).findByRole('button', { name: 'admin' }));
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(await screen.findByText(/check your connection/)).toBeInTheDocument();
    expect(el('invite-email')).toHaveValue('a@gym.test');
  });
});
