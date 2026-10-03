import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuditLogPage } from './AuditLogPage';
import { adminProfile, fakeAuth, setAuth, setServices } from '../test/mocks';
import { localDate } from '../test/fixtures';
import type { AuditLogEntry } from '../types/audit-log';

const entry = (o: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 1, change_id: 'c1', table_name: 'members', record_id: '42', field_name: 'phone', old_value: '9000000001', new_value: '9000000002',
  operation: 'update', changed_by: 'staff-1', changed_at: '2026-07-10T09:30:00Z', changed_by_name: 'Sam Staff', ...o,
});

let getFiltered: ReturnType<typeof vi.fn>;
function renderPage(rows: AuditLogEntry[] = [entry({})], truncated = false) {
  getFiltered = vi.fn().mockResolvedValue({ rows, truncated });
  setAuth(fakeAuth(adminProfile));
  setServices({
    auditLogRepository: { getFiltered } as never,
    profileRepository: { getAllUsers: vi.fn().mockResolvedValue([{ id: 'staff-1', full_name: 'Sam Staff' }, { id: 'admin-1', full_name: 'Ada Admin' }]) } as never,
  });
  return render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
}

describe('Audit log overview (REQ-ADMIN-005)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 7, 15));
  });
  const user = () => userEvent.setup({ advanceTimers: () => {} });

  it('loads with the default range (1st of this month -> today) and no other filters', async () => {
    renderPage();
    await waitFor(() => expect(getFiltered).toHaveBeenCalledWith({ startDate: '2026-07-01', endDate: '2026-07-15', tableName: null, recordId: null, changedBy: null }));
  });

  it('shows field, table, record, old -> new value, who and what happened', async () => {
    renderPage([entry({}), entry({ id: 2, operation: 'insert', old_value: null, field_name: 'name', new_value: 'Priya' })]);
    expect(await screen.findAllByText('phone')).not.toHaveLength(0);
    expect(screen.getAllByText('9000000002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Created').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Updated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // null old value on an insert
    expect(screen.getAllByText('Sam Staff').length).toBeGreaterThan(0);
  });

  it('can filter by table, record id and changed-by (and sends them)', async () => {
    renderPage();
    await waitFor(() => expect(getFiltered).toHaveBeenCalledTimes(1));
    await user().selectOptions(screen.getByLabelText('Table'), 'plans');
    await user().type(screen.getByLabelText('Record ID'), '7');
    await user().selectOptions(screen.getByLabelText('Changed by'), 'staff-1');
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(getFiltered).toHaveBeenLastCalledWith(expect.objectContaining({ tableName: 'plans', recordId: '7', changedBy: 'staff-1' })));
  });

  it('the table filter offers every audited table', async () => {
    renderPage();
    await screen.findByLabelText('Table');
    const options = Array.from((screen.getByLabelText('Table') as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['', 'members', 'subscriptions', 'subscription_items', 'plans', 'branches', 'profiles', 'roles', 'user_roles']);
  });

  it('date range filter is applied; an inverted range is rejected without a request', async () => {
    renderPage();
    await waitFor(() => expect(getFiltered).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-07-10' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-12' } });
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(getFiltered).toHaveBeenLastCalledWith(expect.objectContaining({ startDate: '2026-07-10', endDate: '2026-07-12' })));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-01' } });
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('End date must be on or after the start date.')).toBeInTheDocument();
    expect(getFiltered).toHaveBeenCalledTimes(2);
  });

  it('REQ-ADMIN-005: strictly read-only — no edit/delete/save control anywhere on the screen', async () => {
    renderPage([entry({}), entry({ id: 2 })]);
    await screen.findAllByText('phone');
    const labels = screen.getAllByRole('button').map((b) => (b.textContent ?? '') + (b.getAttribute('aria-label') ?? ''));
    expect(labels.join('|')).not.toMatch(/edit|delete|remove|save|undo|revert/i);
    expect(document.querySelectorAll('form input:not([type="date"]):not([type="text"]), textarea').length).toBe(0);
  });

  it('empty result shows a clear message', async () => {
    renderPage([]);
    expect(await screen.findByText('No changes match these filters.')).toBeInTheDocument();
  });

  it('tells the admin when results were capped at 500', async () => {
    renderPage([entry({})], true);
    expect(await screen.findByText(/most recent 500 changes/)).toBeInTheDocument();
  });

  it('failure -> retry', async () => {
    renderPage();
    getFiltered.mockRejectedValueOnce(new Error('Failed to fetch'));
    await user().click(screen.getByRole('button', { name: 'Apply' }));
    await user().click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(getFiltered.mock.calls.length).toBeGreaterThanOrEqual(3));
  });
});
