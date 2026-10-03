// Gates every Edge Function shares: CORS preflight, method check, bearer token, session validity, role.
import { assertEquals, call, loadFunction, world, activeCaller, adminCaller } from './harness.ts';

const ADMIN_ONLY = ['delete-plan', 'delete-branch', 'delete-role', 'invite-user', 'list-users', 'update-user', 'update-member-number-sequence'];
const ACTIVE_USER = ['create-subscription', 'update-subscription', 'delete-member'];

for (const fn of [...ADMIN_ONLY, ...ACTIVE_USER]) {
  Deno.test(`${fn}: OPTIONS preflight succeeds with CORS headers`, async () => {
    world.reset();
    const r = await call(await loadFunction(fn), { method: 'OPTIONS' });
    assertEquals(r.status, 200);
    assertEquals(r.headers.get('Access-Control-Allow-Origin'), '*');
  });

  Deno.test(`${fn}: GET is rejected with 405`, async () => {
    world.reset();
    assertEquals((await call(await loadFunction(fn), { method: 'GET' })).status, 405);
  });

  Deno.test(`${fn}: missing Authorization header -> 401 (nothing is touched)`, async () => {
    world.reset();
    const r = await call(await loadFunction(fn), { auth: null, body: {} });
    assertEquals(r.status, 401);
    assertEquals(world.log.length, 0, 'no query/rpc may run before auth');
  });

  Deno.test(`${fn}: invalid/expired session -> 401 (no data access)`, async () => {
    world.reset();
    world.user = null;
    const r = await call(await loadFunction(fn), { body: { x: 1 } });
    assertEquals(r.status, 401);
    assertEquals(world.log.length, 0);
  });
}

for (const fn of ADMIN_ONLY) {
  Deno.test(`${fn}: a signed-in NON-admin is refused with 403 before anything else happens`, async () => {
    world.reset();
    adminCaller(false);
    const r = await call(await loadFunction(fn), { body: { plan_id: 1, branch_id: 1, role_id: 1, user_id: 'u', email: 'a@b.co', full_name: 'A', roles: ['staff'], next_sequence: 1 } });
    assertEquals(r.status, 403);
    assertEquals(world.log.filter((l) => l.kind === 'query').length, 0, 'no table access for a non-admin');
  });
}

for (const fn of ACTIVE_USER) {
  for (const [label, profile] of [
    ['deactivated', { id: 'caller-1', is_active: false, deleted_at: null }],
    ['soft-deleted', { id: 'caller-1', is_active: true, deleted_at: '2026-01-01T00:00:00Z' }],
    ['no profile (never invited)', null],
  ] as const) {
    Deno.test(`${fn}: ${label} caller is refused with 403`, async () => {
      world.reset();
      activeCaller(profile as never);
      const r = await call(await loadFunction(fn), { body: { member_id: 1, payment_mode: 'Cash', subscription_id: 1, items: [{ plan_id: 1, member_id: 1, start_date: '2026-01-01' }] } });
      assertEquals(r.status, 403);
      assertEquals(world.log.filter((l) => l.kind === 'rpc').length, 0);
    });
  }
}
