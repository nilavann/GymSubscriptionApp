# Navigation Structure — Web Edition

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)

Uses **React Router** (createBrowserRouter). Do not hand-roll routing or use file-based routing conventions from the mobile app (`expo-router`) — they don't apply here.

---

## Route Map

```
/login                    →  Login screen (email/password + OAuth)
/reset-password           →  Reset Password (WSCR-13) — reached only via a password-reset
                              email link, or redirected here from anywhere else in the app
                              while a recovery session is pending

/                         →  Members List           [home, all users]
/reports                  →  Reports                 [all users]
/settings                 →  Settings hub             [admin only]

/members/new               →  Add New Member          [all users]
/members/:id                →  Member Detail            [all users]
/members/:id/renew          →  Renew Subscription       [all users]
/members/:id/edit           →  Edit Member Info         [all users]

/plans                     →  Manage Plans             [admin only]
/branches                  →  Manage Branches           [admin only]

/users                     →  Manage App Users          [admin only]
/users/invite               →  Invite New User           [admin only]
/roles                     →  Manage Roles              [admin only]

/audit-log                 →  Audit Log (view-only)     [admin only]
/member-numbering          →  Member Numbering          [admin only]
```

Unlike the mobile app's separate "modal" screens (`member/add`, `member/[id]/renew`, `member/[id]/edit` as modals), the web app renders these as regular routed pages. On desktop they may be presented as a centered dialog/panel over the previous page for continuity, but the URL always changes and the browser back button always works — a modal implementation must not break deep-linking or the back button.

---

## Entry Point Logic

On app load:
- If no Supabase session exists → redirect to `/login`.
- If a valid, active-profile session exists → redirect to `/` (Members List).
- If a password-recovery session is pending (`needsPasswordReset`, see [auth.md §4.3](./auth.md#43-reset-password-completion-req-auth-005)) → redirect to `/reset-password`, ahead of the two rules above.

Session state comes from `useAuth()` (see [app-shell.md](./app-shell.md)) — there is no manual `localStorage` key to check; `supabase-js` owns session persistence.

---

## Access Control

| Route prefix     | Who can access      |
|-------------------|----------------------|
| `/login`          | Anyone (redirects away if already signed in, unless a password-recovery session is pending) |
| `/reset-password` | Anyone with a pending password-recovery session; redirects everyone else away |
| `/`                | All signed-in, active users |
| `/reports`         | All signed-in, active users |
| `/settings`        | `admin` role only |
| `/members/*`       | All signed-in, active users |
| `/plans`           | `admin` role only |
| `/branches`        | `admin` role only |
| `/users*`          | `admin` role only |
| `/roles`           | `admin` role only |
| `/audit-log`       | `admin` role only, view-only (REQ-ADMIN-005) |
| `/member-numbering` | `admin` role only |

**Client-side route guards are UX only** — they prevent a staff user from *seeing* an admin page and give a fast redirect, but they are not the security boundary. The actual data protection is Supabase RLS (see [database.md](../backend/database.md)); even if a route guard were buggy, the underlying `plans`/`profiles` writes would still be rejected server-side for a non-admin.

If a `staff` user navigates to an admin-only route, show an inline "Access Denied" message in place — do not redirect away. (This doc previously said "redirect to `/`" here while its own code sample below never did; the actual, implemented behavior — an inline message with no navigation — is what's specified now, and is arguably better UX than yanking the user away from an explicit "why you can't see this.")

If a signed-in user's profile has `is_active = false` (deactivated while they had a session open), any subsequent navigation or data fetch fails (RLS blocks it) — the app must detect this (e.g. a 401/403 from Supabase) and force a sign-out with a "Your account has been deactivated" message, redirecting to `/login`.

### Route guard components

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

(`roles.includes('admin')`, not a single `role` field — `Profile.role` was replaced by a many-to-many `roles`/`user_roles` catalog; see [backend/domain-model.md §1a/§1b](../backend/domain-model.md).)

---

## Navigation Items (shared by mobile bottom bar and desktop sidebar)

See [app-shell.md §3](./app-shell.md#3-responsive-layout-shell-websrccomponentsappshelltsx) for how these render differently by breakpoint — the item list itself is one source of truth:

| Item      | Icon          | Route         | Visible to     |
|-----------|---------------|----------------|------------------|
| Members   | people icon   | `/`            | All users        |
| Reports   | bar-chart icon| `/reports`     | All users        |
| Settings  | settings/gear | `/settings`    | `admin` only     |

Staff users see 2 nav items. Admin users see 3.

Nav bar/sidebar background: `var(--color-surface-dark)` (`#0D0D0D`)
Active icon + label: `var(--color-text-brand)` (`#E8430A`)
Inactive icon + label: `var(--color-neutral-600)` (`#3A3A3A`)

Use any accessible icon set consistently across the app (e.g. `lucide-react`) — pick one and use it everywhere; this is an implementation choice, not a business rule, so it does not need to match the mobile app's `Ionicons`.
