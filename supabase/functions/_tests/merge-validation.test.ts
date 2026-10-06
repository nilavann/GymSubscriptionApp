// import-data MERGE: request parsing + row validation + payload shaping (pure functions, no I/O).
// REQ-ADMIN-008, spec/backend/data-export-import.md §5.4 / §6.1.
import { assert, assertEquals, assertMatch } from './harness.ts';
import { MAX_ROWS, parseRequest, prepareMerge, validateMemberFields, type MergeRequest, type SheetName } from '../import-data/merge-validation.ts';

// ---- parity with the Add Member form ---------------------------------------------------------------------------------
// The SAME 62 cases are run by frontend/src/services/member-validation-parity.test.ts against validateNewMember, so the
// client rules and this server copy cannot drift apart without a test failing.
interface ParityCase { label: string; overrides: Record<string, unknown>; invalid: string[] }
const fixture = JSON.parse(await Deno.readTextFile(new URL('./fixtures/member-validation-cases.json', import.meta.url))) as {
  base: Record<string, unknown>;
  cases: ParityCase[];
};
for (const c of fixture.cases) {
  Deno.test(`parity (strict, = the Add Member form): ${c.label}`, () => {
    const flagged = Object.keys(validateMemberFields({ ...fixture.base, ...c.overrides }, true)).sort();
    assertEquals(flagged, c.invalid);
  });
}
Deno.test('parity fixture is substantial and has valid and invalid cases', () => {
  assert(fixture.cases.length >= 60);
  assert(fixture.cases.some((c) => c.invalid.length === 0) && fixture.cases.some((c) => c.invalid.length > 0));
});

// ---- non-strict (what an import actually runs) ------------------------------------------------------------------------
Deno.test('non-strict: blank cells are allowed (an UPDATE import means "no change"); the database enforces presence on create', () => {
  assertEquals(validateMemberFields({}, false), {});
  assertEquals(validateMemberFields({ name: '', phone: '', weight_kg: '', branch_code: null }, false), {});
});
Deno.test('non-strict: a PRESENT value must still be well-formed', () => {
  assertEquals(Object.keys(validateMemberFields({ name: 'A', phone: '12', weight_kg: '0', height_cm: '999', email: 'x', pincode: '1' }, false)).sort(),
    ['email', 'height_cm', 'name', 'phone', 'pincode', 'weight_kg']);
});
Deno.test('non-strict: doctor-care details are left to the database (an update may rely on stored details)', () => {
  assertEquals(validateMemberFields({ under_doctor_care: true, doctor_care_details: '' }, false), {});
});
Deno.test('dates must be REAL calendar dates in YYYY-MM-DD (the server is stricter than the form)', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '05/06/2026', '2026-1-5', '15-01-2026', 'yesterday', '2026-02-29']) {
    assertEquals(Object.keys(validateMemberFields({ date_of_birth: bad }, false)), ['date_of_birth'], bad);
    assertEquals(Object.keys(validateMemberFields({ date_of_joining: bad }, false)), ['date_of_joining'], bad);
  }
  for (const good of ['2026-02-28', '2024-02-29', '1990-12-31']) assertEquals(validateMemberFields({ date_of_birth: good }, false), {}, good);
});
Deno.test('gender must be one of the three values; under_doctor_care must be a boolean', () => {
  assertEquals(Object.keys(validateMemberFields({ gender: 'X' }, false)), ['gender']);
  assertEquals(validateMemberFields({ gender: 'Other' }, false), {});
  assertEquals(Object.keys(validateMemberFields({ under_doctor_care: 'yes' }, false)), ['under_doctor_care']);
  assertEquals(validateMemberFields({ under_doctor_care: null }, false), {});
});
Deno.test('numeric cells (not strings) are accepted for phone / weight, as an Excel number cell would arrive', () => {
  assertEquals(validateMemberFields({ phone: 9876543210, weight_kg: 62.5, height_cm: 160 }, false), {});
  assertEquals(Object.keys(validateMemberFields({ phone: 987654321 }, false)), ['phone']); // Excel dropped a leading zero
});

