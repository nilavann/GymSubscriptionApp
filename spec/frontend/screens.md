# Screens — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)

This file specifies all screens at field/behavior/validation level of detail — enough to build directly from. It deliberately does **not** reproduce the mobile spec's dp/sp pixel-level component trees ([spec/screens/](../../spec/screens/)), since those are React Native-specific. Visual sizing on the web instead follows the responsive rules in [app-shell.md](./app-shell.md) and the tokens in [colors.md](./colors.md): use relative units (`rem`, `%`, `fr`), the shared breakpoint (`768px`), and the component color rules table — pixel-perfect layout is an implementation detail for whoever builds each screen's CSS, not a spec requirement.

Every screen re-fetches its data on route entry (see [rules.md](./rules.md)) — there is no mobile-style `useFocusEffect`, but the same "always fresh, never stale-on-return" behavior is required.

---

## Screen Registry

| ID     | Screen Name         | Route                  | Access  |
|--------|-----------------------|--------------------------|---------|
| WSCR-01 | Login                | `/login`                | All     |
| WSCR-02 | Members List          | `/`                      | All     |
| WSCR-03 | Member Detail         | `/members/:id`           | All     |
| WSCR-04 | Add Member            | `/members/new`           | All     |
| WSCR-05 | Renew Subscription    | `/members/:id/renew`     | All     |
| WSCR-06 | Edit Member           | `/members/:id/edit`      | All     |
| WSCR-07 | Reports               | `/reports`               | All     |
| WSCR-08 | Manage Plans          | `/plans`                 | Admin   |
| WSCR-09 | Manage Users          | `/users`                 | Admin   |
| WSCR-10 | Invite User           | `/users/invite`          | Admin   |
| WSCR-11 | Settings (hub)        | `/settings`              | Admin   |
| WSCR-12 | Manage Branches       | `/branches`              | Admin   |
| WSCR-13 | Reset Password        | `/reset-password`        | All     |
| WSCR-14 | Audit Log             | `/audit-log`             | Admin   |
| WSCR-15 | Manage Roles          | `/roles`                 | Admin   |
| WSCR-16 | Member Numbering      | `/member-numbering`      | Admin   |

---

## WSCR-01 — Login

**Route:** `/login` · Public (redirects to `/` if already signed in)

### Layout

| Breakpoint | Layout |
|---|---|
| Mobile (`< 768px`) | Single column, full-width form, hero/logo above the form |
| Desktop (`>= 768px`) | Centered card, `max-width: 400px`, vertically and horizontally centered on `--color-surface-dark` background |

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| Email | `email` input | Yes | Standard email validation |
| Password | `password` input | Yes (password flow only) | No client-side complexity rules — Supabase Auth enforces its own password policy |

### Actions

| Action | Behavior |
|---|---|
| "Sign in" button | Calls `authService.signInWithPassword(email, password)` (via `useAuth()`). Disabled while submitting, shows a spinner. |
| "Continue with Google" button | Calls `authService.signInWithOAuth('google')`. Redirects to Google, then back to the app. |
| Error banner | Shown on failed sign-in: "Wrong email or password." for credential errors, or the raw Supabase error message for anything else. |

### States

| State | Trigger | Behavior |
|---|---|---|
| Idle | Page load | Fields empty, button enabled once both fields are non-empty |
| Submitting | Sign in tapped | Button shows spinner, fields disabled |
| Success | Supabase returns a session | `onAuthStateChange` fires (see [app-shell.md](./app-shell.md)), app redirects to `/` |
| Failure | Supabase returns an error | Error banner shown, password field cleared, email kept |
| Deactivated account | Profile fetch after login returns `is_active = false` | Immediately signed out again, error banner: "Your account has been deactivated. Contact an admin." |

No PIN dots, no username field, no version string footer (not meaningful for a web app) — these are mobile-only elements from [spec/screens/login.md](../../spec/screens/login.md) that do not carry over.

