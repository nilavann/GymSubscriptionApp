import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ActionCenterPage } from './ActionCenterPage';
import { addDays, addMonths, todayDate } from '../lib/datetime';
import { fakeServices } from '../test/fakes';
import { renderRoutes, type RenderOptions } from '../test/render';
import { buildMemberListRow } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';
import type { MemberListRow } from '../types/member-list';

const inDays = (n: number) => addDays(todayDate(), n);

// Repository order is ascending by end date (what the real query returns).
const longExpired = buildMemberListRow({ id: 1, name: 'Long Lapsed', member_number: 'M-0001', phone: '9000000001', current_membership_plan_name: 'Monthly', current_membership_end_date: inDays(-100) });
const recentExpired = buildMemberListRow({ id: 2, name: 'Recently Lapsed', member_number: 'M-0002', phone: '9000000002', current_membership_plan_name: 'Quarterly', current_membership_end_date: inDays(-5) });
const dueSoon = buildMemberListRow({ id: 3, name: 'Due Soon', member_number: 'M-0003', phone: '9000000003', current_membership_plan_name: 'Monthly', current_membership_end_date: inDays(3) });
const dueLater = buildMemberListRow({ id: 4, name: 'Due Later', member_number: 'M-0004', phone: '9000000004', current_membership_plan_name: 'Yearly', current_membership_end_date: inDays(20) });
const QUEUE: MemberListRow[] = [longExpired, recentExpired, dueSoon, dueLater];

function renderQueue(options: RenderOptions & { queue?: MemberListRow[]; getActionCenterQueue?: ReturnType<typeof vi.fn> } = {}) {
  const { queue = QUEUE, getActionCenterQueue = vi.fn().mockResolvedValue(queue), ...rest } = options;
  const utils = renderRoutes(
    [
      { path: '/', element: <ActionCenterPage /> },
      { path: '/members/:id', element: <p>Member detail page</p> },
      { path: '/members/:id/renew', element: <p>Renew page</p> },
    ],
    { ...rest, services: fakeServices({ memberListRepository: { getActionCenterQueue } }) }
  );
  return { ...utils, getActionCenterQueue };
}

const ready = () => screen.findByRole('heading', { name: 'Action Center' });
const cardNames = () => Array.from(document.querySelectorAll('.action-center-card-name')).map((el) => el.textContent);

