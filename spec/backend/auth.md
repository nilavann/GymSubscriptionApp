# User Authentication — Backend Spec

> Part of [supabase-architecture.md](./supabase-architecture.md). Consolidates the backend side of [requirements-template.md §7 User Authentication](../requirements-template.md#7-feature-area-user-authentication) (REQ-AUTH-001–005) into one place. The content here is not new — it's pulled together from [domain-model.md](./domain-model.md) (§1 Profile), [database.md](./database.md) (schema, triggers, RLS, bootstrap), and [edge-functions.md](./edge-functions.md) (§1 Authentication), which remain the canonical, type-organized source files. Update those files first if behavior changes; re-sync this doc afterward.
>
> **Out of scope:** creating/editing/deactivating/deleting *other* users (`invite-user`, `update-user` Edge Functions — REQ-ADMIN-004/006) is a separate feature area — see [edge-functions.md §5](./edge-functions.md#5-user-management-req-admin-004006). This doc covers only the sign-in/session/password-reset surface for an already-invited user.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-AUTH-001 | Email + password sign-in via Supabase Auth |
| REQ-AUTH-002 | Google OAuth sign-in, auto-links to the same invited account |
| REQ-AUTH-003 | Google sign-in is invite-only — no `profiles` row, no access, even after a successful Google handshake |
| REQ-AUTH-004 | One account, two interchangeable sign-in methods, same session/profile either way |
| REQ-AUTH-005 | Self-service password reset, including first-time password setup for Google-only users |

No new tables are introduced by this feature — it reuses `auth.users` (owned entirely by Supabase Auth) plus the existing `profiles` table.

---

## 2. Data Model: `profiles` table

One row per Supabase Auth user (`auth.users`), linked 1:1. Reachable via either email/password or a linked Google OAuth identity, or a password set via the password-reset flow — all Supabase Auth-level concepts, not separate columns here.

| Field      | Type    | Nullable | Default   | Constraints                     |
|------------|---------|----------|-----------|----------------------------------|
| id         | uuid    | No       | —         | PK, same value as `auth.users.id`|
| full_name  | text    | No       | —         |                                   |
| is_active  | boolean | No       | `true`    |                                   |

Plus the standard audit columns (`created_at`, `created_by`, `changed_at`, `changed_by`) and soft-delete columns (`deleted_at`, `deleted_by`) shared by every business table.

**Role is not a column here.** A user's role(s) live in `roles`/`user_roles` — an admin-managed
catalog plus a many-to-many join table, so a user can hold more than one role. See
[edge-functions.md §5](./edge-functions.md#5-user-management-req-admin-004006) for the
assignment flow and [database.md §Role Assignment](./database.md) for the schema. This
replaced a single `profiles.role` column, whose self-update RLS policy (§3 below) checked
only row ownership, not which columns changed — any signed-in user could self-promote via
`update({ role: 'admin' })` on their own row. Moving role off `profiles` entirely removes
that vector structurally, since ordinary users get zero write grant on `user_roles` at all.

**Login identity (email, password hash, OAuth identity) is entirely owned by Supabase Auth (`auth.users`) — never duplicated into `profiles`.** If a screen needs to show the user's email, it reads it from the authenticated session, not from `profiles`.

```sql
create table if not exists profiles (
  id          uuid primary key references auth.users(id),
  full_name   text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  changed_at  timestamptz,
  changed_by  uuid references profiles(id),
  deleted_at  timestamptz,
  deleted_by  uuid references profiles(id)
);
```

No `on delete cascade` on the FK — unlike every other business table, this used to be the
one exception to "hard delete is structurally impossible" (domain-model-review.md Critical
#1). A Supabase Auth `admin.deleteUser()` call now fails outright with a foreign-key
violation instead of cascading into a real `DELETE` on this row — deactivation (`is_active =
false`) / soft-delete (`deleted_at`) remain the only supported ways to remove a user.

`profiles` also now gets the same `set_audit_fields`/`prevent_hard_delete`/`audit_row_changes`
triggers every other table gets (database.md §Audit Field Triggers / §Soft Delete Enforcement
/ §Field-Level Audit Trigger) — it was the one table missing all three
(security-review-findings.md's High finding).

### 2.1 Profile creation trigger

A `profiles` row is created automatically whenever a new `auth.users` row appears (via the `invite-user` Edge Function or the one-time bootstrap step — §5). `full_name` arrives via `raw_user_meta_data`, set by the Edge Function at invite time. **This is the only path that creates a `profiles` row** — nothing in this auth feature (password sign-in, Google OAuth, or password reset) ever creates one itself. Role assignment happens separately, after this trigger runs — see §5 and [edge-functions.md §5](./edge-functions.md#5-user-management-req-admin-004006).

`created_at`/`created_by` are stamped by `set_audit_fields()` now (just attached above), not
literal `INSERT` values — reading `auth.uid()`, which would otherwise resolve to `NULL` here
since this trigger runs under whatever connection created the `auth.users` row, not the
inviting admin's own session. Faking the JWT claim for this transaction only (`LOCAL`,
auto-reset at commit) lets `created_by` still correctly attribute to the inviting admin —
same trick `create_subscription_with_items` uses. Left unset for the bootstrap admin (no
inviter), so `created_by` naturally stays `NULL` there too.

```sql
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invited_by uuid := nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid;
begin
  if v_invited_by is not null then
    perform set_config('request.jwt.claim.sub', v_invited_by::text, true);
  end if;

  insert into profiles (id, full_name, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_handle_new_auth_user
  after insert on auth.users
  for each row execute function handle_new_auth_user();
```

This applies identically regardless of whether the user's first sign-in ends up being password or Google OAuth (REQ-AUTH-004) — both land on the same `auth.users` row, and this trigger only cares about the row's creation, not which credential type accompanies it.

---

## 3. Row Level Security (RLS)

RLS is the actual enforcement layer for "is this session allowed to do anything" — the web client cannot be trusted, so invite-only and deactivation enforcement both ultimately rest on these policies, not just the app-level check in §4.2.

```sql
alter table profiles enable row level security;

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

-- is_admin_user(p_user_id) / is_active_admin() are defined against roles/user_roles —
-- see database.md §Role Assignment. is_active_admin() is a one-line wrapper
-- (`select is_admin_user(auth.uid())`), so it's still the right helper to call here.

create policy "profiles_select_active_users" on profiles
  for select using (is_active_user() and deleted_at is null);

-- A user can always read their OWN row, even if deactivated. Without this, a deactivated
-- caller fails is_active_user() above and gets zero rows back, indistinguishable from
-- "never invited" - the app needs to tell those two cases apart (REQ-AUTH-003's message
-- vs. the deactivation message), so the self-lookup can't itself depend on being active.
create policy "profiles_select_self" on profiles
  for select using (auth.uid() = id and deleted_at is null);

create policy "profiles_update_admin" on profiles
  for update using (is_active_admin());
create policy "profiles_update_self_name" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- The self-update policy above only checks row ownership, not which columns change —
-- RLS alone can't express "this column only." A column-level grant is what actually
-- restricts a self-update to full_name, keeping is_active/deleted_at admin-only:
revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;
```

`is_active_user()` / `is_active_admin()` gate every RLS policy on every table in the app, not just `profiles` — this applies identically no matter which sign-in method was used to obtain the session (REQ-AUTH-004).

**Deactivated or soft-deleted users are blocked everywhere immediately**, not just at login: every policy gates on `is_active_user()` / `is_active_admin()`, so a deactivated or deleted account's existing session immediately loses read/write access on its next request even if the client-side session token is still technically valid.

---

## 4. Authentication Flows (REQ-AUTH-001–005)

Every flow below is handled entirely by the Supabase Auth client SDK — **no Edge Function is involved in sign-in, OAuth, or password reset.** The only Edge Function touching auth at all is `invite-user` (out of scope here, §5 below), because creating an `auth.users` row requires the Admin API / service role.

### 4.1 Password sign-in (REQ-AUTH-001)

- `supabase.auth.signInWithPassword({ email, password })`.
- On failure, the client shows a generic "invalid email or password" message — never confirms whether the email exists (same non-leaking pattern as the invite-only check below).

### 4.2 Google OAuth sign-in (REQ-AUTH-002/003/004)

- `supabase.auth.signInWithOAuth({ provider: 'google' })` — Supabase Auth handles the OAuth handshake and either creates a new `auth.users` row or links to an existing one by matching email (REQ-AUTH-004, Supabase Auth's built-in identity linking — no custom code needed for the linking itself).
- **Invite-only enforcement is app-level, not Auth-level** (REQ-AUTH-003): Supabase Auth alone would happily create a session for *any* Google account, invited or not. On every app load / auth-state change, the frontend's `AuthContext` (see [frontend/auth.md §3.2](../frontend/auth.md#32-authprovider-lifecycle)) must:
  1. Read the session from `supabase.auth.getSession()`.
  2. Query `profiles` for `id = session.user.id` (RLS-gated by `profiles_select_active_users`, §3 above).
  3. If no `profiles` row is found: call `supabase.auth.signOut()` immediately, and show "This email hasn't been invited — contact your admin." The Supabase Auth session must never be allowed to persist past this check.
- No Edge Function creates a `profiles` row for Google sign-in — the **only** path that creates one is `invite-user` via `handle_new_auth_user()` (§2.1).
- `is_active_user()` / `is_active_admin()` already gate every RLS policy on `is_active = true and deleted_at is null` — this applies identically no matter which sign-in method was used.

### 4.3 Password reset (REQ-AUTH-005)

- `supabase.auth.resetPasswordForEmail(email, { redirectTo })` — no privileged operation needed, no Edge Function.
- The client shows a generic confirmation ("if that email is registered, a reset link has been sent") regardless of whether the email actually has a matching account or `profiles` row — same non-leaking pattern as REQ-AUTH-001/003.
- The reset-link flow (`supabase.auth.updateUser({ password })` after following the emailed link) works identically whether the account already has a password or not — a user who has only ever signed in via Google can use this flow to set a password for the first time, since it operates on the existing `auth.users` row rather than creating one.
- No `profiles` row is created or modified by this flow — it only touches `auth.users`, same boundary as every other sign-in method.
- **Following the emailed link is not automatically "done."** The link resolves to a real Supabase session (via a `PASSWORD_RECOVERY` auth event), and unless the frontend explicitly gates on that, the user is simply signed into the app with their *old* password still in place. See [frontend/auth.md §4.3](../frontend/auth.md#43-reset-password-completion-req-auth-005) / WSCR-13 for how the frontend forces the `updateUser({ password })` call to actually happen before letting that session go anywhere else.
- **`redirectTo` must be an allow-listed URL, or the link silently does nothing.** Supabase Auth validates `redirectTo` server-side against Authentication → URL Configuration → Redirect URLs (exact match unless a wildcard is configured); an unlisted value means no token is ever attached to the redirect, not an error the app can catch — the user just lands on the Site URL with no session and no explanation. This is a real incident this app hit: `redirectTo` originally pointed at `${origin}/reset-password`, which was never separately allow-listed (only the bare origin was, for Google OAuth below), so password reset silently did nothing end-to-end. Fixed by sending the bare origin instead (frontend/auth.md §4.3) — the frontend's global `PASSWORD_RECOVERY` listener doesn't care which allow-listed page the token lands on. **Operationally**: every real deployment origin must be added to that Dashboard list (or `config.toml`'s `additional_redirect_urls`/`site_url` for local dev — see that file's own note, since it does **not** sync to a hosted project automatically) before this flow can work in that environment at all.

### 4.4 Google OAuth provider configuration

Configured in the Supabase dashboard (Auth → Providers → Google), not in application code:
- Google Cloud OAuth client ID/secret registered against the project's Supabase Auth callback URL.
- Provider enabled with default scopes (email, profile) — no extra scopes needed since the app never reads anything from Google beyond the account's email for identity linking.
- Same Redirect URLs allow-list as §4.3's `redirectTo` — `signInWithOAuth`'s `options.redirectTo` (`auth.service.ts`, also the bare origin) is checked against the exact same Dashboard list, not a separate one.

---

## 5. Bootstrapping the First Admin

A hosted Supabase project has no "first launch" moment, and auto-seeding a well-known admin credential into a public-facing database would be a security hole. The first admin account is created **once, manually**, by whoever sets up the Supabase project:

1. In the Supabase dashboard (or via the Admin API), create the first `auth.users` row with the real admin's email, using **Auth → Invite User** or `supabase.auth.admin.createUser()` from a trusted, non-deployed script.
2. Set `raw_user_meta_data = { "full_name": "..." }` on that call so the `handle_new_auth_user` trigger creates the matching `profiles` row.
3. Grant the admin role directly, since there is no admin yet to call `invite-user`: `insert into user_roles (user_id, role_id) select '<new user id>', id from roles where name = 'admin';`
4. From then on, every other user is created through the in-app **Invite User** flow (`invite-user` Edge Function, admin-only), which assigns roles via `user_roles` directly and sets `raw_user_meta_data.invited_by` to the inviting admin's id.

This one-time step must be documented in the project's deployment runbook — it is not something the app's own UI does, since there is no logged-in admin yet the first time it runs. `profiles` has **no automatic seed** otherwise; `roles` is seeded with `admin`/`staff` by the migration itself (database.md §Seed Data).

**Last-admin lockout**: once at least one admin exists, `update-user` and the role-assignment RPC both block any action that would leave zero active admins (removing the admin role, deactivating, or soft-deleting the last one) — see [edge-functions.md §5](./edge-functions.md#5-user-management-req-admin-004006).

---

## 6. Requirements Traceability

| Requirement | Backend implementation |
|---|---|
| REQ-AUTH-001 | `supabase.auth.signInWithPassword` (client SDK, no Edge Function); `profiles_select_active_users` RLS gates post-login profile fetch |
| REQ-AUTH-002 | `supabase.auth.signInWithOAuth('google')` (client SDK); Google provider config (§4.4); Supabase Auth's built-in identity linking by email |
| REQ-AUTH-003 | App-level post-OAuth `profiles` existence check (§4.2) — no Edge Function auto-creates a profile; `handle_new_auth_user()` is the only creation path |
| REQ-AUTH-004 | Single `profiles` row per `auth.users.id` (§2); `is_active_user()`/`is_active_admin()` apply uniformly regardless of sign-in method (§3) |
| REQ-AUTH-005 | `supabase.auth.resetPasswordForEmail` / `supabase.auth.updateUser({ password })` (client SDK, no Edge Function, no `profiles` writes); frontend completion flow is [frontend/auth.md §4.3](../frontend/auth.md#43-reset-password-completion-req-auth-005) / WSCR-13 |

---

## Related docs

- [domain-model.md §1 Profile](./domain-model.md) — Profile as part of the full domain model
- [database.md](./database.md) — schema, triggers, RLS, and bootstrap as part of the full database spec
- [edge-functions.md §1](./edge-functions.md#1-authentication-req-auth-001005) — authentication as part of the full Edge Functions catalog
- [supabase-architecture.md §7](./supabase-architecture.md#7-authentication-design) — high-level overview
- [../frontend/auth.md](../frontend/auth.md) — frontend counterpart (Login screen, AuthContext, route guards)
