// The ONE place a workbook column is named (spec/frontend/data-export-import.md §5, backend/data-export-import.md §3).
// Pure data in, plain tables out — no spreadsheet library here, so everything is unit-testable and the
// Phase 2 import reader can share these definitions.
//
// Fidelity rules (backend spec §3.2): ids and measurements are number cells; EVERYTHING else is written as a
// string cell — phone / Aadhaar / pincode / member_number (leading zeros survive), dates as the API's own
// YYYY-MM-DD text, timestamps verbatim with offset and microseconds (never round-tripped through a JS Date),
// and any user text starting with = + - @ (a string cell can never be a formula).

export type Row = Record<string, unknown>;
export type CellValue = string | number | null;

export const SCHEMA_VERSION = 1;
/** Excel's own cell limit; a longer value is truncated and counted (README "truncated_cells"). */
export const MAX_CELL_CHARS = 32767;
/** Excel allows 1,048,576 rows per sheet, one of which is the header. */
export const MAX_SHEET_DATA_ROWS = 1_048_575;

/** Server tables the export reads, in the order they are fetched (lookups first). Mirrors the Edge Function whitelist. */
export const EXPORT_TABLES = [
  'branches',
  'plans',
  'roles',
  'users',
  'user_roles',
  'configuration',
  'member_number_sequences',
  'members',
  'subscriptions',
  'subscription_items',
  'audit_log',
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];
export type ExportData = Record<ExportTable, Row[]>;

type Kind = 'text' | 'number' | 'boolean';

interface Lookups {
  branchCode: Map<number, string>;
  planName: Map<number, string>;
  memberPhone: Map<number, string>;
  userEmail: Map<string, string>;
  rolesByUser: Map<string, string>;
  /** member id -> photo entry name inside the photos zip. */
  photoFile: Map<number, string>;
}

interface ColumnDef {
  key: string;
  kind: Kind;
  width: number;
  /** Convenience columns computed from other tables; absent for plain database columns. */
  derive?: (row: Row, lookups: Lookups) => unknown;
}

const text = (key: string, width = 20, derive?: ColumnDef['derive']): ColumnDef => ({ key, kind: 'text', width, derive });
const num = (key: string, width = 12, derive?: ColumnDef['derive']): ColumnDef => ({ key, kind: 'number', width, derive });
const bool = (key: string, width = 12): ColumnDef => ({ key, kind: 'boolean', width });

/** `id` + audit + soft-delete columns every business table carries (backend spec §3.3 "info columns"). */
const INFO: ColumnDef[] = [
  num('id', 10),
  text('created_at', 30),
  text('created_by', 38),
  text('changed_at', 30),
  text('changed_by', 38),
  text('deleted_at', 30),
  text('deleted_by', 38),
];

interface SheetDef {
  name: string;
  source: ExportTable;
  columns: ColumnDef[];
}

