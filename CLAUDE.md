# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Fit & Fine — a web app for managing gym members, plans, branches, and subscriptions. React + TypeScript + Vite frontend, Supabase (Postgres + RLS, Auth, Edge Functions) backend. Hosted on Vercel (frontend) + Supabase Cloud.

## Commands

Run from repo root (npm workspaces):

```bash
npm install                    # install all workspace deps
npm run dev:frontend           # start Vite dev server at http://localhost:5173
npm run build:frontend         # tsc --noEmit && vite build
```

From `frontend/` directly:

```bash
npm run typecheck              # tsc --noEmit only (app + colocated *.test.ts(x))
npm run typecheck:e2e          # tsc for frontend/e2e (Playwright transpiles specs without typechecking them)
npm run preview                # preview a production build
npm run test                   # Vitest unit + component tests (jsdom), single run
npm run test:watch             # Vitest in watch mode
npm run test:coverage          # Vitest + v8 coverage report (informational, no threshold)
npm run test:e2e               # Playwright E2E — builds + previews the app, Supabase network is mocked
npm run test:e2e:ui            # Playwright UI mode, for debugging a spec
```

From the repo root the same suites run as `npm run test:frontend` and `npm run test:e2e:frontend`.

There is no lint config in this repo currently — don't assume `npm run lint` exists. See **Testing rules** below before declaring any work done.

Supabase (from repo root, via `npx supabase ...` or `npm run supabase -- ...`):

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push                              # applies supabase/migrations/ in order
npx supabase functions deploy <function-name>      # e.g. create-subscription, update-subscription, delete-plan
npx supabase secrets set SOME_SECRET=value
```

Local env: copy `frontend/.env.example` to `frontend/.env.local` and fill in `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (anon key only — never the service role key).

## Architecture

Strict layered architecture on the client: **View → Service → Repository**, with Postgres RLS and Edge Functions as the server-side authority for anything security-relevant. Full spec: [spec/architecture.md](spec/architecture.md); implementation rules: [spec/backend/rules.md](spec/backend/rules.md).

```
frontend/src/
  pages/            route-level screens — UI + local UI state only
  components/       shared UI (AppShell, RequireAuth/RequireAdmin guards, etc.)
  services/         client-side validation/orchestration, one per entity (member, plan, subscription, ...)
  repositories/     Supabase data access — supabase-js queries or supabase.functions.invoke
  context/          auth.context (session/profile), services.context (useServices() DI), theme.context
  lib/              supabase-client.ts (the one place VITE_SUPABASE_URL/ANON_KEY are read), datetime.ts, etc.
  types/            DB row types, matching column names exactly

supabase/
  migrations/       Postgres schema, applied in order via supabase db push
  functions/        Edge Functions — create-subscription, update-subscription, delete-plan,
                     delete-branch, delete-member, delete-role, invite-user, list-users,
                     update-user, update-member-number-sequence
```

**Layer rules** (see spec/architecture.md for the full contract):
- A page/component never imports `supabase-js` or calls `supabase.functions.invoke` directly — only via `useServices()` / `useAuth()`.
- A service never imports a concrete repository implementation or anything from `pages/`/`components/` — only repository interfaces.
- A repository does only data access (typed `supabase-js` calls or Edge Function invocations) — no business logic, no date math.
- A `lib/` hook or helper that needs data gets its repository/service via `useServices()` (or as an argument) — never by importing a repository singleton. This is what lets tests inject fakes (`lib/action-center.ts` used to violate this).

**Server-side authority is the core design constraint.** Because the client is untrusted (anyone can hit the Supabase REST API directly), every security- or data-integrity-relevant rule is enforced in Postgres (RLS, triggers, `CHECK`/`RESTRICT` constraints) or in an Edge Function — never trusted from client-side validation alone. The client-side service layer may duplicate a check for instant UX feedback, but it is never the last line of defense. Concretely:

| Rule | Server-side mechanism |
|---|---|
| `end_date` computation (`start_date + duration_days × quantity - 1`, or `NULL` if indefinite) | `create-subscription` Edge Function, per item |
| Subscription overlap guard | **Deliberately client-side only** — no backend enforcement exists for this one, by design |
| Plan/branch deletion guards | `delete-plan`/`delete-branch` Edge Functions + `ON DELETE RESTRICT` |
| Audit fields (`created_by`/`changed_by`/`deleted_by`) | Postgres trigger reads `auth.uid()` — client never sets these |
| Soft delete only, never hard `DELETE` | `deleted_at`/`deleted_by` update pattern, backstopped by a `prevent_hard_delete()` trigger — applies even to one-off admin fixes |
| Role-based access | RLS policies (primary) + route guards / inline role checks (UX only) |
| User invitation | `invite-user` Edge Function using the service role, invite-only for both password and Google OAuth sign-in |

