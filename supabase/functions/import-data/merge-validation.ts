// Pure request parsing, validation and shaping for import-data's MERGE mode (REQ-ADMIN-008,
// spec/backend/data-export-import.md §5.4 and §6.1). No I/O in here on purpose: everything is a function of its input,
// so it is unit-tested directly (_tests/merge-validation.test.ts) and pinned to the client's member rules by a shared
// fixture (_tests/fixtures/member-validation-cases.json, also run by the frontend's vitest).
//
// The uploaded workbook is UNTRUSTED. The browser parses it only to build this JSON; every value is re-checked here,
// and the database constraints behind the RPC are the final backstop.
//
// Division of labour (so an UPDATE import — where a blank cell means "no change" — is not blocked):
//   * this module validates the FORMAT of every value that is present, and the key fields that identify a row;
//   * whether a required column is present for a row that must be CREATED is enforced by the database's NOT NULL /
//     CHECK constraints, which import_workbook reports in plain words ("Weight kg is required").

export const SHEET_ORDER = ['branches', 'plans', 'members', 'subscriptions', 'subscription_items'] as const;
export type SheetName = (typeof SHEET_ORDER)[number];

export const SUPPORTED_SCHEMA_VERSION = 1;
/** Merge runs one transaction per file, so a file is capped (safety rail, not a tuned limit). Larger data: split the file. */
export const MAX_ROWS = 2000;
const MAX_TEXT = 1000;
const MAX_NAME = 80;

export type RawRow = Record<string, unknown> & { _row: number };

export interface RowOutcome {
  sheet: SheetName;
  row: number;
  outcome: string;
  message?: string;
  warning?: string;
  id?: number;
}

export interface MergeRequest {
  dryRun: boolean;
  updateExisting: boolean;
  onError: 'abort' | 'skip_invalid';
  sheets: Record<SheetName, RawRow[]>;
}

