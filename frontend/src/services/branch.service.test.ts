import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchRepository } from '../repositories/branch.repository';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('../repositories/branch.repository', () => ({
  branchRepository: { create: mocks.create, update: mocks.update } satisfies Partial<BranchRepository>,
}));

import { branchService, isBranchFormValid, validateBranch } from './branch.service';
import { buildBranch } from '../test/builders';

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('validateBranch', () => {
  it('accepts a name and a code', () => {
    const errors = validateBranch({ name: 'Mumbai Central', code: 'MUM' });
    expect(errors).toEqual({});
    expect(isBranchFormValid(errors)).toBe(true);
  });

  it('requires both, treating whitespace as empty', () => {
    const errors = validateBranch({ name: '  ', code: '' });
    expect(errors).toEqual({ name: 'Name is required', code: 'Code is required' });
    expect(isBranchFormValid(errors)).toBe(false);
  });
});

describe('branchService', () => {
  it('trims name and code on create', async () => {
    mocks.create.mockResolvedValue(buildBranch());
    await branchService.create({ name: '  Mumbai ', code: ' MUM ' });
    expect(mocks.create).toHaveBeenCalledWith({ name: 'Mumbai', code: 'MUM' });
  });

  it('trims name and code on update', async () => {
    mocks.update.mockResolvedValue(undefined);
    await branchService.update(3, { name: ' Pune', code: 'PUN ' });
    expect(mocks.update).toHaveBeenCalledWith(3, { name: 'Pune', code: 'PUN' });
  });
});
