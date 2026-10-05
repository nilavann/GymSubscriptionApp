import { describe, expect, it } from 'vitest';
import {
  EXPORT_TABLES,
  MAX_CELL_CHARS,
  SCHEMA_VERSION,
  buildReadme,
  buildSheets,
  formatCell,
  stripUnstorable,
  type ExportData,
  type Row,
} from './workbook-schema';

const INFO = ['id', 'created_at', 'created_by', 'changed_at', 'changed_by', 'deleted_at', 'deleted_by'];

// The workbook contract (spec/backend/data-export-import.md §3.3): these lists ARE the header rows. Changing a
// column here is a format change that Restore/Merge readers depend on — it must be a conscious edit of the spec too.
const EXPECTED_HEADERS: Record<string, string[]> = {
  Branches: [...INFO, 'name', 'code'],
  Plans: [...INFO, 'name', 'category', 'duration_days', 'price', 'max_members'],
  Roles: [...INFO, 'name', 'description'],
  Members: [
    ...INFO,
    'name', 'phone', 'date_of_birth', 'date_of_joining', 'gender', 'weight_kg', 'height_cm', 'under_doctor_care',
    'doctor_care_details', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
    'email', 'residential_address', 'pincode', 'aadhaar_number', 'occupation', 'branch_id', 'branch_code',
    'member_number', 'handled_by_staff', 'handled_by_email', 'photo_url', 'photo_thumbnail_url', 'photo_file',
  ],
  Subscriptions: [...INFO, 'subscription_ref', 'member_id', 'member_phone', 'payment_mode', 'notes'],
  SubscriptionItems: [
    ...INFO,
    'subscription_ref', 'subscription_id', 'plan_id', 'plan_name', 'member_id', 'member_phone', 'shared_member_id',
    'shared_member_phone', 'start_date', 'end_date', 'quantity', 'amount_paid',
  ],
  Users: [...INFO, 'email', 'full_name', 'is_active', 'roles'],
  UserRoles: ['user_id', 'role_id', 'granted_at', 'granted_by'],
  Configuration: ['key', 'value', 'description', 'created_at', 'created_by', 'changed_at', 'changed_by'],
  MemberNumberSequences: ['branch_id', 'last_sequence'],
  AuditLog: ['id', 'change_id', 'table_name', 'record_id', 'field_name', 'old_value', 'new_value', 'operation', 'changed_by', 'changed_at'],
};

const TS = '2026-01-15T10:11:12.123456+00:00';

function emptyData(): ExportData {
  return Object.fromEntries(EXPORT_TABLES.map((t) => [t, [] as Row[]])) as ExportData;
}

/** A small but complete dataset: one of everything, incl. a soft-deleted member and an unmatched reference. */
function sampleData(): ExportData {
  const data = emptyData();
  data.branches = [{ id: 1, name: 'Main', code: 'MUM', created_at: TS, created_by: 'u1' }];
  data.plans = [
    { id: 10, name: 'Monthly', category: 'membership', duration_days: 30, price: 1000, max_members: 1 },
    { id: 11, name: 'Membership Fee', category: 'addon', duration_days: null, price: 500, max_members: 1 },
  ];
  data.roles = [
    { id: 1, name: 'admin', description: 'Everything' },
    { id: 2, name: 'staff', description: null },
  ];
  data.users = [
    { id: 'u1', email: 'asha@example.com', full_name: 'Asha', is_active: true },
    { id: 'u2', email: 'ravi@example.com', full_name: 'Ravi', is_active: false, deleted_at: TS, deleted_by: 'u1' },
    { id: 'u3', email: null, full_name: 'No Roles', is_active: true },
  ];
  data.user_roles = [
    { user_id: 'u1', role_id: 2, granted_at: TS, granted_by: null },
    { user_id: 'u1', role_id: 1, granted_at: TS, granted_by: null },
    { user_id: 'u2', role_id: 2, granted_at: TS, granted_by: 'u1' },
  ];
  data.configuration = [{ key: 'member_number_padding_width', value: '4', description: 'pad', created_at: TS }];
  data.member_number_sequences = [{ branch_id: 1, last_sequence: 42 }];
  data.members = [
    {
      id: 5, name: 'Meera', phone: '0987654321', date_of_birth: '1990-05-01', date_of_joining: '2026-01-15', gender: 'Female',
      weight_kg: 62.5, height_cm: 160, under_doctor_care: true, doctor_care_details: '=HYPERLINK("x")', emergency_contact_name: 'Raj',
      emergency_contact_phone: '0123456789', emergency_contact_relationship: 'Spouse', email: null, residential_address: '+91 Road',
      pincode: '012345', aadhaar_number: '000011112222', occupation: '', branch_id: 1, member_number: 'MUM-2026-0001',
      handled_by_staff: 'u1', photo_url: '5/original-1.jpg', photo_thumbnail_url: '5/thumbnail-1.jpg', created_at: TS, created_by: 'u1',
    },
    {
      id: 6, name: 'Gone', phone: '1111111111', date_of_birth: '1980-01-01', date_of_joining: '2025-01-01', gender: 'Male', weight_kg: 80,
      height_cm: 170, under_doctor_care: false, emergency_contact_name: 'X', emergency_contact_phone: '2222222222',
      emergency_contact_relationship: 'Friend', branch_id: 99, member_number: 'MUM-2025-0009', handled_by_staff: 'ghost',
      deleted_at: TS, deleted_by: 'u1',
    },
  ];
  data.subscriptions = [{ id: 7, member_id: 5, payment_mode: 'UPI', notes: null }];
  data.subscription_items = [
    { id: 8, subscription_id: 7, plan_id: 10, member_id: 5, shared_member_id: null, start_date: '2026-01-15', end_date: '2026-02-13', quantity: 1, amount_paid: 1000 },
    { id: 9, subscription_id: 7, plan_id: 11, member_id: 5, shared_member_id: 6, start_date: '2026-01-15', end_date: null, quantity: 1, amount_paid: '500.00' },
  ];
  data.audit_log = [
    { id: 1, change_id: 'c1', table_name: 'members', record_id: '5', field_name: 'name', old_value: null, new_value: 'Meera', operation: 'insert', changed_by: 'u1', changed_at: TS },
  ];
  return data;
}

