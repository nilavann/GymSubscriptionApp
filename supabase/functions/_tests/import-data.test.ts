// import-data (MERGE mode, REQ-ADMIN-008): admin gate, request validation, exactly how the RPC is called, how the
// outcomes are merged, and the abort / dry-run / skip-invalid semantics. The RPC itself is covered by the SQL tests
// (supabase/tests/70_import_workbook.test.sql); here it is scripted.
import { assert, assertEquals, assertMatch, call, loadFunction, world, adminCaller } from './harness.ts';

const fn = () => loadFunction('import-data');
const importCalls = () => world.log.filter((l) => l.kind === 'rpc' && l.name === 'import_workbook');
const lastArgs = () => importCalls()[importCalls().length - 1].args as Record<string, unknown>;

const member = (row: number, extra: Record<string, unknown> = {}) => ({
  _row: row, name: 'Asha Rao', phone: '9876543210', date_of_birth: '1990-05-01', gender: 'Female', weight_kg: 62.5, height_cm: 160,
  emergency_contact_name: 'Raj', emergency_contact_phone: '9123456780', emergency_contact_relationship: 'Spouse', branch_code: 'MUM', ...extra,
});
function body(extra: Record<string, unknown> = {}, sheets: Record<string, unknown[]> = { members: [member(2)] }) {
  return { mode: 'merge', schema_version: 1, dry_run: false, options: { on_error: 'abort' }, sheets, ...extra };
}
/** Scripts the RPC to answer like import_workbook: one outcome per row it was given, in sheet order. */
function scriptRpc(overrides: Record<string, unknown> = {}, outcome = 'created') {
  world.rpc['import_workbook'] = (args) => {
    const payload = args.p_payload as Record<string, { row: number }[]>;
    const rows = ['branches', 'plans', 'members', 'subscriptions'].flatMap((sheet) => (payload[sheet] ?? []).map((r) => ({ sheet, row: r.row, outcome, id: 100 + r.row })));
    return { data: { committed: !args.p_dry_run, aborted: false, dry_run: args.p_dry_run, rows, ...overrides } };
  };
}
async function run(b: unknown, opts: { auth?: string | null } = {}) {
  return await call(await fn(), { body: b, ...opts });
}

// ---- transport + gates -----------------------------------------------------------------------------------------------
Deno.test('import-data: OPTIONS answers the CORS preflight and other methods are 405', async () => {
  world.reset();
  assertEquals((await call(await fn(), { method: 'OPTIONS' })).status, 200);
  assertEquals((await call(await fn(), { method: 'GET' })).status, 405);
});
Deno.test('import-data: no Authorization header -> 401, nothing run', async () => {
  world.reset(); adminCaller(); scriptRpc();
  assertEquals((await run(body(), { auth: null })).status, 401);
  assertEquals(importCalls().length, 0);
});
Deno.test('import-data: an invalid or expired session -> 401', async () => {
  world.reset(); adminCaller(); scriptRpc(); world.user = null;
  assertEquals((await run(body())).status, 401);
  assertEquals(importCalls().length, 0);
});
Deno.test('import-data: a non-admin gets 403 and the import RPC is NEVER called (even for a valid request)', async () => {
  world.reset(); adminCaller(false); scriptRpc();
  const r = await run(body());
  assertEquals(r.status, 403);
  assertMatch(String(r.json!.error), /Admin access required/);
  assertEquals(importCalls().length, 0);
});
Deno.test('import-data: a failing admin check is a 500, not a pass', async () => {
  world.reset(); scriptRpc();
  world.rpc['is_admin_user'] = () => ({ error: { message: 'rpc down' } });
  assertEquals((await run(body())).status, 500);
  assertEquals(importCalls().length, 0);
});

// ---- request validation ----------------------------------------------------------------------------------------------
Deno.test('import-data: malformed JSON is a 400 (not a 500)', async () => {
  world.reset(); adminCaller(); scriptRpc();
  assertEquals((await call(await fn(), { rawBody: '{not json' })).status, 400);
  assertEquals(importCalls().length, 0);
});
for (const [label, mutate, pattern] of [
  ['an unsupported mode (restore is not here yet)', { mode: 'restore' }, /Unsupported mode/],
  ['a missing dry_run flag', { dry_run: undefined }, /dry_run must be true or false/],
  ['a newer schema version', { schema_version: 9 }, /newer version of the app/],
  ['an unknown sheet', { sheets: { users: [{ _row: 2 }] } }, /Unknown sheet/],
  ['no rows', { sheets: { members: [] } }, /no rows to import/],
  ['a bad on_error', { options: { on_error: 'whatever' } }, /on_error/],
] as [string, Record<string, unknown>, RegExp][]) {
  Deno.test(`import-data: ${label} -> 400 and nothing is run`, async () => {
    world.reset(); adminCaller(); scriptRpc();
    const r = await run(body(mutate));
    assertEquals(r.status, 400);
    assertMatch(String(r.json!.error), pattern);
    assertEquals(importCalls().length, 0);
  });
}

