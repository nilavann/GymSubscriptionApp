import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { reportRepository } from '../repositories/report.repository';

const mocks = vi.hoisted(() => ({ getTransactions: vi.fn() }));
vi.mock('../repositories/report.repository', () => ({
  reportRepository: { getTransactions: mocks.getTransactions } satisfies Partial<typeof reportRepository>,
}));

import {
  expiringThisWeek,
  monthlyCounts,
  PAYMENT_MODE_ORDER,
  paymentModeTotals,
  reportService,
  summarize,
  validateDateRange,
} from './report.service';
import { buildMemberListRow } from '../test/builders';
import type { ReportTransactionRow } from '../types/report';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 27, 12, 0)); // 27 Jun 2026
  mocks.getTransactions.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

const tx = (overrides: Partial<ReportTransactionRow> = {}): ReportTransactionRow => ({
  subscription_item_id: 1,
  member_id: 1,
  member_name: 'Priya',
  member_number: 'MUM-2026-0001',
  phone: '9876543210',
  transaction_type: 'Subscription',
  plan_name: 'Monthly',
  start_date: '2026-06-10',
  amount_paid: 1500,
  payment_mode: 'Cash',
  ...overrides,
});

describe('validateDateRange', () => {
  it('allows start <= end (including the same day) and rejects start > end', () => {
    expect(validateDateRange('2026-06-01', '2026-06-30')).toBeNull();
    expect(validateDateRange('2026-06-10', '2026-06-10')).toBeNull();
    expect(validateDateRange('2026-06-11', '2026-06-10')).toBe('Start date must be on or before the end date.');
  });
});

describe('summarize', () => {
  it('counts members by derived status and reports the total', () => {
    const rows = [
      buildMemberListRow({ current_membership_end_date: '2099-01-01' }), // active
      buildMemberListRow({ current_membership_end_date: null }), // indefinite -> active
      buildMemberListRow({ current_membership_end_date: '2026-07-02' }), // expiring
      buildMemberListRow({ current_membership_end_date: '2026-06-01' }), // expired
      buildMemberListRow({ current_membership_plan_id: null, current_membership_end_date: null }), // no plan -> expired
    ];
    expect(summarize(rows)).toEqual({ total: 5, active: 2, expiring: 1, expired: 2 });
  });

  it('is all zeros for no members', () => {
    expect(summarize([])).toEqual({ total: 0, active: 0, expiring: 0, expired: 0 });
  });
});

describe('expiringThisWeek', () => {
  it('keeps only expiring members, soonest first', () => {
    const later = buildMemberListRow({ current_membership_end_date: '2026-07-04' });
    const sooner = buildMemberListRow({ current_membership_end_date: '2026-06-28' });
    const active = buildMemberListRow({ current_membership_end_date: '2026-09-01' });
    const expired = buildMemberListRow({ current_membership_end_date: '2026-06-01' });
    expect(expiringThisWeek([later, active, expired, sooner])).toEqual([sooner, later]);
  });
});

describe('monthlyCounts', () => {
  it('has one entry per month in the range, including zero-count months, for the given type only', () => {
    const rows = [
      tx({ start_date: '2026-04-05' }),
      tx({ start_date: '2026-04-20' }),
      tx({ start_date: '2026-06-01' }),
      tx({ start_date: '2026-05-10', transaction_type: 'Add-on' }),
    ];
    expect(monthlyCounts(rows, 'Subscription', '2026-04-01', '2026-06-30')).toEqual([
      { month: '2026-04', count: 2 },
      { month: '2026-05', count: 0 },
      { month: '2026-06', count: 1 },
    ]);
  });
});

describe('paymentModeTotals', () => {
  it('always returns all three modes in the fixed order, even at 0', () => {
    expect(paymentModeTotals([])).toEqual([
      { mode: 'Cash', total: 0 },
      { mode: 'UPI', total: 0 },
      { mode: 'Card', total: 0 },
    ]);
    expect(PAYMENT_MODE_ORDER).toEqual(['Cash', 'UPI', 'Card']);
  });

  it('sums amount_paid per mode and never reorders by value (colour follows the entity)', () => {
    const rows = [
      tx({ payment_mode: 'Card', amount_paid: 5000 }),
      tx({ payment_mode: 'Cash', amount_paid: 100 }),
      tx({ payment_mode: 'Cash', amount_paid: 250 }),
    ];
    expect(paymentModeTotals(rows)).toEqual([
      { mode: 'Cash', total: 350 },
      { mode: 'UPI', total: 0 },
      { mode: 'Card', total: 5000 },
    ]);
  });
});

describe('reportService.getTransactions', () => {
  it('delegates the date range to the repository', async () => {
    const rows = [tx()];
    mocks.getTransactions.mockResolvedValue(rows);
    await expect(reportService.getTransactions('2026-06-01', '2026-06-30')).resolves.toBe(rows);
    expect(mocks.getTransactions).toHaveBeenCalledWith('2026-06-01', '2026-06-30');
  });
});
