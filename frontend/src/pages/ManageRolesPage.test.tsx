import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ManageRolesPage } from './ManageRolesPage';
import { roleService as realRoleService } from '../services/role.service';
import { adminProfile, fakeAuth, setAuth, setServices } from '../test/mocks';

const roles = [{ id: 1, name: 'admin', description: 'Full access' }, { id: 2, name: 'staff', description: null }];
let roleRepository: Record<string, ReturnType<typeof vi.fn>>;
let roleService: typeof realRoleService;
const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const rows = () => Array.from(document.querySelectorAll('table tbody tr')).map((r) => r.textContent ?? '');

function renderPage() {
  roleRepository = { getAllActive: vi.fn().mockResolvedValue(roles), delete: vi.fn().mockResolvedValue(undefined) };
  roleService = { ...realRoleService, create: vi.fn().mockResolvedValue(roles[0]), update: vi.fn().mockResolvedValue(undefined) } as never;
  setAuth(fakeAuth(adminProfile));
  setServices({ roleRepository: roleRepository as never, roleService });
  return render(<MemoryRouter><ManageRolesPage /></MemoryRouter>);
}

describe('Role management', () => {
  beforeEach(() => vi.useRealTimers());

  it('lists roles', async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
  });
  it('a role needs a name', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add role/i }));
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(roleService.create).not.toHaveBeenCalled();
  });
  it('creates a role with a blank description stored as null', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add role/i }));
    await user.type(el('role-name'), 'trainer');
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    await waitFor(() => expect(roleService.create).toHaveBeenCalledWith({ name: 'trainer', description: '' }));
  });
  it('duplicate role names are reported', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add role/i }));
    (roleService.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('duplicate key value violates unique constraint "idx_roles_name_active"'));
    await user.type(el('role-name'), 'staff');
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    expect(await screen.findByText('This name is already used by another role.')).toBeInTheDocument();
  });
  it('a role that is still assigned to users can\'t be deleted (guard message shown)', async () => {
    const user = userEvent.setup();
    renderPage();
    roleRepository.delete.mockRejectedValue(new Error('Cannot delete — used by 4 user(s)'));
    await user.click((await screen.findAllByRole('button', { name: 'Delete staff' }))[0]);
    const dialog = screen.getByText('Delete role?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText('Cannot delete — used by 4 user(s)')).toBeInTheDocument();
  });
  it('an unused role is deleted after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Delete staff' }))[0]);
    const dialog = screen.getByText('Delete role?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(roleRepository.delete).toHaveBeenCalledWith(2));
  });
});
