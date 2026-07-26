-- Transactional data: members, member_number_sequences, subscriptions, subscription_items
-- — plus the member-number generation trigger and the member-photos storage bucket.
-- See spec/backend/member-management.md and spec/backend/database.md for the full
-- write-up this migration implements. Safe to run multiple times / against an existing
-- project (idempotent create/replace).
--
-- Depends on 20260720000000_master_data.sql for branches/plans (FK targets) and
-- set_audit_fields()/prevent_hard_delete() (reused here, not redefined).

---------------------------------------------------------------------------
-- Tables
---------------------------------------------------------------------------

-- members
create table if not exists members (
  id                              bigint generated always as identity primary key,
  name                            text not null,
  phone                           text not null,
  date_of_birth                   date not null,
  date_of_joining                 date not null default current_date,
  gender                          text not null check (gender in ('Male', 'Female', 'Other')),
  weight_kg                       numeric not null check (weight_kg between 1 and 500),
  height_cm                       numeric not null check (height_cm between 1 and 300),
  under_doctor_care               boolean not null default false,
  doctor_care_details             text,
  emergency_contact_name          text not null,
  emergency_contact_phone         text not null,
  emergency_contact_relationship  text not null,
  email                           text,
  residential_address             text,
  aadhaar_number                  text,
  occupation                      text,
  photo_url                       text,
  photo_thumbnail_url             text,
  branch_id                       bigint not null references branches(id),
  member_number                   text not null,
  handled_by_staff                uuid references profiles(id),
  created_at                      timestamptz not null default now(),
  created_by                      uuid references profiles(id),
  changed_at                      timestamptz,
  changed_by                      uuid references profiles(id),
  deleted_at                      timestamptz,
  deleted_by                      uuid references profiles(id),
  constraint chk_doctor_care_details_required check (
    under_doctor_care = false or (doctor_care_details is not null and length(trim(doctor_care_details)) > 0)
  )
);
create unique index if not exists idx_members_number_active on members(member_number) where deleted_at is null;
-- Uniqueness only among live rows — a soft-deleted member's phone can be reused by a new member (REQ-MEM-001/006/007).
create unique index if not exists idx_members_phone_active on members(phone) where deleted_at is null;
create index if not exists idx_members_branch_id on members(branch_id);

-- member_number_sequences — internal counter, one row per (branch, year).
-- Not shown in any UI, not soft-deletable, not audited: it's a counter, not a business record.
create table if not exists member_number_sequences (
  branch_id      bigint not null references branches(id),
  year           integer not null,
  last_sequence  integer not null,
  primary key (branch_id, year)
);

-- subscriptions — header only, one row per checkout event (domain-model.md §5).
-- Immutable set of line items once created: adding something new later always means
-- a new subscriptions row, never a new line on an existing one.
create table if not exists subscriptions (
  id            bigint generated always as identity primary key,
  member_id     bigint not null references members(id),
  payment_mode  text not null default 'Cash' check (payment_mode in ('Cash', 'UPI', 'Card')),
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references profiles(id),
  changed_at    timestamptz,
  changed_by    uuid references profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references profiles(id)
);
create index if not exists idx_subscriptions_member_id on subscriptions(member_id);

-- subscription_items — one row per plan/add-on selected in a checkout (domain-model.md §6).
create table if not exists subscription_items (
  id                  bigint generated always as identity primary key,
  subscription_id     bigint not null references subscriptions(id),
  plan_id             bigint not null references plans(id) on delete restrict,
  member_id           bigint not null references members(id),
  shared_member_id    bigint references members(id),
  start_date          date not null default current_date,
  end_date            date,
  quantity            integer not null default 1 check (quantity > 0),
  amount_paid         numeric(10,2) not null check (amount_paid >= 0),
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id),
  changed_at          timestamptz,
  changed_by          uuid references profiles(id),
  deleted_at          timestamptz,
  deleted_by          uuid references profiles(id),
  constraint chk_subscription_item_shared_member_distinct check (
    shared_member_id is null or shared_member_id <> member_id
  )
);
create index if not exists idx_subscription_items_subscription_id on subscription_items(subscription_id);
create index if not exists idx_subscription_items_plan_id on subscription_items(plan_id);
-- Supports member_current_items (views-and-audit migration): "what does member X
-- currently have," filtered to end_date is null or in the future.
create index if not exists idx_subscription_items_member_end
  on subscription_items(member_id, end_date) where deleted_at is null;
create index if not exists idx_subscription_items_shared_member_end
  on subscription_items(shared_member_id, end_date) where deleted_at is null and shared_member_id is not null;

---------------------------------------------------------------------------
-- Member Number Generation (REQ-MEM-005/006)
---------------------------------------------------------------------------

