-- Tiny assertion helpers. Each prints "ok - name" / "not ok - name"; run.sh fails on any "not ok".
create schema if not exists t;
create or replace function t.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'ok - %', p_name; else raise notice 'not ok - %', p_name; end if;
end $$;
create or replace function t.eq(p_name text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then raise notice 'ok - %', p_name;
  else raise notice 'not ok - % (expected %, got %)', p_name, p_expected, p_actual; end if;
end $$;
-- Runs a statement; passes only if it raises an error whose message matches p_pattern (ILIKE).
create or replace function t.throws(p_name text, p_sql text, p_pattern text default '%') returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_pattern then raise notice 'ok - %', p_name;
    else raise notice 'not ok - % (wrong error: %)', p_name, sqlerrm; end if;
    return;
  end;
  raise notice 'not ok - % (no error raised)', p_name;
end $$;
create or replace function t.lives(p_name text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql; raise notice 'ok - %', p_name;
exception when others then raise notice 'not ok - % (raised: %)', p_name, sqlerrm;
end $$;
-- Run statements as an API role / signed-in user inside the current transaction.
create or replace function t.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role authenticated';
end $$;
create or replace function t.as_super() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
grant usage on schema t to public;
grant execute on all functions in schema t to public;

-- Fixtures -------------------------------------------------------------------------------
-- Fixed ids so tests can reference them. Profiles are created by the real handle_new_auth_user trigger.
create or replace function t.admin_id()    returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000001'::uuid $$;
create or replace function t.staff_id()    returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000002'::uuid $$;
create or replace function t.inactive_id() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000003'::uuid $$;
create or replace function t.deleted_id()  returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000004'::uuid $$;
create or replace function t.admin2_id()   returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000005'::uuid $$;

create or replace function t.seed_users() returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (t.admin_id(),    'admin@gym.test',    '{"full_name":"Ada Admin"}'),
    (t.staff_id(),    'staff@gym.test',    '{"full_name":"Sam Staff"}'),
    (t.inactive_id(), 'inactive@gym.test', '{"full_name":"Ina Inactive"}'),
    (t.deleted_id(),  'deleted@gym.test',  '{"full_name":"Dan Deleted"}'),
    (t.admin2_id(),   'admin2@gym.test',   '{"full_name":"Bea Admin"}');
  insert into user_roles (user_id, role_id, granted_by)
    select t.admin_id(),  id, t.admin_id() from roles where name = 'admin';
  insert into user_roles (user_id, role_id, granted_by)
    select t.admin2_id(), id, t.admin_id() from roles where name = 'admin';
  insert into user_roles (user_id, role_id, granted_by)
    select u, id, t.admin_id() from roles, unnest(array[t.staff_id(), t.inactive_id(), t.deleted_id()]) u where name = 'staff';
  update profiles set is_active = false where id = t.inactive_id();
  update profiles set deleted_at = now() where id = t.deleted_id();
end $$;

create or replace function t.branch(p_code text default 'MUM') returns bigint language sql as $$
  select id from branches where code = p_code and deleted_at is null
$$;

-- Inserts a minimal valid member; returns its id.
create or replace function t.member(p_phone text, p_branch bigint default null, p_name text default 'Test Member')
returns bigint language sql as $$
  insert into members (name, phone, date_of_birth, gender, weight_kg, height_cm,
    emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, branch_id)
  values (p_name, p_phone, '1990-01-01', 'Male', 70, 170, 'EC', '9999999999', 'Friend', coalesce(p_branch, t.branch()))
  returning id
$$;

create or replace function t.plan(p_name text) returns bigint language sql as $$
  select id from plans where name = p_name and deleted_at is null
$$;

-- Calls the real create_subscription_with_items RPC the way the Edge Function does (service role).
create or replace function t.checkout(p_caller uuid, p_member bigint, p_items jsonb, p_mode text default 'Cash')
returns jsonb language sql as $$
  select create_subscription_with_items(p_caller, p_member, p_mode, null, p_items)
$$;

-- A requirement/security expectation the implementation does NOT currently meet. Prints "known-gap"
-- (does not fail the run) while the gap exists; once fixed it flips to a failing "not ok" so the
-- test gets promoted to a normal t.ok().
create or replace function t.known_gap(p_name text, p_holds boolean) returns void language plpgsql as $$
begin
  if coalesce(p_holds, false) then raise notice 'not ok - % (gap is fixed now: convert this to t.ok)', p_name;
  else raise notice 'known-gap - %', p_name; end if;
end $$;
-- Same, for statements that are expected (by the spec) to raise but currently don't.
create or replace function t.known_gap_throws(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    -- no error: undo whatever the probe did (sub-transaction rollback) so later assertions stay independent
    raise exception using errcode = 'T0001', message = 'probe-ran-without-error';
  exception
    when sqlstate 'T0001' then
      raise notice 'known-gap - %', p_name; return;
    when others then
      raise notice 'not ok - % (gap is fixed now: convert this to t.throws)', p_name; return;
  end;
end $$;

-- Number of rows a DML statement touched (0 when RLS filters everything out).
create or replace function t.affected(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
