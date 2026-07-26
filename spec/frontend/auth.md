# User Authentication — Frontend Spec

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Consolidates the frontend side of [requirements-template.md §7 User Authentication](../requirements-template.md#7-feature-area-user-authentication) (REQ-AUTH-001–005) into one place. The content here is not new — it's pulled together from [screens.md](./screens.md) (WSCR-01), [app-shell.md](./app-shell.md) (Auth Context), [navigation.md](./navigation.md) (route guards), and [data-models.md](./data-models.md) (Profile type), which remain the canonical, type-organized source files. Update those files first if behavior changes; re-sync this doc afterward.
>
> **Out of scope:** inviting/editing/deactivating/deleting other users (WSCR-09/10 Manage Users, REQ-ADMIN-004/006) is a separate feature area — see screens.md's Manage Users section. This doc covers only signing yourself in, staying signed in, and resetting your own password.

---

## 1. Scope

| Requirement | Summary |
|---|---|
| REQ-AUTH-001 | Email + password sign-in via Supabase Auth |
| REQ-AUTH-002 | Google OAuth sign-in, auto-links to the same invited account |
| REQ-AUTH-003 | Google sign-in is invite-only — no `profiles` row, no access, even after a successful Google handshake |
| REQ-AUTH-004 | One account, two interchangeable sign-in methods, same session/profile either way |
| REQ-AUTH-005 | "Forgot password" self-service reset, including first-time password setup for Google-only users |

---

## 2. Screen: Login (WSCR-01)

**Route:** `/login` · Public — redirects to `/` if a valid, active-profile session already exists (see §4 Routing).

### 2.1 Layout

| Breakpoint | Layout |
|---|---|
| Mobile (`< 768px`) | Single column, full-width form, hero/logo above the form |
| Desktop (`>= 768px`) | Centered card, `max-width: 400px`, vertically and horizontally centered on `--color-surface-dark` background |

### 2.2 Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| Email | `email` input | Yes | Standard email validation |
| Password | `password` input | Yes (password flow only) | No client-side complexity rules — Supabase Auth enforces its own password policy |

### 2.3 Actions

| Action | Behavior |
|---|---|
| "Sign in" button | Calls `authService.signInWithPassword(email, password)` (via `useAuth()`). Disabled while submitting, shows a spinner. Implements REQ-AUTH-001. |
| "Continue with Google" button | Calls `authService.signInWithOAuth('google')`. Redirects to Google, then back to the app. Implements REQ-AUTH-002. |
| "Forgot password?" link | Calls `authService.resetPasswordForEmail(email)`. Implements REQ-AUTH-005. |
| Error banner | Shown on failed sign-in: "Wrong email or password." for credential errors, or the raw Supabase error message for anything else. Never confirms/denies whether the email is registered (REQ-AUTH-001 acceptance criteria — same non-leaking pattern as REQ-AUTH-003/005). |

### 2.4 States

| State | Trigger | Behavior |
|---|---|---|
| Idle | Page load | Fields empty, button enabled once both fields are non-empty |
| Submitting | Sign in tapped | Button shows spinner, fields disabled |
| Success | Supabase returns a session | `onAuthStateChange` fires (see §3), app redirects to `/` |
| Failure | Supabase returns an error | Error banner shown, password field cleared, email kept |
| Not invited (Google) | Post-OAuth profile check finds no `profiles` row | Session is signed back out immediately; error banner: "This email hasn't been invited — contact your admin." (REQ-AUTH-003) |
| Deactivated account | Profile fetch after login returns `is_active = false` | Immediately signed out again, error banner: "Your account has been deactivated. Contact an admin." |
| Reset requested | "Forgot password" submitted | Generic confirmation shown regardless of whether the email exists: "If that email is registered, a reset link has been sent." (REQ-AUTH-005) |

No PIN dots, no username field, no version string footer — these are mobile-only elements that do not carry over to web.

### 2.5 Non-functional compliance ([rules.md](./rules.md) rules 16, 29-31)

- **Loading/error/retry (rules 29–30):** the "Failure" state (§2.4) already distinguishes credential errors ("Wrong email or password.") from anything else (raw Supabase error) — tighten the latter to a generic "Something went wrong signing in. Please try again." rather than a raw error string. There's no separate Retry button here: the form staying populated and enabled *is* the retry path, since the user just re-submits. `signInWithPassword`/`signInWithOAuth` don't need `with-timeout.ts` wrapping — they're direct Supabase Auth SDK calls, not this app's own repository/service fetches, and the SDK manages its own request lifecycle.
- **Empty states (rule 31):** not applicable — this screen has no list/collection to be empty.
- **Responsive (rule 16):** the breakpoint table above (§2.1) already gives mobile a single full-width column. Confirming what rule 16 added beyond that: both buttons and the "Forgot password?" link meet the 44×44px touch-target minimum, and neither the mobile nor desktop layout ever requires horizontal scrolling.

---

## 3. Auth Context (`web/src/context/auth.context.tsx`)

### 3.1 `AuthContextValue`

```typescript
export interface AuthContextValue {
  currentProfile: Profile | null;   // profiles row for the logged-in user, or null
  session: Session | null;          // raw Supabase session (has the user's email), or null
  isInitialising: boolean;
  blockedMessage: string | null;    // set on a blocked sign-in (deactivated / not invited)
  authLinkError: string | null;     // set once on mount if the URL carries a rejected/expired auth-link error
  needsPasswordReset: boolean;      // true from a PASSWORD_RECOVERY auth event until updatePassword() succeeds
  signInWithPassword(email: string, password: string): Promise<void>;
  signInWithOAuth(provider: 'google'): Promise<void>;
  resetPasswordForEmail(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  signOut(): Promise<void>;
}
```

| Field | Type | Purpose |
|---|---|---|
| `currentProfile` | `Profile \| null` | The logged-in user's `profiles` row (full_name, role, is_active), or `null` if not authenticated or profile not yet loaded |
| `session` | `Session \| null` | Supabase Auth session object, source of the user's email and auth id |
| `isInitialising` | `boolean` | `true` while the initial session check + profile fetch is in flight |
| `blockedMessage` | `string \| null` | Set once, briefly, on a blocked sign-in attempt so WSCR-01 can render it |
| `authLinkError` | `string \| null` | Set once on mount if the URL carries a Supabase Auth redirect error (`#error=...&error_description=...` — a rejected/expired/already-used password-reset, invite, or OAuth link). Parsed before `detectSessionInUrl` consumes the hash, then the error params are stripped from the visible URL. Distinct from `blockedMessage`: this is about the link never producing a session at all, not a valid session belonging to a blocked account. WSCR-01 and WSCR-13 both display it. |
| `needsPasswordReset` | `boolean` | `true` from the moment Supabase's `PASSWORD_RECOVERY` auth event fires (recovery-link click) until `updatePassword()` succeeds. `RequireAuth` redirects every other route to WSCR-13 while this is true — a recovery session can only be used to set a new password, never to skip straight into the app. Reset back to `false` on sign-out (or any session going to `null`), so a stale flag from an earlier recovery attempt can never block a later, ordinary sign-in. |
| `signInWithPassword` | function | Delegates to `AuthService.signInWithPassword` (REQ-AUTH-001) |
| `signInWithOAuth` | function | Delegates to `AuthService.signInWithOAuth` (REQ-AUTH-002) |
| `resetPasswordForEmail` | function | Delegates to `AuthService.resetPasswordForEmail` — sends the reset email (REQ-AUTH-005, first half) |
| `updatePassword` | function | Delegates to `AuthService.updatePassword` (`supabase.auth.updateUser({ password })`), then clears `needsPasswordReset` — completes REQ-AUTH-005 (second half, WSCR-13) |
| `signOut` | function | Delegates to `AuthService.signOut` |

Initial state at mount: `currentProfile = null`, `session = null`, `isInitialising = true`.

### 3.2 `AuthProvider` lifecycle

```
mount
  → isInitialising = true
  → supabase.auth.getSession() to check for an existing session
  → subscribe via supabase.auth.onAuthStateChange(...)
  → on every (session change):
      if session is null:
        currentProfile = null, session = null, isInitialising = false
      if session is present:
        fetch profiles row where id = session.user.id
          ├─ found and is_active = true  → currentProfile = row, session = session, isInitialising = false
          ├─ found and is_active = false → sign the user out immediately (§3.4),
          │                                 currentProfile = null, show "account deactivated" message
          └─ not found (RLS/race: profile not yet created by trigger, OR REQ-AUTH-003's
             not-invited case) → retry once after a short delay, then if still missing:
             sign the session out and show "This email hasn't been invited — contact your admin."
```

Separately, `onAuthStateChange`'s event name (not just the resulting session) is also watched: a `PASSWORD_RECOVERY` event sets `needsPasswordReset = true` (a recovery-link click resolves to a real session, but the code above must not treat it as an ordinary sign-in); a `SIGNED_OUT` event, or any event whose session is `null`, clears it back to `false`. See §4.3 below and [WSCR-13](./screens.md#wscr-13--reset-password).

`AuthProvider` gets `authService` and `profileRepository` via `useServices()`. It must be nested inside `ServicesProvider`.

This lifecycle is the single place REQ-AUTH-003 (invite-only enforcement) and REQ-AUTH-004 (one profile reachable by either sign-in method) are implemented on the frontend — both password and Google sessions flow through the exact same "fetch profile by `session.user.id`" step, so there is no method-specific branching after Supabase Auth itself resolves the session.

### 3.3 `signInWithPassword` / `signInWithOAuth` behavior

Called by the login screen. On success, `onAuthStateChange` (already subscribed) fires and updates `currentProfile`/`session` — the login screen does not set state directly. On failure, the promise rejects and the login screen shows the error inline.

### 3.4 `signOut` behavior

1. Calls `authService.signOut()` (clears the Supabase session).
2. `onAuthStateChange` fires with `session = null`, which sets `currentProfile = null`.
3. The router's guard (§4) observes the change and redirects to `/login`.

### 3.5 `useAuth` hook

```typescript
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

Screens/components must access auth state only through `useAuth()` — never import `supabase-js` or call `supabase.functions.invoke` directly in a component.

### 3.6 Provider nesting order (`web/src/App.tsx`)

```tsx
<ServicesProvider>
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
</ServicesProvider>
```

While `isInitialising === true`, the router renders a full-screen loading view (centered spinner + "Loading…") instead of any route content.

---

## 4. Routing & Route Guards

### 4.1 Entry point logic

- If no Supabase session exists → redirect to `/login`.
- If a valid, active-profile session exists → redirect to `/` (Members List).
- If a password-recovery session exists (`needsPasswordReset`) → redirect to `/reset-password` (WSCR-13), regardless of what `currentProfile` resolves to. See §4.3.

Session state comes from `useAuth()` — there is no manual `localStorage` key to check; `supabase-js` owns session persistence.

### 4.2 Access control

| Route | Who can access |
|---|---|
| `/login` | Anyone (redirects away if already signed in — unless a password-recovery session is pending, §4.3) |
| `/reset-password` | Anyone with a pending password-recovery session; redirects everyone else away (to `/` or `/login`) |
| Everything else | All signed-in, active users, or `admin`-only per navigation.md's per-route table |

**Client-side route guards are UX only** — they prevent a staff user from *seeing* an admin page and give a fast redirect, but they are not the security boundary. The actual data protection is Supabase RLS (see [backend/auth.md §3](../backend/auth.md#3-row-level-security-rls)); even if a route guard were buggy, the underlying `profiles`/other-table writes would still be rejected server-side.

If a signed-in user's profile has `is_active = false` (deactivated while they had a session open), any subsequent navigation or data fetch fails (RLS blocks it) — the app must detect this (e.g. a 401/403 from Supabase) and force a sign-out with a "Your account has been deactivated" message, redirecting to `/login`.

### 4.3 Reset Password completion (REQ-AUTH-005)

`resetPasswordForEmail` (§2.3/§3) only sends the email — following that link is a separate leg that must be handled explicitly, or the recovery session silently resolves like any other sign-in and the user lands in the app having never actually changed their password. Supabase's client SDK detects the recovery token in the URL and emits a `PASSWORD_RECOVERY` auth event with a real session attached; `AuthContext` turns that into `needsPasswordReset = true` (§3.2). `RequireAuth` then redirects that session to `/reset-password` (WSCR-13) no matter which route it landed on, and `LoginPage` does the same if the user happens to be sitting on `/login` when the flag flips.

WSCR-13 is the only screen allowed to consume a recovery session: it calls `updatePassword(newPassword)` (→ `supabase.auth.updateUser({ password })`), which clears `needsPasswordReset` on success and lets the (now-updated) session fall through to a normal `/` redirect. If the recovery link resolves to a blocked account (deactivated / never invited), the existing resolveSession logic (§3.2) has already signed it back out before WSCR-13 ever gets a session to act on — it redirects to `/login` instead, where the usual blocked-message banner shows.

**`resetPasswordForEmail`'s `redirectTo` is the bare origin, not `${origin}/reset-password`** — a deliberate fix, not the original design. Supabase Auth validates `redirectTo` server-side against Authentication → URL Configuration → Redirect URLs (an *exact* match unless a wildcard is configured there); if it doesn't match, Supabase does **not** attach the recovery token at all — it silently falls back to the project's Site URL instead. Pointing `redirectTo` at a specific sub-path like `/reset-password` made the whole flow depend on that exact sub-path being individually allow-listed, which is easy to miss when only the bare origin was ever added (e.g. because Google OAuth already needed it). Symptom when this goes wrong: the user clicks the emailed link and is "redirected to the app," but the reset-password screen never appears — because no token ever arrived, `needsPasswordReset` never flips true, and the app just falls through to its normal signed-out/signed-in state. Since `AuthContext`'s `PASSWORD_RECOVERY` listener is global (subscribed once, at the app root — §3.2), it doesn't matter which allow-listed page the token actually lands on; `RequireAuth`/`LoginPage` redirect to `/reset-password` from wherever it landed. Using the bare origin removes the dependency on a specific sub-path being separately whitelisted — the origin is virtually always already allow-listed for other auth flows to work at all.

**A rejected/expired/already-used link surfaces as `authLinkError`, not silence.** When Supabase *does* reject a `redirectTo` (or the link is expired/reused), it may itself redirect to the Site URL with `#error=...&error_description=...` attached rather than returning nothing — `AuthContext` parses this once on mount (before `detectSessionInUrl` consumes the hash) and exposes it via `authLinkError` on `AuthContextValue`, cleaning the error params out of the visible URL. `LoginPage` shows it in the same error banner as a failed sign-in; `ResetPasswordPage` shows it directly if the failure redirect happens to land there instead. Distinct from `blockedMessage`, which is about a *valid* session belonging to a blocked account — `authLinkError` is about the link itself never producing a session at all.

### 4.4 Route guard components

```tsx
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentProfile, isInitialising, needsPasswordReset } = useAuth();
  if (isInitialising) return <LoadingView />;
  if (!currentProfile) return <Navigate to="/login" replace />;
  if (needsPasswordReset) return <Navigate to="/reset-password" replace />;
  return children;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { currentProfile } = useAuth();
  if (!currentProfile?.roles.includes('admin')) return <AccessDenied />;
  return children;
}
```

(`RequireAdmin` checks `roles.includes('admin')`, not a single `role` field — `Profile.role` was replaced by a many-to-many `roles`/`user_roles` catalog; see [backend/domain-model.md §1a/§1b](../backend/domain-model.md) and the corrected §5 Data Model below. `AccessDenied` here means an inline "access denied" message in place, not a `Navigate` — this doc previously said "redirect to `/`" in prose while its own code sample never did; the actual, implemented behavior is the inline message, which is also arguably better UX than redirecting away from an explicit "why you can't see this" — that's what's specified now.)

---

## 5. Data Model: Profile

Frontend-visible shape of the `profiles` row (full backend definition in [backend/auth.md §2](../backend/auth.md#2-data-model-profiles-table)). **Note:** this table previously listed a single `role: 'admin' | 'staff'` field; that was replaced by a many-to-many `roles`/`user_roles` catalog (closing a self-promotion RLS gap — see [backend/domain-model.md](../backend/domain-model.md)), reflected below:

| Field | Type | Notes |
|---|---|---|
| id | uuid | Same as `auth.users.id` |
| full_name | string | |
| roles | `string[]` | e.g. `['admin']`, `['staff']`, or both — drives `RequireAdmin` (`roles.includes('admin')`) and nav item visibility; managed via WSCR-\* Manage Roles / Manage Users, not self-editable |
| is_active | boolean | `false` = deactivated, forces sign-out |

**Login identity (email, password, OAuth identity) is never duplicated onto `Profile`** — if a screen needs the user's email, read it from `session.user.email` (via `useAuth()`), not from `currentProfile`.

---

## 6. Top Bar / Sign-out

The app shell's top bar shows the current user's name (`currentProfile.full_name`) and a sign-out control on every authenticated route — calls `useAuth().signOut()` (§3.4).

---

## 7. Requirements Traceability

| Requirement | Frontend implementation |
|---|---|
| REQ-AUTH-001 | Login screen password fields + "Sign in" button (§2.3), `authService.signInWithPassword` |
| REQ-AUTH-002 | "Continue with Google" button (§2.3), `authService.signInWithOAuth('google')` |
| REQ-AUTH-003 | `AuthProvider` lifecycle post-session profile check (§3.2) — sign-out + "not invited" message when no `profiles` row is found |
| REQ-AUTH-004 | Single `AuthContext`/`currentProfile` model (§3.1) — both sign-in methods converge on the same `session.user.id` → `profiles` lookup, no per-method branching |
| REQ-AUTH-005 | "Forgot password?" link (§2.3) + generic confirmation state (§2.4) sends the email; WSCR-13 Reset Password (§4.3) completes it via `updatePassword` — same reset-link flow works whether or not the account already has a password |

---

## Related docs

- [screens.md](./screens.md) — WSCR-01 Login, in the context of the full screen registry
- [app-shell.md](./app-shell.md) — Auth Context as part of the full app shell (root app, responsive layout)
- [navigation.md](./navigation.md) — route guards as part of the full route map
- [data-models.md](./data-models.md) — Profile type as part of the full frontend data model
- [../backend/auth.md](../backend/auth.md) — backend counterpart (database, RLS, Supabase Auth config)