// ---- how the RPC is called -------------------------------------------------------------------------------------------
Deno.test('import-data: calls import_workbook ONCE, as the caller, with the options mapped and only the valid rows', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const r = await run(body({ dry_run: false, options: { update_existing: true, on_error: 'skip_invalid' } }, { members: [member(2), member(3, { phone: '1' })] }));
  assertEquals(r.status, 200);
  assertEquals(importCalls().length, 1);
  const args = lastArgs();
  assertEquals([args.p_caller_id, args.p_update_existing, args.p_skip_invalid, args.p_dry_run], ['caller-1', true, true, false]);
  assertEquals(((args.p_payload as Record<string, { row: number }[]>).members).map((m) => m.row), [2]);
});
Deno.test('import-data: the defaults are add-only and all-or-nothing', async () => {
  world.reset(); adminCaller(); scriptRpc();
  await run({ mode: 'merge', schema_version: 1, dry_run: true, sheets: { members: [member(2)] } });
  const args = lastArgs();
  assertEquals([args.p_update_existing, args.p_skip_invalid, args.p_dry_run], [false, false, true]);
});
Deno.test('import-data: the RPC is given the validated, normalised payload — never the raw cells', async () => {
  world.reset(); adminCaller(); scriptRpc();
  await run(body({}, { members: [member(2, { phone: '98 76 54 32 10', id: 5, member_number: 'HACK', photo_url: 'x' })] }));
  const m = ((lastArgs().p_payload as Record<string, Record<string, unknown>[]>).members)[0];
  assertEquals(m.phone, '9876543210');
  for (const key of ['id', 'member_number', 'photo_url', '_row']) assert(!(key in m), key);
});

// ---- outcomes: abort / dry run / skip invalid ------------------------------------------------------------------------
Deno.test('import-data: a clean real import reports committed, with a summary and the new ids', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const r = await run(body({}, { members: [member(2), member(3, { phone: '9876543211' })] }));
  assertEquals([r.json!.committed, r.json!.aborted, r.json!.dry_run], [true, false, false]);
  assertEquals(((r.json!.summary as Record<string, Record<string, number>>).members).created, 2);
  assertEquals((r.json!.rows as { id: number }[]).map((x) => x.id), [102, 103]);
});
Deno.test('import-data: a dry run is never committed, whatever the RPC says', async () => {
  world.reset(); adminCaller(); scriptRpc({ committed: true }); // even a buggy RPC claiming "committed" cannot make a dry run commit
  const r = await run(body({ dry_run: true }));
  assertEquals([r.json!.committed, r.json!.dry_run], [false, true]);
  assertEquals(lastArgs().p_dry_run, true);
});
Deno.test('import-data: under "abort", ONE invalid row means nothing is committed — valid rows still run, as a forced dry run', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const r = await run(body({ dry_run: false, options: { on_error: 'abort' } }, { members: [member(2), member(3, { phone: '1' })] }));
  assertEquals([r.json!.committed, r.json!.aborted], [false, true]);
  assertEquals(lastArgs().p_dry_run, true, 'the commit was forced into a dry run');
  const rows = r.json!.rows as { row: number; outcome: string }[];
  assertEquals(rows.map((x) => [x.row, x.outcome]), [[2, 'created'], [3, 'error']]);
});
Deno.test('import-data: under "skip_invalid" the valid rows commit and the invalid ones are reported', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const r = await run(body({ dry_run: false, options: { on_error: 'skip_invalid' } }, { members: [member(2), member(3, { phone: '1' })] }));
  assertEquals([r.json!.committed, r.json!.aborted], [true, false]);
  assertEquals(lastArgs().p_dry_run, false);
  const summary = (r.json!.summary as Record<string, Record<string, number>>).members;
  assertEquals([summary.created, summary.error], [1, 1]);
});
Deno.test('import-data: when the DATABASE finds the bad row (not validation) under "abort", the RPC\'s abort is passed through', async () => {
  world.reset(); adminCaller();
  world.rpc['import_workbook'] = () => ({ data: { committed: false, aborted: true, dry_run: false, rows: [
    { sheet: 'members', row: 2, outcome: 'created', id: 1 },
    { sheet: 'members', row: 3, outcome: 'error', message: 'Branch "NOPE" not found' },
  ] } });
  const r = await run(body({}, { members: [member(2), member(3, { phone: '9876543211', branch_code: 'NOPE' })] }));
  assertEquals([r.json!.committed, r.json!.aborted], [false, true]);
  assertEquals((r.json!.rows as { message?: string }[])[1].message, 'Branch "NOPE" not found');
});
Deno.test('import-data: when nothing is valid the RPC is not called at all (and nothing is committed)', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const r = await run(body({ options: { on_error: 'skip_invalid' } }, { members: [member(2, { phone: '1' })] }));
  assertEquals(r.status, 200);
  assertEquals(importCalls().length, 0);
  assertEquals([r.json!.committed, r.json!.aborted], [false, false]);
  assertEquals(((r.json!.summary as Record<string, Record<string, number>>).members).error, 1);
});
Deno.test('import-data: a file of only deleted rows imports nothing, reports them, and never calls the RPC', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const r = await run(body({}, { members: [member(2, { deleted_at: '2026-01-01T00:00:00+00:00' })] }));
  assertEquals(importCalls().length, 0);
  assertEquals(((r.json!.summary as Record<string, Record<string, number>>).members).skipped_deleted, 1);
  assertEquals(r.json!.committed, false);
});