// ---- parseRequest -----------------------------------------------------------------------------------------------------
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ _row: i + 2, name: 'x', code: `C${i}` }));
const valid = (extra: Record<string, unknown> = {}) => ({ mode: 'merge', schema_version: 1, dry_run: true, sheets: { branches: rowsOf(1) }, ...extra });
const err = (body: unknown) => { const r = parseRequest(body); return r.ok ? null : r.error; };

Deno.test('parseRequest: a valid minimal request is accepted with safe defaults (add-only, all-or-nothing)', () => {
  const r = parseRequest(valid());
  assert(r.ok);
  if (r.ok) {
    assertEquals([r.request.dryRun, r.request.updateExisting, r.request.onError], [true, false, 'abort']);
    assertEquals(r.request.sheets.branches.length, 1);
    assertEquals(r.request.sheets.members, []);
  }
});
for (const body of [null, 'x', 7, [], undefined]) {
  Deno.test(`parseRequest: body ${JSON.stringify(body)} is rejected`, () => assertMatch(String(err(body)), /JSON object/));
}
Deno.test('parseRequest: only mode "merge" exists for now (restore is not available yet)', () => {
  for (const mode of [undefined, 'restore', 'MERGE', '', 1]) assertMatch(String(err(valid({ mode }))), /Unsupported mode/);
});
Deno.test('parseRequest: schema_version must be a positive whole number the server understands', () => {
  for (const v of [undefined, 0, -1, 1.5, '1', null]) assertMatch(String(err(valid({ schema_version: v }))), /whole number/);
  assertMatch(String(err(valid({ schema_version: 2 }))), /newer version of the app \(schema_version 2\)/);
});
Deno.test('parseRequest: dry_run is REQUIRED and boolean — a forgotten flag can never commit an import', () => {
  for (const v of [undefined, null, 'true', 1, 0]) assertMatch(String(err(valid({ dry_run: v }))), /dry_run must be true or false/);
});
Deno.test('parseRequest: options are validated', () => {
  assertMatch(String(err(valid({ options: 'x' }))), /options must be an object/);
  assertMatch(String(err(valid({ options: { update_existing: 'yes' } }))), /update_existing/);
  assertMatch(String(err(valid({ options: { on_error: 'ignore' } }))), /on_error/);
  const r = parseRequest(valid({ options: { update_existing: true, on_error: 'skip_invalid' } }));
  assert(r.ok && r.request.updateExisting && r.request.onError === 'skip_invalid');
});
Deno.test('parseRequest: sheets must be a known set of lists of objects with _row numbers', () => {
  assertMatch(String(err(valid({ sheets: 'x' }))), /sheets must be an object/);
  assertMatch(String(err(valid({ sheets: { users: [{ _row: 2 }] } }))), /Unknown sheet "users"/);
  assertMatch(String(err(valid({ sheets: { audit_log: [{ _row: 2 }] } }))), /Unknown sheet "audit_log"/);
  assertMatch(String(err(valid({ sheets: { branches: {} } }))), /must be a list of rows/);
  assertMatch(String(err(valid({ sheets: { branches: [1] } }))), /must be an object/);
  for (const bad of [undefined, 0, -3, 1.5, '2']) assertMatch(String(err(valid({ sheets: { branches: [{ _row: bad, code: 'X' }] } }))), /_row number/);
});
Deno.test('parseRequest: no rows at all is refused, and so is more than the row cap (in total, across sheets)', () => {
  assertMatch(String(err(valid({ sheets: {} }))), /no rows to import/);
  assertMatch(String(err(valid({ sheets: { branches: [] } }))), /no rows to import/);
  assert(parseRequest(valid({ sheets: { branches: rowsOf(MAX_ROWS) } })).ok, 'exactly at the cap is fine');
  assertMatch(String(err(valid({ sheets: { branches: rowsOf(MAX_ROWS + 1) } }))), /2,000 can be imported at once/);
  assertMatch(String(err(valid({ sheets: { branches: rowsOf(1500), members: rowsOf(501) } }))), /2001 rows/);
});

