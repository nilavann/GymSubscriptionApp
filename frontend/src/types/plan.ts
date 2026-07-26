export type PlanCategory = 'membership' | 'addon';

/** Mirrors the `plans` row — see spec/backend/subscription-management.md §2 / domain-model.md §3. */
export interface Plan {
  id: number;
  name: string;
  category: PlanCategory;
  /** NULL means indefinite: never expires (e.g. a one-time "Membership Fee"). */
  duration_days: number | null;
  price: number;
  /** Only meaningful when category = 'membership'; 2 means a couple plan (see SubscriptionItem.shared_member_id). */
  max_members: number;
}
