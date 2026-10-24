import { describe, expect, it } from 'vitest';
import { isSystemAdmin } from './roles';

describe('isSystemAdmin', () => {
  it.each([
    [['admin', 'system_admin'], true],
    [['system_admin', 'admin', 'staff'], true],
    [['admin'], false],
    [['staff'], false],
    [['system_admin'], false],
    [[], false],
    [null, false],
    [undefined, false],
  ])('%j -> %s', (roles, expected) => {
    expect(isSystemAdmin(roles)).toBe(expected);
  });
});
