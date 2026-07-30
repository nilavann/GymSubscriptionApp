import { memberRepository } from '../repositories/member.repository';
import { compressImage } from '../lib/photo-compression';
import { supabase } from '../lib/supabase-client';
import type { Gender, Member, NewMember, UpdateMember } from '../types/member';

/**
 * Fields shared by both the Add Member form and Member Detail's inline edit form — every
 * Member field except branch_id (create-only, immutable after — REQ-MEM-006).
 * handled_by_staff is shared too (settable at creation, defaulting to the logged-in staff
 * member — AddMemberPage seeds it via useAuth() — and independently editable afterward from
 * Member Detail, same field either way — REQ-MEM-003).
 */
interface MemberFieldsDraft {
  name: string;
  phone: string;
  date_of_birth: string;
  date_of_joining: string;
  gender: Gender | '';
  /** Raw text while editing (e.g. "72." mid-entry) — masked to at most 2 decimals, parsed on validate/submit. */
  weight_kg: string;
  height_cm: string;
  under_doctor_care: boolean;
  doctor_care_details: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  email: string;
  residential_address: string;
  aadhaar_number: string;
  occupation: string;
  /** Profile id, or '' for "not set" — see member-detail.md §12. */
  handled_by_staff: string;
}

/**
 * The Add Member form's working state — looser than NewMember (numeric/enum fields can be
 * '' while unselected/unfilled) so the form can hold an incomplete draft. Converted to a
 * real NewMember only after validation passes. See spec/frontend/member-management.md §2.
 */
export interface NewMemberDraft extends MemberFieldsDraft {
  branch_id: number | '';
}

/** Member Detail's inline-edit form state (member-detail.md §7/§12) — same fields as NewMemberDraft, minus branch_id (immutable after creation). */
export type MemberEditDraft = MemberFieldsDraft;

export type MemberFormErrors = Partial<Record<keyof NewMemberDraft, string>>;
export type MemberEditFormErrors = Partial<Record<keyof MemberEditDraft, string>>;

const PHONE_REGEX = /^\d{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared by validateNewMember/validateMemberEdit — server-side CHECK constraints are the authoritative copy (member-management.md §7). */
function validateMemberFields(form: MemberFieldsDraft): Partial<Record<keyof MemberFieldsDraft, string>> {
  const errors: Partial<Record<keyof MemberFieldsDraft, string>> = {};

  const name = form.name.trim();
  if (!name) errors.name = 'Name is required';
  else if (name.length < 2 || name.length > 80) errors.name = 'Name must be 2-80 characters';

  const phone = form.phone.trim().replace(/\s+/g, '');
  if (!phone) errors.phone = 'Phone is required';
  else if (!PHONE_REGEX.test(phone)) errors.phone = 'Enter a valid 10-digit phone number';

  if (!form.date_of_birth) errors.date_of_birth = 'Date of birth is required';
  if (!form.date_of_joining) errors.date_of_joining = 'Date of joining is required';
  if (form.gender === '') errors.gender = 'Select a gender';

  const weightKg = Number(form.weight_kg);
  if (form.weight_kg.trim() === '' || Number.isNaN(weightKg) || weightKg < 1 || weightKg > 500) {
    errors.weight_kg = 'Weight must be between 1 and 500 kg';
  }
  const heightCm = Number(form.height_cm);
  if (form.height_cm.trim() === '' || Number.isNaN(heightCm) || heightCm < 1 || heightCm > 300) {
    errors.height_cm = 'Height must be between 1.0 and 300.0 cm';
  }

  if (form.under_doctor_care && !form.doctor_care_details.trim()) {
    errors.doctor_care_details = "Details are required when under doctor's care";
  }

  if (!form.emergency_contact_name.trim()) errors.emergency_contact_name = 'Emergency contact name is required';

  const emergencyPhone = form.emergency_contact_phone.trim().replace(/\s+/g, '');
  if (!emergencyPhone) errors.emergency_contact_phone = 'Emergency contact phone is required';
  else if (!PHONE_REGEX.test(emergencyPhone)) errors.emergency_contact_phone = 'Enter a valid 10-digit phone number';

  if (!form.emergency_contact_relationship.trim()) {
    errors.emergency_contact_relationship = 'Emergency contact relationship is required';
  }

  if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) {
    errors.email = 'Enter a valid email address';
  }

  return errors;
}

export function validateNewMember(form: NewMemberDraft): MemberFormErrors {
  const errors: MemberFormErrors = validateMemberFields(form);
  if (form.branch_id === '') errors.branch_id = 'Select a branch';
  return errors;
}

export function validateMemberEdit(form: MemberEditDraft): MemberEditFormErrors {
  return validateMemberFields(form);
}

