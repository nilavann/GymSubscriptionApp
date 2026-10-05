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

Wraps every authenticated route. The web shell **changes navigation structure by viewport width**, since desktop and mobile browsers have different ergonomic norms — and it renders **exactly one** structure at a time (rules.md rule 33):

| Breakpoint | Rendered | Component(s) |
|---|---|---|
| `< 768px` (mobile) | A top header + a fixed bottom tab bar (the bar is left out on drill-in routes, §3.4) | `MobileHeader`, `TabBar` |
| `>= 768px` (tablet/desktop) | A fixed-width left sidebar + the footer | `SidebarNav`, `AppFooter` |

Both read the same nav definition (`components/nav-items.tsx` — see [navigation.md](./navigation.md)): there is exactly one source of truth for "what items exist and who can see them", rendered two different ways, not two separate route trees. **`AppShell` switches with `useIsTabletUp()`** (`lib/use-media-query.ts`, the px query `(min-width: 768px)`), so the sidebar and the tab bar are never both mounted. Hiding one with CSS is not allowed: the hidden copy would still render, run its hooks and leave two "Main navigation" landmarks in the DOM ([styling.md §4](./styling.md#css-vs-js-who-decides-what-renders)).

Two further rules follow from that:
- **`useActionCenterCount()` is called once, in `AppShell`,** and the count is passed to whichever nav is mounted. If a conditionally mounted nav owned it, it would refetch every time the tab bar remounted (leaving a drill-in screen, rotating across 768px).
- `<ScrollRestoration />` is rendered in `AppShell`. On a phone the **window** scrolls and React Router doesn't reset it on navigation, so a page opened from mid-list would inherit the old offset (it lands ~25px down on WebKit). At `>= 768px` the scroll container is `.app-shell-main`, which this does not touch.

### 3.1 Mobile header (`MobileHeader.tsx`, `< 768px`)

Source: `design_handoff_flexhub_mobile/README.md` §Mobile shell.

| Property | Value |
|---|---|
| Height / position | `58px`, `position: sticky; top: 0`, `z-index: 20` (the layer scale: tab bar 10, header 20, drawer 40, modals 50+) |
| Surface | `--color-neutral-0`, `1px` bottom border `--color-border-default`, `0 20px` side padding (grown by `env(safe-area-inset-*)`) |
| Left | `assets/logo.png` at `24×18` + "Fit & Fine Gym" in `--font-display`, 15.5px / 700, letter-spacing −0.015em |
| Right | The signed-in user's initials (`getInitials(full_name)`) in a 28px `--color-surface-inverse` circle, white 11px / 700. The desktop's "Name · Role" label is not shown on mobile |
| Hit area | The circle sits inside a **44×44** button (`aria-label="Account menu"`, `aria-expanded`) — the visible glyph is smaller than the touch target |

**Account menu.** Tapping the avatar opens a small panel with the user's name, their roles, and **Sign out**. This is how staff sign out on a phone: the mockup's tab bar has no Sign Out, and Settings (which also has one) is admin-only. The panel is mounted only while open, and its two document listeners (`keydown`, `pointerdown`) exist only while open. It closes on Escape (focus returns to the avatar button), on a press outside it, on any route change (including the browser back button), and after Sign out.

### 3.2 Mobile bottom tab bar (`TabBar.tsx`, `< 768px`)

| Property | Value |
|---|---|
| Items | Action Center · Members · Reports · (Settings, admins only) — three for staff, four for admins. **No Sign Out tab** |
| Position | `position: fixed; bottom: 0; left: 0; right: 0`, `z-index: 10` |
| Surface | `--color-neutral-0`, `1px` top border `--color-border-default`, no shadow; padding `8px 6px` plus `env(safe-area-inset-bottom)` so the home indicator never overlaps it |
| Item | `flex: 1`, min-height 48px, a 20px icon (2px stroke) over a 10.5px label |
| Inactive | `--color-text-secondary`, weight 400 |
| Active | `--tint-ink`, weight 500, **no pill or background**; marked `aria-current="page"` |
| Badge | On the Action Center icon: min 16×16, `--color-status-danger-text`, white 10px / 700, offset top −6 / right −10; value = the queue size; absent when 0 or unknown |
| Content clearance | `.app-shell[data-tabbar='on'] .app-shell-content` reserves `1.5rem + 64px + env(safe-area-inset-bottom)` at the bottom so the last item is never hidden behind the bar |

"Active" is computed by `isNavItemActive()` (`nav-items.tsx`), not by `NavLink`, because a single `to` can't express a section: **Members** is also active on `/members/*`, and **Settings** on `/plans /branches /users /roles /audit-log /member-numbering` (every admin sub-screen carries `AdminTabs`). The same function drives the desktop sidebar.

### 3.3 Desktop sidebar (`SidebarNav.tsx`, `>= 768px`)

| Property | Value |
|---|---|
| Background | `--color-neutral-0`, `1px` right border `--color-border-default` |
| Width | `240px` fixed. Implemented as a CSS Grid column (`.app-shell { grid-template-columns: 240px 1fr }`, `height: 100dvh`), not literal `position: fixed` — same fixed width and full height, sidebar never scrolls independently |
| Brand | Logo + "Fit & Fine" at the top (there is no separate topbar at this width) |
| Active item | `--tint-on-pill` text on a `--tint-pill-bg` row, weight 600 |
| Inactive item | `--color-text-secondary` |
| Sign Out | A row pinned to the bottom of the sidebar, in `--color-status-danger-text` — the only way a staff user (who can't reach Settings) can sign out at this width |
| Badge | Action Center queue size, `--tint-solid` |

### 3.4 Tab-bar visibility is route data

Drill-in screens show a back link instead of the tab bar, and a form must not have a fixed bar sitting over the on-screen keyboard. This is declared on the route (`App.tsx`: `handle: { hideTabBar: true }`) and read in `AppShell` with `useMatches()` via `shouldHideTabBar()` (`lib/route-handle.ts`) — components never path-match to decide it.

| Shows the tab bar | Hides it (`hideTabBar`) |
|---|---|
| `/action-center`, `/`, `/reports`, `/settings`, and the admin sub-screens `/plans /branches /users /users/invite /roles /audit-log /member-numbering` | `/members/new`, `/members/:id`, `/members/:id/renew`, `/members/:id/edit` |

The handle only applies below 768px: at `>= 768px` the sidebar is always shown. Admin sub-screens keep the bar because each carries its own `AdminTabs` row and the bar shows Settings as active.

### 3.5 Tab/nav items

Same role-based visibility rule as the mobile app — see [navigation.md §Navigation Items](./navigation.md): Action Center, Members and Reports for all users, Settings (and its Plans/Branches/Users/Roles/Audit Log/Numbering sub-screens) for the `admin` role only.
