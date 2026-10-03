import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './BackLink.css';

interface BackLinkProps {
  /** Where "back" goes. A real route, not history -1: it must work when the screen was opened by a deep link. */
  to: string;
  /** The visible label, e.g. "Members" — an arrow alone is not a label. */
  children: ReactNode;
}

/**
 * The back control of every drill-in screen (member detail / renew / add / edit). Those routes hide
 * the mobile tab bar (`handle: { hideTabBar }`), so this is how a phone user gets out — it must be a
 * real 44px touch target with a text label (design_handoff_flexhub_mobile/README.md §Interactions).
 * Replaces three one-off versions, one of which was a 32px icon-only button.
 */
export function BackLink({ to, children }: BackLinkProps) {
  return (
    <Link to={to} className="back-link">
      <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
      {children}
    </Link>
  );
}
