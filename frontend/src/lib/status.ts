import { todayDate } from './datetime';
import type { MemberListRow, MemberStatus } from '../types/member-list';

const EXPIRING_SOON_THRESHOLD_DAYS = 7;

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const fromUTC = Date.UTC(fy, fm - 1, fd);
  const toUTC = Date.UTC(ty, tm - 1, td);
  return Math.round((toUTC - fromUTC) / (1000 * 60 * 60 * 24));
}

/**
 * Client-side status derivation — unchanged authority, see
 * spec/backend/member-management.md §6 and spec/backend/business-logic.md §Member Status.
 * Uses the browser's local date (Timezone Rule), never a server-computed status column.
 */
export function deriveStatus(row: {
  current_membership_plan_id: number | null;
  current_membership_end_date: string | null;
}): MemberStatus {
  if (row.current_membership_plan_id === null) return 'expired';
  if (row.current_membership_end_date === null) return 'active';

  const daysRemaining = daysBetween(todayDate(), row.current_membership_end_date);
  if (daysRemaining > EXPIRING_SOON_THRESHOLD_DAYS) return 'active';
  if (daysRemaining >= 0) return 'expiring';
  return 'expired';
}

export const STATUS_LABEL: Record<MemberStatus, string> = {
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
};

export const STATUS_BADGE_CLASS: Record<MemberStatus, string> = {
  active: 'status-badge-active',
  expiring: 'status-badge-expiring',
  expired: 'status-badge-expired',
};

export function getMemberListRowStatus(row: MemberListRow): MemberStatus {
  return deriveStatus(row);
}
