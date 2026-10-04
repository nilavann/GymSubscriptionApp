import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInitialCheckoutItems,
  defaultAmountPaid,
  defaultStartDateForPlan,
  findItemOverlap,
  isCheckoutValid,
  newCheckoutItem,
  previewEndDate,
  validateCheckoutItem,
  type CheckoutItemDraft,
} from './subscription.service';
import { buildPlan } from '../test/builders';
import type { MemberCurrentItem } from '../types/member-current-item';
import type { Plan } from '../types/plan';

// Pure logic, no repository involved. "Today" is pinned to 27 Jun 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 27, 12, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

const monthly = buildPlan({ id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1500 });
const yoga = buildPlan({ id: 2, name: 'Yoga', category: 'addon', duration_days: 30, price: 500 });
const joiningFee = buildPlan({ id: 3, name: 'Joining Fee', category: 'addon', duration_days: null, price: 300 });

const currentItem = (plan: Plan, start_date: string, end_date: string | null): MemberCurrentItem => ({
  subscription_item_id: plan.id * 10,
  subscription_id: 1,
  plan_id: plan.id,
  plan_name: plan.name,
  category: plan.category,
  member_id: 1,
  start_date,
  end_date,
  quantity: 1,
  amount_paid: plan.price,
});

const draftItem = (overrides: Partial<CheckoutItemDraft> = {}): CheckoutItemDraft => ({
  ...newCheckoutItem('membership'),
  plan_id: 1,
  start_date: '2026-07-01',
  amount_paid: 1500,
  ...overrides,
});

describe('newCheckoutItem', () => {
  it('starts blank, today, quantity 1, with a unique key', () => {
    const a = newCheckoutItem('membership');
    const b = newCheckoutItem('addon');
    expect(a).toMatchObject({
      category: 'membership',
      plan_id: '',
      start_date: '2026-06-27',
      quantity: 1,
      isCustomQuantity: false,
      amount_paid: '',
      overlapAcknowledged: false,
    });
    expect(a.key).not.toBe(b.key);
  });
});

describe('previewEndDate / defaultAmountPaid', () => {
  it('is start + duration x quantity - 1 days', () => {
    expect(previewEndDate(monthly, '2026-07-01', 1)).toBe('2026-07-30');
    expect(previewEndDate(monthly, '2026-07-01', 3)).toBe('2026-09-28');
  });

  it('has no end date for an indefinite plan, a missing plan or a missing start', () => {
    expect(previewEndDate(joiningFee, '2026-07-01', 1)).toBeNull();
    expect(previewEndDate(undefined, '2026-07-01', 1)).toBeNull();
    expect(previewEndDate(monthly, '', 1)).toBeNull();
  });

  it('defaults the amount to price x quantity, or blank with no plan', () => {
    expect(defaultAmountPaid(monthly, 3)).toBe(4500);
    expect(defaultAmountPaid(undefined, 1)).toBe('');
  });
});

describe('defaultStartDateForPlan', () => {
  it('is today when the member has nothing current', () => {
    expect(defaultStartDateForPlan(monthly, [])).toBe('2026-06-27');
  });

  it('starts a membership the day after the latest current membership ends', () => {
    const items = [currentItem(monthly, '2026-05-01', '2026-06-15'), currentItem(monthly, '2026-06-16', '2026-07-15')];
    expect(defaultStartDateForPlan(monthly, items)).toBe('2026-07-16');
  });

  it('falls back to today when the current item is indefinite (no date to add a day to)', () => {
    expect(defaultStartDateForPlan(monthly, [currentItem(monthly, '2026-01-01', null)])).toBe('2026-06-27');
  });

  it('looks only at the same add-on plan for an add-on, ignoring membership and other add-ons', () => {
    const items = [currentItem(monthly, '2026-06-01', '2026-12-31'), currentItem(joiningFee, '2026-06-01', '2027-01-31')];
    expect(defaultStartDateForPlan(yoga, items)).toBe('2026-06-27');
    expect(defaultStartDateForPlan(yoga, [...items, currentItem(yoga, '2026-06-01', '2026-07-10')])).toBe('2026-07-11');
  });
});

