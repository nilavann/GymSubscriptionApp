-- Profiles, invite-only auth linkage, and RLS.
-- See spec/backend/auth.md §2-3 for the full write-up this migration implements.
-- Safe to run multiple times / against an existing project (idempotent create/replace).

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null default 'staff' check (role in ('admin', 'staff')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  changed_at  timestamptz,
  changed_by  uuid references profiles(id),
  deleted_at  timestamptz,
  deleted_by  uuid references profiles(id)
);

-- Profile Creation Trigger: a profiles row is created automatically whenever a new
-- auth.users row appears (via the invite-user flow or the one-time bootstrap step).
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, role, is_active, created_at, created_by)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce(new.raw_user_meta_data ->> 'role', 'staff'),
    true,
    now(),
    nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_handle_new_auth_user on auth.users;
create trigger trg_handle_new_auth_user
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Row Level Security
alter table profiles enable row level security;

-- Helper: is the current user an active, non-deleted admin?
create or replace function is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and is_active = true and deleted_at is null
  );
$$;

-- Helper: is the current user active and non-deleted at all (admin or staff)?
create or replace function is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active = true and deleted_at is null
  );
$$;

drop policy if exists "profiles_select_active_users" on profiles;
create policy "profiles_select_active_users" on profiles
  for select using (is_active_user() and deleted_at is null);

-- A user can always read their OWN row, even if deactivated. Without this, a
-- deactivated caller fails is_active_user() and gets zero rows back from the
-- policy above, indistinguishable from "never invited" — the app needs to
-- tell those two cases apart to show the right message (REQ-AUTH-003 vs the
-- deactivation message), so the self-lookup can't depend on being active.
-- Still excludes deleted_at rows, consistent with the soft-delete convention
-- applied everywhere else — a soft-deleted account has no accessible profile.
drop policy if exists "profiles_select_self" on profiles;
create policy "profiles_select_self" on profiles
  for select using (auth.uid() = id and deleted_at is null);

drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles
  for update using (is_active_admin());

drop policy if exists "profiles_update_self_name" on profiles;
create policy "profiles_update_self_name" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
