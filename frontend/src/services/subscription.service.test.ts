import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { currentItem, localDate, plan } from '../test/fixtures';

const monthly = plan({ id: 1, name: 'Monthly', duration_days: 30, price: 1000 });
const quarterly = plan({ id: 2, name: 'Quarterly', duration_days: 90, price: 2500 });
const fee = plan({ id: 3, name: 'Membership Fee', category: 'addon', duration_days: null, price: 500 });
const zumba = plan({ id: 4, name: 'Zumba Class', category: 'addon', duration_days: 30, price: 800 });
const pt = plan({ id: 5, name: 'Personal Training', category: 'addon', duration_days: 30, price: 3000 });
const planById = new Map([monthly, quarterly, fee, zumba, pt].map((p) => [p.id, p]));

function item(overrides: Partial<CheckoutItemDraft>): CheckoutItemDraft {
  return { ...newCheckoutItem('membership'), key: 'k' + Math.random(), ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(localDate(2026, 7, 15));
});

describe('REQ-SUB-001 checkout defaults', () => {
  it('a new item starts with today as start_date, quantity 1, nothing chosen', () => {
    const i = newCheckoutItem('addon');
    expect(i).toMatchObject({ category: 'addon', plan_id: '', start_date: '2026-07-15', quantity: 1, amount_paid: '', isCustomQuantity: false, overlapAcknowledged: false });
  });
  it('every new item gets a unique key', () => {
    expect(newCheckoutItem('membership').key).not.toBe(newCheckoutItem('membership').key);
  });
  it('default amount = plan price x quantity (REQ-SUB-009)', () => {
    expect(defaultAmountPaid(monthly, 1)).toBe(1000);
    expect(defaultAmountPaid(monthly, 2)).toBe(2000);
    expect(defaultAmountPaid(monthly, 12)).toBe(12000);
    expect(defaultAmountPaid(plan({ price: '1000.50' as unknown as number }), 3)).toBeCloseTo(3001.5);
  });
  it('no plan selected -> blank amount', () => expect(defaultAmountPaid(undefined, 1)).toBe(''));
  it('a free plan defaults to 0', () => expect(defaultAmountPaid(plan({ price: 0 }), 5)).toBe(0));
});

describe('REQ-SUB-009 end_date = start + duration x quantity - 1', () => {
  it('x1 monthly starting 1 Jul ends 30 Jul', () => expect(previewEndDate(monthly, '2026-07-01', 1)).toBe('2026-07-30'));
  it('x2 monthly = 60 days', () => expect(previewEndDate(monthly, '2026-07-01', 2)).toBe('2026-08-29'));
  it('x12 monthly = 360 days', () => expect(previewEndDate(monthly, '2026-01-01', 12)).toBe('2026-12-26'));
  it('1-day plan: ends the same day it starts', () => expect(previewEndDate(plan({ duration_days: 1 }), '2026-07-15', 1)).toBe('2026-07-15'));
  it('crosses year boundaries and leap days', () => {
    expect(previewEndDate(monthly, '2026-12-20', 1)).toBe('2027-01-18');
    expect(previewEndDate(plan({ duration_days: 365 }), '2028-01-01', 1)).toBe('2028-12-30');
  });
  it('indefinite plan has no end date', () => expect(previewEndDate(fee, '2026-07-15', 1)).toBeNull());
  it('no plan / no start date -> null', () => {
    expect(previewEndDate(undefined, '2026-07-15', 1)).toBeNull();
    expect(previewEndDate(monthly, '', 1)).toBeNull();
  });
});

describe('Renewal start date default', () => {
  const current = [
    currentItem({ plan_id: 1, category: 'membership', end_date: '2026-08-10' }),
    currentItem({ plan_id: 4, category: 'addon', plan_name: 'Zumba Class', end_date: '2026-07-20' }),
  ];
  it('membership: day after the latest current membership ends', () => expect(defaultStartDateForPlan(quarterly, current)).toBe('2026-08-11'));
  it('add-on: day after the same add-on plan ends', () => expect(defaultStartDateForPlan(zumba, current)).toBe('2026-07-21'));
  it('add-on with no current item of that plan -> today (other add-ons ignored)', () => expect(defaultStartDateForPlan(pt, current)).toBe('2026-07-15'));
  it('no current items at all -> today', () => expect(defaultStartDateForPlan(monthly, [])).toBe('2026-07-15'));
  it('picks the LATEST end date among several current memberships', () => {
    const items = [currentItem({ end_date: '2026-08-01' }), currentItem({ subscription_item_id: 2, end_date: '2026-09-30' })];
    expect(defaultStartDateForPlan(monthly, items)).toBe('2026-10-01');
  });
  it('an indefinite current item cannot be extended -> falls back to today', () => {
    expect(defaultStartDateForPlan(monthly, [currentItem({ end_date: null })])).toBe('2026-07-15');
  });
  it('indefinite outranks a dated one regardless of order', () => {
    const a = [currentItem({ end_date: '2026-09-01' }), currentItem({ subscription_item_id: 2, end_date: null })];
    const b = [...a].reverse();
    expect(defaultStartDateForPlan(monthly, a)).toBe('2026-07-15');
    expect(defaultStartDateForPlan(monthly, b)).toBe('2026-07-15');
  });
});

