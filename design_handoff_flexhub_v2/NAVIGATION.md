# Navigation Structure — Fit & Fine

## Project Summary

Fit & Fine is a gym membership and subscription management system built for a small, real gym (single or multi-branch). It replaces manual/paper or spreadsheet tracking with a system of record: front-desk staff register members, sell/renew memberships and add-ons, and look up who's expiring; owners/admins manage the plan/branch/staff catalog and review earnings and membership health via Reports. Staff and admins share the same login and the Members/Reports screens; everything else (Plans, Branches, Users, Roles, Audit Log, Member Numbering) is gated to admins only. The app is a web-native edition (React + React Router + Supabase), responsive across mobile, tablet, and desktop, with a sibling Expo/React Native mobile app covering the same core workflows.

---

## Primary Navigation

Rendered as a desktop sidebar (`>= 768px`) or a mobile bottom tab bar (`< 768px`) — same three items, one source of truth ([nav-items.tsx](src/components/nav-items.tsx)). Staff see 2 items; admins see all 3.

| Title | Route | Access | Contains |
|---|---|---|---|
| **Members** | `/` | All users | The app's home screen — search, filter, sort, and browse every member. Full detail below. |
| **Reports** | `/reports` | All users | Membership-health dashboard. Summary tiles (total/active/expiring/expired member counts), a bar chart of new registrations, an "Expiring This Week" list, a date-range-scoped payment-mode donut chart (Cash/UPI/Card), and an itemized transaction list for the selected range. Read-only — no admin action lives here. |
| **Settings** | `/settings` | Admin only | The admin hub. A Profile card (current admin's name/email/roles), Account actions (Change Password, Sign Out), and a Data Management grid of cards — each showing a live row count and linking out to one of the catalog/admin screens listed below. |

### Members — search, filter, sort & card/row content

**Data source:** one row per non-deleted member, with their current membership plan/expiry and current add-on plan ids already joined in (`member_list_view`) — fetched once per visit to `/`, then everything below runs client-side over that set (no pagination, no server round-trip per keystroke).

- **Search** — matches `name`, `member_number`, or `phone` (substring, case-insensitive; phone match ignores spaces), live as-you-type.
- **Status pills** — `All` / `Active` / `Expiring` / `Expired`, single-select. Each pill shows a **live count** of how many members it would surface given the search box and filter panel's current state (before the pill's own filter is applied), so the numbers update as you type or filter, not just once on load.
- **Filter panel** — three independent multi-selects, all combinable with each other, the search box, and the status pill:
  - **Gender** — Male / Female / Other
  - **Plan** — any current membership plan
  - **Add-on** — matches if the member currently holds that add-on (a member can hold more than one)
- **Sort** — Join date (newest first, the default), Name, or Expiry.
- **Card / row content:**
  | Field | Mobile card | Desktop table |
  |---|---|---|
  | Avatar | ✓ (thumbnail, initials fallback) | ✓ (thumbnail, initials fallback) |
  | Name | ✓ | ✓ |
  | Member number | ✓ | own column |
  | Phone | ✓ (combined with plan) | own column |
  | Plan | ✓ (combined with phone, e.g. "Gold Plan · 98765xxxxx") | own column |
  | Expiry | ✓ ("Expires 12 Aug 2026" / "Expired 3 Jul 2026" / "—") | own column |
  | Status badge | ✓ (Active green / Expiring Soon amber / Expired red / No plan neutral) | own column |
  | Edit action | icon button, doesn't trigger the row's own open-detail click | icon button in an Actions column |
- **The image** — each member's avatar is a compressed thumbnail (`photo_thumbnail_url`); members with no photo get a deterministic initials avatar (hashed from member id → one of the app's categorical colors) instead. **Clicking a photo avatar** (thumbnail placeholders aren't clickable — there's nothing to enlarge) opens it full-size in a lightbox overlay, fetching the original uncompressed upload (`photo_url`), not the thumbnail. Closes via backdrop click, Escape, or a close button; opening it does not also navigate to the member's detail page.
- **Empty states** — "No members yet." + Add Member CTA (nothing in the system at all) vs. "No members match these filters." + Clear filters (search/filter narrowed the list to zero) — distinct copy for each, never conflated.
- **Actions available:** search/filter/sort as above, "+ Add Member", inline row edit, click a row to open Member Detail, click an avatar photo to enlarge it.

---

## Member Workflows (reached from the Members list, not primary nav)

| Title | Route | Access | Contains |
|---|---|---|---|
| **Member Detail** | `/members/:id` | All users | A member's full record: hero (avatar, name, status, member number), personal + medical + emergency-contact details (inline-editable), the current membership + add-ons (with a "Renew"/"Add" action), and full subscription history. Full detail below. |
| **Add Member** | `/members/new` | All users | Creates a new member row — 20 fields across identity, medical, and emergency-contact info, plus an optional photo. Full detail below. |
| **Renew / Add Subscription** | `/members/:id/renew` | All users | Multi-item checkout to sell one or more plans/add-ons to a member in one go. Full detail below. |
| **Edit Member** | `/members/:id/edit` | All users | Same field set as Add Member, pre-filled with the member's current data (equivalent to using the inline "Edit" toggle on Member Detail directly). `member_number` and `created_by` are shown read-only, never editable. Cancel returns without saving; Save updates the member and returns to their detail page. |

### Add Member — full field list

One form, single column on mobile, no subscription collected here (that's the separate Renew/Add Subscription flow, opened from the new member's detail page right after creation).

