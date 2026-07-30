export type Gender = 'Male' | 'Female' | 'Other';

/**
 * Mirrors a `members` row — see spec/backend/member-management.md §2.
 * `member_number`, `created_by`, and `branch_id` are shown read-only wherever a member is
 * displayed/edited (REQ-MEM-005/006) — never sent back to the server as editable inputs.
 */
export interface Member {
  id: number;
  name: string;
  phone: string;
  date_of_birth: string;
  date_of_joining: string;
  gender: Gender;
  weight_kg: number;
  height_cm: number;
  under_doctor_care: boolean;
  /** Non-null and non-blank whenever under_doctor_care is true (chk_doctor_care_details_required). */
  doctor_care_details: string | null;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  email: string | null;
  residential_address: string | null;
  aadhaar_number: string | null;
  occupation: string | null;
  /**
   * Original upload — shown on Member Detail's hero only, never in list/card surfaces
   * (REQ-MEM-004). The `members` column stores a `member-photos`-relative storage path
   * (private bucket); `memberRepository` resolves it to a short-lived signed URL
   * (`lib/photo-urls.ts`) before it ever reaches this type, so by the time code sees a
   * `Member`, this is already a directly renderable, temporary URL — not the raw path.
   */
  photo_url: string | null;
  /** Compressed (~400px/<50KB) — used by default on list/card surfaces (REQ-MEM-004). Same path-vs-resolved-URL distinction as `photo_url` above. */
  photo_thumbnail_url: string | null;
  /** Set once at registration; immutable thereafter (REQ-MEM-005/006) — see NewMember/UpdateMember below. */
  branch_id: number;
  /** System-generated, e.g. "MUM-2026-0001" (REQ-MEM-005). Never client-settable, at create or edit. */
  member_number: string;
  /** Independently editable — distinct from created_by, no relation to it (REQ-MEM-003). */
  handled_by_staff: string | null;
  /** System-set at creation, immutable forever after (REQ-MEM-003). Shown read-only, never editable. */
  created_by: string | null;
}

/**
 * Payload for memberService.create() — a direct RLS-guarded insert, no Edge Function
 * involved (see spec/backend/member-management.md §7). `member_number`/`created_by` are
 * never included — the database generates/sets them (see database.md's
 * generate_member_number() trigger and set_audit_fields()).
 */
export interface NewMember {
  name: string;
  phone: string;
  date_of_birth: string;
  /** Client pre-fills today's date (browser local date), editable before submit. */
  date_of_joining: string;
  gender: Gender;
  weight_kg: number;
  height_cm: number;
  /** Defaults to false. */
  under_doctor_care: boolean;
  /** Required (non-blank) when under_doctor_care is true; omit/null otherwise. */
  doctor_care_details: string | null;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  /** Feeds member_number generation (REQ-MEM-005) — required at creation, immutable after. */
  branch_id: number;
  email: string | null;
  residential_address: string | null;
  aadhaar_number: string | null;
  occupation: string | null;
  /**
   * Settable at creation, defaulting to whoever's creating the record (AddMemberPage
   * seeds it from the logged-in session) — editable to reassign credit when one staff
   * member enters data on behalf of another (REQ-MEM-003). Independently editable
   * afterward too, from the member's detail page; unrelated to created_by, which is
   * always the logged-in session regardless of what this is set to.
   */
  handled_by_staff?: string | null;
}

// photo_url/photo_thumbnail_url are deliberately absent from NewMember, not just
// optional — see spec/frontend/member-management.md §3.1: compression/upload is a
// separate step from the create call, so a photo failure never blocks the member
// record itself (REQ-MEM-004). Set via a follow-up UpdateMember once the Storage
// upload completes.

/**
 * Payload for memberService.update() — every field optional, EXCEPT `member_number`,
 * `created_by`, and `branch_id`, which don't exist on this type at all (REQ-MEM-006) —
 * not "optional and unset," structurally absent, so there's no accidental way to send
 * them. A payload that somehow included branch_id would be silently pinned back to its
 * original value by generate_member_number()'s UPDATE branch regardless (database.md).
 */
export type UpdateMember = Partial<
  Pick<
    NewMember,
    | 'name'
    | 'phone'
    | 'date_of_birth'
    | 'date_of_joining'
    | 'gender'
    | 'weight_kg'
    | 'height_cm'
    | 'under_doctor_care'
    | 'doctor_care_details'
    | 'emergency_contact_name'
    | 'emergency_contact_phone'
    | 'emergency_contact_relationship'
    | 'email'
    | 'residential_address'
    | 'aadhaar_number'
    | 'occupation'
  >
> & {
  /** Independently editable at any time from Member Detail — see REQ-MEM-003. */
  handled_by_staff?: string | null;
  /**
   * Set via the follow-up call once Storage upload completes (REQ-MEM-004) — absent
   * from NewMember on purpose. Unlike the resolved-URL `Member.photo_url` above, the
   * value written here (by `memberService.uploadPhoto()`) is the raw `member-photos`
   * storage path — this is a write payload, not a read shape.
   */
  photo_url?: string | null;
  photo_thumbnail_url?: string | null;
};
