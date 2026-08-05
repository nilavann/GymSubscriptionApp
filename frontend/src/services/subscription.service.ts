import { addDays, todayDate } from '../lib/datetime';
import type { Plan, PlanCategory } from '../types/plan';
import type { MemberCurrentItem } from '../types/member-current-item';

/** One in-progress item in the checkout being built — see frontend/src/renew-checkout-page.md §4. */
export interface CheckoutItemDraft {
  key: string;
  /** Fixed at creation — governs which plans the item's Plan select offers. */
  category: PlanCategory;
  plan_id: number | '';
  start_date: string;
  quantity: number;
  /** Whether the Quantity field is showing the custom number input instead of the preset chips. */
  isCustomQuantity: boolean;
  amount_paid: number | '';
  /** Set by the item's own "Save anyway" — silences its overlap warning until the item changes again. */
  overlapAcknowledged: boolean;
}

export function newCheckoutItem(category: PlanCategory): CheckoutItemDraft {
  return {
    key: crypto.randomUUID(),
    category,
    plan_id: '',
    start_date: todayDate(),
    quantity: 1,
    isCustomQuantity: false,
    amount_paid: '',
    overlapAcknowledged: false,
  };
}

/**
 * Renewal Start Date Default (§4) — a Membership item looks at any current membership item;
 * an Add-on item looks at a current item of that same add-on plan only.
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
}

/** Per-item validation, client-side only, mirrors create-subscription's own checks for instant feedback. */
export function validateCheckoutItem(item: CheckoutItemDraft, plan: Plan | undefined): CheckoutItemErrors {
  const errors: CheckoutItemErrors = {};
  if (item.plan_id === '') errors.plan_id = 'Select a plan';
  if (!item.start_date) errors.start_date = 'Select a start date';

  if (plan && plan.duration_days !== null) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.quantity = 'Enter a valid quantity';
    }
  }

  if (item.amount_paid === '' || item.amount_paid < 0) {
    errors.amount_paid = 'Enter a valid amount';
  }

  return errors;
}

export function isCheckoutValid(itemErrors: CheckoutItemErrors[], membershipItemCount: number): boolean {
  return membershipItemCount === 1 && itemErrors.every((errors) => Object.keys(errors).length === 0);
}

/**
 * Default state (§7): the Membership item is prefilled from the member's current membership,
 * and an Add-on card is added for each add-on the member currently has, so "Renew" reads as
 * "renew what they already have" rather than a blank form.
 */
export function buildInitialCheckoutItems(currentItems: MemberCurrentItem[], plans: Plan[]): CheckoutItemDraft[] {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const currentMembership = currentItems.find((item) => item.category === 'membership');
  const currentAddons = currentItems.filter((item) => item.category === 'addon');

  function prefill(category: PlanCategory, current: MemberCurrentItem | undefined): CheckoutItemDraft {
    const item = newCheckoutItem(category);
    const plan = current ? planById.get(current.plan_id) : undefined;
    if (!plan) return item;
    item.plan_id = plan.id;
    item.start_date = defaultStartDateForPlan(plan, currentItems);
    item.amount_paid = defaultAmountPaid(plan, item.quantity);
    return item;
  }

  return [prefill('membership', currentMembership), ...currentAddons.map((addon) => prefill('addon', addon))];
}

function rangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  const aEndOrInfinity = aEnd ?? '9999-12-31';
  const bEndOrInfinity = bEnd ?? '9999-12-31';
  return aStart <= bEndOrInfinity && bStart <= aEndOrInfinity;
}

export interface ItemOverlapConflict {
  planName: string;
  existingEndDate: string | null;
}

/**
 * Overlap Warning (§4) — plan-scoped per the spec ("overlaps with an existing active
 * subscription of the same plan"), checked against both the member's current items and
 * every other item already in this same in-progress checkout. Returns the first conflict
 * found; the UI only ever surfaces one at a time per item.
 */
export function findItemOverlap(
  item: CheckoutItemDraft,
  items: CheckoutItemDraft[],
  planById: Map<number, Plan>,
  currentItems: MemberCurrentItem[]
): ItemOverlapConflict | null {
  if (item.plan_id === '' || !item.start_date) return null;
  const plan = planById.get(item.plan_id);
  if (!plan) return null;
  const endDate = previewEndDate(plan, item.start_date, item.quantity);

  const existingConflict = currentItems.find(
    (existing) => existing.plan_id === item.plan_id && rangesOverlap(item.start_date, endDate, existing.start_date, existing.end_date)
  );
  if (existingConflict) {
    return { planName: existingConflict.plan_name, existingEndDate: existingConflict.end_date };
  }

  for (const other of items) {
    if (other.key === item.key || other.plan_id !== item.plan_id || !other.start_date) continue;
    const otherPlan = planById.get(other.plan_id);
    if (!otherPlan) continue;
    const otherEndDate = previewEndDate(otherPlan, other.start_date, other.quantity);
    if (rangesOverlap(item.start_date, endDate, other.start_date, otherEndDate)) {
      return { planName: otherPlan.name, existingEndDate: otherEndDate };
    }
  }

  return null;
}

export type SubscriptionService = typeof subscriptionService;

export const subscriptionService = {
  newCheckoutItem,
  defaultStartDateForPlan,
  previewEndDate,
  defaultAmountPaid,
  validateCheckoutItem,
  isCheckoutValid,
  findItemOverlap,
  buildInitialCheckoutItems,
};