| Group | Fields |
|---|---|
| Identity | name*, phone* (10 digits, unique), date_of_birth*, date_of_joining* (defaults to today), branch_id* (drives member-number generation), gender* |
| Body metrics | weight_kg*, height_cm* |
| Medical | under_doctor_care* (Yes/No toggle, default No), doctor_care_details (required only when the toggle is Yes, otherwise hidden) |
| Emergency contact | emergency_contact_name*, emergency_contact_phone* (10 digits), emergency_contact_relationship* |
| Optional | email, residential_address, aadhaar_number, occupation |
| Staff record | handled_by_staff — pre-filled with the logged-in staff member, changeable before submit (e.g. if a colleague actually handled the signup) |
| Photo | optional, via **Take Photo** (in-page camera capture) or **Upload Photo** (file/gallery picker) — always both options, never one hidden behind the other. Compressed client-side (~400px, under ~50KB); both the original and the compressed thumbnail are uploaded, and a photo failure never blocks saving the rest of the member's details |

`*` required. `member_number` and `created_by` are never form inputs — the database generates/sets them. On save: navigates straight to the new member's detail page; on failure, the form stays open with entered values intact (the retry path) and a specific error where the cause is known (e.g. a duplicate phone), a generic one otherwise.

### Member Detail — additions beyond the base record

Member number shown read-only near the hero; `handled_by_staff` remains editable here too (reassignable after the fact); a photo upload/camera-capture control (shows the full-resolution `photo_url`, not the thumbnail); a Delete action (soft delete, confirm dialog, returns to the Members list). Member-field saves and subscription saves are completely independent actions with their own loading/error state.

### Renew / Add Subscription — checkout form

Not a single-plan form — a **cart-style checkout**: one payment mode and notes field for the whole visit, plus one or more line items added/removed freely.

| Field | Scope | Notes |
|---|---|---|
| payment_mode | Header (once per checkout) | Cash / UPI / Card, default Cash |
| notes | Header | Optional, ≤ 200 chars |
| plan | Per item | Selected from the active catalog, grouped by category (Membership / Add-on) |
| start_date | Per item | Defaults to the day after the member's current same-category item expires, or today if they have none |
| quantity | Per item | ×1/×2/×3/×6/×12 chips + custom, hidden entirely for indefinite (no-expiry) plans |
| amount_paid | Per item | Defaults to `plan.price × quantity`, recalculated live, always editable after |
| shared_member_id | Per item, conditional | Only shown for a membership plan with `max_members = 2` |
| end_date | Per item | Read-only live preview — the real value is computed and returned by the server on save |

**Constraint:** exactly one item in the checkout must be a membership item; Save stays disabled until that's true. Before the request is sent, every item is checked client-side for a date-range overlap against the member's current items and against each other — a conflict shows a warning naming the clashing plan/dates with "Cancel" or "Save anyway," rather than silently blocking the sale. On success, returns to the member's detail page. This same screen and form handle both "first subscription" (from Member Detail's empty state) and "renew" (an existing membership) — there's no separate mode.

---

## Admin / Data Management (reached only via the Settings hub — no primary-nav entry)

| Title | Route | Access | Contains |
|---|---|---|---|
| **Manage Plans** | `/plans` | Admin only | Catalog of membership plans (name, duration, price, category, max members). List (cards on mobile, table on desktop) with Add/Edit in a form panel and usage-guarded Delete (blocked with a "used by N subscriptions" message if any member currently holds that plan). |
| **Manage Branches** | `/branches` | Admin only | Catalog of gym branches/locations, same list + Add/Edit + usage-guarded Delete shape as Manage Plans. Branches scope member numbering and member/subscription records throughout the app. |
| **Manage Users** | `/users` | Admin only | List of every staff/admin account (name, email, role badges, active/deactivated status). Edit a user's full name, roles (multi-select — a user can hold more than one), or deactivate/reactivate them (with confirmation). An admin cannot change their own role or active state. Links to Invite User for adding new accounts. |
| **Invite User** | `/users/invite` | Admin only | Single form (email, full name, roles) that sends a Supabase Auth invite email to a new staff/admin account — no temporary password is shown to the admin. |
| **Manage Roles** | `/roles` | Admin only | Catalog of role names (name + description) that can be assigned to users on Manage Users — this screen manages which roles *exist*, not who holds them. Add/Edit/usage-guarded Delete, same list shape as Manage Plans/Branches. |
| **Audit Log** | `/audit-log` | Admin only, view-only | Append-only, field-level history of every change across members/subscriptions/plans/branches/profiles/roles. Filterable by date range, table, record id, and who made the change. Each row shows old value → new value and the actor. No edit or delete action exists anywhere on this screen. |
| **Member Numbering** | `/member-numbering` | Admin only | Operational configuration for the per-branch member-numbering sequence: global settings (start number, increment, zero-padding width) and a per-branch table showing each branch's last-issued and next-to-issue member number, with an inline override for the next number if needed. |

---

## Authentication (outside the main app shell — no nav chrome)

| Title | Route | Access | Contains |
|---|---|---|---|
| **Login** | `/login` | Public | Email/password sign-in plus "Continue with Google" OAuth, a "Forgot password?" link, and inline error/notice banners (wrong credentials, deactivated account, reset-link-sent confirmation). Redirects to Members if already signed in. |
| **Reset Password** | `/reset-password` | Reached only via a password-reset email link | New password + confirm password form, shown only while a Supabase password-recovery session is active. Redirects away (to Members or Login) for anyone who lands here without one. |

---

## Source of truth

This file is a navigation-level summary for quick orientation. For full field-level, validation, and state-handling detail per screen, see [spec/frontend/screens.md](../spec/frontend/screens.md) and [spec/frontend/navigation.md](../spec/frontend/navigation.md) (route map, access control, entry-point logic).