describe('validateCheckoutItem', () => {
  it('accepts a complete item', () => {
    expect(validateCheckoutItem(draftItem(), monthly)).toEqual({});
  });

  it('requires a plan, a start date and an amount', () => {
    expect(validateCheckoutItem(draftItem({ plan_id: '', start_date: '', amount_paid: '' }), undefined)).toEqual({
      plan_id: 'Select a plan',
      start_date: 'Select a start date',
      amount_paid: 'Enter a valid amount',
    });
  });

  it('rejects a non-positive or fractional quantity for a time-boxed plan only', () => {
    expect(validateCheckoutItem(draftItem({ quantity: 0 }), monthly)).toHaveProperty('quantity');
    expect(validateCheckoutItem(draftItem({ quantity: 1.5 }), monthly)).toHaveProperty('quantity');
    expect(validateCheckoutItem(draftItem({ plan_id: 3, quantity: 0 }), joiningFee)).not.toHaveProperty('quantity');
  });

  it('rejects a negative amount but allows 0', () => {
    expect(validateCheckoutItem(draftItem({ amount_paid: -1 }), monthly)).toHaveProperty('amount_paid');
    expect(validateCheckoutItem(draftItem({ amount_paid: 0 }), monthly)).toEqual({});
  });
});

describe('isCheckoutValid', () => {
  it('needs EXACTLY one membership item and no item errors', () => {
    expect(isCheckoutValid([{}, {}], 1)).toBe(true);
    expect(isCheckoutValid([{}], 0)).toBe(false);
    expect(isCheckoutValid([{}, {}], 2)).toBe(false);
    expect(isCheckoutValid([{ plan_id: 'Select a plan' }], 1)).toBe(false);
  });
});

describe('buildInitialCheckoutItems', () => {
  it('starts with one blank membership item for a member with nothing current', () => {
    const items = buildInitialCheckoutItems([], [monthly, yoga]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: 'membership', plan_id: '' });
  });

  it('prefills the current membership and adds a card per current add-on ("renew what they have")', () => {
    const current = [currentItem(monthly, '2026-06-01', '2026-06-30'), currentItem(yoga, '2026-06-01', '2026-06-30')];
    const items = buildInitialCheckoutItems(current, [monthly, yoga]);

    expect(items.map((i) => [i.category, i.plan_id, i.start_date, i.amount_paid])).toEqual([
      ['membership', 1, '2026-07-01', 1500],
      ['addon', 2, '2026-07-01', 500],
    ]);
  });

  it('leaves an item blank when its plan no longer exists in the catalog', () => {
    const items = buildInitialCheckoutItems([currentItem(monthly, '2026-06-01', '2026-06-30')], [yoga]);
    expect(items[0].plan_id).toBe('');
  });
});

describe('findItemOverlap', () => {
  const planById = new Map<number, Plan>([monthly, yoga, joiningFee].map((p) => [p.id, p]));

  it('flags a new item that overlaps the same plan the member already has', () => {
    const conflict = findItemOverlap(draftItem({ start_date: '2026-07-10' }), [], planById, [
      currentItem(monthly, '2026-06-16', '2026-07-15'),
    ]);
    expect(conflict).toEqual({ planName: 'Monthly', existingEndDate: '2026-07-15' });
  });

  it('does not flag back-to-back periods (new starts the day after the old ends)', () => {
    const conflict = findItemOverlap(draftItem({ start_date: '2026-07-16' }), [], planById, [
      currentItem(monthly, '2026-06-16', '2026-07-15'),
    ]);
    expect(conflict).toBeNull();
  });

  it('is plan-scoped: a different plan never conflicts', () => {
    const conflict = findItemOverlap(draftItem({ plan_id: 2, category: 'addon', start_date: '2026-07-01' }), [], planById, [
      currentItem(monthly, '2026-06-01', '2026-12-31'),
    ]);
    expect(conflict).toBeNull();
  });

  it('treats an indefinite existing item as never ending', () => {
    const conflict = findItemOverlap(draftItem({ plan_id: 3, category: 'addon', start_date: '2030-01-01' }), [], planById, [
      currentItem(joiningFee, '2026-01-01', null),
    ]);
    expect(conflict).toEqual({ planName: 'Joining Fee', existingEndDate: null });
  });

  it('also checks the other items in the same in-progress checkout, but not the item itself', () => {
    const first = draftItem({ start_date: '2026-07-01' });
    const second = draftItem({ start_date: '2026-07-10' });
    expect(findItemOverlap(second, [first, second], planById, [])).toEqual({
      planName: 'Monthly',
      existingEndDate: '2026-07-30',
    });
    expect(findItemOverlap(first, [first], planById, [])).toBeNull();
  });

  it('returns null while the plan or start date is not chosen yet', () => {
    expect(findItemOverlap(draftItem({ plan_id: '' }), [], planById, [])).toBeNull();
    expect(findItemOverlap(draftItem({ start_date: '' }), [], planById, [])).toBeNull();
  });
});
