# Action Center — Screen Spec (Web Edition)

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Route: `/members/:id/renew` and `/members/:id` are the two destinations this screen links out to — see [navigation.md](./navigation.md) for the full route map.
> Source: `design_handoff_flexhub_v2/README.md` §8 (v2 design handoff) — this is the first new screen introduced by that handoff (everything else in it re-skins an existing screen).

---

## 1. Purpose

A renewal queue — the set of members whose current membership is about to lapse or has recently lapsed, so staff can work through it without scrolling every member in Members List looking for expiries. First item in the nav, with a count badge showing the total queue size.

There is no new business rule here and no new backend surface: this is a plain read of data Members List already exposes, filtered to a bounded date window. See §3.

---

## 2. Route & Access

| Route | Access |
|---|---|
| `/action-center` | All signed-in, active users (same as Members List) |

Add to [navigation.md](./navigation.md)'s route map, access-control table, and Navigation Items table — it is not admin-gated.

---

## 3. Data Source (no new backend surface)

Reads `member_list_view` — the same view `memberListRepository.getAll()` already reads for Members List (`spec/backend/member-management.md` §5). RLS already protects it; there is no security- or integrity-relevant rule here of the kind [architecture.md](../architecture.md)'s server-authority table reserves for Edge Functions. So: **no new Edge Function, view, or migration.**

The one real change is at the repository layer — a bounded query instead of `getAll()`, so this screen doesn't have to fetch every member just to build a queue of near-term expiries:

```ts
// repositories/member-list.repository.ts
async getActionCenterQueue({ from, to }: { from: string; to: string }): Promise<MemberListRow[]> {
  // same MEMBER_LIST_SELECT against member_list_view, plus:
  //   .gte('current_membership_end_date', from).lte('current_membership_end_date', to)
  //   .order('current_membership_end_date', { ascending: true })
}
```

Real Postgres-side filtering via `supabase-js`, same view, same RLS. The repository stays pure data access (no date math) — `from`/`to` arrive pre-computed from `lib/action-center.ts`, per the repository layering rule ([architecture.md](../architecture.md)).

---

## 4. Query Window & Client-Derived Queue (`lib/action-center.ts`)

**Window**: `current_membership_end_date BETWEEN (today − 12 months) AND (today + 30 days)`, where `today` is the browser's local date (`todayDate()`, same Timezone Rule as [`lib/status.ts`](../../frontend/src/lib/status.ts) — never a server-computed status/window column, since the server doesn't know the client's local today).

```ts
getActionCenterWindow(): { from: string; to: string }
```

**Split**: the repository returns one ascending result set (bounded by the window above); the client splits it into the two tab result sets:

- **Upcoming** (`end_date >= today`) — kept ascending (soonest first: today → tomorrow → this week → this month).
- **Expired** (`end_date < today`) — reversed to descending (most recently expired first).

```ts
splitActionCenterQueue(rows: MemberListRow[]): { upcoming: MemberListRow[]; expired: MemberListRow[] }
```

Rows with `current_membership_end_date === null` (no plan, or an indefinite plan with no end date) are excluded from both sets — they don't belong in a renewal queue.

**Relative label**: one shared helper, not computed inline per component —

```ts
getRelativeExpiryLabel(endDate: string): { text: string; tier: 'urgent' | 'soon' | 'expired' }
```

| Case | Text | Tier / pill color |
|---|---|---|
| Expires today | "Expires today" | `urgent` — `#ffedd5` / `#c2410c` |
| Expires tomorrow | "Expires tomorrow" | `urgent` if ≤7 days remaining, else `soon` |
| Expires in N days (2–7) | "Expires in N days" | `urgent` — `#ffedd5` / `#c2410c` |
| Expires in N days (8–30) | "Expires in N days" | `soon` — `--color-status-warning-bg` / `--color-status-warning-text` |
| Expired 1 day ago | "Expired 1 day ago" | `expired` — `--color-status-danger-bg` / `--color-status-danger-text` |
| Expired N days ago (2–59) | "Expired N days ago" | `expired` |
| Expired N months ago (60+) | "Expired N months ago" | `expired` |

The `urgent`/`soon` split reuses `EXPIRING_SOON_THRESHOLD_DAYS` (7) exported from `lib/status.ts` rather than a second, possibly-drifting copy of the same constant.

**Nav badge count**: `useActionCenterCount()` (also in `lib/action-center.ts`) runs the same bounded `getActionCenterQueue()` call once on `AppShell` mount, purely for the badge total (`upcoming.length + expired.length`). Fails silently (no badge, not an error state) — a failed badge fetch must never break navigation.

---

## 5. Page Layout (`pages/ActionCenterPage.tsx`, route `/action-center`)

Follows the same fetch/loading/error shape as [`MembersListPage.tsx`](../../frontend/src/pages/MembersListPage.tsx) (`withTimeout`, network-error vs. generic-error message, Retry button) — re-fetches on every route entry, never shows a stale queue on return to this screen. There is no service layer in front of `memberListRepository` here, same as Members List — there's no business logic to protect beyond the pure display-derivation already isolated in `lib/action-center.ts`.

