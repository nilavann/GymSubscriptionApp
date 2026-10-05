// export-data (REQ-ADMIN-007, spec/backend/data-export-import.md §4): admin-only, whitelisted, explicit columns,
// deliberately INCLUDES soft-deleted rows, never credentials, paged so a server-side row cap cannot truncate a backup.
import { assert, assertEquals, assertMatch, call, loadFunction, world, adminCaller } from './harness.ts';

const fn = () => loadFunction('export-data');
const reads = (table: string) => world.log.filter((l) => l.kind === 'query' && l.name === table);
const anyQuery = () => world.log.some((l) => l.kind === 'query');

const AUDIT = ['created_at', 'created_by', 'changed_at', 'changed_by'];
const SOFT = ['deleted_at', 'deleted_by'];
const info = (cols: string[]) => ['id', ...cols, ...AUDIT, ...SOFT];

// A second, independent copy of "every column of every table" — it is the check against the function's own list,
// so adding a column to a table (or to the function) without updating spec §3.3 + both lists fails here.
const EXPECTED: Record<string, { from: string; columns: string[]; paged: boolean }> = {
  branches: { from: 'branches', paged: true, columns: info(['name', 'code']) },
  plans: { from: 'plans', paged: true, columns: info(['name', 'category', 'duration_days', 'price', 'max_members']) },
  roles: { from: 'roles', paged: true, columns: info(['name', 'description']) },
  members: {
    from: 'members',
    paged: true,
    columns: info([
      'name', 'phone', 'date_of_birth', 'date_of_joining', 'gender', 'weight_kg', 'height_cm', 'under_doctor_care',
      'doctor_care_details', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
      'email', 'residential_address', 'pincode', 'aadhaar_number', 'occupation', 'photo_url', 'photo_thumbnail_url',
      'branch_id', 'member_number', 'handled_by_staff',
    ]),
  },
  subscriptions: { from: 'subscriptions', paged: true, columns: info(['member_id', 'payment_mode', 'notes']) },
  subscription_items: {
    from: 'subscription_items',
    paged: true,
    columns: info(['subscription_id', 'plan_id', 'member_id', 'shared_member_id', 'start_date', 'end_date', 'quantity', 'amount_paid']),
  },
  audit_log: {
    from: 'audit_log',
    paged: true,
    columns: ['id', 'change_id', 'table_name', 'record_id', 'field_name', 'old_value', 'new_value', 'operation', 'changed_by', 'changed_at'],
  },
  configuration: { from: 'configuration', paged: false, columns: ['key', 'value', 'description', ...AUDIT] },
  member_number_sequences: { from: 'member_number_sequences', paged: false, columns: ['branch_id', 'last_sequence'] },
  user_roles: { from: 'user_roles', paged: false, columns: ['user_id', 'role_id', 'granted_at', 'granted_by'] },
  users: { from: 'profiles', paged: false, columns: info(['full_name', 'is_active']) },
};

function script(table: string, rows: Record<string, unknown>[] = []) {
  world.tables[EXPECTED[table].from] = () => ({ data: rows, count: rows.length });
}

// ---- transport ----------------------------------------------------------------------------------------------------------
Deno.test('ADMIN-007 export-data: OPTIONS answers CORS preflight, other methods are 405', async () => {
  world.reset();
  const options = await call(await fn(), { method: 'OPTIONS' });
  assertEquals(options.status, 200);
  assertEquals((await call(await fn(), { method: 'GET' })).status, 405);
});

