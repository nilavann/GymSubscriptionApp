import { supabase } from '../lib/supabase-client';
import { resolvePhotoUrls } from '../lib/photo-urls';
import type { MemberListRow } from '../types/member-list';

const MEMBER_LIST_SELECT =
  'id, name, phone, member_number, date_of_joining, gender, photo_url, photo_thumbnail_url, current_membership_plan_id, current_membership_plan_name, current_membership_end_date, current_addon_plan_ids' as const;

/**
 * Reads from `member_list_view` (spec/backend/member-management.md §5) — never re-derives
 * this from raw `subscription_items` on the client. Fetches the full result set once per
 * route entry; search/filter/sort all happen client-side over it (performance note, same doc).
 */
export const memberListRepository = {
  async getAll(): Promise<MemberListRow[]> {
    const { data, error } = await supabase
      .from('member_list_view')
      .select(MEMBER_LIST_SELECT)
      .order('date_of_joining', { ascending: false });
    if (error) throw error;
    return resolvePhotoUrls((data ?? []) as unknown as MemberListRow[]);
  },
};

export type MemberListRepository = typeof memberListRepository;