describe('REQ-SUB-001 item validation', () => {
  it('requires a plan and a start date', () => {
    const errors = validateCheckoutItem(item({ plan_id: '', start_date: '', amount_paid: 10 }), undefined);
    expect(errors).toMatchObject({ plan_id: expect.any(String), start_date: expect.any(String) });
  });
  it('requires an amount; 0 is allowed; negative is not', () => {
    expect(validateCheckoutItem(item({ plan_id: 1, amount_paid: '' }), monthly).amount_paid).toBeDefined();
    expect(validateCheckoutItem(item({ plan_id: 1, amount_paid: 0 }), monthly).amount_paid).toBeUndefined();
    expect(validateCheckoutItem(item({ plan_id: 1, amount_paid: -1 }), monthly).amount_paid).toBeDefined();
  });
  it.each([0, -1, 1.5, NaN])('rejects quantity %s for a timed plan', (quantity) => {
    expect(validateCheckoutItem(item({ plan_id: 1, quantity, amount_paid: 1 }), monthly).quantity).toBeDefined();
  });
  it.each([1, 2, 3, 6, 12, 24])('accepts quantity %s (presets and custom)', (quantity) => {
    expect(validateCheckoutItem(item({ plan_id: 1, quantity, amount_paid: 1 }), monthly).quantity).toBeUndefined();
  });
  it('quantity is not validated for indefinite items (not applicable)', () => {
    expect(validateCheckoutItem(item({ plan_id: 3, category: 'addon', quantity: 0, amount_paid: 1 }), fee).quantity).toBeUndefined();
  });
});

describe('REQ-SUB-001 exactly one membership item', () => {
  const ok = [{}];
  it('valid with exactly one membership item', () => expect(isCheckoutValid(ok, 1)).toBe(true));
  it('blocked with zero membership items', () => expect(isCheckoutValid(ok, 0)).toBe(false));
  it('blocked with two membership items', () => expect(isCheckoutValid([{}, {}], 2)).toBe(false));
  it('blocked when any item has a field error, even with one membership item', () => expect(isCheckoutValid([{}, { amount_paid: 'x' }], 1)).toBe(false));
  it('add-ons alongside the membership item are fine', () => expect(isCheckoutValid([{}, {}, {}], 1)).toBe(true));
});

describe('REQ-SUB-005 overlap: membership items (spec: ANY existing membership item, regardless of plan_id)', () => {
  const existingMonthly = currentItem({ plan_id: 1, plan_name: 'Monthly', category: 'membership', start_date: '2026-07-01', end_date: '2026-07-30' });

  it('same plan, overlapping dates -> conflict naming the plan and its end date', () => {
    const i = item({ plan_id: 1, start_date: '2026-07-20' });
    expect(findItemOverlap(i, [i], planById, [existingMonthly])).toEqual({ planName: 'Monthly', existingEndDate: '2026-07-30' });
  });
  it('same plan, starting the day after the existing one ends -> no conflict', () => {
    const i = item({ plan_id: 1, start_date: '2026-07-31' });
    expect(findItemOverlap(i, [i], planById, [existingMonthly])).toBeNull();
  });
  it('same plan, starting ON the last day of the existing item -> conflict (inclusive ranges)', () => {
    const i = item({ plan_id: 1, start_date: '2026-07-30' });
    expect(findItemOverlap(i, [i], planById, [existingMonthly])).not.toBeNull();
  });
  it('new item that ends exactly on the existing start date -> conflict', () => {
    const i = item({ plan_id: 1, start_date: '2026-06-01', quantity: 1 }); // 6/1..6/30 does not reach 7/1
    expect(findItemOverlap(i, [i], planById, [existingMonthly])).toBeNull();
    const j = item({ plan_id: 1, start_date: '2026-06-02' }); // 6/2..7/1 touches 7/1
    expect(findItemOverlap(j, [j], planById, [existingMonthly])).not.toBeNull();
  });
  it('existing indefinite item is treated as open-ended (always overlaps)', () => {
    const indefinite = currentItem({ plan_id: 1, start_date: '2020-01-01', end_date: null });
    const i = item({ plan_id: 1, start_date: '2030-01-01' });
    expect(findItemOverlap(i, [i], planById, [indefinite])).toEqual({ planName: 'Monthly', existingEndDate: null });
  });
  it('quantity extends the new item\'s range (x3 monthly reaches into a later existing item)', () => {
    const later = currentItem({ plan_id: 1, start_date: '2026-09-15', end_date: '2026-10-14' });
    const short = item({ plan_id: 1, start_date: '2026-07-31', quantity: 1 });
    const long = item({ plan_id: 1, start_date: '2026-07-31', quantity: 3 });
    expect(findItemOverlap(short, [short], planById, [later])).toBeNull();
    expect(findItemOverlap(long, [long], planById, [later])).not.toBeNull();
  });
  it('no plan chosen yet / no start date -> never warns', () => {
    expect(findItemOverlap(item({ plan_id: '' }), [], planById, [existingMonthly])).toBeNull();
    expect(findItemOverlap(item({ plan_id: 1, start_date: '' }), [], planById, [existingMonthly])).toBeNull();
  });
  it('no current items -> no conflict', () => {
    const i = item({ plan_id: 1 });
    expect(findItemOverlap(i, [i], planById, [])).toBeNull();
  });

  // The spec (requirements-template REQ-SUB-005, backend/business-logic.md "Subscription Overlap Guard",
  // frontend/subscription-management.md §5) says a member logically has ONE membership at a time, so a
  // Quarterly overlapping an existing Monthly must warn. The implementation only compares identical plan_ids.
  it.fails('SPEC GAP: membership of a DIFFERENT plan overlapping an existing membership must warn', () => {
    const i = item({ plan_id: 2, start_date: '2026-07-20' }); // Quarterly while Monthly runs to 7/30
    expect(findItemOverlap(i, [i], planById, [existingMonthly])).not.toBeNull();
  });
});

