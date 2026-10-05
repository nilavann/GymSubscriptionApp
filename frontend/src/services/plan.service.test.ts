import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanRepository } from '../repositories/plan.repository';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('../repositories/plan.repository', () => ({
  planRepository: { create: mocks.create, update: mocks.update } satisfies Partial<PlanRepository>,
}));

import { emptyPlanDraft, isPlanFormValid, planService, planToDraft, validatePlan, type PlanDraft } from './plan.service';
import { buildPlan } from '../test/builders';

const draft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  name: 'Monthly',
  category: 'membership',
  duration_days: 30,
  neverExpires: false,
  price: '1500',
  max_members: 1,
  ...overrides,
});

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('validatePlan', () => {
  it('accepts a valid membership plan', () => {
    const errors = validatePlan(draft());
    expect(errors).toEqual({});
    expect(isPlanFormValid(errors)).toBe(true);
  });

  it('requires a name and a category', () => {
    expect(validatePlan(draft({ name: ' ', category: '' }))).toMatchObject({
      name: 'Name is required',
      category: 'Select a category',
    });
  });

  it.each([
    ['empty', ''],
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1.5],
  ])('rejects a %s duration for a membership plan', (_label, duration_days) => {
    expect(validatePlan(draft({ duration_days: duration_days as PlanDraft['duration_days'] }))).toHaveProperty('duration_days');
  });

  it('lets an add-on skip duration only when it never expires', () => {
    expect(validatePlan(draft({ category: 'addon', neverExpires: true, duration_days: '' }))).toEqual({});
    expect(validatePlan(draft({ category: 'addon', neverExpires: false, duration_days: '' }))).toHaveProperty('duration_days');
  });

  it.each([
    ['empty', ''],
    ['negative', '-1'],
    ['non-numeric', 'abc'],
  ])('rejects a %s price', (_label, price) => {
    expect(validatePlan(draft({ price }))).toHaveProperty('price', 'Enter a valid price');
  });

  it('accepts a price of 0 (a free add-on)', () => {
    expect(validatePlan(draft({ price: '0' }))).toEqual({});
  });
});

describe('plan drafts', () => {
  it('starts empty with no category selected', () => {
    expect(emptyPlanDraft()).toEqual({ name: '', category: '', duration_days: '', neverExpires: false, price: '', max_members: 1 });
  });

  it('maps an indefinite add-on to neverExpires, and a membership with no duration to an empty duration', () => {
    expect(planToDraft(buildPlan({ category: 'addon', duration_days: null })).neverExpires).toBe(true);
    expect(planToDraft(buildPlan({ category: 'membership', duration_days: null })).neverExpires).toBe(false);
  });

  it('stringifies the price and normalises max_members to 1 or 2', () => {
    const result = planToDraft(buildPlan({ price: 999.5, max_members: 2 }));
    expect(result.price).toBe('999.5');
    expect(result.max_members).toBe(2);
    expect(planToDraft(buildPlan({ max_members: 5 })).max_members).toBe(1);
  });
});

describe('planService.create / update payloads', () => {
  it('trims the name, coerces the price, and keeps max_members for a membership', async () => {
    mocks.create.mockResolvedValue(buildPlan());
    await planService.create(draft({ name: '  Couple  ', price: '2500', max_members: 2 }));
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Couple',
      category: 'membership',
      duration_days: 30,
      price: 2500,
      max_members: 2,
    });
  });

  it('stores an indefinite add-on as duration null and forces max_members to 1', async () => {
    mocks.create.mockResolvedValue(buildPlan());
    await planService.create(draft({ category: 'addon', neverExpires: true, duration_days: 45, max_members: 2 }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ category: 'addon', duration_days: null, max_members: 1 }));
  });

  it('sends the same payload shape on update', async () => {
    mocks.update.mockResolvedValue(undefined);
    await planService.update(4, draft({ name: 'Quarterly', duration_days: 90 }));
    expect(mocks.update).toHaveBeenCalledWith(4, expect.objectContaining({ name: 'Quarterly', duration_days: 90 }));
  });
});
