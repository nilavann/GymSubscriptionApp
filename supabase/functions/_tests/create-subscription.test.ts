// REQ-SUB-001..009 server-side enforcement in create-subscription.
import { assert, assertEquals, assertMatch, call, loadFunction, world, activeCaller, knownGap } from './harness.ts';

type PlanRow = { id: number; name: string; category: 'membership' | 'addon'; duration_days: number | null; price: number; max_members: number };
const PLANS: PlanRow[] = [
  { id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1000, max_members: 1 },
  { id: 2, name: 'Couple Monthly', category: 'membership', duration_days: 30, price: 1800, max_members: 2 },
  { id: 3, name: 'Membership Fee', category: 'addon', duration_days: null, price: 500, max_members: 1 },
  { id: 4, name: 'Zumba Class', category: 'addon', duration_days: 30, price: 800, max_members: 1 },
  { id: 5, name: 'Day Pass', category: 'membership', duration_days: 1, price: 100, max_members: 1 },
];

function setup(rpcResult: { data?: unknown; error?: { message: string } | null } = { data: { subscription: { id: 99 }, items: [] } }) {
  world.reset();
  activeCaller();
  world.tables['plans'] = (q) => {
    const ids = (q.arg('in') ?? [])[1] as number[];
    return { data: PLANS.filter((p) => ids.includes(p.id)) };
  };
  world.rpc['create_subscription_with_items'] = () => rpcResult;
}
const item = (o: Record<string, unknown> = {}) => ({ plan_id: 1, member_id: 7, shared_member_id: null, start_date: '2026-07-15', quantity: null, amount_paid: null, ...o });
const body = (items: unknown[], o: Record<string, unknown> = {}) => ({ member_id: 7, payment_mode: 'Cash', notes: null, items, ...o });
const rpcItems = () => (world.log.find((l) => l.kind === 'rpc')!.args as { p_items: Record<string, unknown>[] }).p_items;
const rpcArgs = () => world.log.find((l) => l.kind === 'rpc')!.args as Record<string, unknown>;

Deno.test('SUB-001 happy path: 201, one RPC call carrying the header + every item, caller id attributed', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item(), item({ plan_id: 4 })], { notes: 'n', payment_mode: 'UPI' }) });
  assertEquals(r.status, 201);
  assertEquals(world.log.filter((l) => l.kind === 'rpc').length, 1);
  const a = rpcArgs();
  assertEquals([a.p_caller_id, a.p_member_id, a.p_payment_mode, a.p_notes], ['caller-1', 7, 'UPI', 'n']);
  assertEquals(rpcItems().length, 2);
});

Deno.test('SUB-001 required top-level fields', async () => {
  for (const b of [{ items: [item()], payment_mode: 'Cash' }, { member_id: 7, items: [item()] }]) {
    setup();
    assertEquals((await call(await loadFunction('create-subscription'), { body: b })).status, 400);
  }
});
Deno.test('SUB-001 at least one item is required (missing / empty / not an array)', async () => {
  for (const items of [undefined, [], 'x']) {
    setup();
    const r = await call(await loadFunction('create-subscription'), { body: { member_id: 7, payment_mode: 'Cash', items } });
    assertEquals(r.status, 400);
  }
});
Deno.test('SUB-001 each item needs plan_id, member_id and start_date', async () => {
  for (const bad of [{ member_id: 7, start_date: 'x' }, { plan_id: 1, start_date: '2026-01-01' }, { plan_id: 1, member_id: 7 }]) {
    setup();
    assertEquals((await call(await loadFunction('create-subscription'), { body: body([bad]) })).status, 400);
  }
});
Deno.test('SUB-001 a plan that does not exist (or is soft-deleted) is rejected naming the plan id', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 999 })]) });
  assertEquals(r.status, 400);
  assertMatch(String(r.json!.error), /999/);
});
Deno.test('SUB-001 exactly ONE membership item: zero is rejected', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 4 })]) });
  assertEquals(r.status, 400);
  assertMatch(String(r.json!.error), /exactly one membership/i);
  assertEquals(world.log.filter((l) => l.kind === 'rpc').length, 0);
});
Deno.test('SUB-001 exactly ONE membership item: two are rejected (even two different plans)', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 1 }), item({ plan_id: 5 })]) });
  assertEquals(r.status, 400);
  assertEquals(world.log.filter((l) => l.kind === 'rpc').length, 0);
});

Deno.test('SUB-009 end_date = start + duration x quantity - 1 (default quantity 1)', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ start_date: '2026-07-01' })]) });
  assertEquals(rpcItems()[0].end_date, '2026-07-30');
  assertEquals(rpcItems()[0].quantity, 1);
});
Deno.test('SUB-009 quantity multiplies duration AND default price (no discount)', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ start_date: '2026-07-01', quantity: 2 })]) });
  assertEquals(rpcItems()[0].end_date, '2026-08-29'); // 60 days
  assertEquals(rpcItems()[0].amount_paid, 2000);
});
Deno.test('SUB-009 x12 across a year boundary', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ start_date: '2026-12-01', quantity: 12 })]) });
  assertEquals(rpcItems()[0].end_date, '2027-11-25'); // 360 days
});
Deno.test('SUB-009 a 1-day plan ends the day it starts; leap-day arithmetic', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 5, start_date: '2028-02-29' })]) });
  assertEquals(rpcItems()[0].end_date, '2028-02-29');
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ start_date: '2028-02-01' })]) });
  assertEquals(rpcItems()[0].end_date, '2028-03-01'); // 30 days incl. Feb 29
});
Deno.test('SUB-009 invalid quantities rejected: 0, negative, fractional', async () => {
  for (const quantity of [0, -1, 1.5]) {
    setup();
    const r = await call(await loadFunction('create-subscription'), { body: body([item({ quantity })]) });
    assertEquals(r.status, 400, `quantity ${quantity}`);
    assertMatch(String(r.json!.error), /Monthly/); // names the plan, not its numeric id
  }
});
Deno.test('SUB-009 quantity is the client-chosen number (large custom values accepted)', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ quantity: 24 })]) });
  assertEquals(r.status, 201);
  assertEquals(rpcItems()[0].amount_paid, 24000);
});