### 5.1 Header

- Title "Action Center" + sub-line: "Memberships expiring in the next 30 days and everything that expired in the last 12 months, newest expiry first."
- "Send renewal reminders" button — **ships disabled** (`--color-interactive-disabled-bg`/`-text`, `cursor: not-allowed`, `title="Coming soon"`). No backend call wired; this is a placeholder for a future phase.

### 5.2 Summary cards

Two cards, flex, `min-width: 180px`, `radius: card`:

| Card | Count | Note | Colors |
|---|---|---|---|
| Expiring in 30 days | `upcoming.length` | "Next: `<date of upcoming[0]>`" (or a neutral fallback if empty) | `#fffbeb` / `#fde68a` / `#92400e` |
| Expired | `expired.length` | "In the last 12 months" | `#fef2f2` / `#fecaca` / `#b91c1c` |

### 5.3 Filter tabs

Two tabs only — **Expiring soon** (default) and **Expired** — each showing its own count. Selected = `--tint-solid` fill with white text; unselected = white with `--color-border-default`. There is deliberately **no "All" tab** — the two result sets don't merge into one list anywhere on this screen.

### 5.4 Carousel (replaces a table)

Horizontal scroll-snap row (`overflow-x: auto`, `scroll-snap-type: x mandatory`, 16px gap): 3 cards in view on desktop (`flex: 0 0 calc((100% - 32px)/3)`, `min-width: 280px`), 2 cards ≤1100px, ~88% width ≤760px. Prev/next arrow buttons (32px, round, `--color-border-default`) step exactly one card via `scrollBy` **without** `behavior: 'smooth'` (scroll-snap cancels smooth programmatic scrolls) — the step distance is measured from the first rendered card's actual width plus the 16px gap, not a hardcoded pixel value, so it stays correct across the three responsive tiers above. Free wheel/drag scrolling also works, since this is a plain scrollable container. Thin 8px scrollbar.

### 5.5 Card

```
┌───────────────────────────────────────┐
│ [avatar]  Arjun Kumar                  │
│  76px     MUM-2026-0001                │
│           98765 43210                  │
│           ● Expires in 5 days          │
│                                         │
│  Annual                                │
│  Expiry 4 Sep 2026                     │
│                                         │
│  [ Renew ]        [ View ]             │
└───────────────────────────────────────┘
```

| Element | Source | Notes |
|---|---|---|
| Avatar | `photo_thumbnail_url` if set, else initials tile (`getAvatarColor`/`getInitials`, same as Members List) | 76px, radius `tile + 4px` |
| Name | `name` | Ellipsis + `title` attribute for overflow |
| Member #, phone | `member_number`, `phone` | 12.5px secondary text |
| Relative-label pill | `getRelativeExpiryLabel(current_membership_end_date)` (§4) | This is the "status pill" from the design handoff — the urgency-tiered relative label, not the generic Active/Expiring/Expired badge Members List uses |
| Plan | `current_membership_plan_name` | Falls back to "No plan" (should not normally occur for a row with a non-null `end_date`, but the field is nullable in the type) |
| Absolute expiry line | `formatDate(current_membership_end_date)` | Plain "Expiry 4 Sep 2026" text, distinct from the relative-label pill above it |
| Renew button | `navigate('/members/:id/renew')` | Reuses the existing route — no new screen |
| View button | `navigate('/members/:id')` | Reuses the existing route — no new screen |

### 5.6 Empty states

Per tab (dashed card, clock icon):

| Tab | Title | Body |
|---|---|---|
| Expiring soon, empty | "Nothing expiring in the next 30 days" | "Members whose membership is about to lapse will show up here." |
| Expired, empty | "No expired memberships" | "Members whose membership lapsed in the last 12 months will show up here." |

---

## 6. Explicitly out of scope

- **"Send renewal reminders" backend**: ships disabled everywhere in this pass — no Edge Function, no notification plumbing. Resolved by the design handoff itself, not a gap to fill later without an explicit decision to do so.
- **Subscription overlap enforcement, plan/branch deletion guards, audit fields, soft delete**: none of that applies here — this screen has no write path at all, only two existing routes (`/members/:id/renew`, `/members/:id`) it links to.
- **An "All" tab or a merged upcoming+expired list**: deliberately absent — see §5.3.

---

## 7. Related docs

- [navigation.md](./navigation.md) — route map, access control, Navigation Items entry
- [member-management.md](./member-management.md) — `member_list_view`, status derivation, avatar hashing this screen reuses
- [member-detail.md](./member-detail.md) — the `/members/:id` and `/members/:id/renew` destinations this screen links to
- [styling.md](./styling.md), [colors.md](./colors.md) — tint/radius tokens this screen's selected-tab and count-badge fills read from
