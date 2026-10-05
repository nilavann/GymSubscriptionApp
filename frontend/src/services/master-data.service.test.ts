import { describe, expect, it, vi } from 'vitest';

const planRepo = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
const branchRepo = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
const roleRepo = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
const profileRepo = vi.hoisted(() => ({ invite: vi.fn() }));
const numberingRepo = vi.hoisted(() => ({ updateConfig: vi.fn() }));
vi.mock('../repositories/plan.repository', () => ({ planRepository: planRepo }));
vi.mock('../repositories/branch.repository', () => ({ branchRepository: branchRepo }));
vi.mock('../repositories/role.repository', () => ({ roleRepository: roleRepo }));
vi.mock('../repositories/profile.repository', () => ({ profileRepository: profileRepo }));
vi.mock('../repositories/member-numbering.repository', () => ({ memberNumberingRepository: numberingRepo }));

import { emptyPlanDraft, isPlanFormValid, planService, planToDraft, validatePlan, type PlanDraft } from './plan.service';
import { branchService, isBranchFormValid, validateBranch } from './branch.service';
import { emptyRoleDraft, isRoleFormValid, roleService, roleToDraft, validateRole } from './role.service';
import { userService, validateEditUser, validateInvite } from './user.service';
import { memberNumberingService, validateConfig, validateNextSequenceInput } from './member-numbering.service';
import { plan } from '../test/fixtures';

const draft = (o: Partial<PlanDraft>): PlanDraft => ({ ...emptyPlanDraft(), name: 'X', category: 'membership', duration_days: 30, price: '100', ...o });

describe('REQ-ADMIN-002 plan validation', () => {
  it('an empty form reports name, category and price', () => {
    const e = validatePlan(emptyPlanDraft());
    expect(Object.keys(e).sort()).toEqual(['category', 'name', 'price']);
  });
  it('membership plan without duration is blocked', () => {
    expect(validatePlan(draft({ category: 'membership', duration_days: '' })).duration_days).toBeDefined();
  });
  it('membership plan can never be "never expires" even if the flag is set', () => {
    expect(validatePlan(draft({ category: 'membership', duration_days: '', neverExpires: true })).duration_days).toBeDefined();
  });
  it('add-on without duration is blocked unless "never expires" is ticked (indefinite)', () => {
    expect(validatePlan(draft({ category: 'addon', duration_days: '' })).duration_days).toBeDefined();
    expect(validatePlan(draft({ category: 'addon', duration_days: '', neverExpires: true })).duration_days).toBeUndefined();
  });
  it.each([0, -3, 1.5])('duration %s rejected', (d) => expect(validatePlan(draft({ duration_days: d })).duration_days).toBeDefined());
  it('duration 1 accepted (day pass)', () => expect(validatePlan(draft({ duration_days: 1 })).duration_days).toBeUndefined());
  it.each([['', true], ['abc', true], ['-1', true], ['0', false], ['999.99', false]])('price %j error=%s', (p, err) =>
    expect(validatePlan(draft({ price: p })).price !== undefined).toBe(err));
  it('whitespace-only name rejected', () => expect(validatePlan(draft({ name: '   ' })).name).toBeDefined());
  it('valid draft passes', () => expect(isPlanFormValid(validatePlan(draft({})))).toBe(true));

  it('create: indefinite add-on sends duration NULL and max_members 1', async () => {
    await planService.create(draft({ name: '  Fee ', category: 'addon', duration_days: 99, neverExpires: true, max_members: 2 }));
    expect(planRepo.create).toHaveBeenLastCalledWith({ name: 'Fee', category: 'addon', duration_days: null, price: 100, max_members: 1 });
  });
  it('create: couple membership keeps max_members 2', async () => {
    await planService.create(draft({ max_members: 2 }));
    expect(planRepo.create).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'membership', max_members: 2, duration_days: 30 }));
  });
  it('update goes through the repository with the same coercion', async () => {
    await planService.update(7, draft({ price: '1250.50' }));
    expect(planRepo.update).toHaveBeenLastCalledWith(7, expect.objectContaining({ price: 1250.5 }));
  });
  it('planToDraft round-trips indefinite add-ons and couple plans', () => {
    expect(planToDraft(plan({ category: 'addon', duration_days: null }))).toMatchObject({ neverExpires: true, duration_days: '' });
    expect(planToDraft(plan({ max_members: 2 })).max_members).toBe(2);
    expect(planToDraft(plan({ category: 'membership', duration_days: 30 })).neverExpires).toBe(false);
  });
});

