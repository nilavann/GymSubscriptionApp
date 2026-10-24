/** The reserved role behind permanent member delete (REQ-ADMIN-010). Seeded, never editable or deletable. */
export const SYSTEM_ADMIN_ROLE = 'system_admin';

/**
 * UX only — the server (`is_system_admin_user()`) is what actually enforces this. A system
 * admin holds `system_admin` on top of `admin`, so losing `admin` also loses the power.
 */
export function isSystemAdmin(roles: readonly string[] | null | undefined): boolean {
  return !!roles && roles.includes('admin') && roles.includes(SYSTEM_ADMIN_ROLE);
}