const build = (data = sampleData(), extra: { photoFiles?: Map<number, string>; includeAuditLog?: boolean; maxSheetRows?: number } = {}) =>
  buildSheets(data, { includeAuditLog: true, photoFiles: new Map(), ...extra });
const sheet = (built: ReturnType<typeof build>, name: string) => {
  const found = built.sheets.find((s) => s.name === name);
  if (!found) throw new Error(`no sheet ${name}`);
  return found;
};
const cell = (built: ReturnType<typeof build>, sheetName: string, rowIndex: number, header: string) => {
  const s = sheet(built, sheetName);
  return s.rows[rowIndex][s.headers.indexOf(header)];
};

describe('workbook contract — sheets and headers (backend spec §3.3)', () => {
  it('has the documented data sheets, in order', () => {
    expect(build().sheets.map((s) => s.name)).toEqual(Object.keys(EXPECTED_HEADERS));
  });

  it.each(Object.entries(EXPECTED_HEADERS))('%s has exactly the documented headers', (name, headers) => {
    expect(sheet(build(), name).headers).toEqual(headers);
  });

  it('every row has exactly as many cells as the sheet has headers, and widths match too', () => {
    for (const s of build().sheets) {
      expect(s.widths).toHaveLength(s.headers.length);
      for (const row of s.rows) expect(row).toHaveLength(s.headers.length);
    }
  });

  it('puts the info columns first on every business sheet', () => {
    for (const name of ['Branches', 'Plans', 'Roles', 'Members', 'Subscriptions', 'SubscriptionItems', 'Users']) {
      expect(sheet(build(), name).headers.slice(0, INFO.length), name).toEqual(INFO);
    }
  });

  it('omits the AuditLog sheet (and its count) when the audit log is not included', () => {
    const built = build(sampleData(), { includeAuditLog: false });
    expect(built.sheets.map((s) => s.name)).not.toContain('AuditLog');
    expect(built.counts).not.toHaveProperty('AuditLog');
  });

  it('counts the rows of every exported sheet, soft-deleted rows included', () => {
    expect(build().counts).toEqual({
      Branches: 1, Plans: 2, Roles: 2, Members: 2, Subscriptions: 1, SubscriptionItems: 2, Users: 3, UserRoles: 3,
      Configuration: 1, MemberNumberSequences: 1, AuditLog: 1,
    });
  });

  it('an empty database still yields every sheet with just its headers', () => {
    const built = build(emptyData());
    expect(built.sheets).toHaveLength(Object.keys(EXPECTED_HEADERS).length);
    for (const s of built.sheets) expect(s.rows).toEqual([]);
  });
});

