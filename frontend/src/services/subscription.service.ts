import { addDays, todayDate } from '../lib/datetime';
import type { Plan } from '../types/plan';
import type { MemberCurrentItem } from '../types/member-current-item';

/** One in-progress item in the checkout being built — see spec/frontend/subscription-management.md §2. */
export interface CheckoutItemDraft {
  key: string;
  plan_id: number | '';
  start_date: string;
  quantity: number | '';
  amount_paid: number | '';
  /** Once true, plan/quantity changes stop overwriting amount_paid — same "smart default,
   * always overridable" rule the create-subscription Edge Function itself uses. */
  amountTouched: boolean;
  shared_member_id: number | '';
}

export function newCheckoutItem(): CheckoutItemDraft {
  return {
    key: crypto.randomUUID(),
    plan_id: '',
    start_date: todayDate(),
    quantity: 1,
    amount_paid: '',
    amountTouched: false,
    shared_member_id: '',
  };
}

/**
 * Renewal Start Date Default (spec/frontend/subscription-management.md §4) — per item,
 * scoped the same way the overlap check (below) is scoped: membership items look at any
 * current membership item; add-on items look at a current item of the same plan only.
 */
export function defaultStartDateForPlan(plan: Plan, currentItems: MemberCurrentItem[]): string {
  const candidates =
    plan.category === 'membership'
      ? currentItems.filter((item) => item.category === 'membership')
      : currentItems.filter((item) => item.category === 'addon' && item.plan_id === plan.id);

  if (candidates.length === 0) return todayDate();

  // Indefinite (end_date null) outranks any dated item, same "furthest from expiring" rule
  // member_list_view uses - but there's no date to add a day to, so fall back to today.
  const latest = candidates.reduce((best, item) => {
    if (item.end_date === null) return item;
    if (best.end_date === null) return best;
    return item.end_date > best.end_date ? item : best;
  });

  return latest.end_date === null ? todayDate() : addDays(latest.end_date, 1);
}

/** end_date preview only — the authoritative value always comes back from create-subscription. */
export function previewEndDate(plan: Plan | undefined, startDate: string, quantity: number): string | null {
  if (!plan || plan.duration_days === null || !startDate) return null;
  return addDays(startDate, plan.duration_days * quantity - 1);
}

export function defaultAmountPaid(plan: Plan | undefined, quantity: number): number | '' {
  if (!plan) return '';
  return Number(plan.price) * quantity;
}

export interface CheckoutItemErrors {
  plan_id?: string;
  start_date?: string;
  quantity?: string;
  amount_paid?: string;
  shared_member_id?: string;
}

/**
 * Per-item validation, client-side only, mirrors create-subscription's own checks for
 * instant feedback (backend spec §4 steps 3b/3e). `memberId` is the member this whole
 * checkout is for — needed to reject a shared_member_id that's just the member themself
 * (chk_subscription_item_shared_member_distinct enforces this server-side too).
 */
export function validateCheckoutItem(item: CheckoutItemDraft, plan: Plan | undefined, memberId: number): CheckoutItemErrors {
  const errors: CheckoutItemErrors = {};
  if (item.plan_id === '') errors.plan_id = 'Select a plan';
  if (!item.start_date) errors.start_date = 'Select a start date';

  if (plan && plan.duration_days !== null) {
    if (item.quantity === '' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.quantity = 'Enter a valid quantity';
    }
  }

  if (item.amount_paid === '' || item.amount_paid < 0) {
    errors.amount_paid = 'Enter a valid amount';
  }

  if (item.shared_member_id !== '' && item.shared_member_id === memberId) {
    errors.shared_member_id = 'Shared member cannot be the same as the member this checkout is for';
  }

  return errors;
}

export function isCheckoutValid(itemErrors: CheckoutItemErrors[], membershipItemCount: number): boolean {
  return membershipItemCount === 1 && itemErrors.every((errors) => Object.keys(errors).length === 0);
}

export interface OverlapConflict {
  itemKey: string;
  planName: string;
  existingStartDate: string;
  existingEndDate: string | null;
}

function rangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  const aEndOrInfinity = aEnd ?? '9999-12-31';
  const bEndOrInfinity = bEnd ?? '9999-12-31';
  return aStart <= bEndOrInfinity && bStart <= aEndOrInfinity;
}

/**
 * Overlap Warning (REQ-SUB-005/008, subscription-management.md §5) — entirely client-side,
 * no backend equivalent. Checks each item against the member's existing current items and
 * every other item already added in this same in-progress checkout.
 */
export function findOverlapConflicts(
  items: CheckoutItemDraft[],
  planById: Map<number, Plan>,
  currentItems: MemberCurrentItem[]
): OverlapConflict[] {
  const conflicts: OverlapConflict[] = [];

  items.forEach((item, index) => {
    if (item.plan_id === '' || !item.start_date) return;
    const plan = planById.get(item.plan_id);
    if (!plan) return;
    const quantity = item.quantity === '' ? 1 : item.quantity;
    const endDate = previewEndDate(plan, item.start_date, quantity);

    const conflictsWithExisting = currentItems.filter((existing) =>
      plan.category === 'membership' ? existing.category === 'membership' : existing.plan_id === plan.id
    );
    for (const existing of conflictsWithExisting) {
      if (rangesOverlap(item.start_date, endDate, existing.start_date, existing.end_date)) {
        conflicts.push({
          itemKey: item.key,
          planName: existing.plan_name,
          existingStartDate: existing.start_date,
          existingEndDate: existing.end_date,
        });
      }
    }

    // Same in-progress checkout - only compare against earlier items to avoid reporting each pair twice.
    for (let otherIndex = 0; otherIndex < index; otherIndex++) {
      const other = items[otherIndex];
      if (other.plan_id === '' || !other.start_date) continue;
      const otherPlan = planById.get(other.plan_id);
      if (!otherPlan) continue;
      const sameScope = plan.category === 'membership' ? otherPlan.category === 'membership' : otherPlan.id === plan.id;
      if (!sameScope) continue;
      const otherQuantity = other.quantity === '' ? 1 : other.quantity;
      const otherEndDate = previewEndDate(otherPlan, other.start_date, otherQuantity);
      if (rangesOverlap(item.start_date, endDate, other.start_date, otherEndDate)) {
        conflicts.push({
          itemKey: item.key,
          planName: otherPlan.name,
          existingStartDate: other.start_date,
          existingEndDate: otherEndDate,
        });
      }
    }
  });

  return conflicts;
}

export type SubscriptionService = typeof subscriptionService;

export const subscriptionService = {
  newCheckoutItem,
  defaultStartDateForPlan,
  previewEndDate,
  defaultAmountPaid,
  validateCheckoutItem,
  isCheckoutValid,
  findOverlapConflicts,
};
