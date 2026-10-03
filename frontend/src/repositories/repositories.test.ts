import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase-client', () => ({ supabase: { functions: { invoke }, from, storage: { from: () => ({ createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }) }) } } }));

import { memberRepository } from './member.repository';
import { planRepository } from './plan.repository';
import { branchRepository } from './branch.repository';
import { roleRepository } from './role.repository';
import { subscriptionRepository } from './subscription.repository';
import { profileRepository } from './profile.repository';

// Chainable fake: every method returns the builder; awaiting resolves `result`.
function builder(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const calls: [string, unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'eq', 'in', 'order', 'maybeSingle', 'single', 'is', 'gte', 'lte']) {
    b[m] = (...a: unknown[]) => { calls.push([m, a]); return b; };
  }
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null });
  return { b, calls };
}

beforeEach(() => { invoke.mockReset(); from.mockReset(); });

describe('Edge-function backed deletes (guards live server-side; the client surfaces their message verbatim)', () => {
  const body = (e: Response) => ({ context: { json: async () => ({ error: e }) } });
  it.each([
    ['member', () => memberRepository.delete(5), 'delete-member', { member_id: 5 }],
    ['plan', () => planRepository.delete(5), 'delete-plan', { plan_id: 5 }],
    ['branch', () => branchRepository.delete(5), 'delete-branch', { branch_id: 5 }],
    ['role', () => roleRepository.delete(5), 'delete-role', { role_id: 5 }],
  ] as const)('%s delete calls its Edge Function (never a direct table delete)', async (_n, run, fn, payload) => {
    invoke.mockResolvedValue({ error: null });
    await run();
    expect(invoke).toHaveBeenCalledWith(fn, { body: payload });
    expect(from).not.toHaveBeenCalled();
  });
  it.each([
    ['member', () => memberRepository.delete(5)],
    ['plan', () => planRepository.delete(5)],
    ['branch', () => branchRepository.delete(5)],
    ['role', () => roleRepository.delete(5)],
  ] as const)('%s delete: the guard message from the server is thrown verbatim', async (_n, run) => {
    invoke.mockResolvedValue({ error: body('Cannot delete — used by 2 thing(s)' as never) });
    await expect(run()).rejects.toThrow('Cannot delete — used by 2 thing(s)');
  });
});

describe('subscriptionRepository: writes only via Edge Functions (RLS grants no direct insert)', () => {
  it('create -> create-subscription', async () => {
    invoke.mockResolvedValue({ data: { subscription: { id: 1 }, items: [] }, error: null });
    const payload = { member_id: 1, payment_mode: 'Cash' as const, notes: null, items: [] };
    await subscriptionRepository.create(payload);
    expect(invoke).toHaveBeenCalledWith('create-subscription', { body: payload });
    expect(from).not.toHaveBeenCalled();
  });
  it('update -> update-subscription', async () => {
    invoke.mockResolvedValue({ error: null });
    await subscriptionRepository.update({ subscription_id: 1, notes: 'x' });
    expect(invoke).toHaveBeenCalledWith('update-subscription', { body: { subscription_id: 1, notes: 'x' } });
  });
  it('a server error message (e.g. the indefinite-plan 409) is thrown to the page', async () => {
    invoke.mockResolvedValue({ error: { context: { json: async () => ({ error: 'This member already has an active indefinite item' }) } } });
    await expect(subscriptionRepository.create({ member_id: 1, payment_mode: 'Cash', notes: null, items: [] })).rejects.toThrow(/already has an active indefinite item/);
  });
  it('getItemsForSubscriptions with no ids makes no request', async () => {
    expect(await subscriptionRepository.getItemsForSubscriptions([])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
  it('current items come from member_current_items filtered to the member', async () => {
    const { b, calls } = builder({ data: [] });
    from.mockReturnValue(b);
    await subscriptionRepository.getCurrentItemsForMember(7);
    expect(from).toHaveBeenCalledWith('member_current_items');
    expect(calls).toContainEqual(['eq', ['member_id', 7]]);
  });
  it('history is newest first', async () => {
    const { b, calls } = builder({ data: [] });
    from.mockReturnValue(b);
    await subscriptionRepository.getHistoryForMember(7);
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
  });
});

describe('memberRepository direct RLS-guarded access', () => {
  it('create inserts into members and returns the saved row (incl. generated member_number)', async () => {
    const { b, calls } = builder({ data: { id: 1, member_number: 'MUM-2026-0001' } });
    from.mockReturnValue(b);
    const created = await memberRepository.create({ name: 'x' } as never);
    expect(from).toHaveBeenCalledWith('members');
    expect(calls[0]).toEqual(['insert', [{ name: 'x' }]]);
    expect(created).toMatchObject({ member_number: 'MUM-2026-0001' });
  });
  it('the read selects member_number and created_by (shown read-only) and branch_id', async () => {
    const { b, calls } = builder({ data: null });
    from.mockReturnValue(b);
    await memberRepository.getById(1);
    const cols = String(calls.find(([m]) => m === 'select')![1][0]);
    for (const c of ['member_number', 'created_by', 'branch_id', 'handled_by_staff', 'photo_thumbnail_url']) expect(cols).toContain(c);
  });
  it('getById returns null for a missing/deleted member', async () => {
    const { b } = builder({ data: null });
    from.mockReturnValue(b);
    expect(await memberRepository.getById(404)).toBeNull();
  });
  it('database errors become thrown Errors with the DB message (used to detect the phone conflict)', async () => {
    const { b } = builder({ error: { message: 'duplicate key value violates unique constraint "idx_members_phone_active"' } });
    from.mockReturnValue(b);
    await expect(memberRepository.create({} as never)).rejects.toThrow(/idx_members_phone_active/);
    await expect(memberRepository.update(1, {})).rejects.toThrow(/idx_members_phone_active/);
  });
  it('update targets one member by id', async () => {
    const { b, calls } = builder({});
    from.mockReturnValue(b);
    await memberRepository.update(9, { name: 'n' });
    expect(calls).toEqual([['update', [{ name: 'n' }]], ['eq', ['id', 9]]]);
  });
});

describe('profileRepository', () => {
  it('a missing profile row resolves to null (the "never invited" signal)', async () => {
    const { b } = builder({ data: null });
    from.mockReturnValue(b);
    expect(await profileRepository.getById('u')).toBeNull();
  });
  it('picker list only includes ACTIVE users, name-sorted', async () => {
    const { b, calls } = builder({ data: [] });
    from.mockReturnValue(b);
    await profileRepository.getAllActive();
    expect(calls).toContainEqual(['eq', ['is_active', true]]);
    expect(calls).toContainEqual(['order', ['full_name']]);
  });
  it('lookups read profiles_with_roles (multi-role view)', async () => {
    const { b } = builder({ data: [] });
    from.mockReturnValue(b);
    await profileRepository.getAllNonDeleted();
    expect(from).toHaveBeenCalledWith('profiles_with_roles');
  });
});