const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export const SHEETS: SheetDef[] = [
  { name: 'Branches', source: 'branches', columns: [...INFO, text('name', 28), text('code', 12)] },
  {
    name: 'Plans',
    source: 'plans',
    columns: [...INFO, text('name', 28), text('category', 12), num('duration_days'), num('price'), num('max_members')],
  },
  { name: 'Roles', source: 'roles', columns: [...INFO, text('name', 20), text('description', 40)] },
  {
    name: 'Members',
    source: 'members',
    columns: [
      ...INFO,
      text('name', 28),
      text('phone', 14),
      text('date_of_birth', 14),
      text('date_of_joining', 16),
      text('gender', 10),
      num('weight_kg'),
      num('height_cm'),
      bool('under_doctor_care', 18),
      text('doctor_care_details', 30),
      text('emergency_contact_name', 24),
      text('emergency_contact_phone', 18),
      text('emergency_contact_relationship', 22),
      text('email', 28),
      text('residential_address', 36),
      text('pincode', 10),
      text('aadhaar_number', 16),
      text('occupation', 20),
      num('branch_id'),
      text('branch_code', 12, (row, l) => l.branchCode.get(row.branch_id as number)),
      text('member_number', 18),
      text('handled_by_staff', 38),
      text('handled_by_email', 28, (row, l) => l.userEmail.get(row.handled_by_staff as string)),
      text('photo_url', 36),
      text('photo_thumbnail_url', 36),
      text('photo_file', 24, (row, l) => l.photoFile.get(row.id as number)),
    ],
  },
  {
    name: 'Subscriptions',
    source: 'subscriptions',
    columns: [
      ...INFO,
      num('subscription_ref', 16, (row) => asNumber(row.id)),
      num('member_id'),
      text('member_phone', 14, (row, l) => l.memberPhone.get(row.member_id as number)),
      text('payment_mode', 14),
      text('notes', 36),
    ],
  },
  {
    name: 'SubscriptionItems',
    source: 'subscription_items',
    columns: [
      ...INFO,
      num('subscription_ref', 16, (row) => asNumber(row.subscription_id)),
      num('subscription_id', 16),
      num('plan_id'),
      text('plan_name', 24, (row, l) => l.planName.get(row.plan_id as number)),
      num('member_id'),
      text('member_phone', 14, (row, l) => l.memberPhone.get(row.member_id as number)),
      num('shared_member_id', 16),
      text('shared_member_phone', 18, (row, l) => l.memberPhone.get(row.shared_member_id as number)),
      text('start_date', 14),
      text('end_date', 14),
      num('quantity'),
      num('amount_paid'),
    ],
  },
  {
    name: 'Users',
    source: 'users',
    columns: [
      ...INFO,
      text('email', 30),
      text('full_name', 26),
      bool('is_active'),
      text('roles', 24, (row, l) => l.rolesByUser.get(row.id as string)),
    ],
  },
  {
    name: 'UserRoles',
    source: 'user_roles',
    columns: [text('user_id', 38), num('role_id'), text('granted_at', 30), text('granted_by', 38)],
  },
  {
    name: 'Configuration',
    source: 'configuration',
    columns: [
      text('key', 32),
      text('value', 16),
      text('description', 50),
      text('created_at', 30),
      text('created_by', 38),
      text('changed_at', 30),
      text('changed_by', 38),
    ],
  },
  { name: 'MemberNumberSequences', source: 'member_number_sequences', columns: [num('branch_id'), num('last_sequence', 16)] },
  {
    name: 'AuditLog',
    source: 'audit_log',
    columns: [
      num('id', 10),
      text('change_id', 38),
      text('table_name', 20),
      text('record_id', 38),
      text('field_name', 24),
      text('old_value', 30),
      text('new_value', 30),
      text('operation', 10),
      text('changed_by', 38),
      text('changed_at', 30),
    ],
  },
];

export interface BuiltSheet {
  name: string;
  headers: string[];
  rows: CellValue[][];
  widths: number[];
}

export interface BuildStats {
  /** Cells longer than MAX_CELL_CHARS that were cut. */
  truncatedCells: number;
  /** Cells that held characters a spreadsheet cannot store (see `stripUnstorable`) and had them removed. */
  cleanedCells: number;
}

// Characters XML 1.0 — and therefore .xlsx — cannot represent: control characters other than tab / LF / CR,
// U+FFFE / U+FFFF, and unpaired surrogates. The spreadsheet library drops them silently, which would alter a member's
// text without a word; stripping them here lets us count and report it. (No lookbehind: it is a syntax error on
// iOS < 16.4, and this module is part of the main bundle.)
const UNSTORABLE_QUICK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/;
const UNSTORABLE = /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function stripUnstorable(text: string): { text: string; removed: boolean } {
  if (!UNSTORABLE_QUICK.test(text)) return { text, removed: false };
  let removed = false;
  const cleaned = text.replace(UNSTORABLE, (_match, pair: string | undefined) => {
    if (pair) return pair; // a valid surrogate pair (an emoji) is kept
    removed = true;
    return '';
  });
  return { text: cleaned, removed };
}

/** One database value -> one cell, per its column kind. Pure. */
export function formatCell(value: unknown, kind: Kind, stats: BuildStats): CellValue {
  if (value === null || value === undefined) return null;
  if (kind === 'boolean') {
    if (value === true || value === 'true') return 'TRUE';
    if (value === false || value === 'false') return 'FALSE';
    return null;
  }
  if (kind === 'number') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return String(value); // unexpected shape: keep it visible rather than dropping it
  }
  const original = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const { text: raw, removed } = stripUnstorable(original);
  if (removed) stats.cleanedCells += 1;
  if (raw === '') return null;
  if (raw.length > MAX_CELL_CHARS) {
    stats.truncatedCells += 1;
    return raw.slice(0, MAX_CELL_CHARS);
  }
  return raw;
}

