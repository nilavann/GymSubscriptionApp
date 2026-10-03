// delete-* guards (REQ-MEM-007, REQ-ADMIN-002/003), update-subscription, update-user (REQ-ADMIN-004/006), invite-user, list-users, member-number sequence.
import { assert, assertEquals, assertMatch, call, loadFunction, world, activeCaller, adminCaller } from './harness.ts';

const updates = () => world.log.filter((l) => l.kind === 'query' && l.q!.ops.some(([m]) => m === 'update'));

// ---- delete-member (REQ-MEM-007) ---------------------------------------------------------------------------------------------
Deno.test('MEM-007 delete-member: member_id is required', async () => {
  world.reset(); activeCaller();
  assertEquals((await call(await loadFunction('delete-member'), { body: {} })).status, 400);
});
Deno.test('MEM-007 delete-member: a member with live subscription items is protected (409, nothing updated)', async () => {
  world.reset(); activeCaller();
  world.tables['subscription_items'] = () => ({ count: 3 });
  const r = await call(await loadFunction('delete-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 409);
  assertMatch(String(r.json!.error), /used by 3 subscription\/add-on record\(s\)/);
  assertEquals(updates().length, 0);
});
Deno.test('MEM-007 delete-member: guard counts the member as primary OR shared member, ignoring soft-deleted items', async () => {
  world.reset(); activeCaller();
  world.tables['subscription_items'] = () => ({ count: 0 });
  world.tables['members'] = () => ({});
  await call(await loadFunction('delete-member'), { body: { member_id: 5 } });
  const q = world.log.find((l) => l.name === 'subscription_items')!.q!;
  assertEquals(q.arg('or'), ['member_id.eq.5,shared_member_id.eq.5']);
  assert(q.has('is', 'deleted_at', null));
});
Deno.test('MEM-007 delete-member: unused member is SOFT-deleted with deleted_at + deleted_by = caller (never a hard delete)', async () => {
  world.reset(); activeCaller();
  world.tables['subscription_items'] = () => ({ count: 0 });
  world.tables['members'] = () => ({});
  const r = await call(await loadFunction('delete-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 200);
  const u = updates()[0].q!;
  const payload = u.arg('update')![0] as Record<string, unknown>;
  assertEquals(Object.keys(payload).sort(), ['deleted_at', 'deleted_by']);
  assertEquals(payload.deleted_by, 'caller-1');
  assert(!Number.isNaN(Date.parse(String(payload.deleted_at))));
  assert(u.has('eq', 'id', 5) && u.has('is', 'deleted_at', null), 'only targets that live member');
  assert(!world.log.some((l) => l.q?.ops.some(([m]) => m === 'delete')), 'no DELETE issued');
});
Deno.test('MEM-007 delete-member: database failure -> 500', async () => {
  world.reset(); activeCaller();
  world.tables['subscription_items'] = () => ({ error: { message: 'boom' } });
  assertEquals((await call(await loadFunction('delete-member'), { body: { member_id: 5 } })).status, 500);
});

// ---- delete-plan / delete-branch / delete-role guards ---------------------------------------------------------------------------
for (const c of [
  { fn: 'delete-plan', key: 'plan_id', usedTable: 'subscription_items', target: 'plans', msg: /used by 2 subscription\(s\)/, usedFilter: ['eq', 'plan_id', 9] },
  { fn: 'delete-branch', key: 'branch_id', usedTable: 'members', target: 'branches', msg: /used by 2 member\(s\)/, usedFilter: ['eq', 'branch_id', 9] },
  { fn: 'delete-role', key: 'role_id', usedTable: 'user_roles', target: 'roles', msg: /used by 2 user\(s\)/, usedFilter: ['eq', 'role_id', 9] },
]) {
  Deno.test(`${c.fn}: ${c.key} is required`, async () => {
    world.reset(); adminCaller();
    assertEquals((await call(await loadFunction(c.fn), { body: {} })).status, 400);
  });
  Deno.test(`${c.fn}: in-use -> 409 "used by X", nothing deleted`, async () => {
    world.reset(); adminCaller();
    world.tables[c.usedTable] = () => ({ count: 2 });
    const r = await call(await loadFunction(c.fn), { body: { [c.key]: 9 } });
    assertEquals(r.status, 409);
    assertMatch(String(r.json!.error), c.msg);
    assertEquals(updates().length, 0);
    const q = world.log.find((l) => l.name === c.usedTable)!.q!;
    assert(q.has(c.usedFilter[0] as string, ...(c.usedFilter.slice(1) as unknown[])));
  });
  Deno.test(`${c.fn}: unused -> soft delete (deleted_at/deleted_by), only a live row, never a hard delete`, async () => {
    world.reset(); adminCaller();
    world.tables[c.usedTable] = () => ({ count: 0 });
    world.tables[c.target] = () => ({});
    const r = await call(await loadFunction(c.fn), { body: { [c.key]: 9 } });
    assertEquals(r.status, 200);
    const u = updates()[0].q!;
    assertEquals(u.table, c.target);
    const payload = u.arg('update')![0] as Record<string, unknown>;
    assertEquals(payload.deleted_by, 'caller-1');
    assert(u.has('eq', 'id', 9) && u.has('is', 'deleted_at', null));
  });
  Deno.test(`${c.fn}: count query failure -> 500, nothing deleted`, async () => {
    world.reset(); adminCaller();
    world.tables[c.usedTable] = () => ({ error: { message: 'x' } });
    assertEquals((await call(await loadFunction(c.fn), { body: { [c.key]: 9 } })).status, 500);
    assertEquals(updates().length, 0);
  });
}
Deno.test('delete-plan: guard only counts NON-deleted subscription items', async () => {
  world.reset(); adminCaller();
  world.tables['subscription_items'] = () => ({ count: 0 });
  world.tables['plans'] = () => ({});
  await call(await loadFunction('delete-plan'), { body: { plan_id: 9 } });
  assert(world.log.find((l) => l.name === 'subscription_items')!.q!.has('is', 'deleted_at', null));
});

// ---- update-subscription -----------------------------------------------------------------------------------------------------
Deno.test('update-subscription: subscription_id required', async () => {
  world.reset(); activeCaller();
  assertEquals((await call(await loadFunction('update-subscription'), { body: {} })).status, 400);
});
Deno.test('update-subscription: payment_mode must be Cash/UPI/Card', async () => {
  world.reset(); activeCaller();
  const r = await call(await loadFunction('update-subscription'), { body: { subscription_id: 1, payment_mode: 'Cheque' } });
  assertEquals(r.status, 400);
});
Deno.test('update-subscription: omitted notes -> p_notes_provided=false; explicit null -> true (clears)', async () => {
  world.reset(); activeCaller();
  world.rpc['update_subscription_header'] = () => ({ data: { id: 1 } });
  await call(await loadFunction('update-subscription'), { body: { subscription_id: 1, payment_mode: 'UPI' } });
  let a = world.log.find((l) => l.kind === 'rpc')!.args as Record<string, unknown>;
  assertEquals([a.p_payment_mode, a.p_notes, a.p_notes_provided], ['UPI', null, false]);
  world.log.length = 0;
  await call(await loadFunction('update-subscription'), { body: { subscription_id: 1, notes: null } });
  a = world.log.find((l) => l.kind === 'rpc')!.args as Record<string, unknown>;
  assertEquals([a.p_payment_mode, a.p_notes, a.p_notes_provided], [null, null, true]);
  world.log.length = 0;
  await call(await loadFunction('update-subscription'), { body: { subscription_id: 1, notes: 'paid' } });
  a = world.log.find((l) => l.kind === 'rpc')!.args as Record<string, unknown>;
  assertEquals([a.p_notes, a.p_notes_provided], ['paid', true]);
});
Deno.test('update-subscription: line items cannot be edited (only header fields are forwarded)', async () => {
  world.reset(); activeCaller();
  world.rpc['update_subscription_header'] = () => ({ data: { id: 1 } });
  await call(await loadFunction('update-subscription'), { body: { subscription_id: 1, items: [{ quantity: 99 }], amount_paid: 1, plan_id: 3 } });
  const a = world.log.find((l) => l.kind === 'rpc')!.args as Record<string, unknown>;
  assertEquals(Object.keys(a).sort(), ['p_caller_id', 'p_notes', 'p_notes_provided', 'p_payment_mode', 'p_subscription_id']);
});
Deno.test('update-subscription: unknown subscription (RPC raises) -> 500 with message', async () => {
  world.reset(); activeCaller();
  world.rpc['update_subscription_header'] = () => ({ error: { message: 'Subscription 5 not found' } });
  const r = await call(await loadFunction('update-subscription'), { body: { subscription_id: 5 } });
  assertEquals(r.status, 500);
});

// ---- update-user (REQ-ADMIN-004/006) -----------------------------------------------------------------------------------------
function userRpcs(o: { targetIsAdmin?: boolean; otherAdmins?: number; rolesError?: string } = {}) {
  world.rpc['is_admin_user'] = (a) => ({ data: a.p_user_id === 'caller-1' ? true : (o.targetIsAdmin ?? false) });
  world.rpc['count_other_active_admins'] = () => ({ data: o.otherAdmins ?? 1 });
  world.rpc['soft_delete_profile'] = () => ({});
  world.rpc['restore_profile'] = () => ({});
  world.rpc['replace_user_roles'] = () => (o.rolesError ? { error: { message: o.rolesError } } : {});
  world.rpc['update_profile_fields'] = () => ({});
  world.tables['roles'] = (q) => ({ data: ((q.arg('in') ?? [])[1] as string[]).filter((n) => ['admin', 'staff'].includes(n)).map((n, i) => ({ id: i + 1 })) });
  world.tables['profiles_with_roles'] = () => ({ data: { id: 'u2', full_name: 'X', roles: ['staff'], is_active: true } });
}
const rpcNames = () => world.log.filter((l) => l.kind === 'rpc').map((l) => l.name);

Deno.test('ADMIN-006 update-user: an admin can never delete their OWN account', async () => {
  world.reset(); userRpcs();
  const r = await call(await loadFunction('update-user'), { body: { user_id: 'caller-1', delete: true } });
  assertEquals(r.status, 403);
  assert(!rpcNames().includes('soft_delete_profile'));
});
Deno.test('ADMIN-004 update-user: cannot change OWN roles or active status (403) — but may rename self', async () => {
  world.reset(); userRpcs();
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'caller-1', is_active: false } })).status, 403);
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'caller-1', roles: ['staff'] } })).status, 403);
  const ok = await call(await loadFunction('update-user'), { body: { user_id: 'caller-1', full_name: 'New Name' } });
  assertEquals(ok.status, 200);
  assert(rpcNames().includes('update_profile_fields'));
});
Deno.test('ADMIN-006 update-user: deleting the LAST active admin is blocked (409)', async () => {
  world.reset(); userRpcs({ targetIsAdmin: true, otherAdmins: 0 });
  const r = await call(await loadFunction('update-user'), { body: { user_id: 'u2', delete: true } });
  assertEquals(r.status, 409);
  assert(!rpcNames().includes('soft_delete_profile'));
});
Deno.test('ADMIN-006 update-user: deleting an admin is fine when another active admin exists', async () => {
  world.reset(); userRpcs({ targetIsAdmin: true, otherAdmins: 1 });
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', delete: true } })).status, 200);
});
Deno.test('ADMIN-006 update-user: deleting a plain staff user never needs the admin count', async () => {
  world.reset(); userRpcs({ targetIsAdmin: false, otherAdmins: 0 });
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', delete: true } })).status, 200);
  assert(!rpcNames().includes('count_other_active_admins'));
});
Deno.test('ADMIN-006 update-user: delete does NOT require deactivating first, restore reverses it', async () => {
  world.reset(); userRpcs();
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', delete: true } })).status, 200);
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', restore: true } })).status, 200);
  assert(rpcNames().includes('restore_profile'));
});
Deno.test('ADMIN-004 update-user: deactivating the last active admin is blocked (409)', async () => {
  world.reset(); userRpcs({ targetIsAdmin: true, otherAdmins: 0 });
  const r = await call(await loadFunction('update-user'), { body: { user_id: 'u2', is_active: false } });
  assertEquals(r.status, 409);
  assertMatch(String(r.json!.error), /last active admin/);
});
Deno.test('ADMIN-004 update-user: deactivating a regular user works; reactivating never hits the admin guard', async () => {
  world.reset(); userRpcs();
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', is_active: false } })).status, 200);
  world.reset(); userRpcs({ targetIsAdmin: true, otherAdmins: 0 });
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', is_active: true } })).status, 200);
});
Deno.test('ADMIN-004 update-user: roles must be non-empty and exist', async () => {
  world.reset(); userRpcs();
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', roles: [] } })).status, 400);
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', roles: ['ghost'] } })).status, 400);
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', roles: ['staff', 'ghost'] } })).status, 400);
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', roles: ['staff', 'admin'] } })).status, 200);
});
Deno.test('ADMIN-004 update-user: removing the admin role from the last admin is surfaced as 409', async () => {
  world.reset(); userRpcs({ rolesError: 'Cannot remove the admin role — u2 is the last active admin' });
  const r = await call(await loadFunction('update-user'), { body: { user_id: 'u2', roles: ['staff'] } });
  assertEquals(r.status, 409);
});
Deno.test('ADMIN-004 update-user: user_id required, and an empty edit is rejected', async () => {
  world.reset(); userRpcs();
  assertEquals((await call(await loadFunction('update-user'), { body: {} })).status, 400);
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2' } })).status, 400);
});
Deno.test('ADMIN-004 update-user: unknown / deleted user after an edit -> 404', async () => {
  world.reset(); userRpcs();
  world.tables['profiles_with_roles'] = () => ({ data: null });
  assertEquals((await call(await loadFunction('update-user'), { body: { user_id: 'u2', full_name: 'Z' } })).status, 404);
});

