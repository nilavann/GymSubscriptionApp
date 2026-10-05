import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { AuditLogPage } from './AuditLogPage';
import { firstOfCurrentMonth, todayDate } from '../lib/datetime';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildAdminProfile, buildProfile } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';
import type { AuditLogEntry } from '../types/audit-log';
import type { ManagedUser } from '../types/profile';

const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 1,
  change_id: 'c1',
  table_name: 'plans',
  record_id: '7',
  field_name: 'price',
  old_value: '1000',
  new_value: '1500',
  operation: 'update',
  changed_by: 'u1',
  changed_by_name: 'Anita Admin',
  changed_at: '2026-06-27T10:30:00Z',
  ...overrides,
});

const ENTRIES: AuditLogEntry[] = [
  entry({ id: 1 }),
  entry({ id: 2, operation: 'insert', field_name: 'name', old_value: null, new_value: 'Yoga', table_name: 'plans', record_id: '9', changed_by_name: 'System' }),
  entry({ id: 3, operation: 'delete', field_name: 'code', old_value: 'PUN', new_value: null, table_name: 'branches', record_id: '2' }),
];

const USERS: ManagedUser[] = [
  { ...buildProfile({ id: 'u2', full_name: 'Zed Staff' }), email: 'z@x.in', deleted_at: null },
  { ...buildAdminProfile({ id: 'u1', full_name: 'Anita Admin' }), email: 'a@x.in', deleted_at: null },
];

function renderAudit(
  options: RenderOptions & {
    rows?: AuditLogEntry[];
    truncated?: boolean;
    getFiltered?: ReturnType<typeof vi.fn>;
    getAllUsers?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    rows = ENTRIES,
    truncated = false,
    getFiltered = vi.fn().mockResolvedValue({ rows, truncated }),
    getAllUsers = vi.fn().mockResolvedValue(USERS),
    ...rest
  } = options;
  const utils = renderWithProviders(<AuditLogPage />, {
    auth: { currentProfile: buildAdminProfile() },
    ...rest,
    services: fakeServices({ auditLogRepository: { getFiltered }, profileRepository: { getAllUsers } }),
  });
  return { ...utils, getFiltered, getAllUsers };
}

const ready = () => screen.findByRole('heading', { name: 'Audit Log' });
const loaded = async () => {
  await ready();
  await vi.waitFor(() => expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument());
};

