# Fit & Fine — Gym Subscription Manager (Web)

A web app for managing gym members, plans, branches, and subscriptions. Built with React + TypeScript + Vite on the frontend and Supabase (Postgres, Auth, Edge Functions) on the backend.

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, React Router — in [`frontend/`](frontend/)
- **Backend:** Supabase (Postgres + RLS, Auth, Edge Functions) — in [`supabase/`](supabase/)
- **Hosting:** Vercel (frontend), Supabase Cloud (database + functions)

The app follows a strict View → Service → Repository layering on the client, with Postgres RLS and Edge Functions as the server-side authority for security-relevant rules. See [spec/architecture.md](spec/architecture.md) for the full architecture and [spec/](spec/) for feature specs.

## Project Structure

```
frontend/                 React + Vite SPA
  src/
    pages/                 route-level screens
    components/             shared UI
    services/                client-side orchestration/validation
    repositories/            Supabase data access
    context/                 auth + services providers
    lib/                     supabase client, helpers
  .env.example              copy to .env.local and fill in your Supabase values

supabase/
  migrations/                Postgres schema migrations
  functions/                 Edge Functions (create-subscription, update-subscription, delete-plan, delete-branch)
  config.toml                Supabase CLI project config
  seed.sql                   local dev seed data
```

## Prerequisites