// ---- invite-user -------------------------------------------------------------------------------------------------------------
function inviteSetup() {
  world.reset(); adminCaller();
  world.tables['roles'] = (q) => ({ data: ((q.arg('in') ?? [])[1] as string[]).filter((n) => ['admin', 'staff'].includes(n)).map((n) => ({ id: n === 'admin' ? 1 : 2, name: n })) });
  world.tables['user_roles'] = () => ({});
}
const invitePayload = (o: Record<string, unknown> = {}) => ({ email: 'new@gym.test', full_name: 'New Coach', roles: ['staff'], ...o });
Deno.test('ADMIN-004 invite-user: email, full_name and at least one role are required', async () => {
  for (const b of [{ full_name: 'x', roles: ['staff'] }, { email: 'a@b.co', roles: ['staff'] }, { email: 'a@b.co', full_name: 'x' }, { email: 'a@b.co', full_name: 'x', roles: [] }]) {
    inviteSetup();
    assertEquals((await call(await loadFunction('invite-user'), { body: b })).status, 400);
  }
});
Deno.test('ADMIN-004 invite-user: unknown roles rejected, nothing created', async () => {
  inviteSetup();
  let invited = false;
  world.inviteUser = () => { invited = true; return { data: { user: { id: 'n', email: 'x' } }, error: null }; };
  const r = await call(await loadFunction('invite-user'), { body: invitePayload({ roles: ['staff', 'ghost'] }) });
  assertEquals(r.status, 400);
  assert(!invited, 'auth user must not be created for an invalid role');
});
Deno.test('ADMIN-004 invite-user: happy path invites by email with full_name + invited_by metadata, grants every role, 201', async () => {
  inviteSetup();
  let captured: unknown;
  world.inviteUser = (_e, o) => { captured = o; return { data: { user: { id: 'new-user', email: 'new@gym.test' } }, error: null }; };
  const r = await call(await loadFunction('invite-user'), { body: invitePayload({ roles: ['staff', 'admin'] }) });
  assertEquals(r.status, 201);
  assertEquals(captured, { data: { full_name: 'New Coach', invited_by: 'caller-1' } });
  const insert = world.log.find((l) => l.name === 'user_roles')!.q!.arg('insert')![0] as Record<string, unknown>[];
  assertEquals(insert.map((i) => i.role_id).sort(), [1, 2]);
  assert(insert.every((i) => i.user_id === 'new-user' && i.granted_by === 'caller-1'));
});
Deno.test('ADMIN-004 invite-user: an already-registered email is a 409 with a friendly message', async () => {
  inviteSetup();
  world.inviteUser = () => ({ data: null, error: { message: 'A user with this email address has already been registered' } });
  const r = await call(await loadFunction('invite-user'), { body: invitePayload() });
  assertEquals(r.status, 409);
  assertEquals(r.json!.error, 'This email is already registered.');
});
Deno.test('ADMIN-004 invite-user: other auth failures are 500 with the message', async () => {
  inviteSetup();
  world.inviteUser = () => ({ data: null, error: { message: 'rate limit' } });
  assertEquals((await call(await loadFunction('invite-user'), { body: invitePayload() })).status, 500);
});