describe('AuditLogPage — filters and loading', () => {
  it('first loads this month, up to today, with no other filter', async () => {
    const { getFiltered } = renderAudit();
    await loaded();
    expect(getFiltered).toHaveBeenCalledWith({
      startDate: firstOfCurrentMonth(),
      endDate: todayDate(),
      tableName: null,
      recordId: null,
      changedBy: null,
    });
  });

  it('shows a skeleton while loading', async () => {
    renderAudit({ getFiltered: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    await ready();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a network failure offers Retry (re-running the SAME filters) and recovers', async () => {
    const getFiltered = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue({ rows: ENTRIES, truncated: false });
    const { user } = renderAudit({ getFiltered });
    expect(await screen.findByText("Couldn't load the audit log — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(getFiltered).toHaveBeenCalledTimes(2));
    expect(getFiltered.mock.calls[1][0]).toEqual(getFiltered.mock.calls[0][0]);
  });

  it('a generic failure never shows the raw error', async () => {
    renderAudit({ getFiltered: vi.fn().mockRejectedValue(new Error('PGRST raw')) });
    expect(await screen.findByText('Something went wrong loading the audit log. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).not.toBeInTheDocument();
  });

  it('says so when nothing matches (an empty state, not an error)', async () => {
    renderAudit({ rows: [] });
    await loaded();
    expect(screen.getByText('No changes match these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('warns when the 500-row cap truncated the result', async () => {
    renderAudit({ truncated: true });
    await loaded();
    expect(screen.getByText(/Showing the most recent 500 changes/)).toBeInTheDocument();
  });

  it('lists the users alphabetically in "Changed by", and still works if that list fails to load', async () => {
    renderAudit();
    await loaded();
    const select = screen.getByLabelText('Changed by');
    await vi.waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Anyone', 'Anita Admin', 'Zed Staff']);
  });

  it('keeps the page usable when the users list fails', async () => {
    renderAudit({ getAllUsers: vi.fn().mockRejectedValue(new Error('offline')) });
    await loaded();
    // The dropdown degrades to just "Anyone", and the log itself still loads and renders.
    expect(within(screen.getByLabelText('Changed by')).getAllByRole('option')).toHaveLength(1);
    expect(within(document.querySelector('table') as HTMLElement).getAllByRole('row')).toHaveLength(ENTRIES.length + 1);
  });

  it('Apply sends every filter, with blanks as null', async () => {
    const { user, getFiltered } = renderAudit();
    await loaded();
    await user.selectOptions(screen.getByLabelText('Table'), 'plans');
    await user.type(screen.getByLabelText('Record ID'), '7');
    await vi.waitFor(() => expect(within(screen.getByLabelText('Changed by')).getAllByRole('option')).toHaveLength(3));
    await user.selectOptions(screen.getByLabelText('Changed by'), 'u1');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(getFiltered).toHaveBeenLastCalledWith({
      startDate: firstOfCurrentMonth(),
      endDate: todayDate(),
      tableName: 'plans',
      recordId: '7',
      changedBy: 'u1',
    });
  });

  it('refuses an end date before the start date, without refetching', async () => {
    const { user, getFiltered } = renderAudit();
    await loaded();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-20' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-10' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByText('End date must be on or after the start date.')).toBeInTheDocument();
    expect(getFiltered).toHaveBeenCalledTimes(1);
  });

  it('is strictly view-only: no edit or delete control anywhere (REQ-ADMIN-005)', async () => {
    renderAudit({ viewport: 1280 });
    await loaded();
    expect(screen.queryByRole('button', { name: /edit|delete|remove/i })).not.toBeInTheDocument();
  });

  it('offers a Table dropdown of every audited table', async () => {
    renderAudit();
    await loaded();
    const options = within(screen.getByLabelText('Table')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All tables', 'members', 'subscriptions', 'subscription_items', 'plans', 'branches', 'profiles', 'roles', 'user_roles']);
  });
});

describe('AuditLogPage renders exactly ONE of table / cards', () => {
  it('on desktop: a table with a row per change, labelled operation badges, and no cards', async () => {
    renderAudit({ viewport: 1280 });
    await loaded();
    const table = document.querySelector('table') as HTMLElement;
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(within(table).getAllByRole('row')).toHaveLength(ENTRIES.length + 1);
    expect(within(table).getByText('Updated')).toHaveClass('audit-log-op-update');
    expect(within(table).getByText('Created')).toHaveClass('audit-log-op-insert');
    expect(within(table).getByText('Deleted')).toHaveClass('audit-log-op-delete');
    expect(document.querySelector('.audit-log-cards')).toBeNull();
  });

  it('on a phone: cards showing "field on table #id", old → new, and who — no table', async () => {
    renderAudit({ viewport: MOBILE_WIDTH });
    await loaded();
    expect(document.querySelectorAll('table')).toHaveLength(0);
    const cards = Array.from(document.querySelectorAll('.audit-log-card')) as HTMLElement[];
    expect(cards).toHaveLength(ENTRIES.length);
    expect(cards[0]).toHaveTextContent('price on plans #7');
    expect(cards[0]).toHaveTextContent('1000');
    expect(cards[0]).toHaveTextContent('1500');
    expect(cards[0]).toHaveTextContent('Anita Admin');
  });

  it('renders a missing old/new value as an em dash, on both layouts', async () => {
    renderAudit({ viewport: MOBILE_WIDTH });
    await loaded();
    const created = document.querySelectorAll('.audit-log-card')[1] as HTMLElement;
    expect(within(created).getByText('—')).toHaveClass('audit-log-diff-old');
  });
});