Deno.test('SUB-006 indefinite plan: NULL end_date, quantity forced to 1, default amount = price', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item(), item({ plan_id: 3, quantity: null })]) });
  const fee = rpcItems()[1];
  assertEquals([fee.end_date, fee.quantity, fee.amount_paid], [null, 1, 500]);
});
Deno.test('SUB-009 indefinite plan accepts quantity 1 but rejects any other quantity', async () => {
  setup();
  assertEquals((await call(await loadFunction('create-subscription'), { body: body([item(), item({ plan_id: 3, quantity: 1 })]) })).status, 201);
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item(), item({ plan_id: 3, quantity: 2 })]) });
  assertEquals(r.status, 400);
  assertMatch(String(r.json!.error), /indefinite/i);
});

Deno.test('SUB-001 amount_paid: explicit value is kept (editable), 0 allowed, negative rejected', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ amount_paid: 750 })]) });
  assertEquals(rpcItems()[0].amount_paid, 750);
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ amount_paid: 0 })]) });
  assertEquals(rpcItems()[0].amount_paid, 0);
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ amount_paid: -1 })]) });
  assertEquals(r.status, 400);
  assertEquals(world.log.filter((l) => l.kind === 'rpc').length, 0);
});
Deno.test('SUB-003 each add-on keeps its own itemised amount', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item(), item({ plan_id: 4 })]) });
  assertEquals(rpcItems().map((i) => i.amount_paid), [1000, 800]);
});

Deno.test('SUB-004 shared member allowed only on a max_members = 2 membership plan', async () => {
  setup();
  const ok = await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 2, shared_member_id: 8 })]) });
  assertEquals(ok.status, 201);
  assertEquals(rpcItems()[0].shared_member_id, 8);
});
Deno.test('SUB-004 shared member on a single-member plan is rejected', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 1, shared_member_id: 8 })]) });
  assertEquals(r.status, 400);
  assertMatch(String(r.json!.error), /does not support a shared member/);
});
Deno.test('SUB-004 an add-on never takes a shared member, even on a couple checkout', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 2 }), item({ plan_id: 4, shared_member_id: 8 })]) });
  assertEquals(r.status, 400);
});
Deno.test('SUB-004 shared member cannot be the primary member', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 2, shared_member_id: 7 })]) });
  assertEquals(r.status, 400);
  assertMatch(String(r.json!.error), /cannot equal member_id/);
});
Deno.test('SUB-004 a couple plan without a shared member is fine (optional)', async () => {
  setup();
  assertEquals((await call(await loadFunction('create-subscription'), { body: body([item({ plan_id: 2 })]) })).status, 201);
  assertEquals(rpcItems()[0].shared_member_id, null);
});

Deno.test('SUB-005/008 overlap is NOT enforced server-side: identical overlapping items are accepted', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { body: body([item({ start_date: '2026-07-01' }), item({ plan_id: 4, start_date: '2026-07-01' }), item({ plan_id: 4, start_date: '2026-07-02' })]) });
  // two add-on items for the same plan with overlapping dates still go through (no override flag needed)
  assertEquals(r.status, 201);
  assert(!JSON.stringify(rpcArgs()).toLowerCase().includes('overlap'));
});

Deno.test('SUB-007 the RPC\'s indefinite-duplicate error is mapped to 409', async () => {
  setup({ error: { message: 'This member already has an active indefinite item for plan "Membership Fee" — it cannot be attached again' } });
  const r = await call(await loadFunction('create-subscription'), { body: body([item(), item({ plan_id: 3 })]) });
  assertEquals(r.status, 409);
  assertMatch(String(r.json!.error), /already has an active indefinite item/);
});
Deno.test('SUB-007 any other RPC failure is a 500 (not mislabelled as a conflict)', async () => {
  setup({ error: { message: 'insert or update on table "subscription_items" violates foreign key constraint' } });
  const r = await call(await loadFunction('create-subscription'), { body: body([item()]) });
  assertEquals(r.status, 500);
});
Deno.test('SUB-007 there is no separate pre-check query (the RPC is the single atomic source of truth)', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item(), item({ plan_id: 3 })]) });
  assertEquals(world.log.filter((l) => l.kind === 'query' && l.name === 'subscription_items').length, 0);
});

Deno.test('SEC the function never trusts client-supplied end_date / caller id', async () => {
  setup();
  await call(await loadFunction('create-subscription'), { body: body([item({ end_date: '2099-01-01', created_by: 'attacker' })]) });
  assertEquals(rpcItems()[0].end_date, '2026-08-13'); // 2026-07-15 + 30 days - 1, not the forged 2099 date
  assertEquals(rpcArgs().p_caller_id, 'caller-1');
  assert(!('created_by' in rpcItems()[0]));
});
knownGap('malformed JSON body is a client error (4xx), not a 500', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { rawBody: '{not json' });
  assert(r.status >= 400 && r.status < 500, `got ${r.status}`);
});
Deno.test('malformed JSON body never crashes the function (returns an error response)', async () => {
  setup();
  const r = await call(await loadFunction('create-subscription'), { rawBody: '{not json' });
  assert(r.status >= 400);
});