describe('REQ-SUB-008 overlap: add-on items (same plan_id only)', () => {
  const existingZumba = currentItem({ plan_id: 4, plan_name: 'Zumba Class', category: 'addon', start_date: '2026-07-01', end_date: '2026-07-30' });
  it('two overlapping instances of the same add-on conflict', () => {
    const i = item({ category: 'addon', plan_id: 4, start_date: '2026-07-15' });
    expect(findItemOverlap(i, [i], planById, [existingZumba])).toEqual({ planName: 'Zumba Class', existingEndDate: '2026-07-30' });
  });
  it('a DIFFERENT add-on overlapping does not conflict (several add-ons run concurrently)', () => {
    const i = item({ category: 'addon', plan_id: 5, start_date: '2026-07-15' });
    expect(findItemOverlap(i, [i], planById, [existingZumba])).toBeNull();
  });
  it('add-on overlapping a membership item does not conflict', () => {
    const membershipOnly = currentItem({ plan_id: 1, category: 'membership', end_date: '2026-07-30' });
    const i = item({ category: 'addon', plan_id: 4, start_date: '2026-07-15' });
    expect(findItemOverlap(i, [i], planById, [membershipOnly])).toBeNull();
  });
  it('same add-on, non-overlapping later term -> no conflict', () => {
    const i = item({ category: 'addon', plan_id: 4, start_date: '2026-07-31' });
    expect(findItemOverlap(i, [i], planById, [existingZumba])).toBeNull();
  });
  it('also checks against OTHER items in the same in-progress checkout', () => {
    const a = item({ category: 'addon', plan_id: 4, start_date: '2026-08-01' });
    const b = item({ category: 'addon', plan_id: 4, start_date: '2026-08-10' });
    expect(findItemOverlap(b, [a, b], planById, [])).toEqual({ planName: 'Zumba Class', existingEndDate: '2026-08-30' });
    expect(findItemOverlap(a, [a, b], planById, [])).not.toBeNull();
  });
  it('an item never conflicts with itself', () => {
    const a = item({ category: 'addon', plan_id: 4 });
    expect(findItemOverlap(a, [a], planById, [])).toBeNull();
  });
  it('two different add-ons in the same checkout do not conflict', () => {
    const a = item({ category: 'addon', plan_id: 4 });
    const b = item({ category: 'addon', plan_id: 5 });
    expect(findItemOverlap(a, [a, b], planById, [])).toBeNull();
  });
  it('acknowledged overlap state lives on the item (server stores nothing)', () => {
    expect(newCheckoutItem('addon').overlapAcknowledged).toBe(false);
  });
});

describe('Initial checkout (renewal prefill)', () => {
  const plans = [monthly, quarterly, zumba, pt];
  it('with no history: one blank membership item, no add-ons', () => {
    const items = buildInitialCheckoutItems([], plans);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: 'membership', plan_id: '' });
  });
  it('prefills the current membership and one add-on card per current add-on', () => {
    const current = [
      currentItem({ plan_id: 1, category: 'membership', end_date: '2026-07-20' }),
      currentItem({ subscription_item_id: 2, plan_id: 4, plan_name: 'Zumba', category: 'addon', end_date: '2026-07-25' }),
      currentItem({ subscription_item_id: 3, plan_id: 5, plan_name: 'PT', category: 'addon', end_date: '2026-07-18' }),
    ];
    const items = buildInitialCheckoutItems(current, plans);
    expect(items.map((i) => [i.category, i.plan_id])).toEqual([['membership', 1], ['addon', 4], ['addon', 5]]);
    expect(items[0].start_date).toBe('2026-07-21');
    expect(items[0].amount_paid).toBe(1000);
    expect(items[1].start_date).toBe('2026-07-26');
  });
  it('a current item whose plan was since removed from the catalog leaves a blank card instead of crashing', () => {
    const items = buildInitialCheckoutItems([currentItem({ plan_id: 999 })], plans);
    expect(items[0]).toMatchObject({ category: 'membership', plan_id: '' });
  });
});
