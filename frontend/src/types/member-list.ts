import type { Gender } from './member';

/**
 * Mirrors a `member_list_view` row — see spec/backend/member-management.md §5.
 * One row per non-deleted member, with current membership/add-on info already joined in.
 */
export interface MemberListRow {
  id: number;
  name: string;
  phone: string;
  member_number: string;
  date_of_joining: string;
  gender: Gender;
  /** Resolved to a short-lived signed URL by `memberListRepository.getAll()` (`lib/photo-urls.ts`) — `member-photos` is a private bucket, so the underlying `members` column holds a storage path, not a directly usable URL. */
  photo_url: string | null;
  /** Same path-vs-resolved-URL distinction as `photo_url` above. */
  photo_thumbnail_url: string | null;
  current_membership_plan_id: number | null;
  current_membership_plan_name: string | null;
  current_membership_end_date: string | null;
  current_addon_plan_ids: number[];
}

export type MemberStatus = 'active' | 'expiring' | 'expired';
