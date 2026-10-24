// purge-member (REQ-MEM-008): system-admin gate, input validation, RPC error mapping, photo cleanup.
import { assert, assertEquals, assertMatch, call, loadFunction, world } from './harness.ts';

function setup(o: { systemAdmin?: boolean; purge?: () => { data?: unknown; error?: { message: string } } } = {}) {
  world.reset();
  world.rpc['is_system_admin_user'] = () => ({ data: o.systemAdmin ?? true });
  world.rpc['purge_member'] = o.purge ?? (() => ({ data: { photo_paths: ['m/5/photo.jpg', 'm/5/thumb.jpg'], subscriptions: 1, items: 2 } }));
}
const rpcCalls = (name: string) => world.log.filter((l) => l.kind === 'rpc' && l.name === name);

Deno.test('MEM-008 purge-member: no Authorization header -> 401', async () => {
  setup();
  assertEquals((await call(await loadFunction('purge-member'), { auth: null, body: { member_id: 5 } })).status, 401);
});
Deno.test('MEM-008 purge-member: invalid session -> 401', async () => {
  setup(); world.user = null;
  assertEquals((await call(await loadFunction('purge-member'), { body: { member_id: 5 } })).status, 401);
});
Deno.test('MEM-008 purge-member: only POST (and OPTIONS) are served', async () => {
  setup();
  assertEquals((await call(await loadFunction('purge-member'), { method: 'GET' })).status, 405);
  assertEquals((await call(await loadFunction('purge-member'), { method: 'OPTIONS' })).status, 200);
});
Deno.test('MEM-008 purge-member: a non-system-admin is refused (403) and nothing is purged', async () => {
  setup({ systemAdmin: false });
  const r = await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 403);
  assertEquals(rpcCalls('purge_member').length, 0);
  assertEquals(world.log.filter((l) => l.kind === 'storage').length, 0);
});
Deno.test('MEM-008 purge-member: the gate is checked for the JWT caller', async () => {
  setup();
  await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(rpcCalls('is_system_admin_user')[0].args, { p_user_id: 'caller-1' });
});
Deno.test('MEM-008 purge-member: member_id must be a positive integer (400)', async () => {
  for (const body of [{}, { member_id: 0 }, { member_id: -3 }, { member_id: '5' }, { member_id: 1.5 }, { member_id: null }]) {
    setup();
    assertEquals((await call(await loadFunction('purge-member'), { body })).status, 400, JSON.stringify(body));
    assertEquals(rpcCalls('purge_member').length, 0);
  }
});
Deno.test('MEM-008 purge-member: happy path purges as the caller, then removes both photo files', async () => {
  setup();
  const r = await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 200);
  assertEquals(r.json, { success: true, photos_removed: true });
  assertEquals(rpcCalls('purge_member')[0].args, { p_caller_id: 'caller-1', p_member_id: 5 });
  const removal = world.log.find((l) => l.kind === 'storage' && l.name.endsWith('.remove'))!;
  assertEquals(removal.name, 'member-photos.remove');
  assertEquals(removal.args, ['m/5/photo.jpg', 'm/5/thumb.jpg']);
});
Deno.test('MEM-008 purge-member: files left by replaced photos in the member folder are removed too', async () => {
  setup(); world.storageList = () => [{ name: 'original-1.jpg' }, { name: 'thumbnail-1.jpg' }, { name: 'photo.jpg' }];
  const r = await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(r.json, { success: true, photos_removed: true });
  const removal = world.log.find((l) => l.kind === 'storage' && l.name.endsWith('.remove'))!;
  assertEquals((removal.args as string[]).slice().sort(), ['5/original-1.jpg', '5/photo.jpg', '5/thumbnail-1.jpg', 'm/5/photo.jpg', 'm/5/thumb.jpg']);
});
Deno.test('MEM-008 purge-member: a member with no photo makes no storage call', async () => {
  setup({ purge: () => ({ data: { photo_paths: [], subscriptions: 0, items: 0 } }) });
  const r = await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 200);
  assertEquals(world.log.filter((l) => l.kind === 'storage' && l.name.endsWith('.remove')).length, 0);
});
Deno.test('MEM-008 purge-member: a storage failure after the purge is reported, not turned into an error', async () => {
  setup(); world.storageRemove = () => ({ error: { message: 'storage down' } });
  const r = await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 200);
  assertEquals(r.json, { success: true, photos_removed: false });
});
Deno.test('MEM-008 purge-member: unknown member -> 404', async () => {
  setup({ purge: () => ({ error: { message: 'Member 5 not found' } }) });
  assertEquals((await call(await loadFunction('purge-member'), { body: { member_id: 5 } })).status, 404);
});
Deno.test('MEM-008 purge-member: shared-member refusal -> 409 with the database message', async () => {
  setup({ purge: () => ({ error: { message: 'Cannot purge — this member is the shared member on 1 other member(s) subscriptions' } }) });
  const r = await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 409);
  assertMatch(String(r.json!.error), /shared member/);
  assertEquals(world.log.filter((l) => l.kind === 'storage').length, 0);
});
Deno.test('MEM-008 purge-member: any other database failure -> 500, photos kept', async () => {
  setup({ purge: () => ({ error: { message: 'boom' } }) });
  const r = await call(await loadFunction('purge-member'), { body: { member_id: 5 } });
  assertEquals(r.status, 500);
  assert(!world.log.some((l) => l.kind === 'storage'));
});