-- member_number is never accepted from the client and is always overwritten by this
-- trigger, the same pattern set_audit_fields() uses for the audit columns — except this
-- one also fires on UPDATE, purely to pin member_number and branch_id back to their
-- original values (a member's branch is a registration-time fact, never reassigned).
-- The sequence-incrementing logic only ever executes on INSERT; the UPDATE branch
-- returns before reaching it, so no update to an existing member can ever touch
-- member_number_sequences — and since NOT NULL/CHECK/UNIQUE constraints are validated
-- by Postgres only after BEFORE ROW triggers finish, within the same statement/
-- transaction, a member insert that later fails validation rolls back the sequence
-- bump along with everything else.
create or replace function generate_member_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_code text;
  v_year        integer := extract(year from now())::integer;
  v_start       integer;
  v_increment   integer;
  v_width       integer;
  v_sequence    integer;
begin
  if tg_op = 'UPDATE' then
    new.member_number := old.member_number;
    new.branch_id      := old.branch_id;
    return new;
  end if;

  select code into v_branch_code from branches where id = new.branch_id and deleted_at is null;
  if v_branch_code is null then
    raise exception 'branch_id % does not reference an active branch', new.branch_id;
  end if;

  select value::integer into v_start     from configuration where key = 'member_number_start_sequence';
  select value::integer into v_increment from configuration where key = 'member_number_increment';
  select value::integer into v_width     from configuration where key = 'member_number_padding_width';

  -- Atomic per-branch-per-year counter: first row for a (branch, year) starts at v_start;
  -- every subsequent insert adds v_increment to the existing counter. The INSERT ... ON
  -- CONFLICT takes a row lock, so this is safe under concurrent member creation. Only ever
  -- reached on INSERT (see the tg_op = 'UPDATE' branch above) — an update can never bump this.
  insert into member_number_sequences (branch_id, year, last_sequence)
  values (new.branch_id, v_year, v_start)
  on conflict (branch_id, year)
  do update set last_sequence = member_number_sequences.last_sequence + v_increment
  returning last_sequence into v_sequence;

  new.member_number := v_branch_code || '-' || v_year || '-' || lpad(v_sequence::text, v_width, '0');
  return new;
end;
$$;

---------------------------------------------------------------------------
-- Trigger attachments
---------------------------------------------------------------------------
-- Note: the audit-log (after-insert/update) trigger for members/subscriptions/
-- subscription_items is NOT attached here — see the views-and-audit migration, same
-- reason as branches/plans in the master-data migration.

-- members
-- Firing order relative to trg_members_audit doesn't matter: generate_member_number()
-- and set_audit_fields() touch disjoint columns, so either order produces the same
-- final row before the after-insert/after-update audit-log trigger reads it.
drop trigger if exists trg_members_generate_number on members;
create trigger trg_members_generate_number before insert or update on members for each row execute function generate_member_number();

drop trigger if exists trg_members_audit on members;
create trigger trg_members_audit before insert or update on members for each row execute function set_audit_fields();

drop trigger if exists trg_members_no_hard_delete on members;
create trigger trg_members_no_hard_delete before delete on members for each row execute function prevent_hard_delete();

-- subscriptions
drop trigger if exists trg_subscriptions_audit on subscriptions;
create trigger trg_subscriptions_audit before insert or update on subscriptions for each row execute function set_audit_fields();

drop trigger if exists trg_subscriptions_no_hard_delete on subscriptions;
create trigger trg_subscriptions_no_hard_delete before delete on subscriptions for each row execute function prevent_hard_delete();

-- subscription_items
drop trigger if exists trg_subscription_items_audit on subscription_items;
create trigger trg_subscription_items_audit before insert or update on subscription_items for each row execute function set_audit_fields();

drop trigger if exists trg_subscription_items_no_hard_delete on subscription_items;
create trigger trg_subscription_items_no_hard_delete before delete on subscription_items for each row execute function prevent_hard_delete();

---------------------------------------------------------------------------
-- Row Level Security
---------------------------------------------------------------------------
-- is_active_user() / is_active_admin() already exist from the profiles/auth migration.

alter table members                 enable row level security;
alter table member_number_sequences enable row level security;
alter table subscriptions           enable row level security;
alter table subscription_items      enable row level security;

-- members: all active users can read and write directly; server-side CHECK constraints
-- (see table definition above) enforce the required-field and doctor's-care-details
-- rules regardless of what the client sends.
drop policy if exists "members_select_active_users" on members;
create policy "members_select_active_users" on members
  for select using (is_active_user() and deleted_at is null);
drop policy if exists "members_insert_active_users" on members;
create policy "members_insert_active_users" on members
  for insert with check (is_active_user());
drop policy if exists "members_update_active_users" on members;
create policy "members_update_active_users" on members
  for update using (is_active_user());

-- member_number_sequences: no policies granted to any client role at all.
-- Only the SECURITY DEFINER generate_member_number() trigger touches this table.

-- subscriptions / subscription_items: read-only for direct client access. All writes
-- (creating a subscription + its line items together) go through Edge Functions using
-- the service role — see edge-functions.md — so a checkout can't be split into a header
-- with no items, or an item with no valid parent, by a direct insert. No insert/update
-- policy is defined for either table on purpose.
drop policy if exists "subscriptions_select_active_users" on subscriptions;
create policy "subscriptions_select_active_users" on subscriptions
  for select using (is_active_user() and deleted_at is null);
drop policy if exists "subscription_items_select_active_users" on subscription_items;
create policy "subscription_items_select_active_users" on subscription_items
  for select using (is_active_user() and deleted_at is null);

---------------------------------------------------------------------------
-- Storage: member-photos bucket
---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('member-photos', 'member-photos', true)
on conflict (id) do nothing;

drop policy if exists "member_photos_read_public" on storage.objects;
create policy "member_photos_read_public" on storage.objects
  for select using (bucket_id = 'member-photos');

drop policy if exists "member_photos_write_active_users" on storage.objects;
create policy "member_photos_write_active_users" on storage.objects
  for insert with check (bucket_id = 'member-photos' and is_active_user());

drop policy if exists "member_photos_update_active_users" on storage.objects;
create policy "member_photos_update_active_users" on storage.objects
  for update using (bucket_id = 'member-photos' and is_active_user());
