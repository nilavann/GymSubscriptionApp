import { ListChecks, Users, BarChart3, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../context/auth.context';

export interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
  /** Restricts this item to the admin role — see spec/frontend/navigation.md §Navigation Items. */
  adminOnly?: boolean;
  /**
   * Other route prefixes that belong to this item, so it stays highlighted on its sub-screens
   * (e.g. Settings on /plans, /users…, Members on /members/:id). Matched on whole path segments.
   */
  matchPrefixes?: string[];
}

/**
 * Single source of truth for "what nav items exist and who can see them" — both the
 * mobile bottom tab bar and desktop sidebar render from this same list (§Navigation
 * Items, app-shell.md §3). Staff see 3 items; admins see all 4.
 *
 * Icons from lucide-react (rules.md rule 13 — the one lightweight icon set permitted
 * app-wide) — replaces the earlier hand-rolled inline SVGs now that a real icon set is in.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Action Center', path: '/action-center', icon: <ListChecks size={20} strokeWidth={2} /> },
  { label: 'Members', path: '/', icon: <Users size={20} strokeWidth={2} />, matchPrefixes: ['/members'] },
  { label: 'Reports', path: '/reports', icon: <BarChart3 size={20} strokeWidth={2} /> },
  {
    label: 'Settings',
    path: '/settings',
    icon: <Settings size={20} strokeWidth={2} />,
    adminOnly: true,
    // Every admin sub-screen carries <AdminTabs/>, so they live "under" Settings.
    matchPrefixes: ['/plans', '/branches', '/users', '/roles', '/audit-log', '/member-numbering'],
  },
];

/** Items the given roles may see. Pure — the hook below just feeds it the signed-in profile. */
export function getVisibleNavItems(roles: readonly string[] | undefined): NavItem[] {
  const isAdmin = roles?.includes('admin') ?? false;
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}

export function useVisibleNavItems(): NavItem[] {
  const { currentProfile } = useAuth();
  return getVisibleNavItems(currentProfile?.roles);
}

/** The Action Center item shows the queue size; every other item has no badge. */
export function getNavBadge(item: NavItem, actionCenterCount: number | null): number | null {
  return item.path === '/action-center' && actionCenterCount ? actionCenterCount : null;
}

const underPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Whether `item` is the current section. NavLink's own matching only knows one path, so a
 * sub-screen (Members > a member's detail; Settings > Plans) would leave nothing highlighted.
 * `/` is special-cased: it is a prefix of every path, so it only matches itself exactly.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const own = item.path === '/' ? pathname === '/' : underPrefix(pathname, item.path);
  return own || (item.matchPrefixes ?? []).some((prefix) => underPrefix(pathname, prefix));
}
