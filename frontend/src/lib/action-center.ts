import { useEffect, useState } from 'react';
import { todayDate, addDays, addMonths } from './datetime';
import { EXPIRING_SOON_THRESHOLD_DAYS } from './status';
import type { MemberListRepository } from '../repositories/member-list.repository';
import type { MemberListRow } from '../types/member-list';

const EXPIRED_WINDOW_MONTHS = 12;
const UPCOMING_WINDOW_DAYS = 30;

export type ExpiryTier = 'urgent' | 'soon' | 'expired';

/**
 * Action Center's query window (design_handoff_flexhub_v2/README.md §8): everything expiring
 * in the next 30 days plus everything that expired in the last 12 months. Computed from the
 * browser's local "today" (Timezone Rule, same as lib/status.ts) — never a server-computed
 * window, since the server doesn't know the client's local today.
 */
export function getActionCenterWindow(): { from: string; to: string } {
  const today = todayDate();
  return { from: addMonths(today, -EXPIRED_WINDOW_MONTHS), to: addDays(today, UPCOMING_WINDOW_DAYS) };
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const fromUTC = Date.UTC(fy, fm - 1, fd);
  const toUTC = Date.UTC(ty, tm - 1, td);
  return Math.round((toUTC - fromUTC) / (1000 * 60 * 60 * 24));
}

/**
 * Splits the repository's single ascending result set (bounded by getActionCenterWindow) into
 * the two tab result sets — upcoming stays ascending (soonest first), expired is reversed to
 * descending (most recently expired first), per README §8's "Two result sets" note.
 */
export function splitActionCenterQueue(rows: MemberListRow[]): {
  upcoming: MemberListRow[];
  expired: MemberListRow[];
} {
  const today = todayDate();
  const upcoming: MemberListRow[] = [];
  const expired: MemberListRow[] = [];
  for (const row of rows) {
    if (row.current_membership_end_date === null) continue;
    if (row.current_membership_end_date >= today) upcoming.push(row);
    else expired.push(row);
  }
  expired.reverse();
  return { upcoming, expired };
}

/** Relative expiry label + amber/red tier for a row's pill — one shared helper, not inline per component (README §8). */
export function getRelativeExpiryLabel(endDate: string): { text: string; tier: ExpiryTier } {
  const today = todayDate();
  const daysRemaining = daysBetween(today, endDate);

  if (daysRemaining >= 0) {
    const text =
      daysRemaining === 0 ? 'Expires today' : daysRemaining === 1 ? 'Expires tomorrow' : `Expires in ${daysRemaining} days`;
    return { text, tier: daysRemaining <= EXPIRING_SOON_THRESHOLD_DAYS ? 'urgent' : 'soon' };
  }

  const daysAgo = -daysRemaining;
  const text =
    daysAgo === 1
      ? 'Expired 1 day ago'
      : daysAgo < 60
        ? `Expired ${daysAgo} days ago`
        : `Expired ${Math.floor(daysAgo / 30)} months ago`;
  return { text, tier: 'expired' };
}

/**
 * Total Action Center queue size for the nav badge (AppShell) — same bounded query as the
 * page itself, never `getAll()`. Fails silently (no badge) rather than breaking navigation.
 *
 * The repository is a parameter (AppShell passes `useServices().memberListRepository`) rather
 * than an imported singleton, so tests can inject a fake — see CLAUDE.md layer rules. Call this
 * once at an always-mounted level and pass the count down; calling it from a branch that
 * remounts would refetch every time (CLAUDE.md "Responsive rendering rules" #3).
 */
export function useActionCenterCount(memberListRepository: MemberListRepository): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const { from, to } = getActionCenterWindow();
    memberListRepository
      .getActionCenterQueue({ from, to })
      .then((rows) => {
        if (active) setCount(rows.length);
      })
      .catch(() => {
        /* fails silently — no badge on error, navigation must never break */
      });
    return () => {
      active = false;
    };
  }, [memberListRepository]);

  return count;
}