function buildLookups(data: ExportData, photoFiles: Map<number, string>): Lookups {
  const branchCode = new Map<number, string>();
  for (const b of data.branches) if (typeof b.id === 'number' && typeof b.code === 'string') branchCode.set(b.id, b.code);
  const planName = new Map<number, string>();
  for (const p of data.plans) if (typeof p.id === 'number' && typeof p.name === 'string') planName.set(p.id, p.name);
  const memberPhone = new Map<number, string>();
  for (const m of data.members) if (typeof m.id === 'number' && typeof m.phone === 'string') memberPhone.set(m.id, m.phone);
  const userEmail = new Map<string, string>();
  for (const u of data.users) if (typeof u.id === 'string' && typeof u.email === 'string') userEmail.set(u.id, u.email);

  const roleName = new Map<number, string>();
  for (const r of data.roles) if (typeof r.id === 'number' && typeof r.name === 'string') roleName.set(r.id, r.name);
  const names = new Map<string, string[]>();
  for (const ur of data.user_roles) {
    const user = asString(ur.user_id);
    const name = roleName.get(ur.role_id as number);
    if (user && name) names.set(user, [...(names.get(user) ?? []), name]);
  }
  const rolesByUser = new Map([...names].map(([user, list]) => [user, [...list].sort().join(', ')]));

  return { branchCode, planName, memberPhone, userEmail, rolesByUser, photoFile: photoFiles };
}

export interface BuildOptions {
  includeAuditLog: boolean;
  photoFiles: Map<number, string>;
  /** Rows per sheet before overflowing into `<Name>_2`. Defaults to Excel's limit; lowered only by tests. */
  maxSheetRows?: number;
}

export interface BuiltWorkbook {
  sheets: BuiltSheet[];
  /** Row count per sheet name as exported (AuditLog overflow sheets are summed under "AuditLog"). */
  counts: Record<string, number>;
  stats: BuildStats;
}

/** Turns the fetched tables into the data sheets, in workbook order. README is built separately (`buildReadme`). */
export function buildSheets(data: ExportData, options: BuildOptions): BuiltWorkbook {
  const stats: BuildStats = { truncatedCells: 0, cleanedCells: 0 };
  const lookups = buildLookups(data, options.photoFiles);
  const sheets: BuiltSheet[] = [];
  const counts: Record<string, number> = {};

  for (const def of SHEETS) {
    if (def.source === 'audit_log' && !options.includeAuditLog) continue;
    const source = data[def.source];
    const headers = def.columns.map((c) => c.key);
    const widths = def.columns.map((c) => c.width);
    const rows = source.map((row) =>
      def.columns.map((c) => formatCell(c.derive ? c.derive(row, lookups) : row[c.key], c.kind, stats))
    );
    counts[def.name] = rows.length;

    // Past Excel's row limit a sheet overflows into <Name>_2, <Name>_3 … (counts stay under the base name).
    const maxRows = options.maxSheetRows ?? MAX_SHEET_DATA_ROWS;
    const chunks = Math.max(1, Math.ceil(rows.length / maxRows));
    for (let i = 0; i < chunks; i += 1) {
      sheets.push({
        name: i === 0 ? def.name : `${def.name}_${i + 1}`,
        headers,
        rows: rows.slice(i * maxRows, (i + 1) * maxRows),
        widths,
      });
    }
  }
  return { sheets, counts, stats };
}

export interface ReadmeInfo {
  exportedAt: string;
  exportedBy: string;
  sourceProject: string;
  includeAuditLog: boolean;
  photoParts: number;
  counts: Record<string, number>;
  truncatedCells: number;
  cleanedCells: number;
  warnings: string[];
}

/**
 * The README sheet: `key | value` pairs up to the first blank row, then a `Sheet | Rows` table, then warnings and
 * notes. The layout is a contract — the Restore importer reads schema_version and the counts back from it.
 */
export function buildReadme(info: ReadmeInfo): BuiltSheet {
  const rows: CellValue[][] = [
    ['schema_version', SCHEMA_VERSION],
    ['exported_at', info.exportedAt],
    ['exported_by', info.exportedBy || null],
    ['source_project', info.sourceProject || null],
    ['include_audit_log', info.includeAuditLog ? 'TRUE' : 'FALSE'],
    ['photo_parts', info.photoParts],
    ['truncated_cells', info.truncatedCells],
    ['cleaned_cells', info.cleanedCells],
    [null, null],
    ['Sheet', 'Rows'],
    ...Object.entries(info.counts).map(([sheet, count]): CellValue[] => [sheet, count]),
    [null, null],
    ['Warnings', null],
    ...(info.warnings.length > 0 ? info.warnings.map((w): CellValue[] => [w, null]) : [['None', null] as CellValue[]]),
    [null, null],
    ['Notes', null],
    ['This file contains personal and medical data (names, phone and Aadhaar numbers, medical notes, emergency contacts, emails). Store it securely.', null],
    ['Passwords are never exported. Users restored from this file must use "Forgot password" to sign in.', null],
    ['Dates are YYYY-MM-DD text and timestamps are UTC ISO-8601 text — do not retype them.', null],
    ['Converting this workbook to CSV and opening it elsewhere can turn text starting with = + - or @ into a formula.', null],
  ];
  return { name: 'README', headers: ['item', 'value'], rows, widths: [60, 40] };
}
