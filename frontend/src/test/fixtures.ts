import type { MemberListRow } from '../types/member-list';
import type { Plan } from '../types/plan';
import type { MemberCurrentItem } from '../types/member-current-item';
import type { Member } from '../types/member';

export function memberRow(overrides: Partial<MemberListRow> = {}): MemberListRow {
  return {
    id: 1,
    name: 'Arjun Kumar',
    phone: '9800000001',
    member_number: 'MUM-2026-0001',
    date_of_joining: '2026-01-01',
    gender: 'Male',
    photo_url: null,
    photo_thumbnail_url: null,
    current_membership_plan_id: null,
    current_membership_plan_name: null,
    current_membership_end_date: null,
    current_addon_plan_ids: [],
    ...overrides,
  };
}

export function plan(overrides: Partial<Plan> = {}): Plan {
  return { id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1000, max_members: 1, ...overrides };
}

export function currentItem(overrides: Partial<MemberCurrentItem> = {}): MemberCurrentItem {
  return {
    subscription_item_id: 1,
    subscription_id: 1,
    plan_id: 1,
    plan_name: 'Monthly',
    category: 'membership',
    member_id: 1,
    start_date: '2026-07-01',
    end_date: '2026-07-30',
    quantity: 1,
    amount_paid: 1000,
    ...overrides,
  };
}

export function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 1,
    name: 'Arjun Kumar',
    phone: '9800000001',
    date_of_birth: '1990-05-14',
    date_of_joining: '2026-01-01',
    gender: 'Male',
    weight_kg: 78.5,
    height_cm: 175,
    under_doctor_care: false,
    doctor_care_details: null,
    emergency_contact_name: 'Sunita Kumar',
    emergency_contact_phone: '9800000101',
    emergency_contact_relationship: 'Spouse',
    email: null,
    residential_address: null,
    aadhaar_number: null,
    occupation: null,
    photo_url: null,
    photo_thumbnail_url: null,
    branch_id: 1,
    member_number: 'MUM-2026-0001',
    handled_by_staff: null,
    created_by: null,
    ...overrides,
  } as Member;
}

/** Freezes "today" in the browser's local timezone (the app's Timezone Rule). */
export function localDate(y: number, m: number, d: number, h = 12): Date {
  return new Date(y, m - 1, d, h, 0, 0);
}
