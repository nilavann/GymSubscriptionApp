import { Users, BarChart3, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

export interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
  /** Restricts this item to the admin role — see spec/frontend/navigation.md §Navigation Items. */
  adminOnly?: boolean;
}

/**
 * Single source of truth for "what nav items exist and who can see them" — both the
 * mobile bottom tab bar and desktop sidebar render from this same list (§Navigation
 * Items, app-shell.md §3). Staff see 2 items; admins see all 3.
 *
 * Icons from lucide-react (rules.md rule 13 — the one lightweight icon set permitted
 * app-wide) — replaces the earlier hand-rolled inline SVGs now that a real icon set is in.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Members', path: '/', icon: <Users size={20} strokeWidth={2} /> },
  { label: 'Reports', path: '/reports', icon: <BarChart3 size={20} strokeWidth={2} /> },
  { label: 'Settings', path: '/settings', icon: <Settings size={20} strokeWidth={2} />, adminOnly: true },
];