// ---- auth gates (spec §4.2 steps 1-2) -------------------------------------------------------------------------------------
Deno.test('ADMIN-007 export-data: no Authorization header -> 401, nothing read', async () => {
  world.reset(); adminCaller();
  const r = await call(await fn(), { auth: null, body: { table: 'members' } });
  assertEquals(r.status, 401);
  assert(!anyQuery(), 'no table touched');
});
Deno.test('ADMIN-007 export-data: invalid or expired session -> 401, nothing read', async () => {
  world.reset(); adminCaller();
  world.user = null;
  const r = await call(await fn(), { body: { table: 'members' } });
  assertEquals(r.status, 401);
  assert(!anyQuery());
});
Deno.test('ADMIN-007 export-data: a non-admin gets 403 BEFORE any table is read (even for a valid request)', async () => {
  world.reset(); adminCaller(false);
  script('members', [{ id: 1, name: 'Secret Member' }]);
  const r = await call(await fn(), { body: { table: 'members' } });
  assertEquals(r.status, 403);
  assertMatch(String(r.json!.error), /Admin access required/);
  assert(!anyQuery(), 'staff never reach a table');
  assert(!r.text.includes('Secret Member'));
  assertEquals(world.log.find((l) => l.kind === 'rpc')!.args, { p_user_id: 'caller-1' });
});
Deno.test('ADMIN-007 export-data: a failing admin check is a 500, not a pass', async () => {
  world.reset();
  world.rpc['is_admin_user'] = () => ({ error: { message: 'rpc down' } });
  const r = await call(await fn(), { body: { table: 'members' } });
  assertEquals(r.status, 500);
  assert(!anyQuery());
});

// ---- request validation (spec §4.2 step 3) --------------------------------------------------------------------------------
Deno.test('ADMIN-007 export-data: malformed or non-object JSON is a 400, not a 500', async () => {
  world.reset(); adminCaller();
  assertEquals((await call(await fn(), { rawBody: 'not json' })).status, 400);
  assertEquals((await call(await fn(), { rawBody: 'null' })).status, 400);
  assert(!anyQuery());
});
for (const table of ['profiles', 'auth.users', 'pg_catalog.pg_user', 'storage.objects', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 123, null, ['members']]) {
  Deno.test(`ADMIN-007 export-data: table ${JSON.stringify(table)} is not on the whitelist -> 400, nothing read`, async () => {
    world.reset(); adminCaller();
    const r = await call(await fn(), { body: { table } });
    assertEquals(r.status, 400);
    assertMatch(String(r.json!.error), /Unknown table/);
    assert(!anyQuery());
  });
}
for (const limit of [0, -1, 1001, 1.5, '10', true, {}]) {
  Deno.test(`ADMIN-007 export-data: limit ${JSON.stringify(limit)} is rejected -> 400`, async () => {
    world.reset(); adminCaller();
    assertEquals((await call(await fn(), { body: { table: 'members', limit } })).status, 400);
    assert(!anyQuery());
  });
}
for (const after of [-1, 1.5, '5', true, {}]) {
  Deno.test(`ADMIN-007 export-data: after ${JSON.stringify(after)} is rejected -> 400`, async () => {
    world.reset(); adminCaller();
    assertEquals((await call(await fn(), { body: { table: 'members', after } })).status, 400);
    assert(!anyQuery());
  });
}

// ---- explicit columns, no secrets (spec §4.1) -----------------------------------------------------------------------------
for (const [table, spec] of Object.entries(EXPECTED)) {
  Deno.test(`ADMIN-007 export-data: ${table} selects exactly its explicit column list (never *)`, async () => {
    world.reset(); adminCaller(); script(table);
    const r = await call(await fn(), { body: { table } });
    assertEquals(r.status, 200);
    const q = reads(spec.from)[0].q!;
    assertEquals(q.arg('select')![0], spec.columns.join(', '));
    assert(!/\*/.test(String(q.arg('select')![0])), 'never select *');
  });
}
Deno.test('ADMIN-007 export-data: no exported column can carry a credential, token or secret', () => {
  for (const [table, spec] of Object.entries(EXPECTED)) {
    for (const column of spec.columns) {
      assert(!/password|hash|token|secret|encrypted|identit|provider|otp|salt/i.test(column), `${table}.${column} looks sensitive`);
    }
  }
});

