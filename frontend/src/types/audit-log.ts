export type AuditOperation = 'insert' | 'update' | 'delete';

/**
 * One field-level change row from the shared `audit_log` table (REQ-AUDIT-001,
 * spec/backend/domain-model.md §7) — one row per changed field per save, joined
 * client-side with `profiles` for a human-readable `changed_by_name` the same way
 * reportRepository joins `subscription_items` with `members`/`plans`.
 */
export interface AuditLogEntry {
  id: number;
  change_id: string;
  table_name: string;
  record_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  operation: AuditOperation;
  changed_by: string | null;
  changed_by_name: string;
  changed_at: string;
}
