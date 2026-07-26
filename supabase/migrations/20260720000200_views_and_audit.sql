-- Views and audit trail: audit_log + audit_row_changes() (retroactively wired to every
-- table created so far), member_current_items, and member_list_view.
-- See spec/backend/domain-model.md §Views and spec/backend/member-management.md §5 for
-- the full write-up this migration implements. Safe to run multiple times / against an
-- existing project (idempotent create/replace).
--
-- Ordering note: this is the last of the three feature migrations on purpose.
-- audit_row_changes() has to exist before it can be attached to branches/plans (from
-- 20260720000000_master_data.sql) and members/subscriptions/subscription_items (from
-- 20260720000100_transactional_data.sql) — those two migrations intentionally left the
-- after-insert/after-update audit trigger off each table for exactly this reason.
-- member_current_items and member_list_view both need subscription_items/plans/members
-- to already exist, which is why they couldn't be created any earlier either.

---------------------------------------------------------------------------
-- audit_log table
---------------------------------------------------------------------------

-- audit_log — field-level change history, append-only, never soft- or hard-deleted.
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  change_id   uuid not null,
  table_name  text not null,
  record_id   text not null,
  field_name  text not null,
  old_value   text,
  new_value   text,
  operation   text not null check (operation in ('insert', 'update', 'delete')),
  changed_by  uuid references profiles(id),
  changed_at  timestamptz not null default now()
);
create index if not exists idx_audit_log_table_record on audit_log(table_name, record_id);
create index if not exists idx_audit_log_change_id on audit_log(change_id);

create extension if not exists "pgcrypto";
-- Needed for gen_random_uuid(), the change_id generator below.

---------------------------------------------------------------------------
-- audit_row_changes() — fed by an AFTER trigger on every audited table
---------------------------------------------------------------------------

create or replace function audit_row_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change_id uuid := gen_random_uuid();
  v_old       jsonb;
  v_new       jsonb;
  v_record_id text;
  v_key       text;
  v_excluded  text[] := array['created_at', 'created_by', 'changed_at', 'changed_by'];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_record_id := v_new ->> 'id';
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all(v_excluded) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, null, v_new ->> v_key, 'insert', auth.uid(), now());
      end if;
    end loop;
    return new;

  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := v_new ->> 'id';
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all(v_excluded) and (v_old ->> v_key) is distinct from (v_new ->> v_key) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, v_old ->> v_key, v_new ->> v_key, 'update', auth.uid(), now());
      end if;
    end loop;
    return new;
  end if;

  -- DELETE is unreachable in practice (prevent_hard_delete() blocks it on every table);
  -- this branch exists only so the function is well-defined if a table were ever exempted.
  return null;
end;
$$;

---------------------------------------------------------------------------
-- Trigger attachments — audit_row_changes(), plus audit_log's own no-hard-delete guard
---------------------------------------------------------------------------

drop trigger if exists trg_branches_audit_fields on branches;
create trigger trg_branches_audit_fields after insert or update on branches for each row execute function audit_row_changes();

drop trigger if exists trg_plans_audit_fields on plans;
create trigger trg_plans_audit_fields after insert or update on plans for each row execute function audit_row_changes();

drop trigger if exists trg_members_audit_fields on members;
create trigger trg_members_audit_fields after insert or update on members for each row execute function audit_row_changes();

drop trigger if exists trg_subscriptions_audit_fields on subscriptions;
create trigger trg_subscriptions_audit_fields after insert or update on subscriptions for each row execute function audit_row_changes();

drop trigger if exists trg_subscription_items_audit_fields on subscription_items;
create trigger trg_subscription_items_audit_fields after insert or update on subscription_items for each row execute function audit_row_changes();

-- audit_log itself: no soft-delete concept (append-only), but hard delete is still
-- structurally blocked, same defense-in-depth as every other table.
drop trigger if exists trg_audit_log_no_hard_delete on audit_log;
create trigger trg_audit_log_no_hard_delete before delete on audit_log for each row execute function prevent_hard_delete();

---------------------------------------------------------------------------
-- Row Level Security — audit_log
---------------------------------------------------------------------------

alter table audit_log enable row level security;

-- audit_log: admin-only, read-only. No insert/update/delete policy for any role — every
-- row is written exclusively by the audit_row_changes() trigger (security definer).
drop policy if exists "audit_log_select_admin" on audit_log;
create policy "audit_log_select_admin" on audit_log
  for select using (is_active_admin());

---------------------------------------------------------------------------
-- Views
---------------------------------------------------------------------------

-- member_current_items — "what does this member currently have," across every
-- subscription they're part of, either as the checkout's member_id or as a couple-plan
-- line's shared_member_id (domain-model.md §Views).
create or replace view member_current_items as
select
  si.id as subscription_item_id, si.subscription_id, si.plan_id,
  p.name as plan_name, p.category,
  si.member_id, si.start_date, si.end_date, si.quantity, si.amount_paid
from subscription_items si
join plans p on p.id = si.plan_id
where si.deleted_at is null
  and (si.end_date is null or si.end_date >= current_date)

union all

select
  si.id, si.subscription_id, si.plan_id,
  p.name, p.category,
  si.shared_member_id as member_id, si.start_date, si.end_date, si.quantity, si.amount_paid
from subscription_items si
join plans p on p.id = si.plan_id
where si.shared_member_id is not null
  and si.deleted_at is null
  and (si.end_date is null or si.end_date >= current_date);

-- member_list_view — resolves REQ-LIST-001/003/004 against member_current_items instead
-- of a single "latest subscription" row (member-management.md §5). A plain view (no
-- security definer) — inherits and enforces the querying user's own RLS against
-- members/subscription_items/plans automatically, adding no new permission surface.
create or replace view member_list_view as
select
  m.id,
  m.name,
  m.phone,
  m.member_number,
  m.date_of_joining,
  m.gender,
  m.photo_thumbnail_url,
  current_membership.plan_id   as current_membership_plan_id,
  current_membership.plan_name as current_membership_plan_name,
  current_membership.end_date  as current_membership_end_date,
  coalesce(current_addons.addon_plan_ids, '{}') as current_addon_plan_ids
from members m
left join lateral (
  select mci.plan_id, mci.plan_name, mci.end_date
  from member_current_items mci
  where mci.member_id = m.id
    and mci.category = 'membership'
  order by mci.end_date desc nulls first  -- NULL end_date = indefinite/lifetime item, treated as "furthest from expiring"
  limit 1
) current_membership on true
left join lateral (
  select array_agg(distinct mci.plan_id) as addon_plan_ids
  from member_current_items mci
  where mci.member_id = m.id
    and mci.category = 'addon'
) current_addons on true
where m.deleted_at is null;
