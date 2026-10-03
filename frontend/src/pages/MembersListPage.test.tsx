import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MembersListPage } from './MembersListPage';
import { fakeAuth, setAuth, setServices } from '../test/mocks';
import { localDate, memberRow, plan } from '../test/fixtures';

const rows = [
  memberRow({ id: 1, name: 'Old Timer', phone: '9000000001', member_number: 'MUM-2024-0001', date_of_joining: '2024-01-10', gender: 'Male', current_membership_plan_id: 1, current_membership_plan_name: 'Monthly', current_membership_end_date: '2026-12-01' }),
  memberRow({ id: 2, name: 'Newest Joiner', phone: '9000000002', member_number: 'MUM-2026-0002', date_of_joining: '2026-07-10', gender: 'Female', current_membership_plan_id: 2, current_membership_plan_name: 'Quarterly', current_membership_end_date: '2026-07-18', current_addon_plan_ids: [4] }),
  memberRow({ id: 3, name: 'Lapsed Larry', phone: '9000000003', member_number: 'MUM-2025-0003', date_of_joining: '2025-03-05', gender: 'Male' }),
];
const plans = [plan({ id: 1, name: 'Monthly' }), plan({ id: 2, name: 'Quarterly' }), plan({ id: 4, name: 'Zumba Class', category: 'addon' })];

const tableNames = (c: HTMLElement) => Array.from(c.querySelectorAll('table tbody tr')).map((tr) => tr.querySelector('td')?.textContent ?? '');

function renderPage(list = rows) {
  setAuth(fakeAuth());
  setServices({
    memberListRepository: { getAll: vi.fn().mockResolvedValue(list) } as never,
    planRepository: { getAllActive: vi.fn().mockResolvedValue(plans) } as never,
  });
  return render(
    <MemoryRouter>
      <MembersListPage />
    </MemoryRouter>
  );
}

describe('Members list page (REQ-LIST-001..004)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 7, 15));
  });
  const user = () => userEvent.setup({ advanceTimers: () => {} });

  it('REQ-LIST-001: default view shows everyone, newest joiner first, default sort option = join date', async () => {
    const { container } = renderPage();
    await screen.findByText(/members/i, { selector: 'h1' });
    await waitFor(() => expect(tableNames(container)).toHaveLength(3));
    const names = tableNames(container);
    expect(names[0]).toContain('Newest Joiner'); // 2026-07-10
    expect(names[1]).toContain('Lapsed Larry'); // 2025-03-05
    expect(names[2]).toContain('Old Timer'); // 2024-01-10
    expect(screen.getByLabelText('Sort by')).toHaveValue('join-date');
    expect(within(screen.getByLabelText('Sort by')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Sort: Join date (newest)', 'Sort: Name', 'Sort: Expiry date',
    ]);
  });

  it('REQ-LIST-001: explicit sort overrides the default; clicking a column header sorts too', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(tableNames(container)).toHaveLength(3));
    await user().selectOptions(screen.getByLabelText('Sort by'), 'name');
    expect(tableNames(container)[0]).toContain('Lapsed Larry');
    await user().selectOptions(screen.getByLabelText('Sort by'), 'expiry');
    expect(tableNames(container)[0]).toContain('Newest Joiner'); // earliest end date first
  });

  it('REQ-LIST-002: search by name / member number / phone, case-insensitive, narrowing results', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(tableNames(container)).toHaveLength(3));
    const box = screen.getByLabelText('Search members');
    await user().type(box, 'LARRY');
    expect(tableNames(container)).toHaveLength(1);
    await user().clear(box);
    await user().type(box, '2026-0002');
    expect(tableNames(container)[0]).toContain('Newest Joiner');
    await user().clear(box);
    await user().type(box, '900 000 0001');
    expect(tableNames(container)[0]).toContain('Old Timer');
  });

  it('REQ-LIST-002: no match shows an empty state with a Clear search action', async () => {
    renderPage();
    await screen.findByLabelText('Search members');
    await user().type(screen.getByLabelText('Search members'), 'nobody-here');
    expect(await screen.findByText('No results for "nobody-here"')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByLabelText('Search members')).toHaveValue('');
  });

  it('REQ-LIST-003: pills show counts and filter by derived status (single select)', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(tableNames(container)).toHaveLength(3));
    const pills = within(screen.getByRole('group', { name: 'Status filter' }));
    expect(pills.getByRole('button', { name: /^All\s*3$/ })).toBeInTheDocument();
    expect(pills.getByRole('button', { name: /^Active\s*1$/ })).toBeInTheDocument();
    expect(pills.getByRole('button', { name: /^Expiring\s*1$/ })).toBeInTheDocument();
    expect(pills.getByRole('button', { name: /^Expired\s*1$/ })).toBeInTheDocument();
    await user().click(pills.getByRole('button', { name: /^Expiring/ }));
    expect(tableNames(container)).toHaveLength(1);
    expect(tableNames(container)[0]).toContain('Newest Joiner');
    await user().click(pills.getByRole('button', { name: /^Expired/ }));
    expect(tableNames(container)[0]).toContain('Lapsed');
    await user().click(pills.getByRole('button', { name: /^All/ }));
    expect(tableNames(container)).toHaveLength(3);
  });

  it('REQ-LIST-004: filter panel combines gender + plan + add-on with the pill and search', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(tableNames(container)).toHaveLength(3));
    await user().click(screen.getByRole('button', { name: /filters/i }));
    await user().click(screen.getByLabelText('Female'));
    expect(tableNames(container)).toEqual([expect.stringContaining('Newest Joiner')]);
    await user().click(screen.getByLabelText('Zumba Class'));
    expect(tableNames(container)).toHaveLength(1);
    await user().click(screen.getByLabelText('Monthly')); // plan filter AND-ed -> Newest Joiner has Quarterly
    expect(screen.getByText('No members match these filters.')).toBeInTheDocument();
  });

  it('empty database shows a first-run empty state with an Add Member action', async () => {
    renderPage([]);
    expect(await screen.findByText('No members yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search members')).toBeNull();
  });

  it('network failure keeps the user informed and Retry reloads', async () => {
    setAuth(fakeAuth());
    const getAll = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(rows);
    setServices({ memberListRepository: { getAll } as never, planRepository: { getAllActive: vi.fn().mockResolvedValue(plans) } as never });
    render(<MemoryRouter><MembersListPage /></MemoryRouter>);
    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByLabelText('Search members')).toBeInTheDocument();
    expect(getAll).toHaveBeenCalledTimes(2);
  });
});
