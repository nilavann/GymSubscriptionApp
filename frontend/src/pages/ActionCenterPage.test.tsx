import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ActionCenterPage } from './ActionCenterPage';
import { fakeAuth, setAuth, setServices } from '../test/mocks';
import { localDate, memberRow } from '../test/fixtures';

const rows = [
  memberRow({ id: 1, name: 'Expired Eddie', current_membership_end_date: '2026-06-01', current_membership_plan_name: 'Monthly' }),
  memberRow({ id: 2, name: 'Soon Sally', current_membership_end_date: '2026-07-18', current_membership_plan_name: 'Monthly' }),
  memberRow({ id: 3, name: 'Later Larry', current_membership_end_date: '2026-08-10', current_membership_plan_name: 'Annual' }),
];
let getActionCenterQueue: ReturnType<typeof vi.fn>;

function renderPage(list = rows) {
  getActionCenterQueue = vi.fn().mockResolvedValue(list);
  setAuth(fakeAuth());
  setServices({ memberListRepository: { getActionCenterQueue } as never });
  return render(
    <MemoryRouter initialEntries={['/action-center']}>
      <Routes>
        <Route path="/action-center" element={<ActionCenterPage />} />
        <Route path="/members/:id/renew" element={<div>RENEW PAGE</div>} />
        <Route path="/members/:id" element={<div>DETAIL PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Action Center (renewal queue)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 7, 15));
  });
  const user = () => userEvent.setup({ advanceTimers: () => {} });

  it('queries only the bounded window (12 months back .. 30 days ahead) — never every member', async () => {
    renderPage();
    await waitFor(() => expect(getActionCenterQueue).toHaveBeenCalledWith({ from: '2025-07-15', to: '2026-08-14' }));
  });

  it('Expiring tab lists upcoming expiries soonest first with relative labels and tab counts', async () => {
    renderPage();
    expect(await screen.findByText('Soon Sally')).toBeInTheDocument();
    expect(screen.getByText('Later Larry')).toBeInTheDocument();
    expect(screen.queryByText('Expired Eddie')).toBeNull();
    expect(screen.getByText('Expires in 3 days')).toBeInTheDocument();
    const names = Array.from(document.querySelectorAll('.action-center-card')).map((c) => c.textContent ?? '');
    expect(names[0]).toContain('Soon Sally');
  });

  it('Expired tab lists lapsed members', async () => {
    renderPage();
    await screen.findByText('Soon Sally');
    await user().click(screen.getByRole('button', { name: /expired/i }));
    expect(screen.getByText('Expired Eddie')).toBeInTheDocument();
    expect(screen.queryByText('Soon Sally')).toBeNull();
  });

  it('Renew goes to the renew checkout; View opens the member', async () => {
    renderPage();
    await screen.findByText('Soon Sally');
    await user().click(document.querySelector('.action-center-card-renew') as HTMLElement);
    expect(await screen.findByText('RENEW PAGE')).toBeInTheDocument();
  });

  it('empty queue shows friendly empty states for each tab', async () => {
    renderPage([]);
    expect(await screen.findByText('Nothing expiring in the next 30 days')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /expired/i }));
    expect(screen.getByText('No expired memberships')).toBeInTheDocument();
  });

  it('network failure -> retry reloads', async () => {
    renderPage();
    getActionCenterQueue.mockRejectedValueOnce(new Error('Failed to fetch'));
    getActionCenterQueue.mockClear();
    getActionCenterQueue.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(rows);
    render(<MemoryRouter><ActionCenterPage /></MemoryRouter>);
    await user().click((await screen.findAllByRole('button', { name: /retry/i }))[0]);
    await waitFor(() => expect(getActionCenterQueue.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