describe('cell fidelity (backend spec §3.2)', () => {
  it('keeps phone, Aadhaar, pincode and member number as TEXT — leading zeros survive', () => {
    const built = build();
    expect(cell(built, 'Members', 0, 'phone')).toBe('0987654321');
    expect(cell(built, 'Members', 0, 'emergency_contact_phone')).toBe('0123456789');
    expect(cell(built, 'Members', 0, 'pincode')).toBe('012345');
    expect(cell(built, 'Members', 0, 'aadhaar_number')).toBe('000011112222');
    expect(cell(built, 'Members', 0, 'member_number')).toBe('MUM-2026-0001');
  });

  it('ids and measurements are numbers; booleans are TRUE/FALSE text; absent values are empty', () => {
    const built = build();
    expect(cell(built, 'Members', 0, 'id')).toBe(5);
    expect(cell(built, 'Members', 0, 'weight_kg')).toBe(62.5);
    expect(cell(built, 'Members', 0, 'branch_id')).toBe(1);
    expect(cell(built, 'Members', 0, 'under_doctor_care')).toBe('TRUE');
    expect(cell(built, 'Members', 1, 'under_doctor_care')).toBe('FALSE');
    expect(cell(built, 'Members', 0, 'email')).toBeNull();
    expect(cell(built, 'Members', 0, 'occupation')).toBeNull(); // '' and null both export as an empty cell
    expect(cell(built, 'Users', 0, 'is_active')).toBe('TRUE');
  });

  it('timestamps and dates are written verbatim — microseconds and offset kept, never re-formatted', () => {
    const built = build();
    expect(cell(built, 'Branches', 0, 'created_at')).toBe(TS);
    expect(cell(built, 'Members', 0, 'date_of_birth')).toBe('1990-05-01');
    expect(cell(built, 'SubscriptionItems', 0, 'end_date')).toBe('2026-02-13');
    expect(cell(built, 'SubscriptionItems', 1, 'end_date')).toBeNull(); // indefinite
  });

  it('user text that looks like a formula is kept as plain text for the writer to store as a string cell', () => {
    const built = build();
    expect(cell(built, 'Members', 0, 'doctor_care_details')).toBe('=HYPERLINK("x")');
    expect(cell(built, 'Members', 0, 'residential_address')).toBe('+91 Road');
  });

  it('a numeric column given a numeric string (PostgREST numeric) becomes a number', () => {
    expect(cell(build(), 'SubscriptionItems', 1, 'amount_paid')).toBe(500);
  });

  it('soft-deleted rows are exported, with their deleted_at / deleted_by', () => {
    const built = build();
    expect(cell(built, 'Members', 1, 'name')).toBe('Gone');
    expect(cell(built, 'Members', 1, 'deleted_at')).toBe(TS);
    expect(cell(built, 'Members', 1, 'deleted_by')).toBe('u1');
    expect(cell(built, 'Members', 0, 'deleted_at')).toBeNull();
    expect(cell(built, 'Users', 1, 'deleted_at')).toBe(TS);
  });
});

describe('convenience columns derived from other tables', () => {
  it('Members: branch_code, handled_by_email and photo_file; unresolved references are empty, not errors', () => {
    const built = build(sampleData(), { photoFiles: new Map([[5, 'MUM-2026-0001.png']]) });
    expect(cell(built, 'Members', 0, 'branch_code')).toBe('MUM');
    expect(cell(built, 'Members', 0, 'handled_by_email')).toBe('asha@example.com');
    expect(cell(built, 'Members', 0, 'photo_file')).toBe('MUM-2026-0001.png');
    expect(cell(built, 'Members', 1, 'branch_code')).toBeNull(); // branch 99 does not exist
    expect(cell(built, 'Members', 1, 'handled_by_email')).toBeNull();
    expect(cell(built, 'Members', 1, 'photo_file')).toBeNull();
  });

  it('Subscriptions: subscription_ref is the subscription id and member_phone comes from the member', () => {
    const built = build();
    expect(cell(built, 'Subscriptions', 0, 'subscription_ref')).toBe(7);
    expect(cell(built, 'Subscriptions', 0, 'member_phone')).toBe('0987654321');
  });

  it('SubscriptionItems: plan_name, member_phone and shared_member_phone', () => {
    const built = build();
    expect(cell(built, 'SubscriptionItems', 0, 'subscription_ref')).toBe(7);
    expect(cell(built, 'SubscriptionItems', 0, 'plan_name')).toBe('Monthly');
    expect(cell(built, 'SubscriptionItems', 0, 'member_phone')).toBe('0987654321');
    expect(cell(built, 'SubscriptionItems', 0, 'shared_member_phone')).toBeNull();
    expect(cell(built, 'SubscriptionItems', 1, 'plan_name')).toBe('Membership Fee');
    expect(cell(built, 'SubscriptionItems', 1, 'shared_member_phone')).toBe('1111111111'); // a deleted member still resolves
  });

  it('Users: roles are the role names, sorted and comma-separated; a user with none is empty', () => {
    const built = build();
    expect(cell(built, 'Users', 0, 'roles')).toBe('admin, staff');
    expect(cell(built, 'Users', 1, 'roles')).toBe('staff');
    expect(cell(built, 'Users', 2, 'roles')).toBeNull();
  });
});