- Node.js 18+
- npm
- A [Supabase](https://supabase.com) account and project
- A [Vercel](https://vercel.com) account
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (for pushing migrations/functions)

## Local Development

1. Install dependencies (npm workspaces — run from repo root):
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp frontend/.env.example frontend/.env.local
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your Supabase project's **Project Settings → API**. The anon key is safe for the browser bundle — never put the service role key here.

3. Run the dev server:
   ```bash
   npm run dev:frontend
   ```
   The app runs at `http://localhost:5173`.

## Deploying Supabase (Backend)

1. **Link the CLI to your project** (from repo root):
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
   Find `YOUR_PROJECT_REF` in the Supabase dashboard URL or under Project Settings → General.

2. **Push the database schema:**
   ```bash
   npx supabase db push
   ```
   This applies everything in `supabase/migrations/` in order.

3. **Deploy the Edge Functions:**
   ```bash
   npx supabase functions deploy create-subscription
   npx supabase functions deploy update-subscription
   npx supabase functions deploy delete-plan
   npx supabase functions deploy delete-branch
   ```

4. **Set Edge Function secrets** (service role key and anything else `env(...)`-referenced in `config.toml`, e.g. SMTP creds if you enable email):
   ```bash
   npx supabase secrets set SOME_SECRET=value
   ```
   The service role key itself is provisioned automatically for your linked project — never copy it into frontend code or `VITE_*` variables.

5. **Auth settings:** in the Supabase dashboard under Authentication → URL Configuration, set the **Site URL** and **Redirect URLs** to your Vercel production domain (and any preview domains you use) once you have it from the Vercel step below.

## Deploying the Frontend (Vercel)

1. Push this repository to GitHub (or GitLab/Bitbucket).

2. In Vercel, **Add New Project** and import the repo.

3. Configure the project:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build` (default for Vite preset)
   - **Output Directory:** `dist` (default)

4. **Environment Variables** (Project Settings → Environment Variables), for Production/Preview/Development as needed:
   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | your Supabase anon key |

   Never add the Supabase **service role** key to Vercel — it must only exist as a Supabase Edge Function secret.

5. Deploy. Once you have your Vercel domain, go back to Supabase → Authentication → URL Configuration and add it to the allowed **Site URL** / **Redirect URLs**.

## Testing

Four suites, all dev-only (nothing here ships to the browser): frontend unit/component tests, Playwright E2E, Edge Function tests, and database tests. The binding rules for the frontend suites are in [CLAUDE.md](CLAUDE.md#testing-rules-binding); the requirement-by-requirement coverage map for the server-side suites is in [spec/test-traceability.md](spec/test-traceability.md).

From the repo root:

```bash
npm run test:frontend      # Vitest + React Testing Library (see below)
npm run test:e2e:frontend  # Playwright (see below)
npm run test:functions     # Deno: all Edge Functions, with supabase-js replaced by a scriptable fake (needs Deno 2.x)
npm run test:db            # applies the real migrations to a throwaway local Postgres and runs SQL assertions (needs psql + a superuser)
npm test                   # test:frontend + test:functions + test:db (not E2E, which builds the app and is slower)
```

Server-side tests for behaviour the spec requires but the code doesn't yet deliver are kept (not skipped) and marked `GAP` — they pass while the gap exists and fail once it's fixed, so they must then be promoted to normal tests.

### Frontend

```bash
# from frontend/ (or from the repo root as `npm run test:frontend` / `npm run test:e2e:frontend`)
npm run test             # Vitest + React Testing Library, jsdom — unit and component tests, one run
npm run test:watch
npm run test:coverage    # v8 coverage report (informational, no threshold)
npm run typecheck        # app + colocated tests
npm run typecheck:e2e    # Playwright does not typecheck specs, so this does
npm run test:e2e         # Playwright: desktop Chrome, Pixel 7, iPhone 13 (WebKit)
npm run test:e2e:ui      # Playwright UI mode, for debugging a spec
```

First run of the E2E suite on a machine: `npx playwright install chromium webkit` (browsers are cached outside the repo).

**Unit/component tests** sit next to the code (`*.test.ts(x)`) and never touch Supabase: pages get fake services through `renderWithProviders(ui, { services: fakeServices({...}), auth: {...} })` (`frontend/src/test/`). A fake method that a test did not set up throws a named error instead of silently succeeding.

**E2E tests** (`frontend/e2e/`) run against the **production build** (`vite build` + `vite preview`, not the dev server — StrictMode double-runs effects in dev, which would corrupt the render-once and request-count assertions). Supabase is replaced at the network layer by `e2e/fixtures/supabase-mock.ts`: PostgREST tables, Auth, Edge Functions, Postgres functions (`rpc`) and Storage are answered from in-memory data, and **any request nobody mocked fails the test**. Specs assert the requests the client sends — those payloads are the contract with the database and the Edge Functions.

What the frontend suites deliberately do **not** cover: RLS policies, triggers and Edge Function code (the E2E mock fakes *answers* — those are verified by the Deno and database suites above, not here; a real local-Supabase E2E run is a planned follow-up), pixel-level visuals (`e2e/screens-visual.spec.ts` only produces screenshots for review), and iOS Safari's safe-area, focus-zoom and address-bar behaviour (Playwright WebKit does not reproduce them — check a Vercel preview on a real phone).

### Coverage matrix

| Area | Where | How it is tested |
|---|---|---|
| `lib/` helpers (14) | `src/lib/*.test.ts(x)` | Unit tests, one per file |
| Services (9) | `src/services/*.service.test.ts` | Against fake repositories (`vi.mock`) — validation and orchestration |
| Contexts (auth, services, theme) | `src/context/*.test.tsx` | Provider behaviour, storage keys, session lifecycle |
| Components (16 + `nav-items`) | `src/components/*.test.tsx` | RTL; shell/nav assert exactly one navigation structure at 390 / 767 / 768 / 1024 |
| Pages (16) | `src/pages/*.test.tsx` | RTL with fake services — loading / success / empty / error + retry, role gating, key interactions; list pages assert exactly one of table / cards |
| Route table | `src/App.test.tsx` | The documented route set, guards, `hideTabBar` handles |
| Repositories (10) | `src/repositories/*.test.ts` (subscription, member, profile, audit log, Edge Function-backed deletes) | Request shapes against a mocked supabase-js; the remaining repositories are thin wrappers asserted through the E2E request log |
| Shell, theme, scroll, overflow, render-once | `e2e/shell-responsive`, `theme`, `scroll`, `mobile-conventions`, `lists-render-once` | Real browsers and real CSS, three projects |
| Sign-in, access, deep links | `e2e/smoke`, `auth` | Wrong password, deactivated and never-invited accounts, forgot password, a dead token mid-session, refresh on a deep URL (Google OAuth is unit-tested only) |
| Members, Add / Edit / Delete member | `e2e/members` | List search/filter/open, create/edit/delete payloads, phone hero layout |
| Renew checkout | `e2e/renew` | The exact `create-subscription` body, overlap warning, offline retry |
| Action Center | `e2e/action-center` | Server-side queue window, tabs, badge, carousel snap, photo lightbox |
| Reports | `e2e/reports` | Range presets as database filters, table vs cards content, independent retry |
| Admin: Settings, Plans, Branches, Roles | `e2e/settings-admin` | Hub counts, role gating, CRUD payloads, delete guards |
| Admin: Users, Invite | `e2e/admin-users` | Edge Function payloads, self-protection, soft delete / restore |
| Admin: Audit Log, Member Numbering | `e2e/admin-audit-numbering` | Filters as requests, view-only, atomic settings RPC, sequence function |
| Navigation under a slow connection | `e2e/navigation-race` | Back pressed while the next lazy screen is still loading |
| Fonts | `e2e/fonts` | Only the Latin subsets download; body is Rubik, the brand wordmark Schibsted Grotesk |
| Phone screens for review | `e2e/screens-visual` | Eight screens plus Login, attached to the report (not a gate) |

### Edge Functions and database

| Area | Where | How it is tested |
|---|---|---|
| Edge Functions (all 10) | `supabase/functions/_tests/` | Deno, with `@supabase/supabase-js` swapped for a scriptable fake — auth gates, validation, guards and payload shaping |
| Schema, constraints, triggers, RLS, RPCs, views, audit log, concurrency | `supabase/tests/` | The real migrations applied to a throwaway Postgres (Supabase `auth`/`storage`/roles stubbed), then SQL assertions and a 2,000-member load check |

## Notes

- `frontend/.env.local` is gitignored and never committed — each environment (local, Vercel) supplies its own Supabase URL/anon key.
- `frontend/vercel.json` rewrites every path except `/assets/*` to `index.html`, so refreshing or opening a deep link like `/members/123` loads the SPA instead of a Vercel 404. `/assets/*` is excluded on purpose: a stale chunk from a previous deploy must still 404 so `ChunkLoadErrorBoundary` catches it.
- Business rules that matter for security (subscription creation math, plan-deletion guards, audit fields) are enforced server-side via Edge Functions and Postgres triggers/RLS, not trusted from the client. See the "Server-Side Authority" table in [spec/architecture.md](spec/architecture.md).