// ---- soft-deleted rows ARE exported (spec §4.3) --------------------------------------------------------------------------
Deno.test('ADMIN-007 export-data: soft-deleted rows are returned and the query adds NO deleted_at filter (the one documented exception to rule 21)', async () => {
  world.reset(); adminCaller();
  const live = { id: 1, name: 'Live', deleted_at: null, deleted_by: null };
  const gone = { id: 2, name: 'Gone', deleted_at: '2026-03-01T10:00:00.123456+00:00', deleted_by: 'admin-1' };
  script('members', [live, gone]);
  const r = await call(await fn(), { body: { table: 'members' } });
  assertEquals(r.status, 200);
  assertEquals(r.json!.rows, [live, gone]);
  const q = reads('members')[0].q!;
  assert(!q.ops.some(([m]) => m === 'is'), 'no .is() filter');
  assert(!q.ops.some(([m, a]) => m === 'eq' && String(a[0]) === 'deleted_at'), 'no deleted_at equality filter');
  assertEquals((r.json!.rows as Record<string, unknown>[])[1].deleted_at, '2026-03-01T10:00:00.123456+00:00', 'timestamps pass through verbatim');
});

// ---- pagination (spec §4.1) -----------------------------------------------------------------------------------------------
Deno.test('ADMIN-007 export-data: first page — keyset query ascending by id, default limit, no gt filter', async () => {
  world.reset(); adminCaller(); script('members', [{ id: 3 }, { id: 7 }]);
  const r = await call(await fn(), { body: { table: 'members' } });
  const q = reads('members')[0].q!;
  assert(!q.ops.some(([m]) => m === 'gt'));
  assertEquals(q.arg('order'), ['id', { ascending: true }]);
  assertEquals(q.arg('limit'), [500]);
  assertEquals(r.json!.next, 7, 'next is the last id returned');
});
Deno.test('ADMIN-007 export-data: after=N becomes id > N and the requested limit is used', async () => {
  world.reset(); adminCaller(); script('audit_log', [{ id: 1001 }]);
  await call(await fn(), { body: { table: 'audit_log', after: 1000, limit: 250 } });
  const q = reads('audit_log')[0].q!;
  assert(q.has('gt', 'id', 1000));
  assertEquals(q.arg('limit'), [250]);
});
Deno.test('ADMIN-007 export-data: the LAST page is an empty one (next: null) — a short page never ends the export', async () => {
  world.reset(); adminCaller();
  // Server row cap lower than the page size asked: 3 rows come back for limit 1000. Must still say "keep going".
  script('members', [{ id: 1 }, { id: 2 }, { id: 3 }]);
  const short = await call(await fn(), { body: { table: 'members', limit: 1000 } });
  assertEquals(short.json!.next, 3);
  script('members', []);
  const empty = await call(await fn(), { body: { table: 'members', after: 3, limit: 1000 } });
  assertEquals(empty.json, { rows: [], next: null, project_ref: 'localhost' });
});
Deno.test('ADMIN-007 export-data: response carries the project ref taken from SUPABASE_URL', async () => {
  world.reset(); adminCaller(); script('branches', [{ id: 1 }]);
  const r = await call(await fn(), { body: { table: 'branches' } });
  assertEquals(r.json!.project_ref, 'localhost');
});

// ---- single-page tables ---------------------------------------------------------------------------------------------------
for (const table of ['configuration', 'member_number_sequences', 'user_roles']) {
  Deno.test(`ADMIN-007 export-data: ${table} is one page (next: null), no keyset filters`, async () => {
    world.reset(); adminCaller();
    const rows = [{ x: 1 }, { x: 2 }];
    script(table, rows);
    const r = await call(await fn(), { body: { table, after: 99 } });
    assertEquals(r.status, 200);
    assertEquals(r.json!.rows, rows);
    assertEquals(r.json!.next, null);
    const q = reads(EXPECTED[table].from)[0].q!;
    assert(!q.ops.some(([m]) => m === 'gt' || m === 'limit'));
    assertEquals(q.arg('select')![1], { count: 'exact' });
  });
}
Deno.test('ADMIN-007 export-data: a single-page table larger than the server returned fails loudly instead of truncating', async () => {
  world.reset(); adminCaller();
  world.tables['user_roles'] = () => ({ data: [{ user_id: 'u1' }], count: 5 });
  const r = await call(await fn(), { body: { table: 'user_roles' } });
  assertEquals(r.status, 500);
  assertMatch(String(r.json!.error), /more rows than fit in one export page \(1 of 5\)/);
});