// ---- prepareMerge -----------------------------------------------------------------------------------------------------
type Sheets = Partial<Record<SheetName, Record<string, unknown>[]>>;
function prep(sheets: Sheets, opts: Partial<MergeRequest> = {}) {
  const full = { branches: [], plans: [], members: [], subscriptions: [], subscription_items: [], ...sheets } as unknown as MergeRequest['sheets'];
  return prepareMerge({ dryRun: true, updateExisting: false, onError: 'abort', sheets: full, ...opts });
}
const member = (row: number, extra: Record<string, unknown> = {}) => ({
  _row: row, name: 'Asha Rao', phone: '9876543210', date_of_birth: '1990-05-01', gender: 'Female', weight_kg: 62.5, height_cm: 160,
  emergency_contact_name: 'Raj', emergency_contact_phone: '9123456780', emergency_contact_relationship: 'Spouse', branch_code: 'MUM', ...extra,
});
const outcomeOf = (p: ReturnType<typeof prep>, sheet: string, row: number) => p.outcomes.find((o) => o.sheet === sheet && o.row === row);

Deno.test('prepare: an empty valid file produces an empty payload and no outcomes', () => {
  const p = prep({});
  assertEquals([p.validRowCount, p.errorCount, p.outcomes.length], [0, 0, 0]);
});

// -- branches
Deno.test('prepare branches: valid rows pass through trimmed; code is the key and is required', () => {
  const p = prep({ branches: [{ _row: 2, name: '  Pune ', code: ' PUN ' }, { _row: 3, name: 'No code' }, { _row: 4, code: 'X'.repeat(81) }] });
  assertEquals(p.rpcPayload.branches, [{ row: 2, name: 'Pune', code: 'PUN' }]);
  assertEquals(outcomeOf(p, 'branches', 3)?.message, 'Branch code is required');
  assertMatch(String(outcomeOf(p, 'branches', 4)?.message), /too long/);
});
Deno.test('prepare branches: a duplicate code later in the file is an error pointing at the first row', () => {
  const p = prep({ branches: [{ _row: 2, code: 'PUN', name: 'A' }, { _row: 9, code: 'PUN', name: 'B' }] });
  assertEquals(p.rpcPayload.branches, [{ row: 2, name: 'A', code: 'PUN' }]);
  assertEquals(outcomeOf(p, 'branches', 9)?.message, 'Duplicate of row 2');
});

// -- plans
Deno.test('prepare plans: formats are checked, blanks become null, and valid rows keep their numbers as numbers', () => {
  const p = prep({ plans: [{ _row: 2, name: 'Monthly', category: 'membership', duration_days: '30', price: '1000.50', max_members: '' }, { _row: 3, name: 'Locker', category: 'addon', price: 200 }] });
  assertEquals(p.rpcPayload.plans, [
    { row: 2, name: 'Monthly', category: 'membership', duration_days: 30, price: 1000.5, max_members: null },
    { row: 3, name: 'Locker', category: 'addon', duration_days: null, price: 200, max_members: null },
  ]);
});
Deno.test('prepare plans: each bad format is its own clear error', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ name: '' }, /Plan name is required/],
    [{ name: 'x'.repeat(81) }, /at most 80/],
    [{ category: 'bundle' }, /membership.*addon/],
    [{ duration_days: '0' }, /whole number of days/],
    [{ duration_days: '2.5' }, /whole number of days/],
    [{ duration_days: '-3' }, /whole number of days/],
    [{ price: '-1' }, /Price must be/],
    [{ price: 'free' }, /Price must be/],
    [{ price: '100000000' }, /Price must be/],
    [{ max_members: '3' }, /1 or 2/],
    [{ category: 'addon', max_members: '2' }, /Add-ons cannot cover more than 1 member/],
  ];
  for (const [extra, re] of cases) {
    const p = prep({ plans: [{ _row: 2, name: 'P', category: 'membership', price: 1, ...extra }] });
    assertMatch(String(outcomeOf(p, 'plans', 2)?.message), re, JSON.stringify(extra));
  }
});
Deno.test('prepare plans: a duplicate plan name later in the file is an error', () => {
  const p = prep({ plans: [{ _row: 2, name: 'A', category: 'addon', price: 1 }, { _row: 5, name: 'A', category: 'addon', price: 2 }] });
  assertEquals(outcomeOf(p, 'plans', 5)?.message, 'Duplicate of row 2');
});