// ---- the merged response ---------------------------------------------------------------------------------------------
Deno.test('import-data: outcomes from validation and from the RPC are merged and ordered by sheet, then row', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const r = await run(body({ options: { on_error: 'skip_invalid' } }, {
    members: [member(5), member(2, { phone: '1' })],
    branches: [{ _row: 9, name: 'B', code: 'B1' }, { _row: 3, name: '', code: '' }],
  }));
  assertEquals((r.json!.rows as { sheet: string; row: number }[]).map((x) => `${x.sheet}:${x.row}`), ['branches:3', 'branches:9', 'members:2', 'members:5']);
});
Deno.test('import-data: the summary counts every outcome kind per sheet', async () => {
  world.reset(); adminCaller();
  world.rpc['import_workbook'] = () => ({ data: { committed: true, aborted: false, dry_run: false, rows: [
    { sheet: 'members', row: 2, outcome: 'created' }, { sheet: 'members', row: 3, outcome: 'updated' },
    { sheet: 'members', row: 4, outcome: 'unchanged' }, { sheet: 'members', row: 5, outcome: 'skipped_exists' },
  ] } });
  const r = await run(body({ options: { on_error: 'skip_invalid' } }, {
    members: [member(2), member(3, { phone: '9876543211' }), member(4, { phone: '9876543212' }), member(5, { phone: '9876543213' }), member(6, { phone: '9876543214', deleted_at: '2026-01-01T00:00:00+00:00' }), member(7, { phone: '1' })],
  }));
  assertEquals((r.json!.summary as Record<string, unknown>).members, { created: 1, updated: 1, unchanged: 1, skipped_exists: 1, skipped_deleted: 1, error: 1 });
});
Deno.test('import-data: warnings are collected — the validator\'s and the database\'s, the latter with sheet and row', async () => {
  world.reset(); adminCaller();
  world.rpc['import_workbook'] = () => ({ data: { committed: true, aborted: false, dry_run: false, rows: [
    { sheet: 'members', row: 2, outcome: 'created', id: 1, warning: 'handled_by_email "x@y.z" is not an active user — left blank' },
  ] } });
  const r = await run(body());
  const warnings = r.json!.warnings as string[];
  assert(warnings.some((w) => w.startsWith('members row 2: handled_by_email "x@y.z"')));
  assert(warnings.some((w) => /no date of joining/.test(w)));
});

// ---- failures and logging --------------------------------------------------------------------------------------------
Deno.test('import-data: a database/RPC failure is a 500 carrying its message', async () => {
  world.reset(); adminCaller();
  world.rpc['import_workbook'] = () => ({ error: { message: 'canceling statement due to statement timeout' } });
  const r = await run(body());
  assertEquals(r.status, 500);
  assertMatch(String(r.json!.error), /statement timeout/);
});
Deno.test('import-data: the log line has the caller, flags and counts — never row contents', async () => {
  world.reset(); adminCaller(); scriptRpc();
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await run(body({}, { members: [member(2, { name: 'Private Person', aadhaar_number: '123412341234' })] }));
  } finally {
    console.info = original;
  }
  assertEquals(lines.length, 1);
  const log = JSON.parse(lines[0]);
  assertEquals([log.event, log.mode, log.caller, log.dry_run, log.committed], ['import-data', 'merge', 'caller-1', false, true]);
  assert(!/Private Person|123412341234|9876543210/.test(lines[0]));
});
