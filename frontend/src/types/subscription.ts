import type { Plan } from './plan';

export type PaymentMode = 'Cash' | 'UPI' | 'Card';

/** Mirrors the `subscriptions` header row — see spec/backend/subscription-management.md §2. */
export interface Subscription {
  id: number;
  member_id: number;
  payment_mode: PaymentMode;
  notes: string | null;
  created_at: string;
}

/** Mirrors a `subscription_items` row — one per catalog item selected in a checkout. */
export interface SubscriptionItem {
  id: number;
  subscription_id: number;
  plan_id: number;
  member_id: number;
  /** Only set for a category='membership' item on a max_members=2 plan (REQ-SUB-004). */
  shared_member_id: number | null;
  start_date: string;
  /** NULL for indefinite items (plan.duration_days IS NULL). */
  end_date: string | null;
  quantity: number;
  amount_paid: number;
}

/** A SubscriptionItem joined with its Plan — used by read surfaces like Member Detail. */
export interface SubscriptionItemWithPlan extends SubscriptionItem {
  plan: Plan;
}

/**
 * Payload for one item in a create-subscription call.
 * See spec/backend/subscription-management.md §4 and spec/frontend/subscription-management.md §2.
 * `end_date` is never included — it's computed and returned by the server.
 */
export interface NewSubscriptionItem {
  plan_id: number;
  member_id: number;
  /** Only for a category='membership' item on a max_members=2 plan; omit/null otherwise. */
  shared_member_id: number | null;
  start_date: string;
  /** Rejected by the server for indefinite plans; defaults to 1 if omitted for time-boxed ones. */
  quantity: number | null;
  /** Defaults to plan.price × quantity server-side if omitted. */
  amount_paid: number | null;
}

/**
 * Payload for create-subscription — creates the header and every line item together, in
 * one call. `items` must contain at least one entry, exactly one of which references a
 * category='membership' plan.
 */
export interface NewSubscription {
  member_id: number;
  payment_mode: PaymentMode;
  notes: string | null;
  items: NewSubscriptionItem[];
}

/** Response body from a successful create-subscription call. */
export interface CreateSubscriptionResult {
  subscription: Subscription;
  items: SubscriptionItem[];
}

/**
 * Payload for update-subscription — header-only. Line items have no update path at all
 * (see spec/backend/subscription-management.md §4).
 */
export interface UpdateSubscription {
  subscription_id: number;
  payment_mode?: PaymentMode;
  notes?: string | null;
}
