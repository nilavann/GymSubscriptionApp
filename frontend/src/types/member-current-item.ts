import type { PlanCategory } from './plan';

/**
 * Mirrors a `member_current_items` row — see spec/backend/domain-model.md §Views.
 * "What does this member currently have," across every subscription they're part of,
 * either as the checkout's member_id or a couple-plan line's shared_member_id — the view
 * already unions both roles into this one `member_id` column.
 */
export interface MemberCurrentItem {
  subscription_item_id: number;
  subscription_id: number;
  plan_id: number;
  plan_name: string;
  category: PlanCategory;
  member_id: number;
  start_date: string;
  /** NULL means indefinite (never expires). */
  end_date: string | null;
  quantity: number;
  amount_paid: number;
}
