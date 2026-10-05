import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { InviteUserPage } from './InviteUserPage';
import { userService as realUserService } from '../services/user.service';
import { fakeServices } from '../test/fakes';
import { renderRoutes } from '../test/render';
import { buildAdminProfile, buildRole } from '../test/builders';

function renderInvite(options: { invite?: ReturnType<typeof vi.fn>; getAllActive?: ReturnType<typeof vi.fn> } = {}) {
  const {
    invite = vi.fn().mockResolvedValue(undefined),
    getAllActive = vi.fn().mockResolvedValue([buildRole({ id: 1, name: 'admin' }), buildRole({ id: 2, name: 'staff' })]),
  } = options;
  const utils = renderRoutes(
    [
      { path: '/users/invite', element: <InviteUserPage /> },
      { path: '/users', element: <p>Manage Users screen</p> },
    ],
    {
      route: '/users/invite',
      auth: { currentProfile: buildAdminProfile() },
      services: fakeServices({
        roleRepository: { getAllActive },
        userService: { ...realUserService, invite },
      }),
    }
  );
  return { ...utils, invite, getAllActive };
}

const roles = () => within(screen.getByRole('group', { name: 'Roles' }));

describe('InviteUserPage', () => {
  it('offers every available role as a toggle chip', async () => {
    renderInvite();
    expect(await roles().findByRole('button', { name: 'admin' })).toBeInTheDocument();
    expect(roles().getByRole('button', { name: 'staff' })).toBeInTheDocument();
  });

  it('still shows the form when the role list fails to load (just no chips)', async () => {
    renderInvite({ getAllActive: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(screen.getByRole('heading', { name: 'Invite User' })).toBeInTheDocument();
    expect(roles().queryAllByRole('button')).toHaveLength(0);
  });

  it('carries the admin tabs and a back link to Manage Users', () => {
    renderInvite();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage Users' })).toHaveAttribute('href', '/users');
  });

  it('validates on submit: email, name and at least one role, and sends nothing', async () => {
    const { user, invite } = renderInvite();
    await roles().findByRole('button', { name: 'admin' });
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Select at least one role')).toBeInTheDocument();
    expect(invite).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    const { user, invite } = renderInvite();
    await roles().findByRole('button', { name: 'admin' });
    await user.type(screen.getByLabelText(/Email/), 'not-an-email');
    await user.type(screen.getByLabelText(/Name/), 'Ravi Kumar');
    await user.click(roles().getByRole('button', { name: 'staff' }));
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(invite).not.toHaveBeenCalled();
  });

  it('sends the invitation, then returns to Manage Users carrying a confirmation toast', async () => {
    const { user, invite, router } = renderInvite();
    await roles().findByRole('button', { name: 'admin' });
    await user.type(screen.getByLabelText(/Email/), 'ravi@fitandfine.in');
    await user.type(screen.getByLabelText(/Name/), 'Ravi Kumar');
    await user.click(roles().getByRole('button', { name: 'staff' }));
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    expect(invite).toHaveBeenCalledWith({ email: 'ravi@fitandfine.in', full_name: 'Ravi Kumar', roles: ['staff'] });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/users'));
    expect(router.state.location.state).toEqual({ toast: 'Invitation sent to ravi@fitandfine.in' });
  });

  it('selected roles can be toggled off again', async () => {
    const { user } = renderInvite();
    const staff = await roles().findByRole('button', { name: 'staff' });
    await user.click(staff);
    expect(staff).toHaveClass('invite-user-chip-selected');
    await user.click(staff);
    expect(staff).not.toHaveClass('invite-user-chip-selected');
  });

  it.each([
    ['an email that is already registered', new Error('User already registered'), 'This email is already registered.'],
    ['being offline', new Error('Failed to fetch'), "Couldn't send the invite — check your connection and try again."],
    ['anything else', new Error('boom'), 'Something went wrong sending the invite. Please try again.'],
  ])('shows a specific message for %s, stays on the form and keeps the input', async (_label, error, message) => {
    const { user, router } = renderInvite({ invite: vi.fn().mockRejectedValue(error) });
    await roles().findByRole('button', { name: 'admin' });
    await user.type(screen.getByLabelText(/Email/), 'ravi@fitandfine.in');
    await user.type(screen.getByLabelText(/Name/), 'Ravi Kumar');
    await user.click(roles().getByRole('button', { name: 'staff' }));
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/users/invite');
    expect(screen.getByLabelText(/Email/)).toHaveValue('ravi@fitandfine.in');
  });
});
