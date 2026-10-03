import type { MockUser, Row } from './supabase-mock';

export const ADMIN: MockUser = { id: 'u-admin', email: 'anita@fitandfine.in', password: 'admin-secret' };
export const STAFF: MockUser = { id: 'u-staff', email: 'priya@fitandfine.in', password: 'staff-secret' };

/** YYYY-MM-DD, `days` from today in the machine's LOCAL time — the same "today" the app computes. */
export function dayFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

let nextMemberId = 1;

/** One `member_list_view` row. Defaults to an active member with a monthly plan and no photo. */
export function memberListRow(overrides: Row = {}): Row {
  const id = (overrides.id as number | undefined) ?? nextMemberId++;
  return {
    id,
    name: `Member ${id}`,
    phone: '9876543210',
    member_number: `MUM-2026-${String(id).padStart(4, '0')}`,
    date_of_joining: '2026-01-15',
    gender: 'Female',
    photo_url: null,
    photo_thumbnail_url: null,
    current_membership_plan_id: 1,
    current_membership_plan_name: 'Monthly',
    current_membership_end_date: dayFromToday(60),
    current_addon_plan_ids: [],
    ...overrides,
  };
}

/** One full `members` row — what Member Detail / Renew read via `memberRepository.getById`. */
export function memberRow(overrides: Row = {}): Row {
  const id = (overrides.id as number | undefined) ?? 1;
  return {
    id,
    name: `Member ${id}`,
    phone: '9876543210',
    date_of_birth: '1996-03-14',
    date_of_joining: '2026-01-15',
    gender: 'Female',
    weight_kg: 58.5,
    height_cm: 162,
    under_doctor_care: false,
    doctor_care_details: null,
    emergency_contact_name: 'Meera Joshi',
    emergency_contact_phone: '9123456780',
    emergency_contact_relationship: 'Mother',
    email: null,
    residential_address: null,
    pincode: null,
    aadhaar_number: null,
    occupation: null,
    photo_url: null,
    photo_thumbnail_url: null,
    branch_id: 1,
    member_number: `MUM-2026-${String(id).padStart(4, '0')}`,
    handled_by_staff: null,
    created_by: null,
    ...overrides,
  };
}

/** One `member_current_items` row (a subscription item that has not ended yet). */
export function currentItemRow(overrides: Row = {}): Row {
  return {
    subscription_item_id: 1,
    subscription_id: 1,
    plan_id: 1,
    plan_name: 'Monthly',
    category: 'membership',
    member_id: 1,
    start_date: dayFromToday(-10),
    end_date: dayFromToday(20),
    quantity: 1,
    amount_paid: 1500,
    ...overrides,
  };
}

/** Tables every signed-in screen needs. Tests add/replace rows (e.g. `member_list_view`) per scenario. */
export function defaultTables(): Record<string, Row[]> {
  return {
    profiles_with_roles: [
      { id: ADMIN.id, full_name: 'Anita Admin', roles: ['admin'], is_active: true },
      { id: STAFF.id, full_name: 'Priya Sharma', roles: ['staff'], is_active: true },
    ],
    member_list_view: [],
    plans: [
      { id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1500, max_members: 1 },
      { id: 2, name: 'Quarterly', category: 'membership', duration_days: 90, price: 4000, max_members: 1 },
      { id: 3, name: 'Yoga', category: 'addon', duration_days: 30, price: 500, max_members: 1 },
    ],
    branches: [{ id: 1, name: 'Mumbai Central', code: 'MUM' }],
    roles: [
      { id: 1, name: 'admin', description: 'Full access' },
      { id: 2, name: 'staff', description: null },
    ],
    // Empty by default (a legitimate "nothing yet" state); also read as row COUNTS by the Settings
    // hub's Data Management cards (HEAD requests). Tests that need rows set them explicitly.
    members: [],
    profiles: [{ id: ADMIN.id }, { id: STAFF.id }],
    subscriptions: [],
    subscription_items: [],
    member_current_items: [],
    audit_log: [],
  };
}

/** An ISO timestamp for "now" — audit rows are filtered by `changed_at` against the page's date range. */
const nowIso = () => new Date().toISOString();

/**
 * Realistic rows for every list screen, so a spec can open any of them and see real content. Sets the
 * tables/functions on the given mock; individual tests can still override afterwards.
 */
export function seedListScreens(mock: {
  tables: Record<string, Row[]>;
  functions: Record<string, (body: unknown) => { json: unknown } | Promise<{ json: unknown }>>;
}): void {
  mock.tables.member_list_view = Array.from({ length: 6 }, (_, i) =>
    memberListRow({ id: i + 1, name: `Seed Member ${i + 1}`, current_membership_end_date: dayFromToday(30 + i) })
  );
  mock.tables.branches = [
    { id: 1, name: 'Mumbai Central', code: 'MUM' },
    { id: 2, name: 'Pune Camp', code: 'PUN' },
    { id: 3, name: 'Thane West', code: 'THA' },
  ];
  mock.tables.profiles = [
    { id: ADMIN.id, full_name: 'Anita Admin' },
    { id: STAFF.id, full_name: 'Priya Sharma' },
  ];
  mock.tables.configuration = [
    { key: 'member_number_start_sequence', value: '1' },
    { key: 'member_number_increment', value: '1' },
    { key: 'member_number_padding_width', value: '4' },
  ];
  mock.tables.member_number_sequences = [{ branch_id: 1, last_sequence: 41 }];
  mock.tables.audit_log = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    change_id: `change-${i + 1}`,
    table_name: 'plans',
    record_id: String(i + 1),
    field_name: 'price',
    old_value: '1000',
    new_value: '1500',
    operation: 'update',
    changed_by: ADMIN.id,
    changed_at: nowIso(),
  }));
  mock.tables.members = [1, 2, 3].map((id) => ({
    id,
    name: `Seed Member ${id}`,
    phone: '9876543210',
    member_number: `MUM-2026-000${id}`,
  }));
  mock.tables.subscriptions = [1, 2, 3].map((id) => ({ id, payment_mode: (['Cash', 'UPI', 'Card'] as const)[id - 1] }));
  mock.tables.subscription_items = [1, 2, 3].map((id) => ({
    id,
    subscription_id: id,
    plan_id: id === 3 ? 3 : 1,
    member_id: id,
    start_date: dayFromToday(0),
    amount_paid: 1000 * id,
  }));
  mock.functions['list-users'] = () => ({
    json: {
      users: [
        { id: ADMIN.id, full_name: 'Anita Admin', roles: ['admin'], is_active: true, email: ADMIN.email, deleted_at: null },
        { id: STAFF.id, full_name: 'Priya Sharma', roles: ['staff'], is_active: true, email: STAFF.email, deleted_at: null },
        { id: 'u-third', full_name: 'Ravi Kumar', roles: ['staff'], is_active: false, email: 'ravi@fitandfine.in', deleted_at: null },
      ],
    },
  });
}
