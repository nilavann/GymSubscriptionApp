-- The list views are the app's main read path (REQ-LIST-*). A plain Postgres view runs with its OWNER's
-- privileges, so it ignores the caller's RLS unless it is created WITH (security_invoker = true) — the
-- migration comments claim the opposite ("inherits and enforces the querying user's own RLS").
-- Assumes Supabase's legacy default grants (anon/authenticated can SELECT every new public object), as
-- emulated by 00_supabase_stubs.sql. Verify on the live project with:
--   select has_table_privilege('anon', 'public.member_list_view', 'select');
begin;
select t.seed_users();
select t.as_super();
select t.member('9400000001', null, 'Secret Member') as m \gset
select count(*) from (select t.checkout(t.staff_id(), :m, jsonb_build_array(jsonb_build_object('plan_id', t.plan('Monthly'),'member_id',:m,'start_date',current_date,'end_date',current_date+29,'quantity',1,'amount_paid',1000)))) x;
select t.as_super(); -- the RPC sets the jwt claim for the rest of its transaction; reset it

-- Control: the base tables ARE protected by RLS
set local role anon;
select t.eq('SEC base table members is invisible to anon', (select count(*)::int from members), 0);
reset role;

-- Staff reading through the views works (REQ-LIST-001)
select t.as_user(t.staff_id());
select t.eq('LIST an active staff user sees the member through member_list_view', (select count(*)::int from member_list_view where phone = '9400000001'), 1);
select t.eq('LIST ...and its current items through member_current_items', (select count(*)::int from member_current_items), 1);
select t.as_super();

-- The gap: RLS-bypassing view access for callers who must see nothing
set local role anon;
select t.known_gap('SEC (GAP) anon (public anon key) must not read member_list_view', (select count(*) = 0 from member_list_view));
select t.known_gap('SEC (GAP) anon must not read member_current_items', (select count(*) = 0 from member_current_items));
select t.known_gap('SEC (GAP) anon must not read profiles_with_roles', (select count(*) = 0 from profiles_with_roles));
reset role;
select t.as_user(t.inactive_id());
select t.known_gap('SEC (GAP) a DEACTIVATED user must not read member_list_view', (select count(*) = 0 from member_list_view));
select t.as_user(t.deleted_id());
select t.known_gap('SEC (GAP) a DELETED user must not read member_list_view', (select count(*) = 0 from member_list_view));
select t.as_super();
select t.known_gap('SEC (GAP) every public view declares security_invoker = true',
  (select coalesce(bool_and(coalesce('security_invoker=true' = any(c.reloptions), false)), true)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'));

-- REQ-SUB-007 within ONE checkout: the second copy of an indefinite plan is caught by the in-transaction check
select t.member('9400000002', null, 'Dup In Checkout') as d \gset
select t.throws('SUB-007 the same indefinite plan twice in a single checkout is blocked', format($$
  select t.checkout(t.staff_id(), %s, jsonb_build_array(
    jsonb_build_object('plan_id', t.plan('Monthly'),'member_id',%s,'start_date',current_date,'end_date',current_date+29,'quantity',1,'amount_paid',1),
    jsonb_build_object('plan_id', t.plan('Membership Fee'),'member_id',%s,'start_date',current_date,'quantity',1,'amount_paid',500),
    jsonb_build_object('plan_id', t.plan('Membership Fee'),'member_id',%s,'start_date',current_date,'quantity',1,'amount_paid',500))) $$, :d, :d, :d, :d), '%already has an active indefinite item%');
select t.eq('SUB-007 ...and the whole checkout rolled back', (select count(*)::int from subscriptions where member_id = :d), 0);
rollback;
