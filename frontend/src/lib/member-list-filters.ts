import { deriveStatus } from './status';
import type { MemberListRow, MemberStatus } from '../types/member-list';
import type { Gender } from '../types/member';

export type SortOption = 'join-date' | 'name' | 'expiry';
export type StatusPill = 'all' | MemberStatus;

export interface MemberListFilters {
  search: string;
  genders: Gender[];
  addonPlanIds: number[];
  planIds: number[];
}

/** REQ-LIST-002: substring match on name / member number / phone, case-insensitive, phone ignoring spaces. */
export function matchesSearch(row: MemberListRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\s+/g, '');
  return (
    row.name.toLowerCase().includes(q) ||
    row.member_number.toLowerCase().includes(q) ||
    row.phone.replace(/\s+/g, '').toLowerCase().includes(qDigits)
  );
}

/**
 * Every filter EXCEPT the status pill (REQ-LIST-002/004) — search, gender, add-on and plan
 * selections AND together. Feeds each pill's own count.
 */
export function filterBeforeStatus(rows: MemberListRow[], filters: MemberListFilters): MemberListRow[] {
  let result = rows.filter((row) => matchesSearch(row, filters.search));
  if (filters.genders.length > 0) {
    result = result.filter((row) => filters.genders.includes(row.gender));
  }
  if (filters.addonPlanIds.length > 0) {
    result = result.filter((row) => row.current_addon_plan_ids.some((id) => filters.addonPlanIds.includes(id)));
  }
  if (filters.planIds.length > 0) {
    result = result.filter(
      (row) => row.current_membership_plan_id !== null && filters.planIds.includes(row.current_membership_plan_id)
    );
  }
  return result;
}

/** REQ-LIST-003: single-select pill over the derived status. */
export function applyStatusPill(rows: MemberListRow[], pill: StatusPill): MemberListRow[] {
  return pill === 'all' ? rows : rows.filter((row) => deriveStatus(row) === pill);
}

export function statusPillCounts(rowsBeforeStatusFilter: MemberListRow[]): Record<StatusPill, number> {
  const counts: Record<StatusPill, number> = { all: rowsBeforeStatusFilter.length, active: 0, expiring: 0, expired: 0 };
  for (const row of rowsBeforeStatusFilter) {
    counts[deriveStatus(row)] += 1;
  }
  return counts;
}

/** REQ-LIST-001: join date descending by default; name ascending; expiry ascending with no-end-date (indefinite/none) last. */
export function sortMembers(rows: MemberListRow[], sort: SortOption): MemberListRow[] {
  const sorted = [...rows];
  if (sort === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'expiry') {
    sorted.sort((a, b) => {
      if (a.current_membership_end_date === null) return 1;
      if (b.current_membership_end_date === null) return -1;
      return a.current_membership_end_date.localeCompare(b.current_membership_end_date);
    });
  } else {
    sorted.sort((a, b) => b.date_of_joining.localeCompare(a.date_of_joining));
  }
  return sorted;
}
