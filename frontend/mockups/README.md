# Handoff: FlexHub — Fit & Fine Gym Member & Membership Management

## Overview
High-fidelity UI mockups for the Fit & Fine gym membership management web app ("FlexHub"): Login (with error/signed-out variants), Members list, Add/Edit Member forms with validation, Member Detail, Renew/Add Subscription checkout, Reports dashboard (with empty states), the full Settings/Admin area (Plans, Branches, Users, Roles, Audit Log, Member Numbering), plus global network-error states and a shared footer.

## About the Design Files
The file in this bundle (`Gym App Mockups.dc.html`) is a **design reference created in HTML** — a prototype showing intended look and behavior, **not production code**. The target application **already exists in React (React Router + Supabase, with a sibling Expo/React Native app)**. The task is to **recreate these designs inside that existing codebase** using its established patterns, components, and Tailwind classes — do not port the HTML directly. All screens live behind a top dark preview bar with screen-switcher buttons and a "Simulate network error" toggle: **that bar is a mockup-only device, do not implement it**; each screen maps to a real route (see Screens).

## Fidelity
**High-fidelity.** Colors, spacing, typography, copy, and states are final intent. Recreate pixel-close using the codebase's existing Tailwind setup. The theme is parameterized (see Design Tokens) — implement the tokens once and derive all screens from them.

## Theming (tint / CTA / radius)
The design has 3 theme axes, matching the team's login playground. Implement as a small theme config, defaulting to `sky + charcoal + soft`:

| Axis | Options | Values |
|---|---|---|
| tint | sky (default) | card bg `#eff6ff→#fff` gradient, border `#dbeafe`, accent `#2563eb`, pill bg `#dbeafe` |
| | violet | `#f5f3ff` / `#ede9fe` / accent `#7c3aed` |
| | emerald | `#ecfdf5` / `#d1fae5` / accent `#059669` |
| | amber | `#fffbeb` / `#fef3c7` / accent `#b45309` |
| | rose | `#fff1f2` / `#ffe4e6` / accent `#be123c` |
| cta | charcoal (default) | `linear-gradient(to bottom, #374151, #111827)` = Tailwind `bg-gradient-to-b from-gray-700 to-gray-900` |
| | orange | `from-orange-500 to-orange-700` |
| | blue | `from-blue-500 to-blue-700` |
| radius | soft (default) | card 28px (`rounded-3xl`), inputs/buttons 12px (`rounded-xl`), tiles 16px (`rounded-2xl`), pills 999px |
| | pill | card 40px, elements `rounded-full` |
| | sharp | card 10px (`rounded-lg`), elements 6px (`rounded-md`) |

Tint accent drives: active nav item, active status pill, filter-button active state, selected chips (gender, payment, quantity, roles), checkbox fill, progress bars, donut "Cash" slice, hub count badges, admin tab pills.

## Responsive Specification (web, tablet, mobile)
One responsive React app — same components, breakpoint-driven layout. Breakpoints used in the mockup:

