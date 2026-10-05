import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import { reportService as realReportService } from '../services/report.service';
import { addDays, firstOfCurrentMonth, todayDate } from '../lib/datetime';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildMemberListRow } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';
import type { MemberListRow } from '../types/member-list';
import type { ReportTransactionRow } from '../types/report';

const inDays = (n: number) => addDays(todayDate(), n);

const MEMBERS: MemberListRow[] = [
  buildMemberListRow({ id: 1, name: 'Active One', current_membership_plan_name: 'Monthly', current_membership_end_date: inDays(90) }),
  buildMemberListRow({ id: 2, name: 'Active Two', current_membership_end_date: null }),
  buildMemberListRow({ id: 3, name: 'Soon Sarah', current_membership_plan_name: 'Quarterly', current_membership_end_date: inDays(2) }),
  buildMemberListRow({ id: 4, name: 'Gone Gita', current_membership_end_date: inDays(-10) }),
];

const tx = (overrides: Partial<ReportTransactionRow>): ReportTransactionRow => ({
  subscription_item_id: 1,
  member_id: 1,
  member_name: 'Asha Verma',
  member_number: 'MUM-2026-0001',
  phone: '9000000001',
  transaction_type: 'Subscription',
  plan_name: 'Monthly',
  start_date: todayDate(),
  amount_paid: 1500,
  payment_mode: 'Cash',
  ...overrides,
});

const TRANSACTIONS: ReportTransactionRow[] = [
  tx({ subscription_item_id: 1, member_name: 'Older Olga', start_date: inDays(-2), amount_paid: 1000, payment_mode: 'UPI' }),
  tx({ subscription_item_id: 2, member_name: 'Newest Neel', start_date: inDays(0), amount_paid: 2500, payment_mode: 'Card' }),
  tx({ subscription_item_id: 3, member_name: 'Yoga Yash', transaction_type: 'Add-on', plan_name: 'Yoga', start_date: inDays(-1), amount_paid: 500, payment_mode: 'Cash' }),
];

function renderReports(
  options: RenderOptions & {
    members?: MemberListRow[];
    transactions?: ReportTransactionRow[];
    getAll?: ReturnType<typeof vi.fn>;
    getTransactions?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    members = MEMBERS,
    transactions = TRANSACTIONS,
    getAll = vi.fn().mockResolvedValue(members),
    getTransactions = vi.fn().mockResolvedValue(transactions),
    ...rest
  } = options;
  const utils = renderWithProviders(<ReportsPage />, {
    ...rest,
    services: fakeServices({
      memberListRepository: { getAll },
      reportService: { ...realReportService, getTransactions },
    }),
  });
  return { ...utils, getAll, getTransactions };
}

const txLoaded = () => vi.waitFor(() => expect(document.querySelector('.reports-tx-table, .reports-tx-cards, .reports-empty-inline')).not.toBeNull());
const tile = (label: string) => screen.getByText(label, { selector: '.reports-tile-label' }).closest('.reports-tile') as HTMLElement;

