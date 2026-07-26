# Implementation Rules — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)

These rules apply to every file in `web/` and `supabase/`. They take priority over convenience or habit. Read alongside [rules.md's mobile counterpart](../../spec/rules.md) — this file supersedes it for anything under `web/`.

---

## Data & Backend

1. **Supabase is the only backend.** No custom Node/Express server, no other database. All data access goes through `supabase-js` or Supabase Edge Functions.
2. Security-relevant rules (overlap guard, `end_date` computation, plan deletion guard, audit fields, user invitation) are enforced **server-side** — RLS policies and/or Edge Functions — never trusted from client-side validation alone. See [architecture.md §Server-Side Authority](../architecture.md#server-side-authority--the-key-difference-from-the-mobile-app).
3. The Supabase **service role key** never appears in `web/` source, `.env` files committed to git, or any Vercel frontend environment variable. It exists only as an Edge Function secret.
4. All Supabase queries go through the typed `supabase-js` client — never construct raw SQL strings from user input, on the client or in an Edge Function.

## Routing

5. **React Router** only. No file-based routing conventions borrowed from `expo-router` — routes are declared explicitly (see [navigation.md](./navigation.md)).
6. Every screen that reads data re-fetches on route entry — e.g. a `useEffect` that runs when the route's params change, or a router data loader. Returning to a screen (browser back/forward, or re-navigating to the same route with different params) must never show stale data from a previous visit.

## Dates & Timezone

7. `end_date` computation: always `start_date + duration_days - 1`, computed **server-side** in the `create-subscription`/`update-subscription` Edge Functions — never trust a client-supplied `end_date`.
8. Calendar dates (`start_date`, `end_date`) are Postgres `date` columns, serialized as `YYYY-MM-DD` over the wire.
9. Datetime stamps (`created_at`, `changed_at`) are Postgres `timestamptz`, always UTC internally.
10. For display, convert UTC datetimes to the browser's local timezone (`Intl.DateTimeFormat` or equivalent). Calendar dates display as-is, no conversion.
11. A shared `web/src/lib/datetime.ts` helper must expose:
    - `todayDate(): string` — today's date as `YYYY-MM-DD` in the browser's local time
    - `addDays(date: string, days: number): string` — date arithmetic for UI previews of `end_date` (the authoritative value still comes from the server)
    - `toLocalDisplay(utc: string): string` — UTC datetime → local human-readable string
    - `formatDate(date: string): string` — `YYYY-MM-DD` → human-readable, e.g. `27 Jun 2026`

## UI & Styling

12. **Default to no third-party dependency — but evaluate one explicitly when it genuinely avoids reinventing the wheel**, rather than reflexively hand-building something a well-tested package already solves (a responsive/spacing scale, accessible interaction primitives, date math, etc.). "Evaluate explicitly" means naming the trade-off before adding it — bundle size, licensing (watch for packages with a paid/commercial tier gating the component you actually need), maintenance/supply-chain risk, and whether it fights or fits the brand tokens in colors.md — not silently `npm install`-ing whatever a blog post recommends. See [styling.md](./styling.md) for the full write-up of this reasoning as applied to Tailwind CSS below.
    - **Adopted exception: Tailwind CSS** (utility classes, via `@tailwindcss/vite`) for layout/spacing/responsive utilities — see [styling.md](./styling.md). This is deliberately *not* a component library: no pre-built buttons/dialogs/tables ship from it, so it doesn't reintroduce the risk the rest of this rule guards against.
    - **Full pre-built UI component libraries remain off-limits** (MUI, Chakra, Ant Design, shadcn/ui, Tailwind UI, Bootstrap) — this still mirrors the mobile app's "React Native core components only" constraint. Their own opinionated visual language (Material's elevation/ripples, Ant's density, etc.) would fight this app's own brand tokens, and swapping one in later is a significant rewrite (weeks, not a drop-in), not a decision to make lightly for a component or two.
13. A lightweight **icon set** is permitted (e.g. `lucide-react`) — this is not a UI component library, it's the web equivalent of the mobile app's `@expo/vector-icons`. Pick one and use it consistently everywhere.
14. All colors come from `web/src/styles/tokens.css`'s tokens — either as a CSS custom property (`var(--color-brand-600)`) in plain CSS/CSS Modules, the matching Tailwind utility (`bg-brand-600`, `text-brand-600`, ...) since both resolve to the same `@theme` token (see [styling.md](./styling.md)), or `web/src/constants/colors.ts` (TS, for JS-side reads). Never hardcode a hex value in a component file, and never reach for Tailwind's stock palette (`bg-red-500` etc.) — it's been removed from this project's theme specifically to prevent that (styling.md).
15. Follow component color rules in [colors.md §Component Color Rules](./colors.md#component-color-rules).
16. **Responsive by default, mobile-first, three tiers**: every screen must be usable at mobile (`~360px`+), tablet, and desktop widths — designed mobile-first, not desktop-with-a-shrink. Use relative units and CSS Grid/Flexbox (or Tailwind's layout utilities) — no fixed-pixel layout dimensions that break below/above a specific viewport (a fixed-width sidebar *and* a fixed-width content column both landing at the same breakpoint is exactly the bug class this rule exists to prevent — see [styling.md](./styling.md) for the incident that motivated the tablet tier below). Three tiers, matching the Tailwind breakpoint tokens defined in `tokens.css`:
    - **Mobile** (`<768px`, unprefixed/default): content stacks into a single column in reading order — no side-by-side columns, no horizontal scrolling required to reach any content.
    - **Tablet** (`768–1023px`, Tailwind `tablet:` variant): the tier most likely to be skipped if you only test mobile and desktop — verify it explicitly, don't assume desktop layout "just works" down to 768px.
    - **Desktop** (`≥1024px`, Tailwind `desktop:` variant): full multi-column layouts, per [app-shell.md §3](./app-shell.md#3-responsive-layout-shell-websrccomponentsappshelltsx).

    Every tappable control has a minimum 44×44px touch target at every tier, matching the mobile bottom tab bar's own sizing ([app-shell.md §3.2](./app-shell.md#32-mobile-bottom-tab-bar)).

## Form Conventions

Every create/edit form in the app follows the same shape — a screen-specific spec documents its own fields, not these conventions themselves.

16a. **Every required field is visually marked** (an asterisk after the label, styled with `--color-status-danger`) *and* carries `required`/`aria-required="true"` on the actual input — the visual marker alone isn't enough for assistive tech, and the attribute alone isn't enough for sighted users scanning the form.
16b. **Every field whose expected format isn't obvious from its label has a placeholder** hinting the format (e.g. "10-digit mobile number", "name@example.com", "e.g. 72.5") — optional fields are still worth a placeholder if the format is ambiguous, even though they don't get the required marker.
16c. **Decimal-limited numeric fields are masked text inputs, not `type="number"`.** A controlled `type="number"` input re-parses to `Number()` on every keystroke, which silently eats a trailing decimal point (typing "72." collapses back to "72", making a value like "72.5" unreachable). Use `type="text"` + `inputMode="decimal"` with an `onChange` mask that caps the fractional part (see `web/src/lib/input-masks.ts`'s `sanitizeDecimal`) — the raw string lives in form state and is only parsed to a number at validation/submit time. Digit-only fields (phone, Aadhaar) get the same treatment via `sanitizeDigits`, since `maxLength` alone doesn't stop non-numeric characters from being typed or pasted in.
16d. **A flex/grid item sitting next to a fixed-width sibling needs `min-width: 0`.** By spec, a flex or grid item won't shrink below its *content's* intrinsic minimum width unless that's explicitly overridden — so a `flex: 1` or `1fr` track next to a fixed-width sibling (a sidebar, an icon, a fixed-size chart) can silently refuse to shrink and overlap or overflow past that sibling once its content is wide enough, and only at some viewport widths, which reads as "layout randomly breaks while resizing" rather than a clean breakpoint failure. This isn't hypothetical — it hit `AppShell.css`'s `.app-shell-content` (next to the 240px sidebar), `MemberDetailPage.css`'s `.member-detail-history-toggle` (next to a fixed "Edit" button), and `ReportsPage.css`'s `.reports-chart`/`.reports-payment-legend` (next to a fixed-size donut) before being fixed. Whenever you pair a fixed-size element with a flexible one in a *non-wrapping* row/grid, add `min-width: 0` (or `min-height: 0` for a column direction) to the flexible side. Preferred alternative where the content is a simple label/button row: `flex-wrap: wrap` sidesteps the whole problem by letting content take a new line instead of forcing the container wider — this is what most of this app's own card-internal rows already do.
16d. **A multi-line-appropriate field (address, notes, doctor's-care details) is a `<textarea>`, not a single-line `<input>`** — minimum 4 visible rows so the field itself hints that longer text is expected, not just tolerated.
16e. **Save and Cancel are the standard action pair**, right-aligned, Cancel first: Cancel is `type="button"` (never submits), navigates away without a confirmation dialog (matching the simplicity precedent in `member-detail.md` §5 — no "discard changes?" guard is specced anywhere in this app yet), and is disabled while a save is in flight, same as Save. Save is `type="submit"`, shows a saving-state label (e.g. "Saving…") and disables itself while its own request is in flight.

## Data Loading, Errors & Empty States

These apply to **every screen that fetches data**, not just the ones that happen to spell it out — a screen-specific spec (e.g. `member-detail.md`) documents how these rules apply to its own data, it doesn't get to skip them by omission.

29. **Three distinct, non-overlapping states: loading, error, loaded** — never conflate them. While loading, show a skeleton/spinner in place of content, never alongside stale or partial content from a previous render. A screen is never left in a state where the user can't tell whether it's still loading, failed, or genuinely has nothing to show.
30. **A failed fetch always shows a specific, user-facing message and a Retry action that re-runs the same fetch** — never surface a raw `error.message` string, and never require a full page reload just to try again. Distinguish at minimum:
    - **Not found** (the record doesn't exist / was soft-deleted) — no retry offered, since retrying can't change this; show a message and a way back (e.g. a link to the list screen).
    - **Network/timeout** — retry offered.
    - **Generic/unexpected failure** (RLS denial, server error) — retry offered, message doesn't imply the user did anything wrong.

    Bound every data fetch with `web/src/lib/with-timeout.ts` (same pattern already used in `auth.context.tsx`'s profile lookup) so a hung request can't leave a screen stuck loading forever.
31. **Every list-rendering surface has an explicit empty-state message** — a section that legitimately has zero rows (no members match a filter, no subscription history, no current add-ons, etc.) must say so in its own UI, never render a blank area that's indistinguishable from "still loading" or "failed to load." An empty state is not an error state — don't route it through rule 30's error handling.

### Compliance by screen (2026-07-20 audit)

Every screen in [navigation.md](./navigation.md)'s route map, checked against rules 16 (responsive) and 29–31 (loading/error/retry, empty states). All 11 are now compliant — this table is the record of that pass, kept so a future rule change has a checklist to re-run rather than needing to re-derive which screens exist.

| Screen | Route | Rule 16 (responsive) | Rules 29–30 (loading/error/retry) | Rule 31 (empty states) | Spec'd in |
|---|---|---|---|---|---|
| Login | `/login` | ✅ | ✅ | N/A (no list) | [auth.md §2.5](./auth.md#25-non-functional-compliance-rulesmd-rules-16-29-31) |
| Members List | `/` | ✅ | ✅ | ✅ (already had it, pre-dates this audit) | [member-management.md §3.4](./member-management.md#34-members-list--) |
| Member Detail | `/members/:id` | ✅ | ✅ | ✅ | [member-detail.md §4.2–4.4](./member-detail.md) |
| Add Member | `/members/new` | ✅ | ✅ | N/A (no list) | [member-management.md §3.1](./member-management.md#31-add-member--membersnew) |
| Renew/Add Subscription | `/members/:id/renew` | ✅ | ✅ | ✅ (zero-plans case) | [subscription-management.md §3.1/3.3](./subscription-management.md) |
| Edit Member | `/members/:id/edit` | ✅ | ✅ | N/A (no list) | [member-management.md §3.3](./member-management.md#33-edit-member--membersidedit) |
| Reports | `/reports` | ✅ | ✅ | ✅ | [reporting.md](./reporting.md) |
| Manage Plans | `/plans` | ✅ | ✅ | ✅ | [master-data-management.md](./master-data-management.md) |
| Manage Branches | `/branches` | ✅ | ✅ | ✅ | [master-data-management.md](./master-data-management.md) |
| Manage Users | `/users` | ✅ | ✅ | N/A (can't be empty — the viewing admin is always a row) | [screens.md WSCR-09](./screens.md#wscr-09--manage-users) |
| Invite User | `/users/invite` | ✅ | ✅ | N/A (no list) | [screens.md WSCR-10](./screens.md#wscr-10--invite-user) |
| Settings | `/settings` | ✅ | ✅ (per-card, isolated failures) | N/A (fixed content, not a fetched list) | [screens.md WSCR-11](./screens.md#wscr-11--settings-hub) |

**Gap found and fixed during this audit:** WSCR-08/09/10/11 (`screens.md`) had **no mobile breakpoint layout at all** before this pass — just a bare "Table: ..." description with no phone-width alternative, which is exactly the horizontal-scroll anti-pattern rule 16 exists to prevent. All four now specify a stacked-card mobile layout. The Members List fetch (`member-management.md` §3.4) also had zero error-handling/retry mentioned for the single most-used read path in the app before this pass.

### Rule 16 re-audit — tablet tier (2026-07-21)

The table above predates [styling.md](./styling.md)'s 3-tier breakpoint scale — every ✅ in it was only ever checked against the old 2-tier (mobile/desktop) definition, never against the 768–1023px tablet range specifically. This pass re-checked all 11 screens against the tablet tier using the failure signature the Member Detail incident actually had: a layout column with both a fixed `width` **and** `flex-shrink: 0` (the combination that refuses to shrink and forces a sibling to be squeezed instead of the layout reflowing), landing at the same breakpoint as another fixed-width ancestor (`AppShell`'s `240px` sidebar, present on every authenticated route).

- **`Member Detail` (`/members/:id`, `/members/:id/edit`) — confirmed broken, now fixed.** Was the only screen with that exact `width` + `flex-shrink: 0` pattern (`.member-detail-column-left`, `360px`). Fixed by moving the two-column split from the `768px` tier to the `1024px` desktop tier — see [member-detail.md §4.4](./member-detail.md#44-responsive-layout-mobile-first). Below 1024px it now keeps the mobile single-column layout through the tablet range instead of splitting into a too-narrow second column.
- **All other 10 screens — checked, no equivalent pattern found, no changes needed.** Members List, Reports, Manage Plans, Manage Branches, and Manage Users all use the same "stacked cards below 768px, single `<table>` above it" shape — one layout-width decision, not two competing ones. Add Member and Renew/Add Subscription use a single centered column with a `max-width` cap (no `flex-shrink: 0`, so it simply renders narrower on a tablet rather than forcing an overflow). Login and Invite User are single narrow cards at every width. Settings uses a `grid` of cards with `fr` units, not a fixed-width column.

This re-audit was a structural code check (grep for the specific `width` + `flex-shrink: 0` failure signature across every page's CSS), not a pixel-by-pixel visual pass in a real browser at 768px/834px/1024px — that visual verification is still worth doing before calling the tablet tier fully proven out, per styling.md §5's "check exactly 768px and exactly 1024px" guidance.

**Not a gap, confirmed compliant:** empty-state copy for Members List and Add Member's screens.md predecessor (WSCR-02/04) already correctly distinguished "no records at all" from "filter/search matches nothing" — that pattern pre-dates rule 31 and needed no rework, just cross-referencing.

## TypeScript

17. TypeScript strict mode throughout. No `any` types.
18. Types for all DB row shapes match field names exactly to column names in [domain-model.md](../backend/domain-model.md). In practice these live one file per entity under `frontend/src/types/` (`member.ts`, `subscription.ts`, `plan.ts`, `branch.ts`, `role.ts`, `profile.ts`, `report.ts`, `member-list.ts`, `member-current-item.ts`, `audit-log.ts`, `auth.ts`), not a single `index.ts` as this rule originally specified — better colocation with each entity's repository/service, same number of types, no behavioral difference. Follow the existing per-entity-file convention for any new type, don't introduce a barrel file to match this rule's original wording.

## Audit Fields

19. The client **never** sets `created_at`, `created_by`, `changed_at`, or `changed_by` — these are always omitted from insert/update payloads. A Postgres trigger sets them from `auth.uid()`. See [database.md §Audit Field Triggers](../backend/database.md#audit-field-triggers).

## Architecture

20. **Always read [architecture.md](../architecture.md) before writing any service, repository, or Edge Function.** Every file must be placed in the correct layer (View / Service / Repository / Edge Function) and must not violate the layer boundary rules.
21. Screens/components access data and logic only through `useServices()` or `useAuth()` — never import `supabase-js` or call `supabase.functions.invoke` directly in a component.
22. Services depend only on repository interfaces — never on concrete repository implementations.
23. Business rules that are security-relevant (see rule 2) are always enforced server-side; the client-side service layer may duplicate the check for instant UX feedback, but must never be the only enforcement point.

## Supabase-Specific

24. Every table must have RLS **enabled**, even if a policy hasn't been written yet for every case — an RLS-enabled table with no matching policy defaults to deny, which is the safe failure mode.
25. New Edge Functions must validate the caller's identity/role from the request JWT before doing anything privileged — never assume a request reached the function legitimately just because it hit the endpoint.
26. Schema changes only via `supabase/migrations/` files (Supabase CLI), never hand-edited directly in the hosted dashboard for anything meant to persist across environments.

## Access Control & Roles

27. Role-based UI has exactly two forms, both driven by `currentProfile.role` from `useAuth()` — never a separately re-derived role check:
    - **Route guarding** — wrap the route element in `<RequireAdmin>` (`web/src/components/RequireAdmin.tsx`, see [navigation.md](./navigation.md)) to block navigation to an admin-only page entirely, with a fast redirect/access-denied view instead of the page attempting to load and failing on its data fetch.
    - **Conditional rendering** — for a single element within an otherwise-shared page or shell (a nav item, a button, a section), branch inline on `currentProfile?.role === 'admin'` rather than building a separate route/page just to hide one element. This is how [navigation.md §Navigation Items](./navigation.md#navigation-items-shared-by-mobile-bottom-bar-and-desktop-sidebar)'s admin-only nav entries are implemented.
28. **Neither form is the security boundary** (see [architecture.md §Server-Side Authority](../architecture.md#server-side-authority--the-key-difference-from-the-mobile-app)) — every role-gated UI decision must have a matching RLS policy doing the real enforcement (see [database.md](../backend/database.md)). The UI-level check exists purely so a staff user gets a fast, friendly redirect/hidden-element instead of navigating into a page or clicking a button that RLS was always going to reject anyway.

## Performance

32. **Every page in `App.tsx`'s route table is code-split** — `React.lazy(() => import(...))`, never a static top-of-file `import`, wrapped in one `Suspense` boundary at the router/shell level (reusing `LoadingView`, not a bespoke per-page loading state), which is itself wrapped in an error boundary (a failed chunk load — e.g. a stale tab after a redeploy — must show a "reload to get the latest version" message, never a blank crashed app). A static import of a page component bundles it (and its CSS) into the single chunk shipped on every route's first load, regardless of whether that page is the one being visited — see [performance.md](./performance.md) for the incident this was written up from and the full rationale, including what's deliberately exempt (`LoginPage`, `AppShell`) and what's deliberately NOT split (small repository/service files).
