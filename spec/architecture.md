# Architecture — Web Edition

> Part of: [SPEC-WEB.md](../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)

---

## Purpose

This file defines the mandatory layered architecture for the web app. It mirrors the mobile app's View / Service / Repository separation ([spec/architecture.md](../spec/architecture.md)), adapted for a stack where the "backend" is Supabase rather than an app-owned SQL file, and where the client is untrusted.

---

## Project Location

The web app is a **separate project folder** from the existing Expo app, inside the same repository:

```
gymsubscription/                  ← repo root (existing Expo app stays here: app/, package.json, etc.)
  web/                            ← NEW: Vite + React + TypeScript SPA
    src/
    package.json
    vite.config.ts
  supabase/                       ← NEW: Supabase project config, migrations, Edge Functions
    migrations/
    functions/
  SPEC.md, spec/                  ← existing mobile spec (untouched)
  SPEC-WEB.md, spec-web/          ← this spec
```

Vercel is configured to build from the `web/` subfolder (Vercel project "Root Directory" setting). The Supabase project is managed independently via the Supabase CLI/dashboard and is not deployed by Vercel.

---

## Layer Overview

```
┌──────────────────────────────────────────────────┐
│  VIEW  (web/src/pages/, web/src/components/)     │
│  Screen/component code only. No Supabase queries  │
│  written inline. No business rules. Calls service │
│  methods via useServices().                       │
└──────────────────────┬───────────────────────────┘
                       │ calls
┌──────────────────────▼───────────────────────────┐
│  SERVICE  (web/src/services/)                    │
│  Client-side validation and orchestration only.   │
│  Calls repository interfaces. Never trusted as    │
│  the final authority for a security-relevant rule │
│  (see below) — those live server-side.            │
└──────────────────────┬───────────────────────────┘
                       │ calls interface, not implementation
┌──────────────────────▼───────────────────────────┐
│  REPOSITORY  (web/src/repositories/)             │
│  Data access only. Talks to Supabase: either      │
│  direct supabase-js table queries (RLS-guarded    │
│  reads/simple writes) or supabase.functions.invoke│
│  for Edge Functions (protected writes).           │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│  SUPABASE (supabase/)                            │
│  Postgres + RLS policies (data-access authority)  │
│  + Edge Functions (business-rule authority) — see │
│  Server-Side Authority below.                     │
└──────────────────────────────────────────────────┘
```

---

## Server-Side Authority — the key difference from the mobile app

The mobile app's architecture doc states the service layer is where business rules are enforced, because on a single offline device, the service layer *is* the only path to the data. **On the web this assumption is false**: anyone can call the Supabase REST API directly with browser devtools, bypassing the React app entirely. So:

