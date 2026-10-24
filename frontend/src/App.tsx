import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, type RouteObject } from 'react-router-dom';
import { ServicesProvider } from './context/services.context';
import { AuthProvider } from './context/auth.context';
import { ThemeProvider } from './context/theme.context';
import { RequireAuth } from './components/RequireAuth';
import { RequireAdmin } from './components/RequireAdmin';
import { AppShell } from './components/AppShell';
import { LoadingView } from './components/LoadingView';
import { ChunkLoadErrorBoundary } from './components/ChunkLoadErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import type { RouteHandle } from './lib/route-handle';

// Every page below is code-split (rules.md rule 32 / performance.md) — a named-export
// remap is needed because React.lazy only supports default exports and this app's pages
// are named exports throughout. LoginPage and AppShell are the deliberate exceptions
// (performance.md §2.4): LoginPage is the first thing an unauthenticated visitor needs,
// and AppShell is needed on every authenticated route, so lazy-loading either only adds
// a round-trip for zero splitting benefit.
const ActionCenterPage = lazy(() => import('./pages/ActionCenterPage').then((m) => ({ default: m.ActionCenterPage })));
const MembersListPage = lazy(() => import('./pages/MembersListPage').then((m) => ({ default: m.MembersListPage })));
const AddMemberPage = lazy(() => import('./pages/AddMemberPage').then((m) => ({ default: m.AddMemberPage })));
const MemberDetailPage = lazy(() => import('./pages/MemberDetailPage').then((m) => ({ default: m.MemberDetailPage })));
const RenewSubscriptionPage = lazy(() =>
  import('./pages/RenewSubscriptionPage').then((m) => ({ default: m.RenewSubscriptionPage }))
);
const ManagePlansPage = lazy(() => import('./pages/ManagePlansPage').then((m) => ({ default: m.ManagePlansPage })));
const ManageBranchesPage = lazy(() => import('./pages/ManageBranchesPage').then((m) => ({ default: m.ManageBranchesPage })));
const ManageRolesPage = lazy(() => import('./pages/ManageRolesPage').then((m) => ({ default: m.ManageRolesPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ManageUsersPage = lazy(() => import('./pages/ManageUsersPage').then((m) => ({ default: m.ManageUsersPage })));
const InviteUserPage = lazy(() => import('./pages/InviteUserPage').then((m) => ({ default: m.InviteUserPage })));
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const AuditLogPage = lazy(() => import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const MemberNumberingPage = lazy(() =>
  import('./pages/MemberNumberingPage').then((m) => ({ default: m.MemberNumberingPage }))
);

// Drill-in screens (a member's detail / renew / edit, and Add Member) hide the mobile bottom tab bar
// and show a back link instead; AppShell reads this with useMatches() (CLAUDE.md "Responsive
// rendering rules" #4). Has no effect at >= 768px, where navigation is the sidebar.
const drillIn: RouteHandle = { hideTabBar: true };

// Route map per spec/frontend/navigation.md §Route Map. AppShell (and therefore the
// nav bar/sidebar, app-shell.md §3) is mounted only inside <RequireAuth> below, so it
// structurally cannot render for a signed-out visitor — /login sits outside this
// subtree entirely and never sees it.
// Exported (rather than only handed to createBrowserRouter) so App.test.tsx can assert the table's invariants:
// which routes hide the tab bar, which are admin-guarded, and that /login sits outside the shell.
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  // Outside <RequireAuth>/<AppShell> deliberately, same as /login - a password-recovery
  // session (see ResetPasswordPage) must land on a bare screen with no nav chrome, since
  // it isn't allowed to do anything else in the app until the password is actually set.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <MembersListPage /> },
      { path: '/action-center', element: <ActionCenterPage /> },
      { path: '/reports', element: <ReportsPage /> },
      {
        path: '/settings',
        element: (
          <RequireAdmin>
            <SettingsPage />
          </RequireAdmin>
        ),
      },
      { path: '/members/new', element: <AddMemberPage />, handle: drillIn },
      { path: '/members/:id', element: <MemberDetailPage />, handle: drillIn },
      { path: '/members/:id/renew', element: <RenewSubscriptionPage />, handle: drillIn },
      { path: '/members/:id/edit', element: <MemberDetailPage />, handle: drillIn },
      {
        path: '/plans',
        element: (
          <RequireAdmin>
            <ManagePlansPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/branches',
        element: (
          <RequireAdmin>
            <ManageBranchesPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/users',
        element: (
          <RequireAdmin>
            <ManageUsersPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/roles',
        element: (
          <RequireAdmin>
            <ManageRolesPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/users/invite',
        element: (
          <RequireAdmin>
            <InviteUserPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/audit-log',
        element: (
          <RequireAdmin>
            <AuditLogPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/member-numbering',
        element: (
          <RequireAdmin>
            <MemberNumberingPage />
          </RequireAdmin>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/action-center" replace /> },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <ThemeProvider>
      <ServicesProvider>
        <AuthProvider>
          <ChunkLoadErrorBoundary>
            <Suspense fallback={<LoadingView />}>
              {/* Every page is lazy. Without startTransition a navigation that suspends on its chunk replaces the
                  whole app with <LoadingView />, and Back pressed before that chunk arrives leaves the OLD screen
                  rendered under the new URL. With it the current screen stays up until the next one is ready, and a
                  newer navigation supersedes a pending one (e2e/navigation-race.spec.ts). */}
              <RouterProvider router={router} future={{ v7_startTransition: true }} />
            </Suspense>
          </ChunkLoadErrorBoundary>
        </AuthProvider>
      </ServicesProvider>
    </ThemeProvider>
  );
}