describe('REQ-ADMIN-003 branch validation', () => {
  it('name and code are both mandatory', () => {
    expect(Object.keys(validateBranch({ name: '', code: '' })).sort()).toEqual(['code', 'name']);
    expect(Object.keys(validateBranch({ name: '  ', code: ' \t ' })).sort()).toEqual(['code', 'name']);
  });
  it('valid branch', () => expect(isBranchFormValid(validateBranch({ name: 'Delhi', code: 'DEL' }))).toBe(true));
  it('create trims name and code', async () => {
    await branchService.create({ name: ' Delhi ', code: ' DEL ' });
    expect(branchRepo.create).toHaveBeenLastCalledWith({ name: 'Delhi', code: 'DEL' });
  });
  it('update trims too', async () => {
    await branchService.update(2, { name: ' X ', code: ' Y ' });
    expect(branchRepo.update).toHaveBeenLastCalledWith(2, { name: 'X', code: 'Y' });
  });
});

describe('Roles', () => {
  it('name required', () => expect(validateRole(emptyRoleDraft()).name).toBeDefined());
  it('valid', () => expect(isRoleFormValid(validateRole({ name: 'trainer', description: '' }))).toBe(true));
  it('blank description is stored as NULL, name trimmed', async () => {
    await roleService.create({ name: ' trainer ', description: '  ' });
    expect(roleRepo.create).toHaveBeenLastCalledWith({ name: 'trainer', description: null });
  });
  it('roleToDraft maps null description to empty string', () => {
    expect(roleToDraft({ id: 1, name: 'a', description: null } as never)).toEqual({ name: 'a', description: '' });
  });
});

describe('REQ-ADMIN-004 user management validation', () => {
  it('invite: email, name and at least one role are required', () => {
    expect(Object.keys(validateInvite({ email: '', full_name: '', roles: [] })).sort()).toEqual(['email', 'full_name', 'roles']);
  });
  it('invite: malformed email rejected', () => {
    expect(validateInvite({ email: 'a@b', full_name: 'Ann', roles: ['staff'] }).email).toBeDefined();
    expect(validateInvite({ email: 'a b@c.co', full_name: 'Ann', roles: ['staff'] }).email).toBeDefined();
  });
  it('invite: name length 2..80', () => {
    expect(validateInvite({ email: 'a@b.co', full_name: 'A', roles: ['staff'] }).full_name).toBeDefined();
    expect(validateInvite({ email: 'a@b.co', full_name: 'A'.repeat(81), roles: ['staff'] }).full_name).toBeDefined();
    expect(validateInvite({ email: 'a@b.co', full_name: 'Al', roles: ['staff'] })).toEqual({});
  });
  it('invite: a user can hold several roles', () => {
    expect(validateInvite({ email: 'a@b.co', full_name: 'Ann', roles: ['staff', 'admin'] })).toEqual({});
  });
  it('invite sends trimmed values to the invite-user flow', async () => {
    await userService.invite({ email: ' a@b.co ', full_name: ' Ann ', roles: ['staff'] });
    expect(profileRepo.invite).toHaveBeenLastCalledWith({ email: 'a@b.co', full_name: 'Ann', roles: ['staff'] });
  });
  it('edit: name 2..80 and at least one role', () => {
    expect(Object.keys(validateEditUser({ full_name: '', roles: [], is_active: true })).sort()).toEqual(['full_name', 'roles']);
    expect(validateEditUser({ full_name: 'Ann', roles: ['staff'], is_active: false })).toEqual({});
  });
});

describe('Member numbering settings (REQ-MEM-005 admin config)', () => {
  const ok = { start_sequence: '1', increment: '1', padding_width: '4' };
  it('defaults validate', () => expect(validateConfig(ok)).toEqual({}));
  it.each([['0'], ['-1'], ['1.5'], ['abc'], ['']])('start_sequence %j rejected', (v) => expect(validateConfig({ ...ok, start_sequence: v }).start_sequence).toBeDefined());
  it.each([['0'], ['x']])('increment %j rejected', (v) => expect(validateConfig({ ...ok, increment: v }).increment).toBeDefined());
  it.each([['0', true], ['1', false], ['10', false], ['11', true]])('padding %j error=%s', (v, err) => expect(validateConfig({ ...ok, padding_width: v }).padding_width !== undefined).toBe(err));
  it('next-sequence input: whole number >= 1', () => {
    expect(validateNextSequenceInput('42')).toEqual({ value: 42, error: null });
    expect(validateNextSequenceInput('0').error).toBeTruthy();
    expect(validateNextSequenceInput('4.2').error).toBeTruthy();
    expect(validateNextSequenceInput(' 7 ')).toEqual({ value: 7, error: null });
  });
  it('updateConfig sends numbers', async () => {
    await memberNumberingService.updateConfig({ start_sequence: '5', increment: '2', padding_width: '6' });
    expect(numberingRepo.updateConfig).toHaveBeenLastCalledWith({ start_sequence: 5, increment: 2, padding_width: 6 });
  });
});
