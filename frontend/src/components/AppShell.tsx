import { NavLink, Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { NAV_ITEMS } from './nav-items';
import './AppShell.css';

/**
 * Wraps every authenticated route (see spec/frontend/app-shell.md §3) — mounted only
 * inside <RequireAuth> in App.tsx, so the nav bar/sidebar structurally cannot render for
 * a signed-out visitor; /login has no access to this component at all.
 */
export function AppShell() {
  const { currentProfile, signOut } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || currentProfile?.roles.includes('admin'));

  return (
    <div className="app-shell">
      <header className="app-shell-topbar">
        <span className="app-shell-brand">Fit &amp; Fine</span>
        <div className="app-shell-topbar-right">
          <span className="app-shell-user">{currentProfile?.full_name}</span>
          <button type="button" className="app-shell-signout" onClick={() => signOut()}>
            <LogOut size={16} strokeWidth={2} />
            Sign out
          </button>
        </div>
      </header>

      <nav className="app-shell-sidebar" aria-label="Main navigation">
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

      <main className="app-shell-content">
        <Outlet />
      </main>

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
