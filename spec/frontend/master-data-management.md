# Master Data Management — Frontend Spec

> Consolidates the frontend side of [requirements-template.md §9 Admin Data Management](../requirements-template.md#9-feature-area-admin-data-management) — **REQ-ADMIN-002 (Plan Management)** and **REQ-ADMIN-003 (Branch Management)** only. REQ-ADMIN-004/005/006 (Users, Audit Log) are a different shape and out of scope here.
>
> **Supersedes [screens.md](./screens.md)'s WSCR-08** (its Add/Edit field table predates the unified Plan catalog — missing `category`/`max_members`) **and is the only spec for WSCR-12** (Manage Branches — no route or screen existed for it before this doc; added to [navigation.md](./navigation.md) and screens.md's registry alongside this). Both screens share the exact same shape (list + create/edit, admin-only), so one doc covers both rather than duplicating the pattern twice.
>
> **Delete is implemented** for both screens — confirmation dialog → `planRepository.delete`/`branchRepository.delete` → `delete-plan`/`delete-branch` Edge Function, surfacing that function's "used by X" guard message verbatim on a block. See [backend/master-data-management.md §5](../backend/master-data-management.md#5-delete--usage-guard) for the guard design.
>
> Backend counterpart: [../backend/master-data-management.md](../backend/master-data-management.md) — schema (unchanged, already exists), RLS, validation.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-ADMIN-002 | Plan Management: list (both categories, one unified list, filterable by category) + create/edit |
| REQ-ADMIN-003 | Branch Management: list + create/edit |

---

## 2. Fields

### Plan (WSCR-08, `/plans`)

| Field | Required | Type / Rule |
|---|---|---|
| name | Yes | Non-empty, unique among active plans |
| category | Yes | `Membership` / `Add-on` chip selector |
| duration_days | Conditional | Integer ≥ 1 — **shown and required** when category is Membership; **shown and optional** when category is Add-on (blank = indefinite, e.g. "Membership Fee"); a toggle/checkbox for "Never expires" is a reasonable way to represent the blank/indefinite state for add-ons, rather than an empty number field with ambiguous meaning |
| price | Yes | Number ≥ 0, 2 decimal places (same masking approach as `member.service.ts`'s `sanitizeDecimal` — reuse it, don't reinvent) |
| max_members | Conditional | **Shown only** when category is Membership; `1` or `2` chip selector, default `1`. Hidden entirely for Add-on (forced to `1` server-side regardless — `chk_plan_max_members_only_for_membership`) |

Switching category from Membership to Add-on on an already-filled form clears `max_members` back to its default and hides the field, rather than silently submitting a stale value the server would reject anyway.

### Branch (WSCR-12, `/branches`)

| Field | Required | Type / Rule |
|---|---|---|
| name | Yes | Non-empty |
| code | Yes | Non-empty, unique among active branches — shown uppercase in the list (e.g. `MUM`) since it's used as the `member_number` prefix, but no client-side case transformation is forced on input; whatever the admin types is what's saved |

Two fields only — this is the simplest form in the entire app.

---

## 3. Screens

### 3.1 Manage Plans — `/plans` (WSCR-08, admin only)

#### Layout

| Breakpoint | Layout |
|---|---|
| Mobile (`< 768px`) | Stacked cards: name + category badge, duration, price, Edit icon button |
| Desktop (`>= 768px`) | Table: Name, Category, Duration, Price, Max Members, Actions |

"+ Add Plan" button in the page header, meeting the 44×44px touch-target minimum (rules.md rule 16) — same corner-alignment pattern as Members List's page header (title left, action button right).

A category filter (All / Membership / Add-on) above the list, single-select, client-side over the already-fetched full result set — same "fetch once, filter client-side" performance approach as Members List (this catalog is always small, no pagination needed).

#### Loading, errors & empty state (rules.md rules 29–31)

| State | Behavior |
|---|---|
| Loading | Skeleton cards/rows |
| Error | "Couldn't load plans — check your connection and try again." (network/timeout) or "Something went wrong loading plans. Please try again." (generic) + Retry |
| Empty | "No plans yet." + "Add Plan" CTA |

#### Add/Edit form

Single-column form at every width (rules.md rule 16 — 5 fields, nothing worth pairing the way Add Member's 19-field form does). Dialog or slide-over panel, admin's choice of implementation, consistent with WSCR-08's original note.

```
Save tapped
  → validate (§2's per-field rules, including the category-conditional ones)
      → errors: inline, stop
      → valid: direct RLS-guarded supabase-js insert/update on `plans` (no Edge Function —
        backend spec §3)
          → success: close the form, row appears/updates in the list, toast "Plan saved"
          → failure: specific message where known (e.g. a name conflict), otherwise
            "Something went wrong saving this plan. Please try again." (rules.md rule 30).
            Form stays open with entered values intact — that's the retry path.
```

Editing a plan is always allowed, even with existing subscriptions referencing it — it never recalculates existing `subscription_items.end_date` values (unchanged rule, `business-logic.md`).

### 3.2 Manage Branches — `/branches` (WSCR-12, admin only)

#### Layout

| Breakpoint | Layout |
|---|---|
| Mobile (`< 768px`) | Stacked cards: name, code, Edit icon button |
| Desktop (`>= 768px`) | Table: Name, Code, Actions |

Same page-header pattern as Manage Plans ("+ Add Branch" button, top-right).

#### Loading, errors & empty state (rules.md rules 29–31)

| State | Behavior |
|---|---|
| Loading | Skeleton cards/rows |
| Error | "Couldn't load branches — check your connection and try again." (network/timeout) or "Something went wrong loading branches. Please try again." (generic) + Retry |
| Empty | "No branches yet." + "Add Branch" CTA — though in practice this should be rare, since a branch must exist before any member can be registered (`members.branch_id` is required) |

#### Add/Edit form

Single-column, 2 fields (name, code) — the simplest form in the app.

```
Save tapped
  → validate (name and code both required)
      → errors: inline, stop
      → valid: direct RLS-guarded supabase-js insert/update on `branches`
          → success: close the form, row appears/updates in the list, toast "Branch saved"
          → failure: specific message where known (e.g. a code conflict), otherwise
            "Something went wrong saving this branch. Please try again." (rules.md rule 30).
```

---

## 4. Requirements Traceability

| Requirement | Frontend implementation |
|---|---|
| REQ-ADMIN-002 | Manage Plans screen (§3.1), field table (§2) |
| REQ-ADMIN-003 | Manage Branches screen (§3.2), field table (§2) |
| (non-functional) loading/error/retry, empty states, mobile-responsive | §3.1/§3.2 — enforced app-wide by [rules.md](./rules.md) rules 16, 29–31 |

---

## Related docs

- [screens.md](./screens.md) — WSCR-08's layout/loading conventions still apply; its field-level content is superseded by this doc. WSCR-12 has no prior content — this doc is its only spec
- [navigation.md](./navigation.md) — `/branches` added to the route map and access-control table alongside this doc
- [rules.md](./rules.md) — app-wide non-functional rules both screens satisfy
- [../backend/master-data-management.md](../backend/master-data-management.md) — backend counterpart: schema (already exists), RLS, validation, the delete-guard design
