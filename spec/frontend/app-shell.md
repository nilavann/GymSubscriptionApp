# App Shell Specification — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)

This file specifies the wiring of the web app shell: the auth context (`web/src/context/auth.context.tsx`), the root app component (`web/src/App.tsx`), and the responsive layout shell (`web/src/components/AppShell.tsx`). Read alongside: [architecture.md](../architecture.md) · [navigation.md](./navigation.md).

---

## 1. Auth Context (`web/src/context/auth.context.tsx`)

### 1.1 AuthContextValue type

```typescript
export interface AuthContextValue {
  currentProfile: Profile | null;   // profiles row for the logged-in user, or null
  session: Session | null;          // raw Supabase session (has the user's email), or null
  isInitialising: boolean;
  signInWithPassword(email: string, password: string): Promise<void>;
  signInWithOAuth(provider: 'google'): Promise<void>;
  signOut(): Promise<void>;
}
```

| Field | Type | Purpose |
|---|---|---|
| `currentProfile` | `Profile \| null` | The logged-in user's `profiles` row (full_name, role, is_active), or `null` if not authenticated or profile not yet loaded |
| `session` | `Session \| null` | Supabase Auth session object, source of the user's email and auth id |
| `isInitialising` | `boolean` | `true` while the initial session check + profile fetch is in flight |
| `signInWithPassword` | function | Delegates to `AuthService.signInWithPassword` |
| `signInWithOAuth` | function | Delegates to `AuthService.signInWithOAuth` |
| `signOut` | function | Delegates to `AuthService.signOut` |

### 1.2 Initial state

| Field | Value at mount |
|---|---|
| `currentProfile` | `null` |
| `session` | `null` |
| `isInitialising` | `true` |

### 1.3 AuthProvider lifecycle

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
          ├─ found and is_active = false → sign the user out immediately (see §1.5),
          │                                 currentProfile = null, show "account deactivated" message
          └─ not found (RLS/race: profile not yet created by trigger) → retry once after a short delay,
                                                                          then treat as deactivated if still missing
```

`AuthProvider` gets `authService` and `profileRepository` via `useServices()`. It must be nested inside `ServicesProvider`.

### 1.4 signInWithPassword / signInWithOAuth behaviour

Called by the login screen. On success, `onAuthStateChange` (already subscribed) fires and updates `currentProfile`/`session` — the login screen does not set state directly. On failure, the promise rejects and the login screen shows the error inline.

### 1.5 signOut behaviour

1. Calls `authService.signOut()` (clears the Supabase session).
2. `onAuthStateChange` fires with `session = null`, which sets `currentProfile = null`.
3. The router's guard (see [navigation.md](./navigation.md)) observes the change and redirects to `/login`.

### 1.6 useAuth hook

```typescript
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

---

## 2. Root App (`web/src/App.tsx`)

### 2.1 Provider nesting order

```tsx
<ServicesProvider>
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
</ServicesProvider>
```

- No dark mode support at this stage — all colors come from [colors.md](./colors.md)'s CSS custom properties. (If dark mode is wanted later, it must be added to the spec first.)

### 2.2 Route guarding

Route guards live in `navigation.md`'s route tree as wrapper components (`<RequireAuth>`, `<RequireAdmin>`), not inside `App.tsx` itself. `App.tsx` only wires providers and the router.

### 2.3 Loading state

While `isInitialising === true`, the router renders a full-screen loading view instead of any route content:

| Property | Value |
|---|---|
| Background | `var(--color-surface-dark)` |
| Content | Centered spinner + "Loading…" text, `var(--color-brand-primary)` |
| Layout | `min-height: 100vh`, flex centered |

---

## 3. Responsive Layout Shell (`web/src/components/AppShell.tsx`)

Wraps every authenticated route. Unlike the mobile app's fixed bottom tab bar, the web shell **changes navigation pattern by viewport width**, since desktop and mobile browsers have different ergonomic norms:

| Breakpoint | Nav pattern |
|---|---|
| `< 768px` (mobile) | Fixed bottom tab bar, same 2–3 tabs as the mobile app (Members / Reports / Settings) |
| `>= 768px` (tablet/desktop) | Fixed left sidebar with the same items, plus labels always visible (not icon-only) |

Both patterns read from the same route/tab definition (see [navigation.md](./navigation.md)) — there is exactly one source of truth for "what tabs exist and who can see them," rendered two different ways via a CSS media query / `useMediaQuery` hook, not two separate route trees.

### 3.1 Shared shell elements (both breakpoints)

| Element | Content |
|---|---|
| Top bar | App name/logo (left), current user's name + sign-out control (right) |
| Content area | Routed page content, `max-width: 1200px` centered on wide desktop screens so text/tables don't stretch edge-to-edge on ultrawide monitors |

### 3.2 Mobile bottom tab bar

Same visual language as the mobile app's tab bar (see [colors.md](./colors.md)):

| Property | Token |
|---|---|
| Background | `var(--color-surface-dark)` |
| Active icon + label | `var(--color-text-brand)` |
| Inactive icon + label | `var(--color-neutral-600)` |
| Position | `position: fixed; bottom: 0` |
| Content bottom padding | Content area must reserve space (`padding-bottom`) equal to the tab bar height so the last list item isn't hidden behind it |

### 3.3 Desktop sidebar

| Property | Token |
|---|---|
| Background | `var(--color-surface-dark)` |
| Width | `240px` fixed |
| Active item | Background tint `var(--color-brand-tint)` at low opacity or left accent bar in `var(--color-text-brand)`, label `var(--color-text-brand)` |
| Inactive item | Label `var(--color-neutral-600)` |
| Position | Fixed-width `240px` column, full viewport height. Implemented as a CSS Grid column (`.app-shell { grid-template-columns: 240px 1fr }`, `height: 100vh` on the shell), not literal `position: fixed` — visually and behaviorally equivalent (same fixed width, same full-height, sidebar never scrolls independently), just achieved via a different mechanism than this line originally specified. |

### 3.4 Tab/nav items

Same role-based visibility rule as the mobile app — see [navigation.md §Tab Bar](./navigation.md#tab-bar): Members and Reports for all users, Settings (and its Plans/Users sub-items) for `admin` role only.