// ---- list-users --------------------------------------------------------------------------------------------------------------
Deno.test('ADMIN-004 list-users: joins emails from auth, sorts by name, hides deleted users by default', async () => {
  world.reset(); adminCaller();
  world.tables['profiles_with_roles'] = () => ({ data: [
    { id: 'b', full_name: 'Zed', roles: ['staff'], is_active: true, deleted_at: null },
    { id: 'a', full_name: 'Amy', roles: ['admin'], is_active: true, deleted_at: null },
    { id: 'ghost', full_name: 'No Auth Row', roles: [], is_active: true, deleted_at: null },
  ] });
  world.listUsersPages = [[{ id: 'a', email: 'amy@gym.test' }, { id: 'b', email: 'zed@gym.test' }]];
  const r = await call(await loadFunction('list-users'), { body: {} });
  assertEquals(r.status, 200);
  assertEquals((r.json!.users as { email: string }[]).map((u) => u.email), ['amy@gym.test', 'zed@gym.test']);
  assert(world.log.find((l) => l.name === 'profiles_with_roles')!.q!.has('is', 'deleted_at', null), 'default excludes deleted');
});
Deno.test('ADMIN-006 list-users: include_deleted skips the deleted filter', async () => {
  world.reset(); adminCaller();
  world.tables['profiles_with_roles'] = () => ({ data: [] });
  world.listUsersPages = [[]];
  await call(await loadFunction('list-users'), { body: { include_deleted: true } });
  assert(!world.log.find((l) => l.name === 'profiles_with_roles')!.q!.has('is', 'deleted_at', null));
});
Deno.test('ADMIN-004 list-users: paginates auth users until a short page (more than 200 users)', async () => {
  world.reset(); adminCaller();
  const mk = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${from + i}`, email: `u${from + i}@gym.test` }));
  world.tables['profiles_with_roles'] = () => ({ data: [...mk(0, 205)].map((u) => ({ id: u.id, full_name: u.id, roles: [], is_active: true, deleted_at: null })) });
  world.listUsersPages = [mk(0, 200), mk(200, 5)];
  const r = await call(await loadFunction('list-users'), { body: {} });
  assertEquals((r.json!.users as unknown[]).length, 205);
});
Deno.test('ADMIN-004 list-users: empty/absent body is fine', async () => {
  world.reset(); adminCaller();
  world.tables['profiles_with_roles'] = () => ({ data: [] });
  assertEquals((await call(await loadFunction('list-users'), { rawBody: '' })).status, 200);
});

// ---- update-member-number-sequence (REQ-MEM-005 admin) ----------------------------------------------------------------------
function seqSetup(used: string[], cfg = { member_number_increment: '1', member_number_padding_width: '4' }) {
  world.reset(); adminCaller();
  world.tables['branches'] = () => ({ data: { id: 1, code: 'MUM' } });
  world.tables['configuration'] = () => ({ data: Object.entries(cfg).map(([key, value]) => ({ key, value })) });
  world.tables['members'] = () => ({ data: used.map((member_number) => ({ member_number })) });
  world.tables['member_number_sequences'] = () => ({});
}
const upsertArg = () => world.log.find((l) => l.name === 'member_number_sequences')!.q!.arg('upsert')![0] as Record<string, number>;

Deno.test('MEM-005 sequence: validates branch_id and a whole next_sequence >= 1', async () => {
  for (const b of [{}, { branch_id: 1 }, { branch_id: 1, next_sequence: 1.5 }, { branch_id: 1, next_sequence: 'x' }, { branch_id: 1, next_sequence: 0 }, { branch_id: 1, next_sequence: -3 }]) {
    seqSetup([]);
    assertEquals((await call(await loadFunction('update-member-number-sequence'), { body: b })).status, 400, JSON.stringify(b));
  }
});
Deno.test('MEM-005 sequence: unknown/deleted branch -> 400', async () => {
  seqSetup([]);
  world.tables['branches'] = () => ({ data: null });
  assertEquals((await call(await loadFunction('update-member-number-sequence'), { body: { branch_id: 9, next_sequence: 5 } })).status, 400);
});
Deno.test('MEM-005 sequence: stores candidate - increment so the next member lands exactly on the requested number', async () => {
  seqSetup([]);
  const r = await call(await loadFunction('update-member-number-sequence'), { body: { branch_id: 1, next_sequence: 50 } });
  assertEquals(r.json, { success: true, next_sequence: 50, requested: 50, adjusted: false });
  assertEquals(upsertArg(), { branch_id: 1, last_sequence: 49 });
});
Deno.test('MEM-005 sequence: honours a custom increment', async () => {
  seqSetup([], { member_number_increment: '5', member_number_padding_width: '4' });
  await call(await loadFunction('update-member-number-sequence'), { body: { branch_id: 1, next_sequence: 100 } });
  assertEquals(upsertArg().last_sequence, 95);
});
Deno.test('MEM-005 sequence: skips forward past sequence numbers already issued in ANY year (active or deleted members)', async () => {
  seqSetup(['MUM-2024-0010', 'MUM-2025-0011', 'MUM-2026-0012']);
  const r = await call(await loadFunction('update-member-number-sequence'), { body: { branch_id: 1, next_sequence: 10 } });
  assertEquals(r.json!.next_sequence, 13);
  assertEquals(r.json!.adjusted, true);
  assertEquals(upsertArg().last_sequence, 12);
});
Deno.test('MEM-005 sequence: only collides with numbers of THIS branch (query is prefix-filtered)', async () => {
  seqSetup([]);
  await call(await loadFunction('update-member-number-sequence'), { body: { branch_id: 1, next_sequence: 5 } });
  assertEquals(world.log.find((l) => l.name === 'members')!.q!.arg('like'), ['member_number', 'MUM-%']);
});
Deno.test('MEM-005 sequence: a misconfigured increment (0 / non-numeric) is a 500, not an infinite loop', async () => {
  seqSetup([], { member_number_increment: '0', member_number_padding_width: '4' });
  assertEquals((await call(await loadFunction('update-member-number-sequence'), { body: { branch_id: 1, next_sequence: 5 } })).status, 500);
  seqSetup([], { member_number_increment: 'abc', member_number_padding_width: '4' });
  assertEquals((await call(await loadFunction('update-member-number-sequence'), { body: { branch_id: 1, next_sequence: 5 } })).status, 500);
});