// ---- users (profiles + auth email) ---------------------------------------------------------------------------------------
Deno.test('ADMIN-007 export-data: users = profiles (INCLUDING deleted ones) + login email, nothing else from auth.users', async () => {
  world.reset(); adminCaller();
  // The database returns every selected column, so the fixtures carry the full column set.
  const profile = (overrides: Record<string, unknown>) =>
    ({ ...Object.fromEntries(EXPECTED.users.columns.map((c) => [c, null])), ...overrides }) as Record<string, unknown>;
  const live = profile({ id: 'u1', full_name: 'Asha', is_active: true });
  const gone = profile({ id: 'u2', full_name: 'Ravi', is_active: false, deleted_at: '2026-02-01T00:00:00+00:00', deleted_by: 'u1' });
  const orphan = profile({ id: 'u3', full_name: 'No Auth Row', is_active: true });
  script('users', [live, gone, orphan]);
  world.listUsersPages = [[
    { id: 'u1', email: 'asha@example.com', encrypted_password: 'SECRET-HASH', phone: '999' } as never,
    { id: 'u2', email: 'ravi@example.com', raw_app_meta_data: { provider: 'google' } } as never,
  ]];
  const r = await call(await fn(), { body: { table: 'users' } });
  assertEquals(r.status, 200);
  const rows = r.json!.rows as Record<string, unknown>[];
  assertEquals(rows.map((x) => x.id), ['u1', 'u2', 'u3']);
  assertEquals(rows.map((x) => x.email), ['asha@example.com', 'ravi@example.com', null]);
  assertEquals(rows[1].deleted_by, 'u1', 'deleted profile is exported, flagged');
  for (const row of rows) assertEquals(Object.keys(row).sort(), [...EXPECTED.users.columns, 'email'].sort());
  assert(!/SECRET-HASH|encrypted_password|raw_app_meta_data|phone/.test(r.text), 'nothing else from auth.users leaks');
  assert(!reads('profiles')[0].q!.ops.some(([m]) => m === 'is'), 'deleted profiles are not filtered out');
});
Deno.test('ADMIN-007 export-data: users pages through auth.admin.listUsers until a short page', async () => {
  world.reset(); adminCaller();
  const profiles = [{ id: 'late', full_name: 'Late', is_active: true, deleted_at: null, deleted_by: null }];
  script('users', profiles);
  const full = Array.from({ length: 200 }, (_, i) => ({ id: `filler-${i}`, email: `f${i}@example.com` }));
  world.listUsersPages = [full, [{ id: 'late', email: 'late@example.com' }]];
  const r = await call(await fn(), { body: { table: 'users' } });
  assertEquals((r.json!.rows as Record<string, unknown>[])[0].email, 'late@example.com', 'found on page 2');
});

// ---- failures + logging ---------------------------------------------------------------------------------------------------
Deno.test('ADMIN-007 export-data: a database error is a 500 with the message', async () => {
  world.reset(); adminCaller();
  world.tables['members'] = () => ({ error: { message: 'relation exploded' } });
  const r = await call(await fn(), { body: { table: 'members' } });
  assertEquals(r.status, 500);
  assertMatch(String(r.json!.error), /relation exploded/);
});
Deno.test('ADMIN-007 export-data: the log line records caller, table and counts — never row contents', async () => {
  world.reset(); adminCaller(); script('members', [{ id: 9, name: 'Private Person', aadhaar_number: '123412341234' }]);
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await call(await fn(), { body: { table: 'members', after: 4 } });
  } finally {
    console.info = original;
  }
  assertEquals(lines.length, 1);
  assertEquals(JSON.parse(lines[0]), { event: 'export-data', caller: 'caller-1', table: 'members', rows: 1, after: 4 });
  assert(!/Private Person|123412341234/.test(lines[0]));
});