export type ParseResult = { ok: true; request: MergeRequest } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validates the envelope of the request: mode, schema version, flags, sheet names, row shape and the row cap. */
export function parseRequest(body: unknown): ParseResult {
  if (!isObject(body)) return { ok: false, error: 'Request body must be a JSON object' };
  if (body.mode !== 'merge') return { ok: false, error: 'Unsupported mode — only "merge" is available' };

  const version = body.schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'schema_version must be a whole number of 1 or more' };
  }
  if (version > SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This file was made by a newer version of the app (schema_version ${version}); this server understands up to ${SUPPORTED_SCHEMA_VERSION}`,
    };
  }

  if (typeof body.dry_run !== 'boolean') {
    // Required, never defaulted: a forgotten flag must not be able to commit an import.
    return { ok: false, error: 'dry_run must be true or false' };
  }

  let updateExisting = false;
  let onError: MergeRequest['onError'] = 'abort';
  if (body.options !== undefined) {
    if (!isObject(body.options)) return { ok: false, error: 'options must be an object' };
    const options = body.options;
    if (options.update_existing !== undefined) {
      if (typeof options.update_existing !== 'boolean') return { ok: false, error: 'options.update_existing must be true or false' };
      updateExisting = options.update_existing;
    }
    if (options.on_error !== undefined) {
      if (options.on_error !== 'abort' && options.on_error !== 'skip_invalid') {
        return { ok: false, error: 'options.on_error must be "abort" or "skip_invalid"' };
      }
      onError = options.on_error;
    }
  }

  if (!isObject(body.sheets)) return { ok: false, error: 'sheets must be an object' };
  const sheets = Object.fromEntries(SHEET_ORDER.map((name) => [name, [] as RawRow[]])) as Record<SheetName, RawRow[]>;
  let total = 0;
  for (const [name, rows] of Object.entries(body.sheets)) {
    if (!(SHEET_ORDER as readonly string[]).includes(name)) return { ok: false, error: `Unknown sheet "${name}"` };
    if (!Array.isArray(rows)) return { ok: false, error: `Sheet "${name}" must be a list of rows` };
    for (const row of rows) {
      if (!isObject(row)) return { ok: false, error: `Every row in "${name}" must be an object` };
      const n = row._row;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
        return { ok: false, error: `Every row in "${name}" needs a _row number (its row in the spreadsheet)` };
      }
    }
    total += rows.length;
    sheets[name as SheetName] = rows as RawRow[];
  }
  if (total === 0) return { ok: false, error: 'There are no rows to import' };
  if (total > MAX_ROWS) {
    return { ok: false, error: `The file has ${total} rows; at most ${MAX_ROWS.toLocaleString('en-US')} can be imported at once — split it into several files` };
  }

  return { ok: true, request: { dryRun: body.dry_run, updateExisting, onError, sheets } };
}

// ---- value helpers ---------------------------------------------------------------------------------------------------

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const PHONE_REGEX = /^\d{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PINCODE_REGEX = /^\d{6}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GENDERS = ['Male', 'Female', 'Other'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Card'];

/** A cell as trimmed text: null/undefined are empty; numbers and booleans are stringified. */
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
const normalizePhone = (value: unknown) => text(value).replace(/\s+/g, '');

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30, and every other format, e.g. 05/06/2026). */
function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whole-row checks that apply to every sheet: only plain scalar values, no control characters, no runaway text. */
function checkCells(row: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === '_row') continue;
    if (value !== null && typeof value === 'object') {
      problems.push(`Column "${key}" has an unsupported value`);
    } else if (typeof value === 'string') {
      if (CONTROL_CHARS.test(value)) problems.push(`Column "${key}" contains characters that are not allowed`);
      else if (value.length > MAX_TEXT) problems.push(`Column "${key}" is longer than ${MAX_TEXT} characters`);
    }
  }
  return problems;
}

// ---- members ---------------------------------------------------------------------------------------------------------

/**
 * Member field rules — the server copy of frontend/src/services/member.service.ts `validateMemberFields`
 * (kept honest by the parity fixture). `strict` reproduces the Add Member form (every required field must be
 * present); the import itself runs non-strict, because a blank cell on an UPDATE means "no change" and presence on a
 * CREATE is enforced by the database. Returns { field: message } for every invalid field.
 */
export function validateMemberFields(row: Record<string, unknown>, strict: boolean): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = text(row.name);
  if (!name) {
    if (strict) errors.name = 'Name is required';
  } else if (name.length < 2 || name.length > MAX_NAME) {
    errors.name = 'Name must be 2-80 characters';
  }

  const phone = normalizePhone(row.phone);
  if (!phone) {
    if (strict) errors.phone = 'Phone is required';
  } else if (!PHONE_REGEX.test(phone)) {
    errors.phone = 'Enter a valid 10-digit phone number';
  }

  const dob = text(row.date_of_birth);
  if (!dob) {
    if (strict) errors.date_of_birth = 'Date of birth is required';
  } else if (!isIsoDate(dob)) {
    errors.date_of_birth = 'Date of birth must be a real date written as YYYY-MM-DD';
  }

  const joining = text(row.date_of_joining);
  if (!joining) {
    if (strict) errors.date_of_joining = 'Date of joining is required';
  } else if (!isIsoDate(joining)) {
    errors.date_of_joining = 'Date of joining must be a real date written as YYYY-MM-DD';
  }

  const gender = text(row.gender);
  if (!gender) {
    if (strict) errors.gender = 'Gender is required';
  } else if (!GENDERS.includes(gender)) {
    errors.gender = 'Gender must be Male, Female or Other';
  }

  const weight = text(row.weight_kg);
  if (!weight) {
    if (strict) errors.weight_kg = 'Weight is required';
  } else {
    const n = Number(weight);
    if (Number.isNaN(n) || n < 1 || n > 500) errors.weight_kg = 'Weight must be between 1 and 500 kg';
  }
  const height = text(row.height_cm);
  if (!height) {
    if (strict) errors.height_cm = 'Height is required';
  } else {
    const n = Number(height);
    if (Number.isNaN(n) || n < 1 || n > 300) errors.height_cm = 'Height must be between 1.0 and 300.0 cm';
  }

  const careRaw = row.under_doctor_care;
  if (careRaw !== null && careRaw !== undefined && typeof careRaw !== 'boolean') {
    errors.under_doctor_care = 'Under doctor care must be TRUE or FALSE';
  } else if (strict && careRaw === true && !text(row.doctor_care_details)) {
    // Non-strict leaves this to the database's chk_doctor_care_details_required: an update may rely on stored details.
    errors.doctor_care_details = "Details are required when under doctor's care";
  }

  if (!text(row.emergency_contact_name) && strict) errors.emergency_contact_name = 'Emergency contact name is required';
  const emergencyPhone = normalizePhone(row.emergency_contact_phone);
  if (!emergencyPhone) {
    if (strict) errors.emergency_contact_phone = 'Emergency contact phone is required';
  } else if (!PHONE_REGEX.test(emergencyPhone)) {
    errors.emergency_contact_phone = 'Enter a valid 10-digit phone number';
  }
  if (!text(row.emergency_contact_relationship) && strict) {
    errors.emergency_contact_relationship = 'Emergency contact relationship is required';
  }

  const email = text(row.email);
  if (email && !EMAIL_REGEX.test(email)) errors.email = 'Enter a valid email address';
  const pincode = text(row.pincode);
  if (pincode && !PINCODE_REGEX.test(pincode)) errors.pincode = 'Must be exactly 6 digits';

  if (strict && !text(row.branch_code)) errors.branch_code = 'Branch is required';
  return errors;
}

const orNull = (value: unknown): string | null => text(value) || null;
const numOrNull = (value: unknown): number | null => (text(value) === '' ? null : Number(text(value)));

function memberPayload(row: RawRow): Record<string, unknown> {
  return {
    row: row._row,
    name: orNull(row.name),
    phone: normalizePhone(row.phone),
    date_of_birth: orNull(row.date_of_birth),
    date_of_joining: orNull(row.date_of_joining),
    gender: orNull(row.gender),
    weight_kg: numOrNull(row.weight_kg),
    height_cm: numOrNull(row.height_cm),
    under_doctor_care: typeof row.under_doctor_care === 'boolean' ? row.under_doctor_care : null,
    doctor_care_details: orNull(row.doctor_care_details),
    emergency_contact_name: orNull(row.emergency_contact_name),
    emergency_contact_phone: normalizePhone(row.emergency_contact_phone) || null,
    emergency_contact_relationship: orNull(row.emergency_contact_relationship),
    email: orNull(row.email),
    residential_address: orNull(row.residential_address),
    pincode: orNull(row.pincode),
    aadhaar_number: orNull(row.aadhaar_number),
    occupation: orNull(row.occupation),
    branch_code: orNull(row.branch_code),
    handled_by_email: orNull(row.handled_by_email),
  };
}

// ---- shaping the whole request ---------------------------------------------------------------------------------------

export interface Prepared {
  /** Only the rows that passed validation, in the shape import_workbook expects. */
  rpcPayload: Record<string, unknown>;
  /** error / skipped_deleted outcomes decided here (the RPC reports everything else). */
  outcomes: RowOutcome[];
  errorCount: number;
  validRowCount: number;
  warnings: string[];
}

const isDeleted = (row: Record<string, unknown>) => text(row.deleted_at) !== '';
const joinErrors = (errors: Record<string, string>) => Object.values(errors).join('; ');

/** Validates every row, drops deleted/invalid/duplicate ones with an outcome each, and builds the RPC payload. */
export function prepareMerge(request: MergeRequest): Prepared {
  const outcomes: RowOutcome[] = [];
  const warnings: string[] = [];
  const fail = (sheet: SheetName, row: number, message: string) => outcomes.push({ sheet, row, outcome: 'error', message });
  const skipDeleted = (sheet: SheetName, row: number) => outcomes.push({ sheet, row, outcome: 'skipped_deleted' });

  // A row is accepted only if its cells are plain and (per sheet) its fields are valid; returns the cell problems joined.
  const cellProblems = (row: RawRow) => checkCells(row).join('; ');

  // ---- branches (key: code)
  const branches: Record<string, unknown>[] = [];
  const seenBranch = new Map<string, number>();
  for (const row of request.sheets.branches) {
    if (isDeleted(row)) { skipDeleted('branches', row._row); continue; }
    const problems: string[] = [];
    const cells = cellProblems(row);
    if (cells) problems.push(cells);
    const code = text(row.code);
    const name = text(row.name);
    if (!code) problems.push('Branch code is required');
    else if (code.length > MAX_NAME) problems.push('Branch code is too long');
    if (name.length > MAX_NAME) problems.push('Branch name must be at most 80 characters');
    if (code && seenBranch.has(code)) problems.push(`Duplicate of row ${seenBranch.get(code)}`);
    if (problems.length) { fail('branches', row._row, problems.join('; ')); continue; }
    seenBranch.set(code, row._row);
    branches.push({ row: row._row, name: name || null, code });
  }

  // ---- plans (key: name)
  const plans: Record<string, unknown>[] = [];
  const seenPlan = new Map<string, number>();
  for (const row of request.sheets.plans) {
    if (isDeleted(row)) { skipDeleted('plans', row._row); continue; }
    const problems: string[] = [];
    const cells = cellProblems(row);
    if (cells) problems.push(cells);
    const name = text(row.name);
    if (!name) problems.push('Plan name is required');
    else if (name.length > MAX_NAME) problems.push('Plan name must be at most 80 characters');
    const category = text(row.category);
    if (category && category !== 'membership' && category !== 'addon') problems.push('Category must be "membership" or "addon"');
    const duration = text(row.duration_days);
    if (duration && (!/^\d+$/.test(duration) || Number(duration) < 1)) problems.push('Duration must be a whole number of days (1 or more)');
    const price = text(row.price);
    if (price && (Number.isNaN(Number(price)) || Number(price) < 0 || Number(price) > 99999999.99)) problems.push('Price must be a number from 0 to 99,999,999.99');
    const maxMembers = text(row.max_members);
    if (maxMembers && maxMembers !== '1' && maxMembers !== '2') problems.push('Members per plan must be 1 or 2');
    if (category === 'addon' && maxMembers && maxMembers !== '1') problems.push('Add-ons cannot cover more than 1 member');
    if (name && seenPlan.has(name)) problems.push(`Duplicate of row ${seenPlan.get(name)}`);
    if (problems.length) { fail('plans', row._row, problems.join('; ')); continue; }
    seenPlan.set(name, row._row);
    plans.push({
      row: row._row, name, category: category || null,
      duration_days: duration ? Number(duration) : null,
      price: price ? Number(price) : null,
      max_members: maxMembers ? Number(maxMembers) : null,
    });
  }

  // ---- members (key: phone)
  const members: Record<string, unknown>[] = [];
  const seenPhone = new Map<string, number>();
  let defaultedJoining = 0;
  for (const row of request.sheets.members) {
    if (isDeleted(row)) { skipDeleted('members', row._row); continue; }
    const problems: string[] = [];
    const cells = cellProblems(row);
    if (cells) problems.push(cells);
    const fieldErrors = validateMemberFields(row, false);
    if (Object.keys(fieldErrors).length) problems.push(joinErrors(fieldErrors));
    const phone = normalizePhone(row.phone);
    if (!phone) problems.push('Phone is required');
    else if (!fieldErrors.phone && seenPhone.has(phone)) problems.push(`Duplicate of row ${seenPhone.get(phone)}`);
    if (text(row.handled_by_email).length > 254) problems.push('handled_by_email is too long');
    if (problems.length) { fail('members', row._row, problems.join('; ')); continue; }
    seenPhone.set(phone, row._row);
    if (!text(row.date_of_joining)) defaultedJoining += 1;
    members.push(memberPayload(row));
  }
  if (defaultedJoining > 0) {
    warnings.push(`${defaultedJoining} new member row(s) have no date of joining — today's date will be used for any that are created.`);
  }

  // ---- subscriptions (+ their items): created whole or not at all
  const subscriptions: Record<string, unknown>[] = [];
  const subscriptionRows = new Map<string, { row: RawRow; items: Record<string, unknown>[]; failed: boolean; deleted: boolean }>();
  for (const row of request.sheets.subscriptions) {
    const ref = text(row.subscription_ref);
    if (isDeleted(row)) {
      skipDeleted('subscriptions', row._row);
      if (ref) subscriptionRows.set(ref, { row, items: [], failed: true, deleted: true });
      continue;
    }
    const problems: string[] = [];
    const cells = cellProblems(row);
    if (cells) problems.push(cells);
    if (!ref) problems.push('subscription_ref is required');
    else if (subscriptionRows.has(ref)) problems.push(`Duplicate of row ${subscriptionRows.get(ref)!.row._row}`);
    const phone = normalizePhone(row.member_phone);
    if (!phone) problems.push('Member phone is required');
    else if (!PHONE_REGEX.test(phone)) problems.push('Member phone must be a valid 10-digit phone number');
    const mode = text(row.payment_mode);
    if (mode && !PAYMENT_MODES.includes(mode)) problems.push('Payment mode must be Cash, UPI or Card');
    if (problems.length) {
      fail('subscriptions', row._row, problems.join('; '));
      if (ref && !subscriptionRows.has(ref)) subscriptionRows.set(ref, { row, items: [], failed: true, deleted: false });
      continue;
    }
    subscriptionRows.set(ref, { row, items: [], failed: false, deleted: false });
  }

  for (const row of request.sheets.subscription_items) {
    const ref = text(row.subscription_ref);
    const parent = ref ? subscriptionRows.get(ref) : undefined;
    if (isDeleted(row) || parent?.deleted) { skipDeleted('subscription_items', row._row); continue; }
    const problems: string[] = [];
    const cells = cellProblems(row);
    if (cells) problems.push(cells);
    if (!ref) problems.push('subscription_ref is required');
    else if (!parent) problems.push(`No subscription with subscription_ref "${ref}" in the file`);
    if (!text(row.plan_name)) problems.push('Plan name is required');
    const phone = normalizePhone(row.member_phone);
    if (!phone) problems.push('Member phone is required');
    else if (!PHONE_REGEX.test(phone)) problems.push('Member phone must be a valid 10-digit phone number');
    const shared = normalizePhone(row.shared_member_phone);
    if (shared && !PHONE_REGEX.test(shared)) problems.push('Shared member phone must be a valid 10-digit phone number');
    const start = text(row.start_date);
    if (!start) problems.push('Start date is required');
    else if (!isIsoDate(start)) problems.push('Start date must be a real date written as YYYY-MM-DD');
    const quantity = text(row.quantity);
    if (quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 1)) problems.push('Quantity must be a whole number of 1 or more');
    const amount = text(row.amount_paid);
    if (amount && (Number.isNaN(Number(amount)) || Number(amount) < 0)) problems.push('Amount paid must be a number of 0 or more');
    if (problems.length) {
      fail('subscription_items', row._row, problems.join('; '));
      if (parent) parent.failed = true;
      continue;
    }
    parent!.items.push({
      plan_name: text(row.plan_name), member_phone: phone, shared_member_phone: shared || null, start_date: start,
      quantity: quantity ? Number(quantity) : null, amount_paid: amount ? Number(amount) : null,
    });
  }

  for (const [ref, entry] of subscriptionRows) {
    if (entry.deleted) continue;
    if (entry.failed) {
      // An item of this subscription was invalid: it cannot be created half-way (header + items are one immutable set).
      if (!outcomes.some((o) => o.sheet === 'subscriptions' && o.row === entry.row._row)) {
        fail('subscriptions', entry.row._row, 'Not imported because one of its item rows has an error');
      }
      continue;
    }
    if (entry.items.length === 0) {
      fail('subscriptions', entry.row._row, `Subscription "${ref}" has no item rows`);
      continue;
    }
    subscriptions.push({
      row: entry.row._row,
      member_phone: normalizePhone(entry.row.member_phone),
      payment_mode: orNull(entry.row.payment_mode),
      notes: orNull(entry.row.notes),
      items: entry.items,
    });
  }

  return {
    rpcPayload: { branches, plans, members, subscriptions },
    outcomes,
    errorCount: outcomes.filter((o) => o.outcome === 'error').length,
    validRowCount: branches.length + plans.length + members.length + subscriptions.length,
    warnings,
  };
}