Other things worth knowing before editing this codebase:
- Line items (`subscription_items`) are immutable after creation — `update-subscription` only edits header fields (`payment_mode`, `notes`). Adding/removing/changing an item always means a new `create-subscription` checkout, never an edit.
- Every read query must exclude soft-deleted rows; RLS handles this for normal client queries, but any Edge Function code running with the service role must add the `deleted_at is null` filter explicitly.
- No third-party UI component libraries (no MUI/Chakra/Ant/shadcn/Bootstrap) — plain CSS using the shared token file (`frontend/src/styles/tokens.css`) + React only. `lucide-react` is the one approved icon set.
- Calendar dates (`start_date`/`end_date`) are Postgres `date`, wire-formatted `YYYY-MM-DD`; timestamps (`created_at`, `deleted_at`, etc.) are `timestamptz`, always UTC — convert to local only for display, via `frontend/src/lib/datetime.ts`.
- "The device is offline" is detected with `isNetworkError()` from `frontend/src/lib/network-error.ts` — never by comparing an error message to a literal such as `'Failed to fetch'`. Safari says "Load failed", Firefox another thing, supabase-js prefixes `TypeError: ` on a failed read, and an Edge Function call reports `FunctionsFetchError` (normalised in `lib/edge-function-error.ts`). An exact-string check silently turns every offline state into a generic error. Note that supabase-js also retries a failed GET three times (1s + 2s + 4s), so the offline screen appears about 7s after the request.
- Schema changes go through `supabase/migrations/` only, never hand-edited in the hosted dashboard.
- Operational constants (e.g. member-number sequence start/increment/padding) belong in the `configuration` table, not hardcoded — see [spec/backend/database.md](spec/backend/database.md).

## Responsive rendering rules (binding)

The whole app switches at **one** breakpoint: `768px` (`< 768px` mobile, `>= 768px` tablet/desktop). Two mechanisms exist and each has exactly one job:

| Mechanism | Use it for | Never use it for |
|---|---|---|
| **`useIsTabletUp()`** (`frontend/src/lib/use-media-query.ts`, `matchMedia` on `(min-width: 768px)`) — React renders exactly one branch | Alternate renderings of the same content/structure: sidebar vs tab bar vs mobile header, footer vs legal-links list, table vs card list, any block that exists on only one side of the breakpoint | Spacing, grid columns, font sizes, hiding a trivial decoration |
| **CSS media queries / Tailwind `tablet:` `desktop:`** | Pure styling differences (columns, padding, sizes) on markup that is identical at every width | Hiding a second, fully-rendered copy of a component |

