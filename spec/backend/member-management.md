# Member Management — Backend Spec

> Consolidates the backend side of [requirements-template.md §2 Member Management](../requirements-template.md#2-feature-area-member-management) (REQ-MEM-001–007) and [§3 Member List](../requirements-template.md#3-feature-area-member-list--home-page) (REQ-LIST-001–004) into one place, pulled from [domain-model.md](./domain-model.md) §4, [database.md](./database.md), and [edge-functions.md](./edge-functions.md) §2 — which remain canonical for other tables. Update those first if behavior changes; re-sync this doc afterward.
>
> **This resolves a previously-open spec question.** [requirements-template.md §13](../requirements-template.md#13-open-questions) flagged that REQ-LIST-001/003/004's "member status" and default sort were never updated after the Subscription/SubscriptionItem header-line-item split — they still assumed a single "latest subscription" row, which no longer exists (a member's current items can now span multiple independent checkouts). §5 below is that resolution: a `member_list_view` that derives status from `member_current_items` the way [business-logic.md](./business-logic.md)'s working definition already proposed. `requirements-template.md` has been updated to point here instead of leaving this open.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-MEM-001 | Register a member: required demographic/emergency fields, optional extras, unique phone |
| REQ-MEM-002 | Camera capture as an alternative to file upload for the photo |
| REQ-MEM-003 | Immutable `created_by` + independently-editable `handled_by_staff` |
| REQ-MEM-004 | Client-side photo compression; both original and thumbnail stored |
| REQ-MEM-005 | System-generated `member_number`, per-branch/per-year sequence |
| REQ-MEM-006 | Edit any field except `member_number`/`created_by` |
| REQ-MEM-007 | Soft-delete only; phone freed for reuse, `member_number` never reused |
| REQ-LIST-001 | Default sort `date_of_joining desc`; sort by name or expiry |
| REQ-LIST-002 | Search by name/member_number/phone |
| REQ-LIST-003 | Status pills: All/Active/Expiring/Expired |
| REQ-LIST-004 | Filter panel: gender, add-on, plan (combinable) |

---

## 2. Data Model: `members` table

```sql
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
-- Uniqueness only among live rows - a soft-deleted member's phone can be reused (REQ-MEM-001/006/007).
create unique index if not exists idx_members_phone_active on members(phone) where deleted_at is null;
create index if not exists idx_members_branch_id on members(branch_id);
```

`weight_kg`/`height_cm` are **required** here (REQ-MEM-001 lists them as mandatory at registration) — note this is stricter than the currently-stale `spec/frontend/data-models.md`, which still shows them as optional from an earlier revision; that file needs a follow-up pass to match this one.

### 2.1 `member_number_sequences` — internal counter

```sql
create table if not exists member_number_sequences (
  branch_id      bigint primary key references branches(id),
  last_sequence  integer not null
);
```

One row per branch, for that branch's entire lifetime — **not** per `(branch_id, year)`: the counter increments continuously and never resets, including at a calendar-year boundary (§3 below). Admin-viewable via the Member Numbering settings screen (§3.1) through a `select`-only RLS policy; not soft-deletable, and no `insert`/`update`/`delete` policy for any client role — every write goes through either the `generate_member_number()` trigger or the `update-member-number-sequence` Edge Function (§3.1), both service-role/security-definer paths.

---

## 3. Member Number Generation (REQ-MEM-005)

`member_number` is never accepted from the client — this trigger always overwrites whatever the client sends, same pattern as the audit columns. Unlike the audit columns, it also has to actively guard `UPDATE`: it fires on both `INSERT` and `UPDATE`, pinning `member_number` **and** `branch_id` back to their original values on any update (a member's branch is set once at registration and never reassigned — REQ-MEM-006 — otherwise `member_number`'s embedded branch code could drift out of sync with a later-changed `branch_id`). The sequence-incrementing logic below only ever runs on `INSERT`; the `UPDATE` branch returns before reaching it, so no edit to an existing member can ever touch `member_number_sequences`.

```sql
create or replace function generate_member_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_code   text;
  v_year          integer := extract(year from now())::integer;
  v_start         integer;
  v_increment     integer;
  v_padding       integer;
  v_sequence      integer;
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
  select value::integer into v_padding   from configuration where key = 'member_number_padding_width';

  insert into member_number_sequences (branch_id, last_sequence)
  values (new.branch_id, v_start)
  on conflict (branch_id)
  do update set last_sequence = member_number_sequences.last_sequence + v_increment
  returning last_sequence into v_sequence;

  new.member_number := v_branch_code || '-' || v_year || '-' || lpad(v_sequence::text, v_padding, '0');
  return new;
end;
$$;

create trigger trg_members_generate_number
  before insert or update on members
  for each row execute function generate_member_number();
```

Sequence increments continuously per branch, for that branch's entire lifetime, and **never resets** — including at a calendar-year boundary. `v_year` is still computed and still embedded in the formatted string (so `member_number` always shows the year a member actually registered), but the counter itself is keyed by `branch_id` alone. (This table/trigger was originally keyed by `(branch_id, year)`, resetting every branch's counter to `member_number_start_sequence` each year — revised by `20260727000000_member_number_continuous_sequence.sql` per an explicit product decision; REQ-MEM-005 updated to match, see §3.1's Global Settings for the still-tunable `configuration` keys.)

**A failed insert can't leak a sequence bump.** The counter increment runs inside this `BEFORE INSERT` trigger, in the same statement/transaction as the row insert. Postgres validates `NOT NULL`/`CHECK`/`UNIQUE` constraints only *after* all `BEFORE ROW` triggers finish — so if the row is then rejected (e.g. `chk_doctor_care_details_required`, phone uniqueness), the whole statement aborts and rolls back everything it did, including the nested write to `member_number_sequences`. The only residual gap risk is a benign concurrency artifact (a rolled-back insert whose claimed number was already skipped past by a concurrent successful one) — acceptable for a display identifier.

**Firing order relative to `set_audit_fields()` doesn't matter.** The two triggers touch disjoint columns (`member_number`/`branch_id` vs. the audit block), so either order produces the same final row, and the `after insert`/`after update` audit-log trigger always sees the fully-resolved row regardless, since `AFTER ROW` triggers only fire once every `BEFORE ROW` trigger has already run.

### 3.1 Admin configuration: Member Numbering screen

The generation algorithm above is fully automatic and per-branch-independent by design (`member_number_sequences` is keyed by `branch_id` alone — Branch A's counter has never been able to affect Branch B's) — what was missing was any way for an admin to *see* or *adjust* that state, since `member_number_sequences` had zero RLS policies for any client role and the three `configuration` keys had no dedicated screen. The **Member Numbering** admin screen (`/member-numbering`, [frontend/screens.md WSCR-16](../frontend/screens.md#wscr-16--member-numbering)) closes that gap:

- **Global settings** (`member_number_start_sequence`, `member_number_increment`, `member_number_padding_width`): read is a direct RLS-guarded `select` on `configuration` (`configuration_select_admin`, no new grant needed). Write goes through `update_member_number_config(p_start_sequence, p_increment, p_padding_width)` — a `security invoker` RPC that updates all three rows in one statement/transaction, so a save is genuinely all-or-nothing (each `UPDATE` inside it still runs as the calling admin and is individually gated by the existing `configuration_update_admin` policy, same as three separate client calls would be — the function only removes the "partially applied on failure" risk three independent `.update()` calls had, closing a gap found in a later CRUD-flow audit, [crud-review.md](../crud-review.md)). Changing these only affects *future* numbers; past `member_number` values are never recalculated (same principle as editing a Plan not recalculating past `SubscriptionItem` rows).
- **Per-branch sequences**: a new `member_number_sequences_select_admin` RLS policy (`20260726000000_member_number_sequences_admin_select.sql`) lets an admin view every active branch's current counter — one per branch, since the counter never resets — alongside each branch's next number-to-be-issued (computed client-side: `last_sequence + increment`, or `start_sequence` if no row exists yet for that branch). Writes still don't go through this policy directly — see below. There is no year selector on this screen: since the counter is continuous, there's only ever one current value per branch to look at, not one per year.
- **Editing a branch's next number**: the `update-member-number-sequence` Edge Function (admin-only). Takes `{ branch_id, next_sequence }` and treats `next_sequence` as a *target*: since `member_number` is never reused (REQ-MEM-007) even after a soft delete, and the counter no longer resets per year, it checks whether that sequence value has ever been issued at that branch **in any year** (fetching every `member_number` starting with that branch's code, with no `deleted_at` filter, and comparing the trailing sequence portion), and if so walks forward by `member_number_increment` until it finds one that hasn't — capped at 10,000 attempts as a safety valve, not an expected path at this app's scale. It then stores `last_sequence = <found value> - increment`, so the next real registration's own `last_sequence + increment` arithmetic lands exactly on the found value. The response reports whether the applied value differs from what was requested, so the UI can surface "150 was already used — set to 153 instead" rather than silently substituting a different number than the admin asked for.

No new Requirement ID was added to `requirements-template.md` for this admin screen itself — it's an operational capability over an existing, already-specified mechanism (REQ-MEM-005), not a new product requirement changing how members register. REQ-MEM-005's own wording *was* revised, separately, when the counter's reset behavior changed (see §3 above).

---

## 4. Row Level Security

```sql
alter table members                 enable row level security;
alter table member_number_sequences enable row level security;

create policy "members_select_active_users" on members
  for select using (is_active_user() and deleted_at is null);
create policy "members_insert_active_users" on members
  for insert with check (is_active_user());
create policy "members_update_active_users" on members
  for update using (is_active_user() and deleted_at is null);

-- member_number_sequences: no policy for any client role - only the
-- SECURITY DEFINER generate_member_number() trigger touches this table.
```

No admin/staff distinction — **any active user can create, read, and edit members** (Section 1's role model: staff can "add/edit members"). Create/read/plain-field edits stay direct RLS-gated updates under `members_update_active_users` — no Edge Function needed for those. Deletion (REQ-MEM-007) is the one exception — it now goes through a guarded Edge Function; see [Member Deletion Guard](#member-deletion-guard-closes-domain-model-reviewmds-member-deletion-finding) near the end of this doc.

---

## 5. `member_list_view` — resolving the member-status open question

### 5.1 Why this is needed

Before the Subscription/SubscriptionItem split, "a member's status" meant reading one `end_date` off their single latest `subscriptions` row. That row no longer exists — a member's current items are now the union of every non-deleted `subscription_items` row across every `subscriptions` checkout they're part of (`member_current_items`, [domain-model.md §Views](./domain-model.md#views)). REQ-LIST-001/003/004 still describe "latest subscription" as if it were one row; this view is the concrete resolution business-logic.md's Member Status section proposed but left unconfirmed: **status derives from the member's `category = 'membership'` item(s) in `member_current_items`, using whichever has the latest `end_date`.**

The view's job is narrow and deliberate: expose exactly the columns the Member List screen (REQ-LIST-001–004) needs, pre-joined, so the frontend never has to hand-roll this multi-item aggregation itself.

### 5.2 Definition

```sql
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
  coalesce(current_addons.addon_plan_ids, '{}') as current_addon_plan_ids,
  m.photo_url  -- appended last, not next to photo_thumbnail_url — see the migration's
               -- own comment: CREATE OR REPLACE VIEW can only add columns at the end
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
```

A plain view (no `security definer`) — like `member_current_items`, it inherits and enforces the querying user's own RLS against `members`/`subscription_items`/`plans` automatically; it adds no new permission surface.

**`photo_url`** (added `20260721000000_member_list_view_photo_url.sql`, alongside the original `photo_thumbnail_url`) feeds the Members List's photo lightbox ([frontend/member-management.md §3.4](../frontend/member-management.md#34-members-list)): clicking a row's thumbnail avatar enlarges the *original*, uncompressed photo, not the thumbnail already on screen. Cheap to include for every row — it's a URL string, not image bytes; the browser only fetches the actual original image when the lightbox opens and the `<img>` element's `src` is set.

**No new indexes needed.** Postgres inlines the view definitions during planning, so the LATERAL subqueries ultimately scan `subscription_items` filtered by `member_id`/`shared_member_id`, which is exactly what `idx_subscription_items_member_end` and `idx_subscription_items_shared_member_end` ([database.md](./database.md)) already support. This comfortably meets the `<1s for up to ~2,000 members` NFR (requirements-template.md §10).

### 5.3 Disambiguating "no plan" vs. "indefinite plan" — the subtle part

`current_membership_end_date` alone is ambiguous: `NULL` means either *no current membership item exists at all* or *the member has an indefinite (lifetime) membership item*, which are opposite statuses. The view resolves this by giving each case a different signature, and status derivation (§6) must check both columns together:

| `current_membership_plan_id` | `current_membership_end_date` | Meaning |
|---|---|---|
| `NULL` | `NULL` | No current membership item at all → **Expired** |
| not `NULL` | `NULL` | Has an indefinite/lifetime membership item → **Active** (never expires) |
| not `NULL` | a date | Time-boxed membership item → compare to today (§6) |

This case (an indefinite item under `category = 'membership'`) wasn't explicitly covered by business-logic.md's existing status table — flagged there too; see §7 below.

### 5.4 Usage

```sql
select * from member_list_view order by date_of_joining desc;  -- REQ-LIST-001 default
select * from member_list_view where phone ilike '%' || :query || '%' or name ilike '%' || :query || '%' or member_number ilike '%' || :query || '%';  -- REQ-LIST-002
```

At this scale (NFR: low-thousands of members), fetching the full view result set and doing search/filter/sort client-side is sufficient — consistent with the existing "client-side sorting of already-fetched data" rule for the old single-subscription model. No server-side pagination or filter parameters are needed yet.

---

## 6. Status Derivation (client-side, unchanged authority — see business-logic.md)

Still computed **client-side**, using the browser's local date (Timezone Rule, [domain-model.md](./domain-model.md)) — a pure read/display rule with no security implication, so no server-side enforcement is needed beyond the view itself.

```
function deriveStatus(row):
  if row.current_membership_plan_id is null:
    return 'expired'                          # no current membership item at all
  if row.current_membership_end_date is null:
    return 'active'                           # indefinite/lifetime membership
  days_remaining = row.current_membership_end_date - today
  if days_remaining > 7:  return 'active'
  if days_remaining >= 0: return 'expiring'
  return 'expired'
```

| Status | Condition | Badge |
|---|---|---|
| Active | indefinite item, or `end_date >= today` with `days_remaining > 7` | Green |
| Expiring | `end_date >= today` with `days_remaining <= 7` | Amber |
| Expired | `end_date < today`, or no current membership item at all | Red |

---

## 7. Business Rules

- **Phone uniqueness** (REQ-MEM-001/006): `idx_members_phone_active`, scoped to `deleted_at is null` — a duplicate insert/update is rejected by Postgres with a unique-violation, surfaced by the client as a validation error naming the conflict. A deleted member's phone becomes available immediately.
- **Doctor's-care conditional** (REQ-MEM-001): enforced twice — client-side for instant feedback, and server-side via `chk_doctor_care_details_required`, which requires a non-blank (post-`trim`) value, not just non-`NULL` — so a forged direct API call sending `doctor_care_details = ''` is rejected too, not only one omitting the field entirely.
- **`member_number` immutability** (REQ-MEM-005/006): trigger-generated at insert; on update, `generate_member_number()` (§3) actively pins it back to `old.member_number` regardless of what an update payload contains — the same DB-level guarantee `created_by` gets from `set_audit_fields()`, not just an "the client never sends it" convention.
- **`branch_id` immutability** (REQ-MEM-005/006): a registration-time fact, not an ongoing editable field — `generate_member_number()` (§3) pins it back to `old.branch_id` on every update, in the same trigger and for the same reason as `member_number` above, so the branch code embedded in `member_number` can never drift out of sync with a member's `branch_id`.
- **`created_by` immutability** (REQ-MEM-003): standard audit trigger, set once on insert, never touched by `set_audit_fields()`'s `before update` path.
- **`handled_by_staff` independence** (REQ-MEM-003): a plain, directly-editable column — any active user can set it on `insert` (via `members_insert_active_users`) or `update` it via the normal `members_update_active_users` policy; it has no relationship to `created_by`/`changed_by` beyond sharing the `profiles` FK target. There was never a DB-level restriction against setting it at creation — the frontend originally chose to omit it from the create payload (see `NewMember`'s type comment history) and default it in afterward from Member Detail instead; that was purely a frontend UX decision, reversed to default it from the logged-in session directly on the Add Member form, no schema/RLS change needed either way.
- **Soft delete only** (REQ-MEM-007): `update members set deleted_at = now(), deleted_by = :caller where id = :id`, guarded by a usage check first — see [Member Deletion Guard](#member-deletion-guard-closes-domain-model-reviewmds-member-deletion-finding) below. `Subscription`/`SubscriptionItem`/`AuditLog` rows referencing a deleted member are retained unchanged (deleting a member with none is unaffected by the guard, since it only blocks when something references it), and `member_current_items` keeps including them (it has no `members.deleted_at` filter of its own) — **`member_list_view` is what actually hides a deleted member from the list**, via its own `where m.deleted_at is null`.
- **Photo handling** (REQ-MEM-002/004): compression happens entirely client-side (browser canvas) before upload — no Edge Function involved; both `photo_url` (original) and `photo_thumbnail_url` (compressed, ~400px/<50KB) are written via a normal `members` update after the Storage upload completes. If the photo upload fails, the rest of the member record still saves — see [edge-functions.md §2](./edge-functions.md#2-members).
- **No Edge Function required for members create/read/edit** — direct RLS-guarded `supabase-js` calls, same as [edge-functions.md §2](./edge-functions.md#2-members) already documents. Delete is the one exception (above).

---

## 8. Storage: `member-photos` bucket

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "member_photos_read_active_users" on storage.objects
  for select using (bucket_id = 'member-photos' and is_active_user());
create policy "member_photos_write_active_users" on storage.objects
  for insert with check (bucket_id = 'member-photos' and is_active_user());
create policy "member_photos_update_active_users" on storage.objects
  for update using (bucket_id = 'member-photos' and is_active_user());
```

**Private bucket, gated read** — this supersedes an earlier public-bucket design (still what this section said until now): object keys are `{memberId}/original-{timestamp}.jpg` / `{memberId}/thumbnail-{timestamp}.jpg`, and sequential bigint member IDs are trivially enumerable, so a fully public bucket meant anyone with a guessed URL could view any member's photo with no session at all. `20260723000000_member_photos_private_bucket.sql` closed this (security-review-findings.md's Medium finding) by flipping `public = false` and gating `select` behind the same `is_active_user()` check the write/update policies already used, plus adding `file_size_limit`/`allowed_mime_types` (bundled in as a Low-priority fix to the same row).

Because a private object has no public URL, `members.photo_url`/`photo_thumbnail_url` changed meaning: they now store a bucket-relative **path**, not a URL. The frontend (`frontend/src/lib/photo-urls.ts`) resolves that path to a short-lived signed URL (`createSignedUrl`) right after fetching member rows, called from both `memberListRepository.getAll()` and `memberRepository.getById()` — a signed URL itself can't be persisted since it expires, so only the stable path is stored. `MembersListPage.tsx`/`MemberDetailPage.tsx`/`PhotoLightbox.tsx` needed no changes for this — they just render whatever string they're given, same as before. Any photo uploaded before this migration had a full public URL stored instead of a bare path; the migration backfills those rows with a regex strip down to the bare path.

---

## 9. Requirements Traceability

| Requirement | Backend implementation |
|---|---|
| REQ-MEM-001 | `members` table + constraints (§2); `chk_doctor_care_details_required`; `idx_members_phone_active` |
| REQ-MEM-002 | No backend involvement — client-side camera capture feeds the same upload path as a file |
| REQ-MEM-003 | `created_by` via `set_audit_fields()` trigger (immutable); `handled_by_staff` plain editable column |
| REQ-MEM-004 | `photo_url`/`photo_thumbnail_url` columns; `member-photos` bucket (§8); compression itself is client-side |
| REQ-MEM-005 | `generate_member_number()` trigger + `member_number_sequences` + `configuration` (§3) |
| REQ-MEM-006 | `members_update_active_users` RLS policy; `generate_member_number()` (§3) pins `member_number`/`branch_id` back to their original values on every update; `created_by` pinned by `set_audit_fields()` |
| REQ-MEM-007 | Guarded soft-delete via `delete-member` Edge Function (used-by-X-subscriptions check, then update); `idx_members_phone_active`'s partial-unique scoping frees the phone |
| REQ-LIST-001 | `member_list_view` ordered by `date_of_joining desc` by default; `name`/`current_membership_end_date` available for the other sort options |
| REQ-LIST-002 | `member_list_view.name`/`.phone`/`.member_number`, `ilike` substring match |
| REQ-LIST-003 | `deriveStatus()` (§6) over `current_membership_plan_id`/`current_membership_end_date` |
| REQ-LIST-004 | `member_list_view.gender`, `.current_addon_plan_ids`, `.current_membership_plan_id` |

---

## Member deletion guard (closes domain-model-review.md's Member deletion finding)

Plan and Branch ([master-data-management.md](./master-data-management.md) §5) both block deletion of a row still referenced elsewhere, via a dedicated Edge Function. Member originally had no equivalent — a plain client-side `update members set deleted_at = now(), deleted_by = auth.uid()`, RLS-gated the same as any other edit, with no usage check at all. That gap is closed: deleting a member with any non-deleted `subscription_items` row referencing it (as either `member_id` or `shared_member_id`) is now blocked, same "used by X" shape as Plan/Branch.

**`delete-member` Edge Function** (`supabase/functions/delete-member/index.ts`):
1. Authenticates the caller via the `Authorization` header (same pattern as every other Edge Function in this app).
2. Checks the caller is an active, non-deleted user — **not admin-only**, unlike `delete-plan`/`delete-branch`, since REQ-MEM-007 is staff/admin. `is_active_user()` can't be called from this function's service-role client (it reads `auth.uid()`, which is `NULL` here), so this checks `profiles.is_active`/`deleted_at` directly for the caller's id instead.
3. Counts non-deleted `subscription_items` where `member_id = :id or shared_member_id = :id`. If any exist, returns 409: `Cannot delete — used by ${count} subscription/add-on record(s)`.
4. Otherwise performs the same soft-delete update as before, just now via the service-role client instead of the caller's own RLS-gated session.

The frontend (`memberRepository.delete`, `frontend/src/repositories/member.repository.ts`) now calls this function instead of updating `members` directly — the only member-write path that goes through an Edge Function, mirroring `planRepository.delete`/`branchRepository.delete`'s shape exactly (including surfacing the guard's message verbatim on the member detail screen).

This guard is deliberately Edge-Function-level, not a DB trigger/constraint — consistent with Plan/Branch, and for the same reason ([edge-functions.md §4](./edge-functions.md#4-plan-management-req-admin-002)): simpler than adding `ON DELETE RESTRICT`-style enforcement to a soft-delete model, at negligible race-window cost for a low-frequency, human-confirmed action.

---

## Related docs

- [domain-model.md §4 Member, §Views](./domain-model.md) — as part of the full domain model
- [database.md](./database.md) — schema/triggers/RLS as part of the full database spec
- [edge-functions.md §2](./edge-functions.md#2-members) — members as part of the full Edge Functions catalog
- [business-logic.md §Member Status](./business-logic.md#member-status) — status derivation as part of the full business-logic doc
- [../frontend/member-management.md](../frontend/member-management.md) — frontend counterpart (screens, search/filter/sort UI, photo compression)