| Rule | Mobile app authority | Web app authority |
|---|---|---|
| `end_date` computation | `SubscriptionService.renew()` | `create-subscription` Edge Function, per item |
| Subscription overlap guard | `SubscriptionService.renew()` | **Client-side only, by design** — no Edge Function or RLS enforcement exists for this one; see [backend/subscription-management.md §4](./backend/subscription-management.md#4-create-subscription-edge-function-req-sub-001-004007009) and [backend/business-logic.md §Subscription Overlap Guard](./backend/business-logic.md#subscription-overlap-guard-req-sub-005008) |
| Plan deletion guard | `PlanService.delete()` | `delete-plan` Edge Function + `ON DELETE RESTRICT` constraint |
| Audit fields (`created_by`/`changed_by`) | Repository sets from trusted local `currentUserId` | Postgres trigger reads `auth.uid()` — see [database.md](./backend/database.md) |
| Role-based read/write access | Route guards + screen checks | RLS policies (primary) + `<RequireAdmin>` route guards and inline `currentProfile.role` checks for conditional rendering (UX only — see [rules.md §Access Control & Roles](./frontend/rules.md#access-control--roles)) |
| User invitation | N/A (local PIN creation) | `invite-user` Edge Function (service role) |

The client-side service layer still exists and still runs the same validations (for good UX — instant feedback, no round trip needed to tell a user a required field is empty) — but it is **never the last line of defense**. Every row above must also be enforced server-side. If a spec change modifies one of these rules, it must update the Edge Function / RLS policy, not just a client service.

---

## Folder Structure

```
web/src/
  repositories/
    interfaces/                        ← TypeScript interfaces (the contracts)
      member.repository.ts
      plan.repository.ts
      subscription.repository.ts
      profile.repository.ts
    supabase/                          ← supabase-js implementations
      supabase-member.repository.ts
      supabase-plan.repository.ts
      supabase-subscription.repository.ts
      supabase-profile.repository.ts
  services/
    auth.service.ts                    ← Supabase Auth session, sign-in/out, OAuth
    member.service.ts                  ← create/edit member, client-side validation
    plan.service.ts                    ← plan CRUD, client-side pre-check before calling delete-plan
    subscription.service.ts            ← renew flow orchestration, calls create-subscription
    user.service.ts                    ← invite/deactivate flow orchestration
  context/
    auth.context.tsx                   ← logged-in profile, session state
    services.context.tsx               ← instantiates all services, exposes useServices()
  lib/
    supabase-client.ts                 ← single supabase-js client instance
    datetime.ts
  types/
    index.ts                           ← all DB row types (Profile, Plan, Member, Subscription)
  pages/                                ← route-level screen components
  components/                           ← shared/reusable UI components
  App.tsx
  main.tsx

supabase/functions/
  create-subscription/index.ts
  update-subscription/index.ts
  delete-plan/index.ts
  invite-user/index.ts
```

---

## Layer Rules

### View Layer — `web/src/pages/`, `web/src/components/`

- Screen/component files contain **UI and local UI state only** (loading flags, form field values, error messages).
- A component accesses data and logic **only** through `useServices()` or `useAuth()`.
- A component **must never** import `web/src/repositories/` directly, call `supabase-js` directly, or call `supabase.functions.invoke` directly.
- A component **must never** compute `end_date` or apply the overlap/deletion guards itself — those results come back from the service layer, which got them from an Edge Function.
- Data re-fetch on every route entry (React Router's navigation, e.g. via a `useEffect` keyed on the route `loader`/params, or a data-fetching hook run on mount of each page) — see [rules.md](./frontend/rules.md) for the exact pattern, since there is no `useFocusEffect` equivalent outside React Navigation.

### Service Layer — `web/src/services/`

- Services are **classes** (or hooks wrapping classes) with constructor injection of repository interfaces, same pattern as the mobile app.
- Services perform **client-side** validation and call the repository. For the rules listed in Server-Side Authority above, the service calls the repository method that ultimately invokes an Edge Function, and surfaces the Edge Function's error message to the UI — it does not attempt to re-implement the guard itself.
- A service **must never** import a concrete repository class (`supabase-*.ts`).
- A service **must never** import from `web/src/pages/` or `web/src/components/`.

### Repository Layer — `web/src/repositories/`

- Each entity has one **interface** in `interfaces/` and one implementation in `supabase/`.
- Repository implementations contain **only** data access: `supabase-js` table queries or `supabase.functions.invoke(...)` calls. No business logic, no date math.
- All Supabase queries go through the typed `supabase-js` client — never construct raw SQL strings.

---

## Repository Interface Contract

```typescript
// web/src/repositories/interfaces/member.repository.ts
export interface MemberRepository {
  getAll(): Promise<Member[]>;
  getById(id: number): Promise<Member | null>;
  create(data: NewMember): Promise<number>;                 // direct insert, RLS-guarded
  update(id: number, data: UpdateMember): Promise<void>;     // direct update, RLS-guarded
}

// web/src/repositories/interfaces/plan.repository.ts
export interface PlanRepository {
  getAll(): Promise<Plan[]>;
  getById(id: number): Promise<Plan | null>;
  create(data: NewPlan): Promise<number>;                    // direct insert, RLS-guarded (admin only)
  update(id: number, data: UpdatePlan): Promise<void>;       // direct update, RLS-guarded (admin only)
  delete(id: number): Promise<void>;                         // invokes delete-plan Edge Function
}

// web/src/repositories/interfaces/subscription.repository.ts
export interface SubscriptionRepository {
  getAllForMember(memberId: number): Promise<Subscription[]>;              // direct select, RLS-guarded (read-only)
  getCurrentItemsForMember(memberId: number): Promise<SubscriptionItemWithPlan[]>; // reads member_current_items
  create(data: NewSubscription): Promise<CreateSubscriptionResult>;        // invokes create-subscription Edge Function
  update(id: number, data: UpdateSubscription): Promise<void>;             // invokes update-subscription Edge Function
}

// web/src/repositories/interfaces/profile.repository.ts
export interface ProfileRepository {
  getAll(): Promise<Profile[]>;
  getById(id: string): Promise<Profile | null>;
  invite(data: InviteUser): Promise<void>;                   // invokes invite-user Edge Function
  update(id: string, data: UpdateProfile): Promise<void>;    // direct update, RLS-guarded
}
```

---

## Edge Functions

Each Edge Function runs with the Supabase **service role** key (never exposed to the client) and re-validates the caller's identity/role from the request's JWT before doing anything privileged.

The full function list, with every validation step, lives in [edge-functions.md](./backend/edge-functions.md) — illustrative shape below:

```typescript
// supabase/functions/create-subscription/index.ts
// The only write path for subscriptions/subscription_items — creates the header and every
// line item together, in one call. A checkout always has exactly one category='membership'
// item plus zero or more category='addon' items; adding something new later is always a new
// checkout, never an edit to this one.
// 1. Verify caller is an authenticated, active, non-deleted user (profiles.is_active = true,
//    deleted_at is null) via the request JWT.
// 2. Validate the payload has ≥1 item and exactly one is category='membership'.
// 3. Per item: look up the plan (must not be soft-deleted), validate quantity, compute
//    end_date = start_date + (duration_days × quantity) - 1 (null for indefinite plans),
//    compute/accept amount_paid, validate shared_member_id (only for max_members=2
//    membership items), and hard-block re-attaching an indefinite plan the member already
//    has (REQ-SUB-007 — no override for this one).
// 4. Insert the header + all items via a single service-role RPC call (create_subscription_with_items,
//    see database.md) so it's genuinely one transaction — either every row lands or none do.
// 5. Return the created subscription and its items.
// Deliberately NOT implemented here: the overlap warning (REQ-SUB-005/008) — that's resolved
// as a client-side-only check in the checkout form, before this function is ever called. See
// backend/subscription-management.md §4 and backend/business-logic.md §Subscription Overlap Guard.

// supabase/functions/update-subscription/index.ts
// Header-only edits: payment_mode, notes. Line items (subscription_items) have no update path
// at all in this revision — not plan_id, not dates, not quantity, not shared_member_id after
// creation. Adding, removing, or changing an item always means a new create-subscription checkout.

// supabase/functions/delete-plan/index.ts
// 1. Verify caller is an active admin.
// 2. Count non-deleted subscriptions referencing plan_id.
// 3. If count > 0 → return 409 with a friendly "used by X subscription(s)" message.
// 4. Else soft-delete: UPDATE plans SET deleted_at = now(), deleted_by = auth.uid() — never a real DELETE
//    (see database.md §Soft Delete Enforcement).

// supabase/functions/invite-user/index.ts
// 1. Verify caller is an active admin.
// 2. Call supabase.auth.admin.inviteUserByEmail(email, { data: { full_name, role, invited_by: callerId } }).
//    The handle_new_auth_user trigger (see database.md) creates the profiles row automatically.
```

---

## Auth & Session

**Owner: Supabase Auth client SDK** — `supabase-js`'s `supabase.auth` owns session storage (browser `localStorage`, managed by the SDK) and token refresh. The app does not implement its own session persistence.

```typescript
// web/src/services/auth.service.ts
export class AuthService {
  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signInWithOAuth(provider: 'google'): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  onAuthStateChange(callback: (session: Session | null) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => callback(session));
  }
}
```

`AuthContext` subscribes to `onAuthStateChange` on mount, and whenever a session exists, fetches the matching `profiles` row (for `role`, `full_name`, `is_active`) to build the full "current user" object exposed via `useAuth()`. See [app-shell.md](./frontend/app-shell.md) for the full lifecycle.

---

## Context and Wiring

### `web/src/lib/supabase-client.ts` — the one place the Supabase URL/anon key are read

```typescript
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

Only the **anon key** ever ships to the browser. The service role key exists only in Edge Function environment variables, set via the Supabase dashboard/CLI — it must never appear in `web/` source, `.env` files committed to git, or any Vercel **frontend** environment variable.

### `web/src/context/services.context.tsx`

```typescript
export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const memberRepo       = new SupabaseMemberRepository(supabase);
  const planRepo         = new SupabasePlanRepository(supabase);
  const subscriptionRepo = new SupabaseSubscriptionRepository(supabase);
  const profileRepo      = new SupabaseProfileRepository(supabase);

  const services = {
    auth:         new AuthService(),
    member:       new MemberService(memberRepo),
    plan:         new PlanService(planRepo),
    subscription: new SubscriptionService(subscriptionRepo, planRepo),
    user:         new UserService(profileRepo),
  };

  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used inside ServicesProvider');
  return ctx;
}
```

### `web/src/App.tsx` — provider nesting order

```tsx
<ServicesProvider>
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
</ServicesProvider>
```

---

## What Is Forbidden

| ❌ Never do this | ✅ Do this instead |
|---|---|
| Call `supabase-js` or `supabase.functions.invoke` in a page/component | Call a service method via `useServices()` |
| Compute `end_date` in the client service layer and trust it | Let the `create-subscription` / `update-subscription` Edge Function compute and persist it |
| Treat the overlap warning as a security/data-integrity control, or build anything server-side that assumes it fired | It's deliberately client-side-only (REQ-SUB-005/008) — a UX safety net with zero backend footprint, bypassed trivially by a direct API call, by design |
| Grant the client a direct `insert`/`update` RLS policy on `subscriptions` | Route all subscription writes through Edge Functions |
| Put the Supabase **service role** key in any `web/` file or `VITE_*` env var | Service role key lives only in Edge Function secrets |
| Set `created_by` / `changed_by` from a client-supplied value | Let the Postgres trigger read `auth.uid()` |
| Build a parallel users/credentials table | Use `auth.users` + `profiles`, linked 1:1 by id |
