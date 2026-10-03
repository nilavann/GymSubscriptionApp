import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReportsPage } from './ReportsPage';
import * as realReportService from '../services/report.service';
import { fakeAuth, setAuth, setServices } from '../test/mocks';
import { localDate, memberRow } from '../test/fixtures';
import type { ReportTransactionRow } from '../types/report';

const tx = (o: Partial<ReportTransactionRow>): ReportTransactionRow => ({
  subscription_item_id: 1, member_id: 1, member_name: 'Priya', member_number: 'MUM-2026-0001', phone: '9876543210',
  transaction_type: 'Subscription', plan_name: 'Monthly', start_date: '2026-07-10', amount_paid: 1000, payment_mode: 'UPI', ...o,
});

let getTransactions: ReturnType<typeof vi.fn>;

function renderPage(txs: ReportTransactionRow[] = [], memberRows = [memberRow({ current_membership_plan_id: 1, current_membership_end_date: '2026-07-18' })]) {
  getTransactions = vi.fn().mockResolvedValue(txs);
  setAuth(fakeAuth());
  setServices({
    memberListRepository: { getAll: vi.fn().mockResolvedValue(memberRows) } as never,
    reportService: { ...realReportService.reportService, getTransactions } as never,
  });
  return render(<MemoryRouter><ReportsPage /></MemoryRouter>);
}

describe('Reports page (REQ-REPORT-001/002)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 7, 15));
  });
  const user = () => userEvent.setup({ advanceTimers: () => {} });

  it('REQ-REPORT-001: defaults to the 1st of the current month through today', async () => {
    renderPage();
    await waitFor(() => expect(getTransactions).toHaveBeenCalledWith('2026-07-01', '2026-07-15'));
    expect(screen.getByRole('button', { name: 'This month' }).className).toContain('active');
  });

  it('REQ-REPORT-001: shows the two monthly bar charts and the payment-mode chart', async () => {
    renderPage([tx({})]);
    expect(await screen.findByText('New Subscriptions per Month')).toBeInTheDocument();
    expect(screen.getByText('New Add-ons per Month')).toBeInTheDocument();
    expect(screen.getByText('Revenue by Payment Mode')).toBeInTheDocument();
  });

  it('REQ-REPORT-001: presets recalculate for Today / This week (last 7 days incl. today)', async () => {
    renderPage();
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(1));
    await user().click(screen.getByRole('button', { name: 'Today' }));
    expect(getTransactions).toHaveBeenLastCalledWith('2026-07-15', '2026-07-15');
    await user().click(screen.getByRole('button', { name: 'This week' }));
    expect(getTransactions).toHaveBeenLastCalledWith('2026-07-09', '2026-07-15');
  });

  it('REQ-REPORT-001: a custom range recalculates charts + list for exactly that range', async () => {
    renderPage();
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(1));
    await user().click(screen.getByRole('button', { name: 'Custom…' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-04-10' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-20' } });
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(getTransactions).toHaveBeenLastCalledWith('2026-04-10', '2026-06-20'));
  });

  it('REQ-REPORT-001: a multi-month range shows one bar per calendar month (never daily/weekly)', async () => {
    renderPage([tx({ start_date: '2026-04-12' }), tx({ subscription_item_id: 2, start_date: '2026-06-02' })]);
    await user().click(await screen.findByRole('button', { name: 'Custom…' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-04-10' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-20' } });
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    const chart = (await screen.findByText('New Subscriptions per Month')).parentElement as HTMLElement;
    await waitFor(() => expect(chart.querySelectorAll('.reports-chart-bar-wrap')).toHaveLength(3)); // Apr, May, Jun
  });

  it('start date after end date is rejected with a message and nothing is fetched', async () => {
    renderPage();
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(1));
    await user().click(screen.getByRole('button', { name: 'Custom…' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-07-20' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-01' } });
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/Start date must be on or before the end date/)).toBeInTheDocument();
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  it('REQ-REPORT-002: one row per item with member, number, phone, type, plan, date, amount, payment — no per-member aggregation', async () => {
    renderPage([
      tx({ subscription_item_id: 1, plan_name: 'Monthly', transaction_type: 'Subscription', amount_paid: 1000, payment_mode: 'UPI' }),
      tx({ subscription_item_id: 2, plan_name: 'Zumba Class', transaction_type: 'Add-on', amount_paid: 800, payment_mode: 'UPI' }),
      tx({ subscription_item_id: 3, plan_name: 'Personal Training', transaction_type: 'Add-on', amount_paid: 3000, payment_mode: 'UPI' }),
    ]);
    await screen.findByText('Transactions');
    const table = document.querySelector('table.reports-tx-table') as HTMLElement;
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Member', 'Member #', 'Phone', 'Type', 'Plan', 'Date', 'Amount', 'Payment']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3); // renewal + two add-ons for the same member stay separate
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Zumba Class'), expect.stringContaining('Personal Training')]));
    expect(within(rows[0]).getByText('MUM-2026-0001')).toBeInTheDocument();
    expect(within(rows[0]).getByText('9876543210')).toBeInTheDocument();
  });

  it('REQ-REPORT-002: labels Subscription vs Add-on and shows the checkout\'s payment mode', async () => {
    renderPage([tx({ transaction_type: 'Add-on', payment_mode: 'Card', amount_paid: 800 })]);
    await screen.findByText('Transactions');
    const row = (document.querySelector('table.reports-tx-table tbody tr') as HTMLElement);
    expect(within(row).getByText('Add-on')).toBeInTheDocument();
    expect(within(row).getByText(/Card/)).toBeInTheDocument();
  });

  it('transactions are listed newest first', async () => {
    renderPage([tx({ subscription_item_id: 1, member_name: 'Older', start_date: '2026-07-01' }), tx({ subscription_item_id: 2, member_name: 'Newer', start_date: '2026-07-12' })]);
    await screen.findByText('Transactions');
    const names = Array.from(document.querySelectorAll('table.reports-tx-table tbody tr td:first-child')).map((td) => td.textContent);
    expect(names).toEqual(['Newer', 'Older']);
  });

  it('empty range shows empty states instead of blank charts/tables', async () => {
    renderPage([]);
    expect(await screen.findByText('No transactions in this date range.')).toBeInTheDocument();
    expect(screen.getByText('No payments in this date range.')).toBeInTheDocument();
  });

  it('summary counts and "expiring this week" come from the member list view statuses', async () => {
    renderPage([], [
      memberRow({ id: 1, name: 'Soon Sally', current_membership_plan_id: 1, current_membership_end_date: '2026-07-18' }),
      memberRow({ id: 2, name: 'Fine Fred', current_membership_plan_id: 1, current_membership_end_date: '2027-01-01' }),
    ]);
    expect(await screen.findByText('Soon Sally')).toBeInTheDocument();
    expect(screen.queryByText('Fine Fred')).toBeNull();
  });

  it('range load failure offers Retry that re-requests the same range', async () => {
    renderPage();
    getTransactions.mockRejectedValueOnce(new Error('Failed to fetch'));
    await user().click(screen.getByRole('button', { name: 'Today' }));
    await user().click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(getTransactions).toHaveBeenLastCalledWith('2026-07-15', '2026-07-15'));
  });
});