describe('stripUnstorable — characters a spreadsheet cannot hold are removed (and counted), not silently lost', () => {
  it.each([
    ['plain text', 'Asha Rao', 'Asha Rao', false],
    ['tab, newline and carriage return are legal and kept', 'a\tb\nc\rd', 'a\tb\nc\rd', false],
    ['NUL', 'a\u0000b', 'ab', true],
    ['SOH control character', 'a\u0001b', 'ab', true],
    ['vertical tab', 'a\u000Bb', 'ab', true],
    ['form feed', 'a\u000Cb', 'ab', true],
    ['escape', 'a\u001Bb', 'ab', true],
    ['U+FFFE', 'a￾b', 'ab', true],
    ['an unpaired high surrogate', 'a\uD800b', 'ab', true],
    ['an unpaired low surrogate', 'a\uDC00b', 'ab', true],
    ['a valid surrogate pair (an emoji) is kept', 'gym 💪', 'gym 💪', false],
    ['an emoji next to a stray surrogate keeps the emoji only', '💪\uD800', '💪', true],
    ['Devanagari and accented text is untouched', 'आशा Müller', 'आशा Müller', false],
    ['a literal _x0001_ is just text', 'a_x0001_b', 'a_x0001_b', false],
    ['only illegal characters leaves an empty string', '\u0000\u0001', '', true],
  ])('%s', (_name, input, expected, removed) => {
    expect(stripUnstorable(input)).toEqual({ text: expected, removed });
  });

  it('formatCell counts each affected cell once, however many characters were removed', () => {
    const s = { truncatedCells: 0, cleanedCells: 0 };
    expect(formatCell('a\u0001b\u0002c', 'text', s)).toBe('abc');
    expect(formatCell('clean', 'text', s)).toBe('clean');
    expect(s.cleanedCells).toBe(1);
  });

  it('a value that is ONLY illegal characters becomes an empty cell, still counted', () => {
    const s = { truncatedCells: 0, cleanedCells: 0 };
    expect(formatCell('\u0000', 'text', s)).toBeNull();
    expect(s.cleanedCells).toBe(1);
  });

  it('counts cleaned cells across a build', () => {
    const data = sampleData();
    data.members = [{ ...data.members[0], name: 'Me\u0001era', residential_address: 'x\u0002y' }];
    expect(build(data).stats.cleanedCells).toBe(2);
  });
});

describe('formatCell', () => {
  const stats = () => ({ truncatedCells: 0, cleanedCells: 0 });

  it.each([
    [null, 'text', null],
    [undefined, 'number', null],
    ['', 'text', null],
    ['abc', 'text', 'abc'],
    [7, 'text', '7'],
    [{ a: 1 }, 'text', '{"a":1}'],
    [3, 'number', 3],
    ['3.5', 'number', 3.5],
    [' ', 'number', ' '],
    ['n/a', 'number', 'n/a'],
    [Infinity, 'number', 'Infinity'],
    [true, 'boolean', 'TRUE'],
    [false, 'boolean', 'FALSE'],
    ['true', 'boolean', 'TRUE'],
    ['false', 'boolean', 'FALSE'],
    ['maybe', 'boolean', null],
  ] as const)('%j as %s -> %j', (value, kind, expected) => {
    expect(formatCell(value, kind, stats())).toBe(expected);
  });

  it('truncates a text cell to the Excel limit and counts it', () => {
    const s = stats();
    const cellValue = formatCell('x'.repeat(MAX_CELL_CHARS + 500), 'text', s) as string;
    expect(cellValue).toHaveLength(MAX_CELL_CHARS);
    expect(s.truncatedCells).toBe(1);
    expect(formatCell('x'.repeat(MAX_CELL_CHARS), 'text', s)).toHaveLength(MAX_CELL_CHARS);
    expect(s.truncatedCells).toBe(1); // exactly at the limit is not truncated
  });

  it('counts truncated cells across a build', () => {
    const data = sampleData();
    data.audit_log = [{ ...data.audit_log[0], new_value: 'y'.repeat(MAX_CELL_CHARS + 1) }];
    expect(build(data).stats.truncatedCells).toBe(1);
  });
});