See [auth.md §2.5](./auth.md#25-non-functional-compliance-rulesmd-rules-16-29-31) for this screen's rules 16/29–31 compliance detail — not repeated here to avoid the two copies drifting apart.

---

## WSCR-13 — Reset Password

**Route:** `/reset-password` · Not admin-gated, but not reachable by ordinary navigation either — sits outside `<RequireAuth>`/`<AppShell>` (same as WSCR-01) and is only ever landed on via the link in a password-reset email, or by `RequireAuth` redirecting an in-progress recovery session here from anywhere else in the app. See [auth.md §4.3](./auth.md#43-reset-password-completion-req-auth-005) — this is REQ-AUTH-005's second half; WSCR-01's "Forgot password?" link only covers sending the email.

### Layout

Same centered-card treatment as WSCR-01 (`--color-surface-dark` background, `max-width: 400px` card).

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| New password | `password` input | Yes | Minimum 6 characters (client-side pre-check only; Supabase Auth's own policy is the real enforcement) |
| Confirm new password | `password` input | Yes | Must match the field above |

### Actions

| Action | Behavior |
|---|---|
| "Update password" button | Calls `updatePassword(newPassword)` (via `useAuth()`), which calls `supabase.auth.updateUser({ password })`. Disabled until both fields are filled, match, and meet the length check. Shows a spinner while submitting. On success, redirects to `/`. |

### States

| State | Trigger | Behavior |
|---|---|---|
| Not a recovery session | Page reached directly (bookmark, typed URL) with no pending password-reset session | Immediately redirected — to `/` if already signed in normally, `/login` otherwise. No form is ever shown. |
| Blocked account | The recovery link resolves to a deactivated/never-invited account | `AuthContext` has already signed the session back out; redirected to `/login`, where the existing "deactivated"/"not invited" banner (WSCR-01) shows. |
| Idle | A valid recovery session is active | Form shown, submit disabled until both fields are valid and match |
| Submitting | "Update password" tapped | Button shows spinner, fields disabled |
| Success | `updateUser` resolves | Redirects to `/` — the now-updated session is a normal signed-in session from this point on |
| Failure | `updateUser` rejects | Error banner: "Could not update your password. Please try again." Fields stay filled. |

---

## WSCR-02 — Members List (home)

**Route:** `/` · All signed-in users

### Layout

| Breakpoint | Layout |
|---|---|
| Mobile | Vertically stacked member **cards**, one per member, matching the mobile app's row content (avatar, name, plan · phone, expiry line, status badge) |
| Desktop | A **data table** — columns: Avatar+Name, Phone, Plan, Expiry, Status, Actions. Sortable by clicking a column header. |

Both layouts read from the same filtered/sorted data — see below.

### Top bar

"Members" title, "+ Add Member" button (all users can add members — same as mobile, not admin-gated).

### Search & filter (same rules as [spec/screens/members-list.md](../../spec/screens/members-list.md), platform-neutral parts only)

| Control | Behavior |
|---|---|
| Search box | Matches name substring (case-insensitive) or phone (ignoring spaces), live as-you-type |
| Status chips | All / Active / Expiring / Expired — single-select, additive with the filter panel |
| Filter panel | Multi-select status, multi-select plan, sort (`name-asc`, `name-desc`, `expiry-asc`, `join-date`) |
| Result count line | `"{n} members"` / `"{n} results for \"{query}\""` / `"{n} members · {x} filters active"` etc. |

No `frozen` status — not part of this app's data model (same exclusion as the mobile app).

### Row / card content

| Element | Content |
|---|---|
| Avatar | Initials avatar, deterministic background color from member id (same algorithm as mobile: hash id → color from a fixed palette) |
| Name | Member name, search match highlighted |
| Secondary line | `"{planName} · {phone}"` or `"No plan · {phone}"` if no subscription |
| Expiry line | `"Expires {date}"` (active/expiring) / `"Expired {date}"` / `"—"` if no subscription — color per status |
| Status badge | Active (green) / Expiring Soon (amber) / Expired (red) / No plan (neutral) — see [colors.md](./colors.md) |
| Edit action | Icon button → `/members/:id/edit`, must not also trigger the row's own navigate-to-detail click |

### Empty states

| Reason | Message |
|---|---|
| No members at all | "No members yet." + "Add Member" CTA |
| Search returns nothing | `"No results for \"{query}\""` + "Clear search" |
| Filter returns nothing | "No members match these filters." + "Clear filters" |

### Data source

`memberService.getAll()` returning members with their latest subscription (highest `start_date`) joined in — same "always latest subscription only" rule as the mobile app.

> **Superseded.** [member-management.md §3.4](./member-management.md#34-members-list--) is authoritative for this screen — current field set (`member_list_view`, not "latest subscription"), plus its rules 16/29–31 compliance detail (loading/error/retry, mobile-friendliness confirmation). The empty-state copy above is still current and reused there.

---

## WSCR-03 — Member Detail

**Route:** `/members/:id` · All signed-in users

### Layout

| Breakpoint | Layout |
|---|---|
| Mobile | Single column: hero card → personal details → body metrics → current subscription → subscription history |
| Desktop | Two-column: left column (`~360px`) has hero card + personal details + body metrics; right column (flexible width) has current subscription + subscription history |

### Hero section (read-only)

Avatar (initials), name, current status badge, member id (`"#" + String(id).padStart(4, '0')`).

### Personal Details (view + inline edit toggle)

| Field | Editable | Notes |
|---|---|---|
| name | Yes | 2–80 chars |
| phone | Yes | Exactly 10 digits |
| email | Yes | Optional, format-validated if present |
| gender | Yes | Male / Female / Other chip selector, optional, deselectable |

"Edit" button toggles the section into edit mode (matches mobile's screen-mode pattern) — separate save action from subscription actions, own loading/error state. Photo upload (`photo_url`) is available here: an "Upload photo" control writes to the `member-photos` Storage bucket and sets `photo_url` on save.

### Body Metrics (view + inline edit)

| Field | Editable | Notes |
|---|---|---|
| weight | Yes | Integer 1–1000 kg, optional |
| height | Yes | Decimal 1.0–300.0 cm, optional |

### Current Subscription

Shows the latest subscription's plan, dates, amount paid, payment mode, status. "Renew" button → `/members/:id/renew`. If no subscription exists, shows an empty state with an "Add Subscription" CTA that opens the same renew flow for a first-time subscription.

### Subscription History

Table/list of all past subscriptions, newest first, each row editable (opens an edit panel/dialog to change plan/dates/amount/payment mode/notes — calls `update-subscription` Edge Function, no overlap re-check on edit, matching [business-logic.md](./business-logic.md)).

### Save flows

Member field saves and subscription saves are **completely independent** (own loading state, own error state) — identical rule to [spec/screens/member-detail.md §5.6](../../spec/screens/member-detail.md), just moved off Firestore/SQLite terminology onto Supabase repository calls.

> **Superseded.** [member-detail.md](./member-detail.md) is the full, current spec for this screen — current field set, header/line-item Current Membership + Add-ons (not a single "latest subscription"), and its rules 16/29–31 compliance detail.

---

## WSCR-04 — Add Member

**Route:** `/members/new` · All signed-in users

### Fields

| Field | Required | Rule |
|---|---|---|
| name | Yes | Non-empty after trim, 2–80 chars |
| phone | Yes | Exactly 10 digits after stripping spaces |
| email | No | Empty valid; if present must match `^[^\s@]+@[^\s@]+\.[^\s@]+$` |
| gender | No | `'Male' \| 'Female' \| 'Other' \| null` |
| weight | No | Empty valid; if present integer 1–1000 |
| height | No | Empty valid; if present float 1.0–300.0 |
| photo | No | Optional upload to `member-photos` bucket at save time |

Validation timing: on blur (that field only) and on submit (all fields at once, scroll to first error). Same rules as the mobile app's SCR-004.

### Submit flow

```
Save tapped
  → validate all fields
      → errors: show inline, stop
      → valid: memberService.create({ name, phone, email, photo_url, gender, weight, height })
          → success: navigate to /members/:newId (replace, not push — no back-to-empty-form)
          → failure: inline error banner, form stays open
```

`created_by` is never sent — the database trigger sets it (see [database.md](../backend/database.md)).

This screen only creates the member row — it does **not** collect a first subscription. Adding the first subscription happens from the new member's detail page (Current Subscription empty state → "Add Subscription"), same separation of concerns as the mobile app.

> **Superseded.** [member-management.md §3.1](./member-management.md#31-add-member--membersnew) is authoritative — current field set (19 fields, not 7) and rules 16/29–31 compliance detail.

---

## WSCR-05 — Renew / Add Subscription

**Route:** `/members/:id/renew` · All signed-in users

### Fields

| Field | Required | Rule |
|---|---|---|
| plan | Yes | Select from active plans list |
| start_date | Yes | Date picker; default per Renewal Start Date Default (see [business-logic.md](./business-logic.md)) |
| amount_paid | Yes | Number ≥ 0 |
| payment_mode | Yes | `Cash \| UPI \| Card`, default `Cash` |
| notes | No | ≤ 200 chars |

`end_date` is not a form field — it is computed and returned by the server (see [architecture.md](../architecture.md)) and shown read-only once the plan and start date are chosen (client-side preview computed the same formula purely for UX; the authoritative value comes back from the `create-subscription` Edge Function response).

### Submit flow

```
Submit tapped
  → validate all fields
      → errors: show inline, stop
      → valid: subscriptionService.create({ member_id, plan_id, start_date, amount_paid, payment_mode, notes })
          → calls create-subscription Edge Function
          → success: navigate back to /members/:id
          → overlap error (409): show inline error with the conflicting date range from the response —
             "This period overlaps with an existing subscription (DD MMM YYYY – DD MMM YYYY). Choose a start date after DD MMM YYYY."
          → other failure: generic inline error banner
```

> **Superseded.** [subscription-management.md](./subscription-management.md) is authoritative — the single-plan model and server-side 409 overlap check above no longer exist (multi-item checkout, client-side-only overlap warning instead), plus its rules 16/29–31 compliance detail.

---

## WSCR-06 — Edit Member

Same fields and validation as the Personal Details + Body Metrics sections of WSCR-03 (Member Detail), but if implemented as its own route (`/members/:id/edit`) rather than an inline toggle on the detail page, it is a full-page form pre-filled with the member's current data. Cancel returns to `/members/:id` without saving; Save calls `memberService.update(id, data)` and returns to `/members/:id`.

(Both an inline-edit-on-detail-page and a separate edit route satisfy the route map in [navigation.md](./navigation.md) — pick one consistently; do not build both. Recommendation: inline edit on WSCR-03 for a smoother experience, with `/members/:id/edit` as a deep-linkable route that simply pre-opens WSCR-03 in edit mode.)

> **Superseded.** [member-management.md §3.3](./member-management.md#33-edit-member--membersidedit) is authoritative — current field set and rules 16/29–31 compliance detail.

---

## WSCR-07 — Reports

**Route:** `/reports` · All signed-in users

> **Superseded.** [reporting.md](./reporting.md) is authoritative — adds the date-range-scoped bar charts (REQ-REPORT-001) and itemized transaction list (REQ-REPORT-002) this section's own note anticipated. The summary tiles and Expiring This Week content below is unchanged and still accurate, just consolidated there alongside the newer sections.

### Content

| Section | Content |
|---|---|
| Summary tiles | Total members, Active count, Expiring Soon count (within 7 days), Expired count — responsive grid: 2 columns on mobile, 4 on desktop |
| Expiring This Week | List of members whose `end_date` is within 7 days (inclusive) of today, soonest first |
| Revenue (optional detail, if the user wants it built) | Not yet specified beyond counts — do not build a revenue breakdown until it is added to this spec |

All counts are computed via `supabase-js` queries filtering on `end_date` — no Edge Function needed since these are read-only aggregate queries, not writes.

> **Note:** this section is intentionally lighter than the mobile app's unwritten SCR-007 (which was still "📝 Pending" in the mobile spec too — see [spec/screens.md](../../spec/screens.md)). If richer reporting (charts, date-range filters, exports) is wanted, add it to this file first before building it.

### Non-functional compliance ([rules.md](./rules.md) rules 16, 29–31)

| Concern | Behavior |
|---|---|
| Loading | Skeleton tiles + skeleton list rows while the aggregate queries are in flight — not a blank page |
| Error | "Couldn't load reports — check your connection and try again." (network/timeout, bounded by `with-timeout.ts`) or "Something went wrong loading reports. Please try again." (generic) + Retry button re-running the same queries |
| Empty — Expiring This Week | "No memberships expiring this week." — a genuinely common, non-error state for a healthy member base, not a failure |
| Empty — zero members overall | Summary tiles show `0` for every count (a valid value, not an empty state); the Expiring list shows the same "No memberships expiring this week" message rather than a separate "no members at all" variant, since there's nothing more specific to say |
| Responsive | Summary tiles: 2-column grid mobile, 4-column desktop (already specified above). Expiring list: single-column stacked rows at every width — never a table requiring horizontal scroll. All row content meets the 44×44px touch-target minimum |

---

## WSCR-08 — Manage Plans

**Route:** `/plans` · Admin only

> **Superseded.** [master-data-management.md](./master-data-management.md) is authoritative for this screen — the Add/Edit field table below predates the unified Plan catalog (missing `category`/`max_members`, both required per REQ-ADMIN-002), and Delete is implemented (usage-guarded, see that doc's §5), not deferred as this section originally said. Layout/loading/error/empty-state content here is still accurate and reused there.

### Layout

| Breakpoint | Layout |
|---|---|
| Mobile (`< 768px`) | Stacked cards, one per plan: name + category badge, duration, price, edit/delete icon buttons — never the raw 4-column table, which would force horizontal scrolling at this width |
| Desktop (`>= 768px`) | Table: Name, Duration (days), Price, Actions (edit/delete) |

"+ Add Plan" button in the top bar at both widths, meeting the 44×44px touch-target minimum (rules.md rule 16).

### Loading, errors & empty state (rules.md rules 29–31)

| State | Behavior |
|---|---|
| Loading | Skeleton cards/rows in place of the list |
| Error | "Couldn't load plans — check your connection and try again." (network/timeout) or "Something went wrong loading plans. Please try again." (generic) + Retry, same pattern as every other list screen |
| Empty | "No plans yet." + "Add Plan" CTA — distinct from a fetch error, never conflated with it |

### Add/Edit form (dialog or slide-over panel)

| Field | Required | Rule |
|---|---|---|
| name | Yes | 1–60 chars, unique |
| duration_days | Yes | Integer ≥ 1 |
| price | Yes | Number ≥ 0 |

### Delete flow

```
Delete clicked
  → planService.delete(id) — calls delete-plan Edge Function
      → 409 (in use): toast "Cannot delete — used by {n} subscription(s)."
      → other failure (network/timeout/generic): toast "Couldn't delete this plan. Please try again."
        (rules.md rule 30) — row stays in the list, re-clicking Delete is the retry path
      → success: confirm dialog was already shown before calling delete; row removed, toast "Plan deleted"
```

Client shows a confirm dialog ("Delete plan? '{name}' will be permanently deleted.") before calling delete, but the actual "is it safe to delete" check happens server-side in the Edge Function — the client does not pre-check via a separate count query first (unlike the mobile app's two-step guard), since the Edge Function already returns a friendly error in one round trip.

Editing a plan is always allowed, even with existing subscriptions; it never recalculates existing `end_date` values.

---

## WSCR-12 — Manage Branches

**Route:** `/branches` · Admin only

New screen — Branch Management (REQ-ADMIN-003) had no route or screen at all before [master-data-management.md](./master-data-management.md), which is authoritative for it. See that doc for the full field list, layout, and loading/error/empty-state treatment — same shape as WSCR-08 above (list + Add/Edit + usage-guarded Delete, implemented).

---

## WSCR-09 — Manage Users

**Route:** `/users` · Admin only

### Layout

| Breakpoint | Layout |
|---|---|
| Mobile (`< 768px`) | Stacked cards, one per user: name + role badge + status badge, email below, edit/deactivate icon buttons — never the raw 5-column table at this width |
| Desktop (`>= 768px`) | Table: Name, Email, Role, Status (Active/Deactivated), Actions (edit, deactivate/reactivate) |

"+ Invite User" button → `/users/invite`, at both widths, meeting the 44×44px touch-target minimum (rules.md rule 16).

### Loading & errors (rules.md rules 29–30)

| State | Behavior |
|---|---|
| Loading | Skeleton cards/rows in place of the list |
| Error | "Couldn't load users — check your connection and try again." (network/timeout) or "Something went wrong loading users. Please try again." (generic) + Retry |

No empty state (rule 31) applies here — the signed-in admin viewing this page is always at least one row, so this list can never legitimately be empty.

### Edit (role / full_name / active state)

| Field | Editable | Notes |
|---|---|---|
| full_name | Yes | 2–80 chars |
| roles | Yes | Multi-select chip row, one chip per row in the `roles` catalog (admin-managed, [WSCR-15](#wscr-15--manage-roles)) — a user can hold more than one role at once, not a single Admin/Staff radio choice. Admin cannot change their own roles or active state (disabled control on their own row, enforced server-side too — [edge-functions.md §5](../backend/edge-functions.md#5-user-management-req-admin-004006)) |
| is_active | Yes | Toggle, via confirm dialog: "Deactivate user? {name} will not be able to sign in." / "Reactivate user? {name} will be able to sign in again." |

There is no PIN/password field here — Supabase Auth owns credentials; an admin cannot set or see another user's password. If a user needs a password reset, that is Supabase's standard "forgot password" email flow, not an admin action in this screen.

### Data source

The list itself (name, email, role, status) comes from the `list-users` Edge Function, not a direct `profiles` read — `profiles` has no `email` column, and reading other users' emails needs the Admin API (service role). See [edge-functions.md §5](../backend/edge-functions.md#5-user-management-req-admin-004006).

### Submit flow

Calls the `update-user` Edge Function (**not** a direct `supabase-js` `.update()`, corrected from an earlier draft of this doc) — `profiles_update_admin`'s RLS policy has no row-level way to exclude "the caller's own id," so the self-protection rule (an admin can't change their own `role`/`is_active`, or delete their own account) can only be enforced server-side, inside that function ([edge-functions.md §5](../backend/edge-functions.md#5-user-management-req-admin-004006) item 4). `full_name`-only self-edits are still allowed. On failure: "Couldn't update this user. Please try again." (rule 30) — the row's edit control stays open/populated as the retry path.

---

## WSCR-10 — Invite User

**Route:** `/users/invite` · Admin only

### Layout

Single-column form at every width (rules.md rule 16) — 3 fields, no layout that could ever need a breakpoint split. Submit button meets the 44×44px touch-target minimum.

### Fields

| Field | Required | Rule |
|---|---|---|
| email | Yes | Valid email format |
| full_name | Yes | 2–80 chars |
| roles | Yes | Multi-select chip row (same catalog/control as WSCR-09's edit form), at least one required — not a single Admin/Staff default-Staff choice |

### Submit flow

```
Invite tapped
  → validate fields
      → errors: inline, stop
      → valid: userService.invite({ email, full_name, roles })
          → calls invite-user Edge Function (service role, sends Supabase invite email)
          → success: navigate back to /users, toast "Invitation sent to {email}"
          → failure: inline error banner — specific message where the cause is known (e.g.
            "This email is already registered."), otherwise a generic "Something went wrong
            sending the invite. Please try again." (rules.md rule 30). Form stays populated —
            that's the retry path, no separate button needed.
```

The invited user receives a Supabase Auth email to set their password (or sign in via OAuth with that email) — there is no "temporary password" shown to the admin, unlike the mobile app's PIN-creation flow.

---

## WSCR-11 — Settings (hub)

**Route:** `/settings` · Admin only

### Layout

Cards stack in a single column at every width on mobile; desktop may lay the Data Management cards out in a 2-column grid, but never wider than that — this is a low-density hub page, not a dashboard (rules.md rule 16). Every card/link/button meets the 44×44px touch-target minimum.

### Content

| Section | Content |
|---|---|
| Profile card | Current admin's name, email, role badge(s) — `roles` is an array now, see [auth.md §5](./auth.md#5-data-model-profile) |
| Account | "Change Password" (sends a reset email via `resetPasswordForEmail`, same as WSCR-01's "Forgot password?" — completed at [WSCR-13 Reset Password](#wscr-13--reset-password)), "Sign Out" |
| Data Management | Cards linking to Members (`/`), Plans (`/plans`), Branches (`/branches`), Manage Users (`/users`), Roles (`/roles`), Audit Log (`/audit-log`, [WSCR-14](#wscr-14--audit-log)), and Member Numbering (`/member-numbering`, [WSCR-16](#wscr-16--member-numbering), count shown is the branch count — there's no natural "row count" for a settings screen), each showing a live count; Subscriptions shown as a count-only card (no dedicated global list screen to link to — see [requirements-template.md §13](../requirements-template.md#13-open-questions)) |

Row counts use simple `count: 'exact', head: true` `supabase-js` queries per table.

### Loading & errors (rules.md rules 29–30)

Each Data Management count is independent — one slow/failed count query must not block the others or the rest of the page from rendering. Per card: show a skeleton digit while its count is in flight; on failure, show "—" with a small inline "Retry" affordance for that card only, not a page-level error blocking the whole hub (the Profile card and Account section don't depend on these counts at all, so they should never be hidden behind a Data Management failure).

Unlike the mobile app (PIN change via a custom sheet + `AuthService.changePin`), password changes are Supabase Auth's native flow: `supabase.auth.updateUser({ password })` after re-authentication, or the standard "reset password" email link. Do not build a custom current/new/confirm PIN sheet — there is no PIN in this edition.

Staff users do not have a `/settings` route at all (route is admin-only per [navigation.md](./navigation.md)) — unlike the mobile app, which let staff reach a reduced version of this screen. If a reduced staff-facing account page (e.g. just "change password" + "sign out") is wanted, add it to this spec as a new route first.

---

## WSCR-14 — Audit Log

**Route:** `/audit-log` · Admin only. Reached only via the Settings hub's Data Management grid (WSCR-11) — no primary-nav entry, same as every other admin screen in this app. Implements REQ-ADMIN-005; see [backend/edge-functions.md §7](../backend/edge-functions.md#7-audit-log-req-admin-005) for the full design.

### Layout

Single column at every width: a filter form, then results as cards (mobile) / a table (desktop, `>= 768px`) — same responsive pattern as WSCR-07 Reports' transaction list.

### Filters

| Field | Type | Default | Notes |
|---|---|---|---|
| Start date / End date | `date` inputs | 1st of the current month → today | Same default as WSCR-07 Reports |
| Table | Dropdown | "All tables" | One option per table `audit_row_changes()` is actually attached to — `members`, `subscriptions`, `subscription_items`, `plans`, `branches`, `profiles`, `roles`, `user_roles` |
| Record ID | Text input | Blank | Exact match against `audit_log.record_id` (stored as text regardless of the source table's real PK type) |
| Changed by | Dropdown | "Anyone" | Populated from `profileRepository.getAllUsers()` (same data Manage Users already fetches) — no new query needed |

An "Apply" button re-runs the query; changing a filter does not auto-apply (consistent with WSCR-07's date range, extended here to every filter).

### Results

One row per field-level change (REQ-AUDIT-001) — a single edit touching 3 fields shows as 3 rows, same `change_id`, same timestamp. Each row shows: when (local time, via `toLocalDisplay`), table name, record id, field name, an operation badge (Created/Updated/Deleted, colored success/warning/danger respectively), old value → new value (`—` for whichever side is `null` — `null` on the old side means it was created, `null` on the new side means it was deleted), and who made the change (falls back to "System" if `changed_by` is `null`, "Deleted user" if the profile no longer resolves).

Capped at 500 rows per filter set — if more exist, a notice above the results says so and asks the admin to narrow the range/filters; there is no pagination control (out of scope for this pass, per the same "fetch once, filter client-side" philosophy as the Member List at this app's scale, just with an explicit ceiling since this table's growth is unbounded EAV, unlike Member).

### States

| State | Trigger | Behavior |
|---|---|---|
| Loading | Filters applied (including initial load) | Skeleton block, same shimmer as WSCR-07 |
| Loaded, empty | Query returns zero rows | "No changes match these filters." |
| Loaded, truncated | More than 500 rows match | Warning-toned notice above the results, in addition to showing the first 500 |
| Network error | Fetch times out or fails | "Couldn't load the audit log — check your connection and try again." + Retry |
| Generic error | Any other failure | "Something went wrong loading the audit log. Please try again." + Retry |

### Non-functional compliance

**Strictly view-only** — no edit or delete action anywhere on this screen, for any entry, at any time (REQ-ADMIN-005's acceptance criteria; the audit log is append-only by design, see [domain-model.md §7](../backend/domain-model.md#7-auditlog)). No Edge Function is used — this is a direct, admin-only RLS-gated read (`audit_log_select_admin`), same pattern as Reports.

---

## WSCR-15 — Manage Roles

**Route:** `/roles` · Admin only. Reached only via the Settings hub's Data Management grid (WSCR-11), same as Manage Plans/Manage Branches — no primary-nav entry. This screen was built as the direct UI counterpart of the `profiles.role` → `roles`/`user_roles` catalog redesign ([backend/domain-model.md §1a/§1b](../backend/domain-model.md)) that closed a self-promotion RLS gap, but was never given a frontend spec entry until now.

### Layout

Same list + Add/Edit form shape as WSCR-08 Manage Plans / WSCR-12 Manage Branches: cards on mobile, a table on desktop (`>= 768px`), a form panel that opens inline for both Add and Edit.

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | Text | Yes | Unique among non-deleted roles (`idx_roles_name_active`) — a duplicate name is rejected with "This name is already used by another role." |
| Description | Text | No | Free text |

### Actions

| Action | Behavior |
|---|---|
| Add Role | Opens the form empty; on save, calls `roleService.create` |
| Edit | Opens the form pre-filled; on save, calls `roleService.update(id, ...)` |
| Delete | Confirmation dialog, then `roleRepository.delete(id)` → `delete-role` Edge Function. Blocked with "Cannot delete — used by X user(s)" if any `user_roles` row still references it — same "used by X" guard shape as Plan/Branch. |

### States

Same loading/error/retry shape as WSCR-08/WSCR-12: skeleton while loading, network vs generic error distinction with Retry, empty state ("No roles yet." + Add Role button) when the catalog has zero rows.

### Non-functional compliance

Admin-only (`RequireAdmin`, same as every other screen in this section) — this is the screen that makes REQ-ADMIN-004's "edit role" meaningful now that a user's role is a many-to-many assignment rather than a single enum column; assigning/revoking which roles a *user* holds still happens on Manage Users (WSCR-09), not here — this screen only manages the catalog of role *names* that exist to assign.

---

## WSCR-16 — Member Numbering

**Route:** `/member-numbering` · Admin only. Reached only via the Settings hub's Data Management grid (WSCR-11) — no primary-nav entry. Operational configuration over REQ-MEM-005's existing generator, not a new requirement; see [backend/member-management.md §3.1](../backend/member-management.md#31-admin-configuration-member-numbering-screen) for the full backend design.

### Layout

Two stacked sections, single column at every width: Global Settings (a small form), then Per-Branch Sequences (cards/table, same responsive card/table split as WSCR-08/WSCR-12/WSCR-15).

### Global Settings

| Field | Type | Notes |
|---|---|---|
| Start sequence | Whole number, ≥ 1 | First sequence number issued to a branch, the first time that branch is ever used |
| Increment | Whole number, ≥ 1 | Step size between consecutive numbers within one branch. The counter never resets. |
| Padding width | Whole number, 1–10 | Zero-padding width for the sequence portion, e.g. `4` → `0001` |

"Save Settings" writes all three `configuration` rows at once. A hint above the form makes explicit that this only affects *future* numbers — existing `member_number` values are never recalculated (same non-retroactive principle as editing a Plan). Success/failure feedback as an inline banner (rules.md rule 30).

### Per-Branch Sequences

No year picker — each branch has exactly one counter, continuous for that branch's entire lifetime (it never resets, not even at a calendar-year boundary; see [backend/member-management.md §3](../backend/member-management.md#3-member-number-generation-req-mem-005)), so there's only ever one current state per branch to show. Each row (one per active branch) shows:

| Column | Content |
|---|---|
| Branch | Name + code |
| Last issued | The full formatted `member_number` last given out at this branch (`{code}-{current year}-{padded sequence}` — always previewed with the *current* calendar year, since that's what a registration happening right now would receive), or "None yet" if no member has ever been registered there |
| Next number | The full formatted `member_number` the *next* registration at this branch will receive — computed client-side as a preview, same "client previews, server decides" split as RenewSubscriptionPage's `end_date` preview |
| Actions | "Edit" opens an inline number input in place of the Next-number cell |

Each branch's counter is independent by construction (`member_number_sequences` is keyed by `branch_id` alone) — a hint above the table says so explicitly, since this is the exact behavior the request that produced this screen asked to confirm. The same hint also states the never-resets rule plainly, since it's easy to assume (wrongly) that a fresh year means a fresh counter.

### Editing a branch's next number

Inline edit, not a modal: "Edit" swaps the Next-number cell for a plain number input plus Save/Cancel icon buttons. Save calls `memberNumberingRepository.updateSequence(branch_id, next_sequence)` → `update-member-number-sequence` Edge Function. Two outcomes:

- **Applied as requested**: the list reloads, edit closes, no extra notice.
- **Adjusted** (the requested number had already been issued to some member at that branch — in any year, active or previously deleted): the Edge Function walks forward to the next unused number and applies that instead. The screen surfaces this via a plain `window.alert` naming both the requested and applied values (e.g. "Downtown: 150 was already used — set to 153 instead.") — a deliberately blunt, impossible-to-miss notice for a low-frequency admin action, not a toast that could go unnoticed.

### States

Same loading/error/retry shape as the other Settings-hub screens (skeleton, network vs generic error distinction, Retry). No empty state needed for the branch list — Branch Management (WSCR-12) is the only place branches are created, and this screen simply has nothing to show if none exist yet, same as it would for zero of anything.

### Non-functional compliance

Every value shown is either a direct RLS-guarded read (`configuration`, `member_number_sequences` — both admin-only `select` policies) or a client-side preview computed from one; every write goes through a service-role Edge Function, never a raw client update — consistent with this app's server-side-authority principle (architecture.md) and with the collision-avoidance logic specifically needing to query `members`, something RLS alone can't gate safely for this purpose.
