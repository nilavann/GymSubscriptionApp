import { Link, useLocation } from 'react-router-dom';
import { getNavBadge, isNavItemActive, type NavItem } from './nav-items';

interface TabBarProps {
  items: NavItem[];
  /** Fetched once by AppShell (CLAUDE.md "Responsive rendering rules" #3) and passed down. */
  actionCenterCount: number | null;
}

/**
 * Mobile bottom tab bar (< 768px) — design_handoff_flexhub_mobile/README.md §Mobile shell. Shown on
 * Action Center, Members, Reports and (for admins) Settings; AppShell leaves it out entirely on
 * drill-in routes (`handle: { hideTabBar }`) and at >= 768px. There is deliberately no Sign Out tab:
 * that lives in the header's account menu, so the bar stays at the mockup's three or four items.
 */
export function TabBar({ items, actionCenterCount }: TabBarProps) {
  const { pathname } = useLocation();

  return (
    <nav className="app-shell-tabbar" aria-label="Main navigation">
      {items.map((item) => {
        const active = isNavItemActive(item, pathname);
        const badge = getNavBadge(item, actionCenterCount);
        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={active ? 'page' : undefined}
            className={`app-shell-tab${active ? ' app-shell-tab-active' : ''}`}
          >
            <span className="app-shell-tab-icon-wrap">
              {item.icon}
              {badge !== null && <span className="app-shell-nav-badge app-shell-nav-badge-tab">{badge}</span>}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
