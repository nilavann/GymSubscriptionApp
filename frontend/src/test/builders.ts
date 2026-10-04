import type { Member } from '../types/member';
import type { MemberListRow } from '../types/member-list';
import type { Plan } from '../types/plan';
import type { Profile } from '../types/profile';
import type { Branch } from '../types/branch';
import type { Role } from '../types/role';

/**
 * Typed test-data builders: every field has a sensible default, tests override only what they
 * assert on. Because they return the real row types, a schema change in `types/` is a compile
 * error here rather than a silently-stale fixture. A counter keeps ids unique within a test file.
 */

let sequence = 0;
const nextId = () => ++sequence;

export function buildMemberListRow(overrides: Partial<MemberListRow> = {}): MemberListRow {
  const id = overrides.id ?? nextId();
  return {
    id,
    name: `Member ${id}`,
    phone: '9876543210',
    member_number: `MUM-2026-${String(id).padStart(4, '0')}`,
    date_of_joining: '2026-01-15',
    gender: 'Male',
    photo_url: null,
    photo_thumbnail_url: null,
    current_membership_plan_id: 1,
    current_membership_plan_name: 'Monthly',
    current_membership_end_date: '2099-12-31',
    current_addon_plan_ids: [],
    ...overrides,
  };
}

export function buildMember(overrides: Partial<Member> = {}): Member {
  const id = overrides.id ?? nextId();
  return {
    id,
    name: `Member ${id}`,
    phone: '9876543210',
    date_of_birth: '1995-04-12',
    date_of_joining: '2026-01-15',
    gender: 'Male',
    weight_kg: 72.5,
    height_cm: 175,
    under_doctor_care: false,
    doctor_care_details: null,
    emergency_contact_name: 'Asha Rao',
    emergency_contact_phone: '9123456780',
    emergency_contact_relationship: 'Sister',
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

export function buildPlan(overrides: Partial<Plan> = {}): Plan {
  const id = overrides.id ?? nextId();
  return {
    id,
    name: `Plan ${id}`,
    category: 'membership',
    duration_days: 30,
    price: 1500,
    max_members: 1,
    ...overrides,
  };
}

export function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    full_name: 'Priya Sharma',
    roles: ['staff'],
    is_active: true,
    ...overrides,
  };
}

export const buildAdminProfile = (overrides: Partial<Profile> = {}): Profile =>
  buildProfile({ roles: ['admin'], ...overrides });

export function buildBranch(overrides: Partial<Branch> = {}): Branch {
  const id = overrides.id ?? nextId();
  return { id, name: `Branch ${id}`, code: `B${id}`, ...overrides };
}

export function buildRole(overrides: Partial<Role> = {}): Role {
  const id = overrides.id ?? nextId();
  return { id, name: `role-${id}`, description: null, ...overrides };
}
