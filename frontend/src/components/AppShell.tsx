import { NavLink, Outlet } from 'react-router-dom';
import { Dumbbell } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { NAV_ITEMS } from './nav-items';
import { AppFooter } from './AppFooter';
import './AppShell.css';

/**
 * Wraps every authenticated route (see spec/frontend/app-shell.md §3) — mounted only
 * inside <RequireAuth> in App.tsx, so the nav bar/sidebar structurally cannot render for
 * a signed-out visitor; /login has no access to this component at all.
 *
 * No persistent topbar (per frontend/mockups/README.md) — the brand mark lives at the
 * top of the sidebar itself, and sign-out lives on the Settings hub's Account section.
 */
export function AppShell() {
  const { currentProfile } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || currentProfile?.roles.includes('admin'));

  return (
    <div className="app-shell">
      <nav className="app-shell-sidebar" aria-label="Main navigation">
        <div className="app-shell-brand-row">
          <span className="app-shell-logo-tile" aria-hidden="true">
            <Dumbbell size={18} strokeWidth={2} />
          </span>
          <span className="app-shell-brand">Fit &amp; Fine</span>
        </div>

        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `app-shell-nav-item${isActive ? ' app-shell-nav-item-active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="app-shell-main">
        <main className="app-shell-content">
          <Outlet />
        </main>
        <AppFooter />
      </div>

      <nav className="app-shell-tabbar" aria-label="Main navigation">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `app-shell-tab${isActive ? ' app-shell-tab-active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
