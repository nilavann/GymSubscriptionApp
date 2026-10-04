import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleRepository } from '../repositories/role.repository';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('../repositories/role.repository', () => ({
  roleRepository: { create: mocks.create, update: mocks.update } satisfies Partial<RoleRepository>,
}));

import { emptyRoleDraft, isRoleFormValid, roleService, roleToDraft, validateRole } from './role.service';
import { buildRole } from '../test/builders';

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('role drafts', () => {
  it('starts empty', () => {
    expect(emptyRoleDraft()).toEqual({ name: '', description: '' });
  });

  it('maps a null description to an empty string', () => {
    expect(roleToDraft(buildRole({ name: 'trainer', description: null }))).toEqual({ name: 'trainer', description: '' });
    expect(roleToDraft(buildRole({ name: 'trainer', description: 'Floor staff' })).description).toBe('Floor staff');
  });
});

describe('validateRole', () => {
  it('requires a name, treating whitespace as empty', () => {
    expect(validateRole({ name: ' ', description: '' })).toEqual({ name: 'Name is required' });
    expect(isRoleFormValid(validateRole({ name: 'trainer', description: '' }))).toBe(true);
  });
});

describe('roleService', () => {
  it('trims the name and stores a blank description as null', async () => {
    mocks.create.mockResolvedValue(buildRole());
    await roleService.create({ name: ' trainer ', description: '   ' });
    expect(mocks.create).toHaveBeenCalledWith({ name: 'trainer', description: null });
  });

  it('keeps a real description (trimmed) on update', async () => {
    mocks.update.mockResolvedValue(undefined);
    await roleService.update(2, { name: 'trainer', description: ' Floor staff ' });
    expect(mocks.update).toHaveBeenCalledWith(2, { name: 'trainer', description: 'Floor staff' });
  });
});