1. **Never mount both versions of something and hide one with CSS (`display: none`).** React still renders the hidden copy: double the DOM nodes, both subtrees' hooks and effects run, and `<img>`s fetch twice. Every list screen (Members, Plans, Branches, Roles, Users, Audit Log, Member Numbering, Reports transactions) now renders exactly one of `*-table` / `*-cards` — keep it that way; `e2e/lists-render-once.spec.ts` fails if a hidden twin comes back.
2. JS and CSS gates use the same **px** query, `(min-width: 768px)`. Never feed the rem-based Tailwind token (`--breakpoint-tablet: 48rem`) into JS — they diverge as soon as a user changes the browser's default font size.
3. A hook that fetches (e.g. `useActionCenterCount`) is called **once, at an always-mounted level** (`AppShell`), and the result is passed down as props. Never call it inside a branch that remounts on breakpoint or route change — it would refetch every time.
4. Tab-bar visibility is route data: `handle: { hideTabBar: true }` on the route in `App.tsx`, read with `useMatches()`. Components never path-match to decide it. The bar shows on Action Center, Members, Reports, Settings and the admin sub-pages; member detail / renew / add / edit hide it and show a back link instead.
5. Page state (search, filters, form input) lives in the page component **above** any breakpoint-switched branch, so rotating a phone or resizing a window never loses it.
6. z-index scale: tab bar 10, mobile header 20, filter drawer 40, modals 50, camera modal 60, photo lightbox 70. A new fixed/sticky layer takes a slot in this scale.
7. Every page is a lazy chunk, and `RouterProvider` in `App.tsx` runs with `future={{ v7_startTransition: true }}`. Don't remove it: without it a navigation that is waiting on its chunk blanks the whole app, and pressing Back inside that window leaves the *old* screen rendered under the new URL (reproduced on every engine; `e2e/navigation-race.spec.ts`).
8. Visual order on a phone may differ from the DOM only where the handoff specifies it, and only with CSS `order` (Member Detail's Personal → Medical → Emergency → Add-ons → History). Never reorder by rendering the sections twice.

## Mobile conventions

- Touch targets are at least 44×44px — the visible glyph may be smaller, the button carries the hit area.
- Form controls are 16px below 768px (one global rule in `index.css`) so iOS Safari doesn't zoom on focus.
- Full-height shells use `100dvh` (with a `100vh` fallback), never bare `100vh`; safe-area insets come from `env(safe-area-inset-*)` (the viewport meta has `viewport-fit=cover`).
- No hover-only information (a `title` tooltip needs a tap equivalent), and status is never conveyed by color alone (label + fill weight too).
- No hex literals outside `frontend/src/styles/tokens.css`; fonts only via `var(--font-ui)` / `var(--font-display)` (self-hosted Fontsource variable fonts, imported in `main.tsx`).
- The theme preference key in `context/theme.context.tsx` is versioned (`flexhub-theme-v3`). Every device stores a value on first load, so changing a default only reaches existing users if the key is bumped.
- `.status-badge-*` styles live in one shared stylesheet — never re-declare them in a page's CSS.

## Testing rules (binding)

Tooling: **Vitest + React Testing Library** (jsdom) for unit/component tests, colocated as `*.test.ts(x)` next to the file; **Playwright** for E2E in `frontend/e2e/` (projects: `desktop-chrome`, `mobile-chrome`, `mobile-safari`). Both are dev-only dependencies (rule 12 evaluation: nothing ships to the browser).

1. Every new or changed component, page, hook, service or `lib/` helper ships a test in the same change. Every user-facing flow or route change also gets Playwright coverage that passes in both a desktop and a mobile project.
2. Any screen with alternate renderings asserts that **exactly one** is in the DOM at each width (e.g. at 390px zero `<table>`; at 1024px no card list).
3. Unit tests never hit Supabase (`lib/supabase-client.ts` throws without env vars — the Vitest config supplies dummy ones). Pages and components get fakes through `renderWithProviders(ui, { services: fakeServices({...}), auth: {...} })` (`frontend/src/test/`: `render.tsx`, `fakes.ts`, `auth.ts`, `builders.ts`): `ServicesProvider` accepts a `services` override and `AuthContext` is exported for tests. `fakeServices` makes any un-faked method throw a named error rather than silently succeed. Services currently import their concrete repository module (against the layer rule above), so a service test replaces that module with `vi.mock` and a fake typed `satisfies Partial<…Repository>`.
4. E2E runs against the **production build** (`vite build` + `vite preview`) with Supabase's network mocked by `frontend/e2e/fixtures/supabase-mock.ts`; any unmocked request fails the test. E2E never talks to a real Supabase project and no service-role key appears in any test, fixture or env file. A real local-Supabase suite is a planned follow-up, not present yet.
5. Query by role, label and visible text, not class names or implementation details — except the single-rendering assertions, which count elements.
6. A failing test is fixed, or deleted with a stated reason. Never commit `.skip` / `.only`.
7. Before calling work done run `npm run test` and `npm run build:frontend`, plus `npm run test:e2e` when a route, flow or layout changed. Report failures verbatim; never claim a pass that was not run.
8. Playwright WebKit does not reproduce iOS Safari's safe-area, focus-zoom or address-bar behavior — verify those by hand on a Vercel preview deployment.

## Spec Directory

[spec/](spec/) is the source of truth for behavior and is more detailed than this file. Key entry points: [spec/architecture.md](spec/architecture.md) (layering + server authority table), [spec/backend/rules.md](spec/backend/rules.md) and [spec/frontend/rules.md](spec/frontend/rules.md) (binding implementation rules), [spec/backend/edge-functions.md](spec/backend/edge-functions.md) (full validation steps per function), [spec/backend/database.md](spec/backend/database.md) (schema, triggers, RLS), [spec/backend/domain-model.md](spec/backend/domain-model.md). Read the relevant spec file before writing a new service, repository, or Edge Function — don't guess at business rules from code alone.