describe('ActionCenterPage — data states', () => {
  it('shows a skeleton while loading', () => {
    renderQueue({ getActionCenterQueue: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Action Center' })).not.toBeInTheDocument();
  });

  it('asks only for the bounded window: 12 months back to 30 days ahead — never every member', async () => {
    const { getActionCenterQueue } = renderQueue();
    await ready();
    expect(getActionCenterQueue).toHaveBeenCalledTimes(1);
    expect(getActionCenterQueue).toHaveBeenCalledWith({ from: addMonths(todayDate(), -12), to: inDays(30) });
  });

  it('a network failure offers Retry and recovers', async () => {
    const getActionCenterQueue = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(QUEUE);
    const { user } = renderQueue({ getActionCenterQueue });

    expect(await screen.findByText("Couldn't load the renewal queue")).toBeInTheDocument();
    expect(screen.getByText('Check your internet connection and try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a generic failure does not blame the connection or leak the raw error', async () => {
    renderQueue({ getActionCenterQueue: vi.fn().mockRejectedValue(new Error('PGRST301 raw')) });
    expect(await screen.findByText(/Something went wrong loading the renewal queue/)).toBeInTheDocument();
    expect(screen.queryByText(/PGRST301/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check your internet connection/)).not.toBeInTheDocument();
  });
});

describe('ActionCenterPage — queue', () => {
  it('summarises both queues and defaults to Expiring soon, soonest first', async () => {
    renderQueue();
    await ready();

    const summary = document.querySelector('.action-center-summary-row') as HTMLElement;
    expect(within(summary).getByText('Expiring in 30 days').previousElementSibling).toHaveTextContent('2');
    expect(within(summary).getByText('Expired').previousElementSibling).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /Expiring soon/ })).toHaveClass('action-center-tab-active');
    expect(cardNames()).toEqual(['Due Soon', 'Due Later']);
  });

  it('the Expired tab shows lapsed members, most recently expired first', async () => {
    const { user } = renderQueue();
    await ready();
    await user.click(screen.getByRole('button', { name: /^Expired/ }));
    expect(cardNames()).toEqual(['Recently Lapsed', 'Long Lapsed']);
  });

  it('shows a specific, non-error empty state for each empty tab', async () => {
    const { user } = renderQueue({ queue: [] });
    await ready();
    expect(screen.getByText('Nothing expiring in the next 30 days')).toBeInTheDocument();
    expect(screen.getByText('Nothing on the horizon')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Expired/ }));
    expect(screen.getByText('No expired memberships')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('keeps "Send renewal reminders" disabled (coming soon)', async () => {
    renderQueue();
    await ready();
    expect(screen.getByRole('button', { name: 'Send renewal reminders' })).toBeDisabled();
  });
});

describe('ActionCenterPage — cards', () => {
  it('shows identity, plan, expiry and a relative label in the same pill colours as the Members list', async () => {
    const { user } = renderQueue();
    await ready();

    const card = (name: string) => screen.getByText(name).closest('.action-center-card') as HTMLElement;
    const soon = card('Due Soon');
    expect(within(soon).getByText('M-0003')).toBeInTheDocument();
    expect(within(soon).getByText('9000000003')).toBeInTheDocument();
    expect(within(soon).getByText('Monthly')).toBeInTheDocument();
    expect(within(soon).getByText('Expires in 3 days')).toHaveClass('action-center-pill-urgent'); // <= 7d = amber "expiring"
    expect(within(card('Due Later')).getByText('Expires in 20 days')).toHaveClass('action-center-pill-soon'); // 8-30d = neutral "active"

    await user.click(screen.getByRole('button', { name: /^Expired/ }));
    expect(within(card('Recently Lapsed')).getByText('Expired 5 days ago')).toHaveClass('action-center-pill-expired');
  });

  it('Renew and View open the renew screen / member detail', async () => {
    const { user, router } = renderQueue();
    await ready();
    const soon = screen.getByText('Due Soon').closest('.action-center-card') as HTMLElement;

    await user.click(within(soon).getByRole('button', { name: /Renew/ }));
    expect(router.state.location.pathname).toBe('/members/3/renew');
  });

  it('View goes to the member', async () => {
    const { user, router } = renderQueue();
    await ready();
    const soon = screen.getByText('Due Soon').closest('.action-center-card') as HTMLElement;
    await user.click(within(soon).getByRole('button', { name: /View/ }));
    expect(router.state.location.pathname).toBe('/members/3');
  });

  it('enlarges the ORIGINAL photo, not the thumbnail, and only when one exists', async () => {
    const withPhoto = { ...dueSoon, photo_thumbnail_url: 'https://img.test/thumb.jpg', photo_url: 'https://img.test/full.jpg' };
    const { user } = renderQueue({ queue: [withPhoto] });
    await ready();

    await user.click(document.querySelector('img.action-center-avatar-img') as HTMLElement);
    expect(screen.getByRole('img', { name: 'Due Soon' })).toHaveAttribute('src', 'https://img.test/full.jpg');
  });

  it('does not open a lightbox for a member whose original photo has not finished uploading', async () => {
    const thumbOnly = { ...dueSoon, photo_thumbnail_url: 'https://img.test/thumb.jpg', photo_url: null };
    const { user } = renderQueue({ queue: [thumbOnly] });
    await ready();
    await user.click(document.querySelector('img.action-center-avatar-img') as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ActionCenterPage — carousel (README §Action Center)', () => {
  it('the arrows scroll one card at a time WITHOUT behavior: "smooth" (smooth cancels scroll-snap)', async () => {
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy as unknown as typeof Element.prototype.scrollBy;
    const { user } = renderQueue({ viewport: MOBILE_WIDTH });
    await ready();

    await user.click(screen.getByRole('button', { name: 'Scroll to next card' }));
    await user.click(screen.getByRole('button', { name: 'Scroll to previous card' }));

    expect(scrollBy).toHaveBeenCalledTimes(2);
    for (const [options] of scrollBy.mock.calls) {
      expect(options).not.toHaveProperty('behavior');
      expect(options).toHaveProperty('left');
    }
    expect(scrollBy.mock.calls[0][0].left).toBeGreaterThanOrEqual(0);
    expect(scrollBy.mock.calls[1][0].left).toBeLessThanOrEqual(0);
  });

  it('does not refetch the queue when switching tabs', async () => {
    const { user, getActionCenterQueue } = renderQueue();
    await ready();
    await user.click(screen.getByRole('button', { name: /^Expired/ }));
    await user.click(screen.getByRole('button', { name: /Expiring soon/ }));
    expect(getActionCenterQueue).toHaveBeenCalledTimes(1);
  });
});