describe('sheet overflow past the row limit', () => {
  it('splits into <Name>_2, <Name>_3 … while the count stays under the base name', () => {
    const data = sampleData();
    data.audit_log = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, change_id: 'c', table_name: 'members', record_id: '1', field_name: 'f', operation: 'insert' }));
    const built = build(data, { maxSheetRows: 3 });
    const audit = built.sheets.filter((s) => s.name.startsWith('AuditLog'));
    expect(audit.map((s) => s.name)).toEqual(['AuditLog', 'AuditLog_2', 'AuditLog_3']);
    expect(audit.map((s) => s.rows.length)).toEqual([3, 3, 1]);
    expect(audit.map((s) => s.rows[0][0])).toEqual([1, 4, 7]); // ids continue in order across the parts
    expect(audit.every((s) => s.headers.length === 10)).toBe(true);
    expect(built.counts.AuditLog).toBe(7);
  });

  it('a sheet exactly at the limit does not overflow', () => {
    const data = sampleData();
    data.audit_log = Array.from({ length: 3 }, (_, i) => ({ id: i + 1 }));
    expect(build(data, { maxSheetRows: 3 }).sheets.filter((s) => s.name.startsWith('AuditLog'))).toHaveLength(1);
  });
});

describe('README sheet', () => {
  const info = {
    exportedAt: '2026-10-06T08:00:00.000Z',
    exportedBy: 'admin@example.com',
    sourceProject: 'abcdefgh',
    includeAuditLog: true,
    photoParts: 2,
    counts: { Branches: 1, Members: 30 },
    truncatedCells: 3,
    cleanedCells: 2,
    warnings: [] as string[],
  };

  it('opens with the key/value block the importers read: schema_version first, then the metadata', () => {
    const readme = buildReadme(info);
    expect(readme.name).toBe('README');
    expect(readme.rows.slice(0, 8)).toEqual([
      ['schema_version', SCHEMA_VERSION],
      ['exported_at', '2026-10-06T08:00:00.000Z'],
      ['exported_by', 'admin@example.com'],
      ['source_project', 'abcdefgh'],
      ['include_audit_log', 'TRUE'],
      ['photo_parts', 2],
      ['truncated_cells', 3],
      ['cleaned_cells', 2],
    ]);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('lists the per-sheet row counts as numbers under a Sheet | Rows header', () => {
    const rows = buildReadme(info).rows;
    const at = rows.findIndex((r) => r[0] === 'Sheet');
    expect(rows[at]).toEqual(['Sheet', 'Rows']);
    expect(rows.slice(at + 1, at + 3)).toEqual([['Branches', 1], ['Members', 30]]);
    expect(rows[at - 1]).toEqual([null, null]); // blank separator ends the key/value block
  });

  it('says "None" when there are no warnings, and lists each warning otherwise', () => {
    const none = buildReadme(info).rows.map((r) => r[0]);
    expect(none[none.indexOf('Warnings') + 1]).toBe('None');
    const some = buildReadme({ ...info, warnings: ['Photo for member MUM-1 could not be read and was skipped.'] }).rows.map((r) => r[0]);
    expect(some[some.indexOf('Warnings') + 1]).toBe('Photo for member MUM-1 could not be read and was skipped.');
    expect(some).not.toContain('None');
  });

  it('carries the personal-data, password and CSV notes', () => {
    const text = buildReadme(info).rows.map((r) => String(r[0])).join('\n');
    expect(text).toMatch(/personal and medical data/);
    expect(text).toMatch(/Passwords are never exported/);
    expect(text).toMatch(/CSV/);
  });

  it('records the audit log as excluded, and blank metadata as empty cells', () => {
    const rows = buildReadme({ ...info, includeAuditLog: false, exportedBy: '', sourceProject: '' }).rows;
    expect(rows[4]).toEqual(['include_audit_log', 'FALSE']);
    expect(rows[2]).toEqual(['exported_by', null]);
    expect(rows[3]).toEqual(['source_project', null]);
  });
});
