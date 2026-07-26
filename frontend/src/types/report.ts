import type { PaymentMode } from './subscription';

export type TransactionType = 'Subscription' | 'Add-on';

/**
 * One row per `subscription_items` row in a date range, joined client-side with its
 * `subscriptions`/`members`/`plans` parents — see spec/backend/reporting.md §3.
 */
export interface ReportTransactionRow {
  subscription_item_id: number;
  member_id: number;
  member_name: string;
  member_number: string;
  phone: string;
  transaction_type: TransactionType;
  plan_name: string;
  start_date: string;
  amount_paid: number;
  payment_mode: PaymentMode;
}

/** One bar in a monthly chart — `month` is a YYYY-MM key, chronologically sortable as a string. */
export interface MonthlyCount {
  month: string;
  count: number;
}

export interface ReportSummary {
  total: number;
  active: number;
  expiring: number;
  expired: number;
}

/** Total ₹ received in the applied date range, for one payment mode — feeds the Reports pie chart. */
export interface PaymentModeTotal {
  mode: PaymentMode;
  total: number;
}