// -- members
Deno.test('prepare members: a valid row is normalised for the RPC (phone digits, trimmed text, parsed numbers, nulls for blanks)', () => {
  const p = prep({ members: [member(2, { phone: '98 76 54 32 10', name: '  Asha Rao ', weight_kg: '62.5', email: '', occupation: ' Teacher ', under_doctor_care: false })] });
  const m = (p.rpcPayload.members as Record<string, unknown>[])[0];
  assertEquals([m.row, m.phone, m.name, m.weight_kg, m.email, m.occupation, m.under_doctor_care], [2, '9876543210', 'Asha Rao', 62.5, null, 'Teacher', false]);
  assertEquals([m.date_of_joining, m.handled_by_email, m.doctor_care_details], [null, null, null]);
});
Deno.test('prepare members: the phone (the match key) is required even though other blanks are allowed', () => {
  const p = prep({ members: [member(2, { phone: '' })] });
  assertMatch(String(outcomeOf(p, 'members', 2)?.message), /Phone is required/);
});
Deno.test('prepare members: format errors are reported per row, all together', () => {
  const p = prep({ members: [member(2, { name: 'A', phone: '12345', pincode: '12', email: 'x' })] });
  const msg = String(outcomeOf(p, 'members', 2)?.message);
  for (const part of ['Name must be 2-80 characters', 'Enter a valid 10-digit phone number', 'Must be exactly 6 digits', 'Enter a valid email address']) assert(msg.includes(part), part);
});
Deno.test('prepare members: a duplicate phone (even with different spacing) later in the file is an error', () => {
  const p = prep({ members: [member(2), member(7, { phone: '98765 43210' })] });
  assertEquals(outcomeOf(p, 'members', 7)?.message, 'Duplicate of row 2');
  assertEquals((p.rpcPayload.members as unknown[]).length, 1);
});
Deno.test('prepare members: a missing date of joining is accepted but warned about once, with a count', () => {
  const p = prep({ members: [member(2), member(3, { phone: '9876543211' }), member(4, { phone: '9876543212', date_of_joining: '2026-01-01' })] });
  assertEquals(p.warnings.length, 1);
  assertMatch(p.warnings[0], /^2 new member row\(s\) have no date of joining/);
});
Deno.test('prepare members: handled_by_email longer than an email can be is refused', () => {
  const p = prep({ members: [member(2, { handled_by_email: 'a'.repeat(255) })] });
  assertMatch(String(outcomeOf(p, 'members', 2)?.message), /handled_by_email is too long/);
});