| Breakpoint | Behavior |
|---|---|
| ≥ 861px (desktop) | Left sidebar nav 220px (Members / Reports / Settings), member list as a 7-column table-style grid (`2fr 1fr 1.1fr 1.1fr 1fr 0.9fr 60px`) |
| ≤ 860px (mobile/tablet-portrait) | Sidebar hidden → fixed bottom tab bar (3 tabs, active = tint accent); member table → stacked member cards (avatar, name+status row, member #, plan · phone, expiry) |
| ≤ 980px | Reports tiles 4-col → 2-col; report grid 2-col → 1-col; admin list+form 2-col → 1-col; hub cards 3-col → 2-col |
| ≤ 760px | Member Detail 2-col → 1-col |
| ≤ 640px | All form grids 2-col → 1-col; hub cards → 1-col |

Nav rule (from NAVIGATION.md): desktop sidebar ≥768px, mobile bottom tabs <768px — align the mockup's 860px cut to the codebase's existing 768px convention. Staff see 2 nav items; admins see all 3. Touch targets on mobile ≥44px. Filter drawer: fixed right panel 320px wide, `max-width: 85vw` on small screens, backdrop `rgba(17,24,39,0.35)`.

## Screens / Routes

### 1. Login — `/login`
Centered card, max-width 380px, tint gradient bg, tint border, radius `card`, shadow `0 20px 40px rgba(17,24,39,0.08)`, padding 36/32.
- Logo tile 56px white, radius `tile`, shadow `0 6px 16px rgba(17,24,39,0.12)`, dumbbell icon.
- H2 22px/600 "Welcome to Fit & Fine"; sub 13.5px `#6b7280`.
- Inputs: username (user icon) + 4-digit PIN (lock icon, `letter-spacing: .4em`, right-aligned `0/4` counter 11px `#9ca3af`). Input style: `bg #f9fafb, border 1px #e5e7eb, radius el, padding 10px 12px 10px 34px, 13.5px`.
- "Forgot PIN?" right-aligned 12px link.
- CTA "Sign in" full-width, cta gradient, white, shadow `0 6px 14px rgba(17,24,39,0.15)`; disabled = `bg #e5e7eb, text #9ca3af`.
- Dashed divider "Or sign in with" + white Google button (official G logo, h 42px, border `#e5e7eb`).
- Footer line 11px `#9ca3af`: "Fit & Fine Gym · v1.0.0".

**States** (banner above inputs, radius `el`, 12.5px, icon left):
- Wrong credentials: bg `#fef2f2`, border `#fecaca`, text `#b91c1c` — "Incorrect username or PIN. Try again or ask an admin to reset your PIN."
- Deactivated: `#fffbeb`/`#fde68a`/`#92400e` — "This account has been deactivated. Contact an admin to restore access."
- Reset link sent: `#ecfdf5`/`#a7f3d0`/`#047857` — "A PIN reset link has been sent to your registered email."
- Network error: red banner "Can't reach the server. Check your internet connection and try again." + Retry.
- Signed-out screen: same card; green check circle (`#dcfce7`/`#15803d`), "You're signed out", "Your session has ended safely. Redirecting to sign in…", 4px progress bar (65% tint accent), "Sign in again" CTA. Auto-redirect to `/login`.
- Redirect: already-authenticated users landing on `/login` go to `/`.

### 2. Members list — `/` (home)
- Header: "Members" 22px/700 + "+ Add Member" CTA (cta gradient, 13px/600).
- Search input max 340px, search icon, placeholder "Search by name, member #, or phone" — matches name/member_number/phone, live.
- **Filters button** (funnel icon + "Filters" + count badge when active; active state = tint bg/border/accent) opens a **right-side drawer**: sections Gender (Male/Female/Other), Plan, Add-on as checkbox lists (18px boxes, tint fill when checked); footer "Clear all" + "Apply filters" (cta gradient). Close via X or backdrop.
- Applied filters render as **removable chips** under the search row: `Group: Value` pill (tint pill bg + accent text) with × button, plus "Clear all" text link.
- Status pills: All / Active / Expiring / Expired with live counts; selected = solid tint accent, others white with `#e5e7eb` border.
- Sort dropdown ("Sort: Join date ▾"); options Join date (default, newest), Name, Expiry.
- Rows (desktop): white, radius 12px, border `#f1f1f3`, avatar 38px (radius tile, categorical bg color hashed from member id, initials fallback), name 13.5px/600, other cells 13px `#6b7280`. Status badges: Active `#dcfce7`/`#15803d`, Expiring Soon `#fef3c7`/`#b45309`, Expired `#fee2e2`/`#b91c1c`, No plan `#f3f4f6`/`#6b7280`. Edit icon button 30px per row (stopPropagation from row click → detail).
- Photo avatars open a full-size lightbox (original `photo_url`, not thumbnail); initials avatars aren't clickable.
- Empty states: "No members yet." + Add Member CTA vs "No members match these filters." + Clear filters.
- Network error state: full-area centered — offline icon in `#fee2e2` 60px tile, "Couldn't load members" 15px/700, "Check your internet connection. Your search and filters are kept — nothing is lost.", Retry CTA.

### 3. Add Member — `/members/new`; Edit Member — `/members/:id/edit`
Centered column max 720px; back arrow + title; subtitle: Add = "Subscription is sold separately after the member is created."; Edit = "FF-0198 · Rohan Mehta · joined 2 Nov 2025".
White section cards (radius 16px, border `#f1f1f3`, padding 20/22) with uppercase 11.5px `#9ca3af` section titles: **Identity, Body metrics, Medical, Emergency contact, Optional details, Staff record, Photo**. Two-col grid, 1-col ≤640px.
- Required fields marked with red asterisk: name, phone (10 digits, unique), DOB, date of joining (defaults today), branch (select, helper "Drives member-number generation."), gender (3 equal chips, selected = tint), weight, height, under-doctor-care toggle, emergency name/phone/relationship.
- Medical toggle (44×24 switch, tint when on) reveals required "Doctor care details" textarea only when Yes.
- Optional: email, occupation, aadhaar, residential address.
- Staff record: handled_by_staff select pre-filled with logged-in user, helper text.
- Photo: 64px preview (dashed placeholder in Add; filled avatar in Edit), always BOTH "Take Photo" and "Upload Photo" buttons; helper "Compressed automatically. A photo failure never blocks saving the member."
- Edit-only: read-only Member number + Created by (dashed border, `#f3f4f6` bg, lock icon) — never editable.
- Validation (Edit mockup shows): error summary banner (`#fef2f2`/`#fecaca`, "Please fix 2 errors below before saving."); error inputs = `border 1.5px #f87171, bg #fef2f2` + 11.5px `#dc2626` message below ("This phone number is already registered to FF-0198.", "Must be exactly 10 digits.").
- Save failure keeps the form open with values intact; network error shows amber banner "Couldn't save — network error. Everything you entered is kept; retry when you're back online." + Retry save.
- Footer: Cancel (ghost) + "Create member"/"Save changes" (cta gradient), right-aligned. On save → member detail.

### 4. Member Detail — `/members/:id`
Max 920px. Hero card: 68px avatar, name 19px/700 + status badge, meta line "FF-0231 · 98765 43210 · Female · joined 14 Feb 2026", "Handled by: …" (editable), Edit + Delete (red ghost, soft-delete confirm → members list).
Two columns (1.0 / 1.15; stack ≤760px):
- Left: Personal / Medical / Emergency cards as key-value rows (key 12.5px `#9ca3af`, value 13px/500 right-aligned, dividers `#f5f5f6`).
- Right: **Current membership** card on tint gradient bg with accent section title, "Renew" CTA, plan 17px/700, dates + amount line, 6px progress bar (tint accent) + "12 days remaining"; **Add-ons** card ("+ Add" ghost) rows with status badges; **Subscription history** timeline rows (8px colored dot, title 13px/600, meta 11.5px, amount right 12.5px/600).
Member-field saves and subscription saves are independent actions with separate loading/error state.

### 5. Renew / Add Subscription — `/members/:id/renew`
Max 720px, back → detail. Subtitle "one checkout, one or more items".
- **Payment card** (once per checkout): Cash / UPI / Card chips (default Cash, selected = tint) + notes input (optional ≤200 chars).
- **Item cards** (repeatable): category tag (Membership = tint pill, Add-on = amber pill) + trash icon; fields Plan (select, grouped by category), Start date (helper: "Defaults to day after current same-category item expires" or today), Quantity chips ×1/×2/×3/×6/×12/Custom (hidden for indefinite plans), Amount paid (helper "Defaults to price × quantity, editable"); read-only **end-date preview** strip (dashed `#e5e7eb`, calendar icon, "Ends 12 Feb 2027 (computed on save)").
- shared_member_id field appears only for membership plans with max_members = 2.
- **Overlap warning** (amber `#fffbeb`/`#fde68a`): "Overlaps with current Personal Training (till 5 Aug 2026)." + "Cancel" / "Save anyway" buttons — warn, never silently block.
- "+ Add another item" dashed full-width button.
- Footer card: "Total this visit" ₹ 19px/700, green check line "✓ Contains exactly one membership item" (Save disabled until true), Cancel + "Save checkout".
- Network error: amber banner "Checkout couldn't be saved — network error. No payment was recorded; your items are kept."

### 6. Reports — `/reports` (read-only)
App shell, Reports nav active. Header + range chips: Today / This week / This month / Custom… (selected = solid tint).
- 4 summary tiles: Total members / Active (label `#15803d`) / Expiring soon (`#b45309`) / Expired (`#b91c1c`) — value 26px/700, sub 11.5px.
- Grid (1.25fr/1fr), **order: Payment modes, Transactions (top row); New registrations, Expiring this week (bottom)**.
- Payment modes: 190px conic donut (Cash = tint accent 46%, UPI `#f59e0b` 35%, Card `#9ca3af` 19%), 108px white center "₹86.4k collected", legend with square dots. Card fixed height 340px.
- Transactions: fixed 340px card, internal scroll (thin 5px `#e5e7eb` scrollbar), rows: member 13px/600, meta 11.5px (plan · qty · datetime · staff), mode pill, amount 13px/700; footer "Showing 9 of 42 · scroll to load more" (infinite scroll + pagination).
- New registrations: 6-month bar chart, 150px, current month = accent, others = tint pill bg, value labels above bars.
- Expiring this week: scrolling list (max 230px) of avatar + name + plan + "Mon, 3 Aug" (amber), footer "Showing 6 of 12".
- **Empty states**: tiles 0; bars → chart icon + "No registrations yet"; donut → gray ring ₹0 + "No payments in this range — try a wider date range."; expiring → green check "Nothing expiring this week"; transactions → "No transactions in this range" + Change date range button.
- Network error: full-page "Couldn't load reports" template.

### 7. Settings / Admin — `/settings` (admin only)
App shell, Settings active. Pill sub-tabs: Hub / Plans / Branches / Users / Roles / Audit Log / Numbering (in the real app these are routes `/plans`, `/branches`, `/users`, `/roles`, `/audit-log`, `/member-numbering` reached from the hub).
- **Hub**: Profile card (52px tint avatar, name, email, role badges Admin=tint / Staff=gray, Change Password + Sign Out (red ghost)); Data-management card grid (3-col) with live row-count pills, click → screen.
- **Plans**: list rows (name + category badge Membership=tint / Add-on=amber, meta "6 months · max 1 member", price right 13.5px/700, edit + delete icon buttons) + form panel: Name (duplicate error "A plan named "Gold Plan" already exists."), Category select, Duration, Price (error "Price must be greater than 0."), Max members (1 / 2 shared). Usage-guarded delete banner: "Can't delete Gold Plan — currently used by 34 subscriptions."
- **Branches**: same list shape (meta: member count + prefix) + add form (required-name error; helper "Branches scope member numbering and all member records.").
- **Users**: rows with avatar, name + role badges, email, Active (`#dcfce7`) / Deactivated (`#fee2e2`) badge, edit button; note "You can't change your own role or deactivate yourself." Invite panel: Email (invalid-email error), Full name, Staff/Admin multi-select chips, note "An invite email is sent — no temporary password is shown."
- **Roles**: name + description + holder count; guarded delete "Can't delete Staff — held by 3 users."; add form with required error.
- **Audit Log** (view-only, append-only): filter row (date range, table, actor, record-id input); rows: table pill, "**field** on record", old value (red pill `#fee2e2`) → new value (green pill `#dcfce7`), actor + timestamp right.
- **Numbering**: per-branch rows (branch, "Last issued: FF-0231", right-aligned Next input 110px; invalid override error "Must be greater than last issued (0231)."); Global settings panel (start number, increment, zero-padding select "4 (FF-0001)", Reset + Save).

## Interactions & Behavior
- Row click → member detail; edit icon click must not trigger row navigation.
- Filter drawer: slide from right; Apply closes; chips removable individually; counts on status pills recompute live against current search + filter state.
- Doctor-care toggle show/hide is immediate; the details field is required only when visible.
- Network-error handling is universal: list screens show full-area retry templates; forms show non-destructive banners and preserve all input.
- Transitions: keep subtle — 150ms on toggles/hover; no parallax or heavy animation.

## State Management (per NAVIGATION.md)
- Members: fetch `member_list_view` once per visit; search/filter/sort/status all client-side. State: query, statusPill, filters {gender[], plan[], addon[]}, sort.
- Checkout: paymentMode, notes, items[] {plan, startDate, qty, amountPaid, sharedMemberId?}; client-side overlap check against current items and each other before submit; exactly-one-membership constraint gates Save.
- Reports: dateRange scopes donut + transactions only.
- Auth: session redirects (login ↔ app), deactivated-account error on sign-in.

## Design Tokens
- Font: system stack (`-apple-system, "Segoe UI", …`). Sizes: 11/11.5/12/12.5/13/13.5/14.5/15/17/19/21/22/26px; weights 500/600/700.
- Grays: text `#111827`, secondary `#6b7280`, muted `#9ca3af`, borders `#e5e7eb` (controls) and `#f1f1f3` (cards), row dividers `#f5f5f6`, input bg `#f9fafb`, page bg `#f3f4f6`.
- Semantic: success `#dcfce7`/`#15803d`; warning `#fef3c7` or `#fffbeb`/`#b45309`/`#92400e`; danger `#fee2e2`/`#fef2f2`/`#fecaca`/`#dc2626`/`#b91c1c`.
- Avatar categorical palette: `#2563eb #7c3aed #059669 #b45309 #be123c #0891b2` (deterministic hash by member id).
- Cards: white, 1px `#f1f1f3`, radius 16px, padding 20–22px. Shadows only on login card, logo tile, CTAs (see Login).
- Icons: Lucide, 2px stroke (the mockup inlines equivalent SVGs).

## Footer (all pages)
White, top border `#e5e7eb`, max 1080px inner row: logo tile + "FlexHub" + "Fit & Fine Gym member management · v1.0.0"; links Privacy Policy / Terms of Use / Refund Policy / Support (12px, `#6b7280` → `#111827` hover); "© 2026 Fit & Fine Gym. All rights reserved." Wraps and stacks on mobile.

## Assets
No external assets — all icons are inline SVG (Lucide-equivalent), Google logo is the standard 4-color SVG, avatars are initials-based. Placeholder data throughout (names, phones, prices) — replace with live Supabase data.

## Files
- `Gym App Mockups.dc.html` — all screens in one file; use the top switcher + "Simulate network error" toggle and the login variant chips to view every state. Theme axes (tint/cta/radius) are adjustable via the file's props defaults in the `data-props` JSON.

## Screenshots
In `screenshots/` (desktop viewport):
- `10-reports.png`
- `11-reports-empty.png`
- `12-admin-hub.png`
- `13-admin-plans.png`
- `14-admin-audit-log.png`
- `15-members-network-error.png`
- `01-login-default.png`
- `02-login-wrong-credentials.png`
- `03-login-signed-out.png`
- `04-members-list.png`
- `05-members-filter-drawer.png`
- `06-add-member.png`
- `07-edit-member-errors.png`
- `08-member-detail.png`
- `09-renew-checkout.png`
