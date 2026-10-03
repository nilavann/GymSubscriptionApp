import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expiringThisWeek, monthlyCounts, paymentModeTotals, summarize, validateDateRange } from './report.service';
import { localDate, memberRow } from '../test/fixtures';
import type { ReportTransactionRow } from '../types/report';

vi.mock('../repositories/report.repository', () => ({ reportRepository: { getTransactions: vi.fn() } }));

function tx(overrides: Partial<ReportTransactionRow>): ReportTransactionRow {
  return {
    subscription_item_id: 1, member_id: 1, member_name: 'A', member_number: 'M-1', phone: '9', transaction_type: 'Subscription',
    plan_name: 'Monthly', start_date: '2026-07-10', amount_paid: 1000, payment_mode: 'Cash', ...overrides,
  };
}

describe('Reporting (REQ-REPORT-001/002)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(localDate(2026, 7, 15));
  });

  describe('validateDateRange', () => {
    it('start after end is invalid', () => expect(validateDateRange('2026-07-02', '2026-07-01')).toMatch(/on or before/));
    it('same day is valid', () => expect(validateDateRange('2026-07-01', '2026-07-01')).toBeNull());
    it('start before end is valid', () => expect(validateDateRange('2026-06-01', '2026-07-01')).toBeNull());
  });

  describe('monthlyCounts — one bar per calendar month, counted by start_date', () => {
    const txs = [
      tx({ start_date: '2026-05-31' }), tx({ start_date: '2026-06-01' }), tx({ start_date: '2026-06-30' }),
      tx({ start_date: '2026-08-02' }),
      tx({ transaction_type: 'Add-on', start_date: '2026-06-15' }),
    ];
    it('Subscriptions: includes empty months in range, buckets by month of start_date', () => {
      expect(monthlyCounts(txs, 'Subscription', '2026-05-01', '2026-08-31')).toEqual([
        { month: '2026-05', count: 1 }, { month: '2026-06', count: 2 }, { month: '2026-07', count: 0 }, { month: '2026-08', count: 1 },
      ]);
    });
    it('Add-ons are counted separately from Subscriptions', () => {
      expect(monthlyCounts(txs, 'Add-on', '2026-06-01', '2026-06-30')).toEqual([{ month: '2026-06', count: 1 }]);
    });
    it('a range inside one month yields exactly one bar (never daily/weekly)', () => {
      expect(monthlyCounts(txs, 'Subscription', '2026-06-10', '2026-06-12')).toHaveLength(1);
    });
    it('spanning a year boundary keeps chronological order', () => {
      expect(monthlyCounts([], 'Subscription', '2025-12-15', '2026-01-15').map((m) => m.month)).toEqual(['2025-12', '2026-01']);
    });
    it('no transactions -> zero bars with count 0 (empty-state chart)', () => {
      expect(monthlyCounts([], 'Subscription', '2026-07-01', '2026-07-15')).toEqual([{ month: '2026-07', count: 0 }]);
    });
    it('rows outside the requested months do not leak in', () => {
      expect(monthlyCounts([tx({ start_date: '2027-01-01' })], 'Subscription', '2026-07-01', '2026-07-31')).toEqual([{ month: '2026-07', count: 0 }]);
    });
  });

  describe('paymentModeTotals', () => {
    it('always returns Cash, UPI, Card in a fixed order, even at 0', () => {
      expect(paymentModeTotals([])).toEqual([{ mode: 'Cash', total: 0 }, { mode: 'UPI', total: 0 }, { mode: 'Card', total: 0 }]);
    });
    it('sums amounts per mode; every item counted (no per-member aggregation)', () => {
      const totals = paymentModeTotals([
        tx({ amount_paid: 1000, payment_mode: 'Cash' }), tx({ amount_paid: 500, payment_mode: 'Cash' }),
        tx({ amount_paid: 800, payment_mode: 'UPI' }), tx({ amount_paid: 0, payment_mode: 'Card' }),
      ]);
      expect(totals).toEqual([{ mode: 'Cash', total: 1500 }, { mode: 'UPI', total: 800 }, { mode: 'Card', total: 0 }]);
    });
  });

  describe('summary + expiring this week', () => {
    const rows = [
      memberRow({ id: 1, current_membership_plan_id: 1, current_membership_end_date: '2026-12-01' }),
      memberRow({ id: 2, current_membership_plan_id: 1, current_membership_end_date: '2026-07-20' }),
      memberRow({ id: 3, current_membership_plan_id: 1, current_membership_end_date: '2026-07-16' }),
      memberRow({ id: 4 }),
    ];
    it('summarize counts each status', () => expect(summarize(rows)).toEqual({ total: 4, active: 1, expiring: 2, expired: 1 }));
    it('expiringThisWeek: only expiring members, soonest first', () => expect(expiringThisWeek(rows).map((r) => r.id)).toEqual([3, 2]));
    it('empty input', () => {
      expect(summarize([])).toEqual({ total: 0, active: 0, expiring: 0, expired: 0 });
      expect(expiringThisWeek([])).toEqual([]);
    });
  });
});
