# Data Models — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
>
> **Superseded — entirely stale, kept for history only.** Everything below predates two schema redesigns that have since shipped: the `profiles.role` single-column → `roles`/`user_roles` many-to-many catalog (§1a/§1b), and the single-row `Subscription` (with embedded `plan_id`/dates) → header (`Subscription`) + line-item (`SubscriptionItem`) split. It also predates `Branch`, the unified Plan/AddOn catalog (`category`, nullable `duration_days`, `max_members`), the full 19-field `Member` (REQ-MEM-001), `AuditLog`, and the `member_list_view`/`member_current_items` views. None of the field tables, input types, or business rules below reflect the current schema — do not build against this file. Authoritative sources instead:
> - [../backend/domain-model.md](../backend/domain-model.md) — full entity/field list, relationships, views, ER diagram
> - [../backend/database.md](../backend/database.md) — generated schema, triggers, RLS
> - [./member-management.md](./member-management.md) — Member's actual field set + frontend types
> - [./subscription-management.md](./subscription-management.md) — Subscription/SubscriptionItem/Plan, header/line-item model
> - [./master-data-management.md](./master-data-management.md) — Plan/Branch catalog management
> - [./auth.md §5](./auth.md#5-data-model-profile) — Profile's current shape (`roles: string[]`, not `role: string`)
> - `frontend/src/types/*.ts` — the actual TypeScript types (split across `member.ts`, `subscription.ts`, `plan.ts`, `branch.ts`, `role.ts`, `profile.ts`, `report.ts`, `member-list.ts`, `member-current-item.ts`, `audit-log.ts`, rather than one `index.ts` this doc's own §2 intro describes — see rules.md/architecture.md for that separate, minor deviation)

---

## Audit Fields (common to all tables)

Every table carries four audit columns. They are not repeated in each table below — they are implied:

| Field      | Type        | Nullable | Default | Constraints                                              |
|------------|-------------|----------|---------|-----------------------------------------------------------|
| created_at | timestamptz | No       | `now()` | UTC, set on INSERT by the database, never changed        |
| created_by | uuid        | Yes      | NULL    | FK → `profiles.id`, set on INSERT by a Postgres trigger   |
| changed_at | timestamptz | Yes      | NULL    | UTC, set on every UPDATE by a Postgres trigger            |
| changed_by | uuid        | Yes      | NULL    | FK → `profiles.id`, set on every UPDATE by a trigger      |

**Rules — different from the mobile app on purpose:**
- In the mobile app, the service layer set audit fields using a trusted local `currentUserId`. On the web, the client is untrusted (anyone can open devtools and forge a request), so audit fields are **never accepted from the client**. They are set server-side by a Postgres trigger reading `auth.uid()` (the authenticated user making the request, verified by Supabase via the request's JWT).
- `created_at` / `created_by` are set once at INSERT and never modified.
- `changed_at` / `changed_by` start as NULL and are set on every subsequent UPDATE.
- See [database.md](../backend/database.md) for the trigger implementation.

---

## Timezone Rule

**Storage:** All datetime values (`created_at`, `changed_at`) are stored as Postgres `timestamptz`, which Postgres always persists internally as UTC.

**Display:** At runtime, every datetime value read from the database is converted to the **browser's local timezone** before being shown to the user (`Intl.DateTimeFormat` or equivalent, using the browser's detected timezone — no manual timezone picker).

**Calendar dates** (`start_date`, `end_date` in subscriptions) represent business calendar days and have no timezone. They are stored as Postgres `date` and compared/serialized as `YYYY-MM-DD` with no timezone conversion.

| Value type     | DB type        | DB format                    | Display format                  |
|----------------|-----------------|-------------------------------|----------------------------------|
| Datetime stamp | `timestamptz`   | `2026-06-27T09:30:00Z` (UTC) | `27 Jun 2026, 3:00 PM` (local)  |
| Calendar date  | `date`          | `2026-06-27` (no timezone)   | `27 Jun 2026` (no conversion)   |

---

## 1.0 Profile (formerly "App User")

Represents a staff member or admin who operates the app. One row per Supabase Auth user (`auth.users`), linked 1:1. Used to populate `created_by` / `changed_by` audit fields and to drive role-based access control.

| Field      | Type        | Nullable | Default   | Constraints                                          |
|------------|-------------|----------|-----------|--------------------------------------------------------|
| id         | uuid        | No       | —         | Primary key, **same value as** `auth.users.id`         |
| full_name  | text        | No       | —         |                                                         |
| role       | text        | No       | `'staff'` | CHECK IN ('admin', 'staff')                            |
| is_active  | boolean     | No       | `true`    | `false` = deactivated                                  |
| created_at | timestamptz | No       | `now()`   | See Audit Fields                                       |
| created_by | uuid        | Yes      | NULL      | FK → `profiles.id` — see Audit Fields                  |
| changed_at | timestamptz | Yes      | NULL      | See Audit Fields                                       |
| changed_by | uuid        | Yes      | NULL      | FK → `profiles.id` — see Audit Fields                  |

**Note:** `username`/`pin` from the mobile app's `app_users` table do not exist here. Login identity (email, password hash, OAuth identity) is entirely owned by Supabase Auth (`auth.users`) — never duplicated into `profiles`. If a screen needs to show the user's email, read it from the authenticated session, not from `profiles`.

**Seed data:** On first deploy, one admin account must exist. Unlike the mobile app (which seeds a default PIN at first launch), there is no "first launch" moment for a hosted web app. See [database.md §Bootstrapping the First Admin](../backend/database.md#bootstrapping-the-first-admin) for how the first admin account is created (a one-time manual step, not an automatic seed).

**Business rules:**
- Only `admin` role profiles can add/deactivate other users, change roles, and manage plans.
- `staff` role profiles can add members, renew subscriptions, and view reports.
- A deactivated profile (`is_active = false`) is blocked at the RLS level, not just the UI — see [database.md](../backend/database.md).

---

## 1.1 Plan

Represents a subscription tier offered by the gym. Unchanged from the mobile app's domain model.

| Field         | Type        | Nullable | Default | Constraints                                    |
|---------------|-------------|----------|---------|-------------------------------------------------|
| id            | bigint      | No       | identity| Primary key, auto-increment                     |
| name          | text        | No       | —       | Unique                                           |
| duration_days | integer     | No       | —       | CHECK > 0                                        |
| price         | numeric     | No       | —       | CHECK >= 0                                       |
| created_at    | timestamptz | No       | `now()` | See Audit Fields                                 |
| created_by    | uuid        | Yes      | NULL    | FK → `profiles.id` — see Audit Fields            |
| changed_at    | timestamptz | Yes      | NULL    | See Audit Fields                                 |
| changed_by    | uuid        | Yes      | NULL    | FK → `profiles.id` — see Audit Fields            |

**Seed data (inserted once via migration, same values as the mobile app):**

| name      | duration_days | price |
|-----------|----------------|-------|
| Day       | 1              | 100   |
| Monthly   | 30             | 1000  |
| Quarterly | 90             | 2500  |
| Annual    | 365            | 8000  |

**Business rules (unchanged from mobile — see [business-logic.md](./business-logic.md)):**
- A plan **cannot be deleted** if any subscription references it, active or historical.
- A plan **can be edited** even if it has subscriptions. Editing does not recalculate existing `end_date` values.

---

## 1.2 Member

Represents a gym subscriber.

| Field      | Type        | Nullable | Default | Constraints                                    |
|------------|-------------|----------|---------|--------------------------------------------------|
| id         | bigint      | No       | identity| Primary key, auto-increment                      |
| name       | text        | No       | —       |                                                   |
| phone      | text        | No       | —       | Stored as plain text                              |
| email      | text        | Yes      | NULL    |                                                   |
| photo_url  | text        | Yes      | NULL    | Public URL into the `member-photos` Storage bucket (replaces the mobile app's local `photo_uri` file path) |
| gender     | text        | Yes      | NULL    | CHECK IN ('Male', 'Female', 'Other')             |
| weight     | integer     | Yes      | NULL    | CHECK 1–1000 (kg)                                 |
| height     | numeric     | Yes      | NULL    | CHECK 1.0–300.0 (cm)                              |
| created_at | timestamptz | No       | `now()` | See Audit Fields                                  |
| created_by | uuid        | Yes      | NULL    | FK → `profiles.id` — see Audit Fields             |
| changed_at | timestamptz | Yes      | NULL    | See Audit Fields                                  |
| changed_by | uuid        | Yes      | NULL    | FK → `profiles.id` — see Audit Fields             |

---

## 1.3 Subscription

Represents one subscription period for a member. A member can have multiple subscriptions over time (renewals create new rows).

| Field        | Type        | Nullable | Default  | Constraints                                    |
|--------------|-------------|----------|----------|---------------------------------------------------|
| id           | bigint      | No       | identity | Primary key, auto-increment                       |
| member_id    | bigint      | No       | —        | FK → `members.id`, ON DELETE CASCADE               |
| plan_id      | bigint      | No       | —        | FK → `plans.id`, ON DELETE RESTRICT                |
| start_date   | date        | No       | —        | Calendar date                                      |
| end_date     | date        | No       | —        | Derived: `start_date + duration_days - 1`          |
| amount_paid  | numeric     | No       | —        | CHECK >= 0                                         |
| payment_mode | text        | No       | `'Cash'` | CHECK IN ('Cash', 'UPI', 'Card')                   |
| notes        | text        | Yes      | NULL     |                                                     |
| created_at   | timestamptz | No       | `now()`  | See Audit Fields                                   |
| created_by   | uuid        | Yes      | NULL     | FK → `profiles.id` — see Audit Fields              |
| changed_at   | timestamptz | Yes      | NULL     | See Audit Fields                                   |
| changed_by   | uuid        | Yes      | NULL     | FK → `profiles.id` — see Audit Fields              |

**Business rule:** `end_date = start_date + plan.duration_days - 1` (unchanged from mobile — see [business-logic.md](./business-logic.md)).

**Note on `plan_id` FK:** the mobile spec used a plain `FK → plans.id` with an app-level pre-check before delete. On Postgres, `ON DELETE RESTRICT` (the default) makes the database itself refuse the delete. The `plan-delete` Edge Function still runs the friendly pre-check first so the user gets the "used by X subscription(s)" message instead of a raw constraint-violation error. See [business-logic.md §Plan Deletion Guard](./business-logic.md#plan-deletion-guard).

---

## 2. Input Types

Passed from the client to Supabase Edge Functions or, for simple CRUD, directly to `supabase-js` `.insert()` / `.update()` calls. Defined in `src/types/index.ts`. Audit fields are **never** included from the client — see Audit Fields above.

### 2.1 NewMember

| Field | Type |
|---|---|
| `name` | `string` |
| `phone` | `string` |
| `email` | `string \| null` |
| `photo_url` | `string \| null` |
| `gender` | `'Male' \| 'Female' \| 'Other' \| null` |
| `weight` | `number \| null` |
| `height` | `number \| null` |

### 2.2 UpdateMember

All fields optional.

| Field | Type |
|---|---|
| `name` | `string?` |
| `phone` | `string?` |
| `email` | `string \| null?` |
| `photo_url` | `string \| null?` |
| `gender` | `'Male' \| 'Female' \| 'Other' \| null?` |
| `weight` | `number \| null?` |
| `height` | `number \| null?` |

### 2.3 NewPlan

| Field | Type |
|---|---|
| `name` | `string` |
| `duration_days` | `number` |
| `price` | `number` |

### 2.4 UpdatePlan

All fields optional.

| Field | Type |
|---|---|
| `name` | `string?` |
| `duration_days` | `number?` |
| `price` | `number?` |

### 2.5 NewSubscription

`end_date` is **not** supplied by the client — it is computed server-side by the `create-subscription` Edge Function (see [architecture.md](../architecture.md)).

| Field | Type | Notes |
|---|---|---|
| `member_id` | `number` | |
| `plan_id` | `number` | |
| `start_date` | `string` | `YYYY-MM-DD` |
| `amount_paid` | `number` | |
| `payment_mode` | `'Cash' \| 'UPI' \| 'Card'` | |
| `notes` | `string \| null` | |

### 2.6 UpdateSubscription

All fields optional. Used when editing an existing subscription from the Member Detail screen. If `start_date` or `plan_id` changes, `end_date` is recomputed server-side by the `update-subscription` Edge Function — the client never sends `end_date`.

| Field | Type | Notes |
|---|---|---|
| `plan_id` | `number?` | |
| `start_date` | `string?` | `YYYY-MM-DD` |
| `amount_paid` | `number?` | |
| `payment_mode` | `'Cash' \| 'UPI' \| 'Card'?` | |
| `notes` | `string \| null?` | |

### 2.7 InviteUser

Used by the `invite-user` Edge Function (admin only). There is no `NewProfile`/`UpdateProfile` insert type for the client — `profiles` rows are only ever created by the `invite-user` function (via a trigger when the invited `auth.users` row is created) and updated directly through RLS-guarded `supabase-js` calls for `full_name` / `role` / `is_active`.

| Field | Type |
|---|---|
| `email` | `string` |
| `full_name` | `string` |
| `role` | `'admin' \| 'staff'` |

### 2.8 UpdateProfile

All fields optional. Sent as a direct `supabase-js` `.update()` on `profiles`, permitted by RLS only when the caller is `admin`, or when a user updates their own `full_name`.

| Field | Type |
|---|---|
| `full_name` | `string?` |
| `role` | `'admin' \| 'staff'?` | admin only |
| `is_active` | `boolean?` | admin only |
