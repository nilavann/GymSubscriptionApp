import { supabase } from '../lib/supabase-client';
import type { AuditLogEntry } from '../types/audit-log';

const AUDIT_SELECT =
  'id, change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at' as const;

/**
 * Every table `audit_row_changes()` is actually attached to (REQ-AUDIT-001's six required
 * tables plus the two bonus ones from the roles/user_roles redesign) — see
 * spec/backend/domain-model.md §7 and 20260720000200_views_and_audit.sql /
 * 20260722000000_roles_and_user_roles.sql. `audit_log` itself is never in this list, since
 * it is the mechanism, not a table being audited.
 */
export const AUDITED_TABLES = [
  'members',
  'subscriptions',
  'subscription_items',
  'plans',
  'branches',
  'profiles',
  'roles',
  'user_roles',
] as const;

export interface AuditLogFilters {
  startDate: string;
  endDate: string;
  tableName: string | null;
  recordId: string | null;
  changedBy: string | null;
}

export interface AuditLogPage {
  rows: AuditLogEntry[];
  /** True if more rows exist beyond MAX_ROWS for this filter set - narrow the range/filters to see them. */
  truncated: boolean;
}

interface RawEntry {
  id: number;
  change_id: string;
  table_name: string;
  record_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  operation: 'insert' | 'update' | 'delete';
  changed_by: string | null;
  changed_at: string;
}

// EAV growth here has no retention/partitioning story yet (domain-model-review.md) - a wide
// unfiltered range on a long-lived app could return an unbounded number of rows. Capped and
// surfaced as `truncated` rather than silently returning a partial page with no indication.
const MAX_ROWS = 500;

function dedupe(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => id !== null)));
}

/** `dateStr` (YYYY-MM-DD) interpreted as the START of that day in the caller's LOCAL
 * timezone, converted to the UTC instant `changed_at` (a timestamptz) is compared against —
 * a bare `${dateStr}T00:00:00` (no offset) is parsed as local time per the Date spec, unlike
 * appending `Z`, which would silently use UTC midnight instead and shift the boundary by the
 * caller's UTC offset. */
function localDayStartUtc(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

/** Same as localDayStartUtc but for the END of the local day (23:59:59.999). */
function localDayEndUtc(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999`).toISOString();
}

/**
 * View-only (REQ-ADMIN-005) - admin-only read via `audit_log_select_admin` RLS, no
 * Edge Function needed, same reasoning as reportRepository's direct-read pattern. Flat
 * query + client-side join to `profiles` for the "changed by" display name, rather than a
 * Postgres-side nested select (same dynamic-select type-inference reason as
 * member.repository.ts/report.repository.ts).
 */
export const auditLogRepository = {
  /** Live row count for the Settings hub's Data Management card (screens.md WSCR-11). */
  async getCount(): Promise<number> {
    const { count, error } = await supabase.from('audit_log').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  },

  async getFiltered(filters: AuditLogFilters): Promise<AuditLogPage> {
    let query = supabase
      .from('audit_log')
      .select(AUDIT_SELECT)
      .gte('changed_at', localDayStartUtc(filters.startDate))
      .lte('changed_at', localDayEndUtc(filters.endDate))
      .order('changed_at', { ascending: false })
      .limit(MAX_ROWS + 1);

    if (filters.tableName) query = query.eq('table_name', filters.tableName);
    if (filters.recordId) query = query.eq('record_id', filters.recordId.trim());
    if (filters.changedBy) query = query.eq('changed_by', filters.changedBy);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown as RawEntry[];
    const truncated = rows.length > MAX_ROWS;
    const page = truncated ? rows.slice(0, MAX_ROWS) : rows;

    const changerIds = dedupe(page.map((r) => r.changed_by));
    const { data: profiles, error: profilesError } =
      changerIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', changerIds)
        : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameMap = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

    return {
      rows: page.map((r) => ({
        ...r,
        changed_by_name: r.changed_by ? nameMap.get(r.changed_by) ?? 'Deleted user' : 'System',
      })),
      truncated,
    };
  },
};

export type AuditLogRepository = typeof auditLogRepository;