export function isMemberFormValid(errors: MemberFormErrors | MemberEditFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

function draftToMemberFieldsUpdate(form: MemberFieldsDraft) {
  return {
    name: form.name.trim(),
    phone: form.phone.trim().replace(/\s+/g, ''),
    date_of_birth: form.date_of_birth,
    date_of_joining: form.date_of_joining,
    gender: form.gender as Gender,
    weight_kg: Number(form.weight_kg),
    height_cm: Number(form.height_cm),
    under_doctor_care: form.under_doctor_care,
    doctor_care_details: form.under_doctor_care ? form.doctor_care_details.trim() : null,
    emergency_contact_name: form.emergency_contact_name.trim(),
    emergency_contact_phone: form.emergency_contact_phone.trim().replace(/\s+/g, ''),
    emergency_contact_relationship: form.emergency_contact_relationship.trim(),
    email: form.email.trim() || null,
    residential_address: form.residential_address.trim() || null,
    aadhaar_number: form.aadhaar_number.trim() || null,
    occupation: form.occupation.trim() || null,
    handled_by_staff: form.handled_by_staff || null,
  };
}

function draftToNewMember(form: NewMemberDraft): NewMember {
  return { ...draftToMemberFieldsUpdate(form), branch_id: form.branch_id as number };
}

/** Member -> MemberEditDraft, the inverse of draftToMemberFieldsUpdate — member-detail.md §4.1's `memberForm` init. */
export function editDraftFromMember(member: Member): MemberEditDraft {
  return {
    name: member.name,
    phone: member.phone,
    date_of_birth: member.date_of_birth,
    date_of_joining: member.date_of_joining,
    gender: member.gender,
    weight_kg: String(member.weight_kg),
    height_cm: String(member.height_cm),
    under_doctor_care: member.under_doctor_care,
    doctor_care_details: member.doctor_care_details ?? '',
    emergency_contact_name: member.emergency_contact_name,
    emergency_contact_phone: member.emergency_contact_phone,
    emergency_contact_relationship: member.emergency_contact_relationship,
    email: member.email ?? '',
    residential_address: member.residential_address ?? '',
    aadhaar_number: member.aadhaar_number ?? '',
    occupation: member.occupation ?? '',
    handled_by_staff: member.handled_by_staff ?? '',
  };
}

export interface CreateMemberResult {
  member: Member;
  /** Set only if a photo was supplied and its upload failed — the member record above still saved regardless (REQ-MEM-004). */
  photoError: string | null;
}

export const memberService = {
  validateNewMember,
  validateMemberEdit,
  isMemberFormValid,
  editDraftFromMember,

  /**
   * Personal Details/Body Metrics/Doctor's Care/Emergency Contact/handled_by_staff save
   * (member-detail.md §13). Returns the coerced payload actually sent, so the caller can
   * merge it into local Member state without re-fetching (types differ from the string-typed
   * draft — e.g. weight_kg goes back to a number here).
   */
  async updateMember(id: number, form: MemberEditDraft): Promise<UpdateMember> {
    const payload: UpdateMember = draftToMemberFieldsUpdate(form);
    await memberRepository.update(id, payload);
    return payload;
  },

  /**
   * Creates the member row, then — as a separate, independent step — uploads/saves the
   * photo if one was supplied. A photo failure never rolls back or blocks the member
   * record; the caller gets the created member back either way (member-management.md §3.1/§4).
   */
  async create(draft: NewMemberDraft, photoFile: File | null): Promise<CreateMemberResult> {
    const member = await memberRepository.create(draftToNewMember(draft));

    if (!photoFile) {
      return { member, photoError: null };
    }
    try {
      await memberService.uploadPhoto(member.id, photoFile);
      return { member, photoError: null };
    } catch {
      return {
        member,
        photoError: "The member was saved, but the photo couldn't be uploaded. You can retry from the member's page.",
      };
    }
  },

  /** Uploads both the original and a compressed thumbnail, then saves both URLs (REQ-MEM-004). */
  async uploadPhoto(memberId: number, file: File): Promise<void> {
    const compressed = await compressImage(file);
    const timestamp = Date.now();
    const originalPath = `${memberId}/original-${timestamp}.jpg`;
    const thumbnailPath = `${memberId}/thumbnail-${timestamp}.jpg`;

    const [originalResult, thumbnailResult] = await Promise.all([
      supabase.storage.from('member-photos').upload(originalPath, file, { upsert: true }),
      supabase.storage.from('member-photos').upload(thumbnailPath, compressed, { upsert: true }),
    ]);
    if (originalResult.error || thumbnailResult.error) {
      // One side may have already landed in storage even though the other failed — clean
      // it up so a failed upload doesn't leave an orphaned blob nothing ever references.
      const uploadedPaths = [
        originalResult.error ? null : originalPath,
        thumbnailResult.error ? null : thumbnailPath,
      ].filter((p): p is string => p !== null);
      if (uploadedPaths.length > 0) {
        await supabase.storage.from('member-photos').remove(uploadedPaths);
      }
      throw originalResult.error ?? thumbnailResult.error;
    }

    try {
      // member-photos is a private bucket — store the bucket-relative path, not a public
      // URL. Resolved to a short-lived signed URL on read (lib/photo-urls.ts), since a
      // signed URL itself can't be persisted (it expires).
      await memberRepository.update(memberId, { photo_url: originalPath, photo_thumbnail_url: thumbnailPath });
    } catch (err) {
      await supabase.storage.from('member-photos').remove([originalPath, thumbnailPath]);
      throw err;
    }
  },
};

export type MemberService = typeof memberService;