describe('ReportsPage — the two sections load independently', () => {
  it('shows a skeleton while each loads', () => {
    renderReports({
      getAll: vi.fn().mockReturnValue(new Promise(() => undefined)),
      getTransactions: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    expect(screen.getAllByLabelText('Loading')).toHaveLength(2);
  });

  it('a failing summary offers a Retry that reloads ONLY the member summary', async () => {
    const getAll = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(MEMBERS);
    const { user, getTransactions } = renderReports({ getAll });

    expect(await screen.findByText("Couldn't load reports — check your connection and try again.")).toBeInTheDocument();
    await txLoaded(); // the range section is unaffected
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(tile('Total')).toBeInTheDocument());
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  it('a failing range section offers a Retry that re-runs the SAME range, leaving the summary alone', async () => {
    const getTransactions = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(TRANSACTIONS);
    const { user, getAll } = renderReports({ getTransactions });

    expect(await screen.findByText('Something went wrong loading reports. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    await vi.waitFor(() => expect(tile('Total')).toBeInTheDocument()); // summary still fine
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await txLoaded();
    expect(getTransactions).toHaveBeenCalledTimes(2);
    expect(getTransactions.mock.calls[1]).toEqual(getTransactions.mock.calls[0]);
    expect(getAll).toHaveBeenCalledTimes(1);
  });
});

describe('ReportsPage — summary tiles and Expiring This Week', () => {
  it('counts members by derived status', async () => {
    renderReports();
    await vi.waitFor(() => expect(tile('Total')).toBeInTheDocument());
    expect(within(tile('Total')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Active')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Expiring Soon')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Expired')).getByText('1')).toBeInTheDocument();
  });

  it('lists who is expiring this week, with their plan and date', async () => {
    renderReports();
    await vi.waitFor(() => expect(tile('Total')).toBeInTheDocument());
    const row = screen.getByText('Soon Sarah').closest('.reports-expiring-row') as HTMLElement;
    expect(within(row).getByText('Quarterly')).toBeInTheDocument();
  });

  it('says so when nobody is expiring this week (an empty state, not an error)', async () => {
    renderReports({ members: [MEMBERS[0]] });
    expect(await screen.findByText('No memberships expiring this week.')).toBeInTheDocument();
  });
});

describe('ReportsPage — date range', () => {
  it('starts on "This month": 1st of the month to today', async () => {
    const { getTransactions } = renderReports();
    await txLoaded();
    expect(getTransactions).toHaveBeenCalledWith(firstOfCurrentMonth(), todayDate());
    expect(screen.getByRole('button', { name: 'This month' })).toHaveClass('reports-range-chip-active');
  });

  it('the presets fetch their range: Today, and the last 7 days', async () => {
    const { user, getTransactions } = renderReports();
    await txLoaded();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(getTransactions).toHaveBeenLastCalledWith(todayDate(), todayDate());

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(getTransactions).toHaveBeenLastCalledWith(inDays(-6), todayDate());
  });

  it('Custom reveals the date form; a reversed range is refused without fetching', async () => {
    const { user, getTransactions } = renderReports();
    await txLoaded();
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Custom…' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-20' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-10' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByText('Start date must be on or before the end date.')).toBeInTheDocument();
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  it('Custom applies a valid range', async () => {
    const { user, getTransactions } = renderReports();
    await txLoaded();
    await user.click(screen.getByRole('button', { name: 'Custom…' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-05-31' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(getTransactions).toHaveBeenLastCalledWith('2026-05-01', '2026-05-31');
  });
});

describe('ReportsPage renders exactly ONE of table / cards for transactions', () => {
  it('on desktop: a table, newest first, with rupees and a distinct add-on badge — no cards', async () => {
    renderReports({ viewport: 1280 });
    await txLoaded();
    const table = document.querySelector('table') as HTMLElement;
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(document.querySelector('.reports-tx-cards')).toBeNull();

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Newest Neel', 'Yoga Yash', 'Older Olga']);
    expect(within(table).getByText('₹2500')).toBeInTheDocument();
    expect(within(table).getByText('Add-on')).toHaveClass('reports-tx-type-addon');
    expect(within(table).getAllByText('Subscription')[0]).not.toHaveClass('reports-tx-type-addon');
  });

  it('on a phone: cards showing plan · date, member # · phone and amount · mode — no table', async () => {
    renderReports({ viewport: MOBILE_WIDTH });
    await txLoaded();
    expect(document.querySelectorAll('table')).toHaveLength(0);
    const cards = Array.from(document.querySelectorAll('.reports-tx-card')) as HTMLElement[];
    expect(cards).toHaveLength(TRANSACTIONS.length);
    expect(cards[0]).toHaveTextContent('Newest Neel');
    expect(cards[0]).toHaveTextContent('₹2500 · Card');
    expect(cards[0]).toHaveTextContent('MUM-2026-0001 · 9000000001');
  });

  it('says so when the range has no transactions', async () => {
    renderReports({ transactions: [] });
    expect(await screen.findByText('No transactions in this date range.')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });
});

describe('ReportsPage — charts', () => {
  it('shows both monthly charts and the payment-mode legend with all three modes in a fixed order', async () => {
    renderReports();
    await txLoaded();
    expect(screen.getByText('New Subscriptions per Month')).toBeInTheDocument();
    expect(screen.getByText('New Add-ons per Month')).toBeInTheDocument();

    const legend = document.querySelector('.reports-payment-legend') as HTMLElement;
    expect(legend.textContent?.indexOf('Cash')).toBeLessThan(legend.textContent?.indexOf('UPI') as number);
    expect(legend.textContent?.indexOf('UPI')).toBeLessThan(legend.textContent?.indexOf('Card') as number);
  });
});
