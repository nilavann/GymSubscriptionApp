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

## Notes

- `frontend/.env.local` is gitignored and never committed — each environment (local, Vercel) supplies its own Supabase URL/anon key.
- Business rules that matter for security (subscription creation math, plan-deletion guards, audit fields) are enforced server-side via Edge Functions and Postgres triggers/RLS, not trusted from the client. See the "Server-Side Authority" table in [spec/architecture.md](spec/architecture.md).
