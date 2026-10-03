import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ManageUsersPage } from './ManageUsersPage';
import { userService as realUserService } from '../services/user.service';
import { adminProfile, fakeAuth, setAuth, setServices } from '../test/mocks';
import type { ManagedUser } from '../types/profile';

const u = (o: Partial<ManagedUser>): ManagedUser => ({ id: 'x', full_name: 'X', email: 'x@gym.test', roles: ['staff'], is_active: true, deleted_at: null, ...o });
const me = u({ id: adminProfile.id, full_name: 'Ada Admin', email: 'ada@gym.test', roles: ['admin'] });
const sam = u({ id: 'staff-1', full_name: 'Sam Staff', email: 'sam@gym.test' });
const ina = u({ id: 'staff-2', full_name: 'Ina Inactive', email: 'ina@gym.test', is_active: false });
const dan = u({ id: 'staff-3', full_name: 'Dan Deleted', email: 'dan@gym.test', deleted_at: '2026-07-01T00:00:00Z' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let userService: any;

function renderPage(list: ManagedUser[] = [me, sam, ina]) {
  userService = {
    ...realUserService,
    getAll: vi.fn().mockImplementation(async (includeDeleted?: boolean) => (includeDeleted ? [...list, dan] : list)),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
  };
  setAuth(fakeAuth(adminProfile));
  setServices({
    userService: userService as never,
    roleRepository: { getAllActive: vi.fn().mockResolvedValue([{ id: 1, name: 'admin' }, { id: 2, name: 'staff' }]) } as never,
  });
  return render(<MemoryRouter><ManageUsersPage /></MemoryRouter>);
}
const rows = () => Array.from(document.querySelectorAll('table tbody tr')).map((r) => r.textContent ?? '');

describe('User management (REQ-ADMIN-004/006)', () => {
  beforeEach(() => vi.useRealTimers());

  it('ADMIN-004: lists every user with name, email, role(s) and active status', async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const ada = rows().find((r) => r.includes('Ada Admin')) as string;
    expect(ada).toContain('ada@gym.test');
    expect(ada).toContain('admin');
    expect(rows().find((r) => r.includes('Ina Inactive'))).toMatch(/inactive/i);
    expect(rows().find((r) => r.includes('Sam Staff'))).toMatch(/active/i);
  });

  it('ADMIN-006: deleted users are hidden by default', async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().join('|')).not.toContain('Dan Deleted');
  });

  it('ADMIN-006: "Show deleted users" reveals them with a Restore action instead of edit/deactivate/delete', async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(screen.getByLabelText('Show deleted users'));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getAllByRole('button', { name: 'Restore Dan Deleted' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Edit Dan Deleted' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Dan Deleted' })).toBeNull();
  });

  it('ADMIN-004/006: an admin cannot deactivate or delete THEIR OWN account (controls disabled)', async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    for (const b of screen.getAllByRole('button', { name: 'Deactivate Ada Admin' })) expect(b).toBeDisabled();
    for (const b of screen.getAllByRole('button', { name: 'Delete Ada Admin' })) expect(b).toBeDisabled();
    // ...but other users' controls are available
    for (const b of screen.getAllByRole('button', { name: 'Delete Sam Staff' })) expect(b).toBeEnabled();
  });

  it('ADMIN-004: editing your own row can only change the name — roles are locked and not sent', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Edit Ada Admin' }))[0]);
    expect(screen.getByText("You can't change your own roles.")).toBeInTheDocument();
    for (const chip of within(screen.getByRole('group', { name: 'Roles' })).getAllByRole('button')) expect(chip).toBeDisabled();
    const name = document.getElementById('user-full-name') as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'Ada L');
    await user.click(screen.getByRole('button', { name: /^(save|update)/i }));
    await waitFor(() => expect(userService.update).toHaveBeenCalledWith(adminProfile.id, { full_name: 'Ada L' }));
  });

  it('ADMIN-004: editing someone else can change name and roles (multi-role)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Edit Sam Staff' }))[0]);
    await user.click(within(screen.getByRole('group', { name: 'Roles' })).getByRole('button', { name: 'admin' }));
    await user.click(screen.getByRole('button', { name: /^(save|update)/i }));
    await waitFor(() => expect(userService.update).toHaveBeenCalledWith('staff-1', { full_name: 'Sam Staff', roles: ['staff', 'admin'] }));
  });

  async function untickOnlyRoleAndSave() {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Edit Sam Staff' }))[0]);
    await user.click(within(screen.getByRole('group', { name: 'Roles' })).getByRole('button', { name: 'staff' })); // untick the only role
    await user.click(screen.getByRole('button', { name: /^(save|update)/i }));
  }

  it('edit validation: a user must keep at least one role — the save is blocked', async () => {
    await untickOnlyRoleAndSave();
    expect(userService.update).not.toHaveBeenCalled();
  });

  // Minor UX gap: the blocked save above is silent — the edit form never renders errors.roles
  // (only the Invite form does), so the admin gets no explanation.
  it.fails('UX GAP: the edit form tells the admin WHY the save was blocked ("Select at least one role")', async () => {
    await untickOnlyRoleAndSave();
    expect(await screen.findByText('Select at least one role', undefined, { timeout: 300 })).toBeInTheDocument();
  });

  it('ADMIN-004: deactivating asks for confirmation, then sets is_active=false', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Deactivate Sam Staff' }))[0]);
    expect(screen.getByText('Deactivate user?')).toBeInTheDocument();
    const dialog = screen.getByText('Deactivate user?').parentElement as HTMLElement;
    await user.click(within(dialog).getAllByRole('button').find((b) => /deactivate/i.test(b.textContent ?? '')) as HTMLElement);
    await waitFor(() => expect(userService.update).toHaveBeenCalledWith('staff-1', { is_active: false }));
  });

  it('ADMIN-004: a deactivated user can be reactivated (reversible toggle, still listed)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Reactivate Ina Inactive' }))[0]);
    expect(screen.getByText('Reactivate user?')).toBeInTheDocument();
    const dialog = screen.getByText('Reactivate user?').parentElement as HTMLElement;
    await user.click(within(dialog).getAllByRole('button').find((b) => /reactivate/i.test(b.textContent ?? '')) as HTMLElement);
    await waitFor(() => expect(userService.update).toHaveBeenCalledWith('staff-2', { is_active: true }));
  });

  it('ADMIN-006: delete asks first; confirming calls delete and reloads without the user', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Delete Sam Staff' }))[0]);
    expect(screen.getByText('Delete user?')).toBeInTheDocument();
    const dialog = screen.getByText('Delete user?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(userService.delete).toHaveBeenCalledWith('staff-1'));
  });

  it('ADMIN-006: Cancel on the delete dialog does nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Delete Sam Staff' }))[0]);
    const dialog = screen.getByText('Delete user?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(userService.delete).not.toHaveBeenCalled();
  });

  it('a server rejection (e.g. last-admin guard) surfaces an error and keeps the dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    userService.delete.mockRejectedValue(new Error('Cannot delete the last active admin'));
    await user.click((await screen.findAllByRole('button', { name: 'Delete Sam Staff' }))[0]);
    const dialog = screen.getByText('Delete user?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    expect(await within(dialog).findByText(/Something went wrong deleting this user/)).toBeInTheDocument();
  });

});