// -- deleted rows, odd cells
Deno.test('prepare: rows with a deleted_at are skipped (reported as skipped_deleted), never sent to the database', () => {
  const p = prep({
    branches: [{ _row: 2, code: 'OLD', name: 'Old', deleted_at: '2026-01-01T00:00:00+00:00' }],
    plans: [{ _row: 2, name: 'Old', category: 'addon', price: 1, deleted_at: '2026-01-01T00:00:00+00:00' }],
    members: [member(2, { deleted_at: '2026-01-01T00:00:00+00:00' }), member(3, { phone: '9876543299' })],
  });
  assertEquals(outcomeOf(p, 'branches', 2)?.outcome, 'skipped_deleted');
  assertEquals(outcomeOf(p, 'plans', 2)?.outcome, 'skipped_deleted');
  assertEquals(outcomeOf(p, 'members', 2)?.outcome, 'skipped_deleted');
  assertEquals([(p.rpcPayload.branches as unknown[]).length, (p.rpcPayload.plans as unknown[]).length, (p.rpcPayload.members as unknown[]).length], [0, 0, 1]);
  assertEquals(p.errorCount, 0);
});
Deno.test('prepare: info columns from an export (id, created_by, member_number, photo_url …) never reach the database', () => {
  const p = prep({ members: [member(2, { id: 99, created_by: 'u1', member_number: 'HACK-1', photo_url: 'x/y.jpg', branch_id: 7, deleted_by: null })] });
  const m = (p.rpcPayload.members as Record<string, unknown>[])[0];
  for (const key of ['id', 'created_by', 'member_number', 'photo_url', 'branch_id', 'deleted_by', '_row']) assert(!(key in m), `${key} must not be forwarded`);
});
Deno.test('prepare: a cell holding an object/array, a control character, or a runaway string is rejected', () => {
  const p = prep({ members: [member(2, { occupation: { a: 1 } }), member(3, { phone: '9876543211', occupation: 'a\u0001b' }), member(4, { phone: '9876543212', residential_address: 'x'.repeat(1001) })] });
  assertMatch(String(outcomeOf(p, 'members', 2)?.message), /unsupported value/);
  assertMatch(String(outcomeOf(p, 'members', 3)?.message), /characters that are not allowed/);
  assertMatch(String(outcomeOf(p, 'members', 4)?.message), /longer than 1000/);
  assertEquals(p.validRowCount, 0);
});
Deno.test('prepare: text that merely LOOKS like a formula is just text — stored as given, never evaluated', () => {
  const p = prep({ members: [member(2, { occupation: '=HYPERLINK("http://x")', residential_address: '+91 Road' })] });
  const m = (p.rpcPayload.members as Record<string, unknown>[])[0];
  assertEquals([m.occupation, m.residential_address], ['=HYPERLINK("http://x")', '+91 Road']);
});

