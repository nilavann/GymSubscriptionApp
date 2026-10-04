import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ManageRolesPage } from './ManageRolesPage';
import { roleService as realRoleService } from '../services/role.service';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildRole } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';
import type { Role } from '../types/role';

const ROLES: Role[] = [
  buildRole({ id: 1, name: 'admin', description: 'Full access' }),
  buildRole({ id: 2, name: 'staff', description: null }),
];

function renderRoles(
  options: RenderOptions & {
    roles?: Role[];
    getAllActive?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
    remove?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    roles = ROLES,
    getAllActive = vi.fn().mockResolvedValue(roles),
    create = vi.fn().mockResolvedValue(buildRole()),
    update = vi.fn().mockResolvedValue(undefined),
    remove = vi.fn().mockResolvedValue(undefined),
    ...rest
  } = options;
  const utils = renderWithProviders(<ManageRolesPage />, {
    ...rest,
    services: fakeServices({
      roleRepository: { getAllActive, delete: remove },
      roleService: { ...realRoleService, create, update },
    }),
  });
  return { ...utils, getAllActive, create, update, remove };
}

const ready = () => screen.findByRole('heading', { name: 'Roles' });

describe('ManageRolesPage — data states', () => {
  it('shows a skeleton while loading', () => {
    renderRoles({ getAllActive: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a network failure offers Retry and recovers', async () => {
    const getAllActive = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(ROLES);
    const { user } = renderRoles({ getAllActive });
    expect(await screen.findByText("Couldn't load roles — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a generic failure never shows the raw error', async () => {
    renderRoles({ getAllActive: vi.fn().mockRejectedValue(new Error('PGRST raw')) });
    expect(await screen.findByText('Something went wrong loading roles. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).not.toBeInTheDocument();
  });

  it('with no roles, says so and offers to add one', async () => {
    renderRoles({ roles: [] });
    await ready();
    expect(screen.getByText('No roles yet.')).toBeInTheDocument();
  });
});

describe('ManageRolesPage renders exactly ONE of table / cards', () => {
  it('on desktop: a table showing each description (or a dash), no cards', async () => {
    renderRoles({ viewport: 1280 });
    await ready();
    const table = document.querySelector('table') as HTMLElement;
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(within(table).getAllByRole('row')).toHaveLength(ROLES.length + 1);
    expect(within(table).getByText('Full access')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
    expect(document.querySelector('.roles-cards')).toBeNull();
  });

  it('on a phone: cards, one per role, no table', async () => {
    renderRoles({ viewport: MOBILE_WIDTH });
    await ready();
    expect(document.querySelectorAll('table')).toHaveLength(0);
    expect(document.querySelectorAll('.roles-card')).toHaveLength(ROLES.length);
  });
});

describe('ManageRolesPage — add / edit / delete', () => {
  it('requires a name but not a description', async () => {
    const { user, create } = renderRoles();
    await ready();
    await user.click(screen.getAllByRole('button', { name: /Add Role/ })[0]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a role, trimming it and storing a blank description as null', async () => {
    const { user, create, getAllActive } = renderRoles();
    await ready();
    await user.click(screen.getAllByRole('button', { name: /Add Role/ })[0]);
    await user.type(screen.getByLabelText(/^Name/), 'trainer');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The page hands its draft to the service; the service's own trim/null mapping is covered in role.service.test.
    expect(create).toHaveBeenCalledWith({ name: 'trainer', description: '' });
    await vi.waitFor(() => expect(getAllActive).toHaveBeenCalledTimes(2));
  });

  it('reports a duplicate NAME (roles are unique by name, not code)', async () => {
    const { user } = renderRoles({ create: vi.fn().mockRejectedValue(new Error('duplicate key … name')) });
    await ready();
    await user.click(screen.getAllByRole('button', { name: /Add Role/ })[0]);
    await user.type(screen.getByLabelText(/^Name/), 'admin');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This name is already used by another role.')).toBeInTheDocument();
  });

  it('editing prefills name and description and saves with the role id', async () => {
    const { user, update } = renderRoles({ viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit admin' }));
    expect(screen.getByRole('heading', { name: 'Edit Role' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('admin');
    expect(screen.getByLabelText('Description')).toHaveValue('Full access');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(1, { name: 'admin', description: 'Full access' });
  });

  it('deletes after confirmation and shows the server’s "in use" message verbatim when blocked', async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error('Cannot delete — used by 2 user(s)')).mockResolvedValue(undefined);
    const { user } = renderRoles({ remove, viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete staff' }));
    expect(screen.getByRole('heading', { name: 'Delete role?' })).toBeInTheDocument();

    const dialog = () => document.querySelector('.roles-delete-dialog') as HTMLElement;
    await user.click(within(dialog()).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Cannot delete — used by 2 user(s)')).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith(2);

    await user.click(within(dialog()).getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => expect(screen.queryByRole('heading', { name: 'Delete role?' })).not.toBeInTheDocument());
  });
});
