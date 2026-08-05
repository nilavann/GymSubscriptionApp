import { supabase } from '../lib/supabase-client';
import { resolvePhotoUrls } from '../lib/photo-urls';
import { extractFunctionErrorMessage } from '../lib/edge-function-error';
import type { Member, NewMember, UpdateMember } from '../types/member';

// Inlined as a literal in every .select() call below (not shared as a variable) — supabase-js
// parses the select string at the type level to infer the result shape, which only works for
// a literal it can see at the call site, not a runtime string constant.

/**
 * Direct RLS-guarded reads/writes — no Edge Function involved (member-management.md §7).
 * `member_number`/`created_by` are never sent; `branch_id` is never sent on update — see
 * NewMember/UpdateMember (types/member.ts) for why those aren't even accepted as inputs.
 */
const MEMBER_SELECT =
  'id, name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm, under_doctor_care, doctor_care_details, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, email, residential_address, aadhaar_number, occupation, photo_url, photo_thumbnail_url, branch_id, member_number, handled_by_staff, created_by' as const;

export const memberRepository = {
  /** Live row count for the Settings hub's Data Management card (screens.md WSCR-11). */
  async getCount(): Promise<number> {
    const { count, error } = await supabase.from('members').select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  async getById(id: number): Promise<Member | null> {
    const { data, error } = await supabase.from('members').select(MEMBER_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const [resolved] = await resolvePhotoUrls([data as unknown as Member]);
    return resolved;
  },

  async create(data: NewMember): Promise<Member> {
    const { data: created, error } = await supabase.from('members').insert(data).select(MEMBER_SELECT).single();
    if (error) throw new Error(error.message);
    return created as unknown as Member;
  },

  async update(id: number, data: UpdateMember): Promise<void> {
    const { error } = await supabase.from('members').update(data).eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Soft delete only (REQ-MEM-007) — never a real DELETE, database.md enforces this at the
   * trigger level too. Routed through the delete-member Edge Function (not a direct update
   * like create/update above) because this is the one member write that needs an
   * authoritative, server-side usage guard — see member-management.md §9.
   */
  async delete(id: number): Promise<void> {
    const { error } = await supabase.functions.invoke('delete-member', { body: { member_id: id } });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
  },
};

export type MemberRepository = typeof memberRepository;
