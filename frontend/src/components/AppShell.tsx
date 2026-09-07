import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/auth.context';
import { useActionCenterCount } from '../lib/action-center';
import { NAV_ITEMS } from './nav-items';
import { AppFooter } from './AppFooter';
import logo from '../assets/logo.png';
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
  const actionCenterCount = useActionCenterCount();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || currentProfile?.roles.includes('admin'));

  function badgeFor(path: string): number | null {
    return path === '/action-center' && actionCenterCount ? actionCenterCount : null;
  }

  return (
    <div className="app-shell">
      <nav className="app-shell-sidebar" aria-label="Main navigation">
        <div className="app-shell-brand-row">
          <img src={logo} alt="" className="app-shell-logo" aria-hidden="true" />
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
            {badgeFor(item.path) !== null && <span className="app-shell-nav-badge">{badgeFor(item.path)}</span>}
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
            <span className="app-shell-tab-icon-wrap">
              {item.icon}
              {badgeFor(item.path) !== null && <span className="app-shell-nav-badge app-shell-nav-badge-tab">{badgeFor(item.path)}</span>}
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