// -- subscriptions
const sub = (row: number, ref: string | number, extra: Record<string, unknown> = {}) => ({ _row: row, subscription_ref: ref, member_phone: '9876543210', ...extra });
const item = (row: number, ref: string | number, extra: Record<string, unknown> = {}) => ({
  _row: row, subscription_ref: ref, plan_name: 'Monthly', member_phone: '9876543210', start_date: '2026-01-15', ...extra,
});
Deno.test('prepare subscriptions: items are grouped under their subscription_ref, normalised, and sent as ONE nested subscription', () => {
  const p = prep({
    subscriptions: [sub(2, 7, { payment_mode: 'UPI', notes: ' hi ' })],
    subscription_items: [item(2, 7), item(3, 7, { plan_name: 'Zumba Class', quantity: '2', amount_paid: '1600', shared_member_phone: '98765 43211' })],
  });
  assertEquals(p.rpcPayload.subscriptions, [{
    row: 2, member_phone: '9876543210', payment_mode: 'UPI', notes: 'hi',
    items: [
      { plan_name: 'Monthly', member_phone: '9876543210', shared_member_phone: null, start_date: '2026-01-15', quantity: null, amount_paid: null },
      { plan_name: 'Zumba Class', member_phone: '9876543210', shared_member_phone: '9876543211', start_date: '2026-01-15', quantity: 2, amount_paid: 1600 },
    ],
  }]);
  assertEquals(p.errorCount, 0);
});
Deno.test('prepare subscriptions: end_date in the file is ignored — it is not even forwarded (the database recomputes it)', () => {
  const p = prep({ subscriptions: [sub(2, 1)], subscription_items: [item(2, 1, { end_date: '1999-01-01' })] });
  const items = ((p.rpcPayload.subscriptions as Record<string, unknown>[])[0].items as Record<string, unknown>[]);
  assert(!('end_date' in items[0]));
});
Deno.test('prepare subscriptions: header problems are errors (key, member phone, payment mode, duplicates)', () => {
  const p = prep({
    subscriptions: [sub(2, ''), sub(3, 'A', { member_phone: '' }), sub(4, 'B', { member_phone: '123' }), sub(5, 'C', { payment_mode: 'Cheque' }), sub(6, 'D'), sub(7, 'D')],
    subscription_items: [item(2, 'D')],
  });
  assertMatch(String(outcomeOf(p, 'subscriptions', 2)?.message), /subscription_ref is required/);
  assertMatch(String(outcomeOf(p, 'subscriptions', 3)?.message), /Member phone is required/);
  assertMatch(String(outcomeOf(p, 'subscriptions', 4)?.message), /valid 10-digit/);
  assertMatch(String(outcomeOf(p, 'subscriptions', 5)?.message), /Cash, UPI or Card/);
  assertEquals(outcomeOf(p, 'subscriptions', 7)?.message, 'Duplicate of row 6');
});
Deno.test('prepare subscriptions: a subscription with no item rows is an error', () => {
  const p = prep({ subscriptions: [sub(2, 'X')] });
  assertMatch(String(outcomeOf(p, 'subscriptions', 2)?.message), /has no item rows/);
});
Deno.test('prepare subscriptions: an item pointing at an unknown subscription_ref is an error on the ITEM row', () => {
  const p = prep({ subscription_items: [item(2, 'GHOST')] });
  assertMatch(String(outcomeOf(p, 'subscription_items', 2)?.message), /No subscription with subscription_ref "GHOST"/);
});
Deno.test('prepare subscriptions: one invalid item stops the WHOLE subscription (it is created whole or not at all)', () => {
  const p = prep({ subscriptions: [sub(2, 1)], subscription_items: [item(2, 1), item(3, 1, { start_date: '05/06/2026' })] });
  assertMatch(String(outcomeOf(p, 'subscription_items', 3)?.message), /Start date must be a real date/);
  assertMatch(String(outcomeOf(p, 'subscriptions', 2)?.message), /one of its item rows has an error/);
  assertEquals((p.rpcPayload.subscriptions as unknown[]).length, 0);
});
Deno.test('prepare subscriptions: item field rules', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ plan_name: '' }, /Plan name is required/],
    [{ member_phone: '' }, /Member phone is required/],
    [{ member_phone: '1' }, /valid 10-digit/],
    [{ shared_member_phone: '1' }, /Shared member phone/],
    [{ start_date: '' }, /Start date is required/],
    [{ start_date: '2026-02-30' }, /real date/],
    [{ quantity: '0' }, /Quantity must be/],
    [{ quantity: '1.5' }, /Quantity must be/],
    [{ amount_paid: '-5' }, /Amount paid/],
    [{ amount_paid: 'lots' }, /Amount paid/],
  ];
  for (const [extra, re] of cases) {
    const p = prep({ subscriptions: [sub(2, 1)], subscription_items: [item(2, 1, extra)] });
    assertMatch(String(outcomeOf(p, 'subscription_items', 2)?.message), re, JSON.stringify(extra));
  }
});
Deno.test('prepare subscriptions: a deleted subscription skips its items too; a deleted item is skipped alone', () => {
  const p = prep({
    subscriptions: [sub(2, 'GONE', { deleted_at: '2026-01-01T00:00:00+00:00' }), sub(3, 'LIVE')],
    subscription_items: [item(2, 'GONE'), item(3, 'LIVE'), item(4, 'LIVE', { plan_name: 'Old', deleted_at: '2026-01-01T00:00:00+00:00' })],
  });
  assertEquals(outcomeOf(p, 'subscriptions', 2)?.outcome, 'skipped_deleted');
  assertEquals(outcomeOf(p, 'subscription_items', 2)?.outcome, 'skipped_deleted');
  assertEquals(outcomeOf(p, 'subscription_items', 4)?.outcome, 'skipped_deleted');
  const subs = p.rpcPayload.subscriptions as { items: unknown[] }[];
  assertEquals([subs.length, subs[0].items.length], [1, 1]);
  assertEquals(p.errorCount, 0);
});
Deno.test('prepare: errorCount and validRowCount add up', () => {
  const p = prep({ branches: [{ _row: 2, code: 'A', name: 'a' }, { _row: 3, name: 'no code' }], members: [member(2), member(3, { phone: '1' })] });
  assertEquals([p.errorCount, p.validRowCount], [2, 2]);
});
