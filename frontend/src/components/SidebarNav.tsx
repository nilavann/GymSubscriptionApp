import { Link, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/auth.context';
import { getNavBadge, isNavItemActive, type NavItem } from './nav-items';
import logo from '../assets/logo.png';

interface SidebarNavProps {
  items: NavItem[];
  /** Fetched once by AppShell (CLAUDE.md "Responsive rendering rules" #3) and passed down. */
  actionCenterCount: number | null;
}

/**
 * Desktop/tablet navigation (>= 768px): brand mark, the nav items, and Sign Out pinned to the
 * bottom. Rendered INSTEAD OF the mobile header + tab bar, never alongside them. Sign Out lives
 * here too because Settings is admin-only — this is the only way a staff user can sign out at
 * this width (on a phone it is the header's account menu).
 */
export function SidebarNav({ items, actionCenterCount }: SidebarNavProps) {
  const { signOut } = useAuth();
  const { pathname } = useLocation();

  return (
    <nav className="app-shell-sidebar" aria-label="Main navigation">
      <div className="app-shell-brand-row">
        <img src={logo} alt="" className="app-shell-logo" aria-hidden="true" />
        <span className="app-shell-brand">Fit &amp; Fine</span>
      </div>

      {items.map((item) => {
        const active = isNavItemActive(item, pathname);
        const badge = getNavBadge(item, actionCenterCount);
        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={active ? 'page' : undefined}
            className={`app-shell-nav-item${active ? ' app-shell-nav-item-active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
            {badge !== null && <span className="app-shell-nav-badge">{badge}</span>}
          </Link>
        );
      })}

      <button type="button" className="app-shell-nav-item app-shell-signout-button" onClick={() => signOut()}>
        <LogOut size={20} strokeWidth={2} />
        <span>Sign Out</span>
      </button>
    </nav>
  );
}
