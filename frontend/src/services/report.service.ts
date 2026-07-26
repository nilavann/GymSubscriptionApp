import { reportRepository } from '../repositories/report.repository';
import { monthsBetween } from '../lib/datetime';
import { deriveStatus } from '../lib/status';
import type { MemberListRow } from '../types/member-list';
import type { MonthlyCount, PaymentModeTotal, ReportSummary, ReportTransactionRow, TransactionType } from '../types/report';
import type { PaymentMode } from '../types/subscription';

/** Fixed display order — categorical color assignment must never reorder by value (dataviz §color-formula "color follows the entity, never its rank"). */
export const PAYMENT_MODE_ORDER: PaymentMode[] = ['Cash', 'UPI', 'Card'];

export function validateDateRange(startDate: string, endDate: string): string | null {
  if (startDate > endDate) return 'Start date must be on or before the end date.';
  return null;
}

/** Static counts + Expiring This Week — same `member_list_view` + `deriveStatus()` the Members List uses. */
export function summarize(rows: MemberListRow[]): ReportSummary {
  let active = 0;
  let expiring = 0;
  let expired = 0;
  for (const row of rows) {
    const status = deriveStatus(row);
    if (status === 'active') active += 1;
    else if (status === 'expiring') expiring += 1;
    else expired += 1;
  }
  return { total: rows.length, active, expiring, expired };
}

/** Members expiring within 7 days (inclusive), soonest first — spec/backend/reporting.md §4. */
export function expiringThisWeek(rows: MemberListRow[]): MemberListRow[] {
  return rows
    .filter((row) => deriveStatus(row) === 'expiring')
    .sort((a, b) => (a.current_membership_end_date ?? '').localeCompare(b.current_membership_end_date ?? ''));
}

/**
 * One bar per calendar month in [startDate, endDate], including zero-count months, for the
 * given transaction type — spec/backend/reporting.md §3.3/§4.
 */
export function monthlyCounts(
  transactions: ReportTransactionRow[],
  type: TransactionType,
  startDate: string,
  endDate: string
): MonthlyCount[] {
  const counts = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.transaction_type !== type) continue;
    const month = tx.start_date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return monthsBetween(startDate, endDate).map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

/** Total ₹ received per payment mode in the applied range — feeds the Reports pie chart. Always all 3 modes, fixed order, even at ₹0. */
export function paymentModeTotals(transactions: ReportTransactionRow[]): PaymentModeTotal[] {
  const totals = new Map<PaymentMode, number>(PAYMENT_MODE_ORDER.map((mode) => [mode, 0]));
  for (const tx of transactions) {
    totals.set(tx.payment_mode, (totals.get(tx.payment_mode) ?? 0) + tx.amount_paid);
  }
  return PAYMENT_MODE_ORDER.map((mode) => ({ mode, total: totals.get(mode) ?? 0 }));
}

export const reportService = {
  validateDateRange,
  summarize,
  expiringThisWeek,
  monthlyCounts,
  paymentModeTotals,

  async getTransactions(startDate: string, endDate: string): Promise<ReportTransactionRow[]> {
    return reportRepository.getTransactions(startDate, endDate);
  },
};

export type ReportService = typeof reportService;
