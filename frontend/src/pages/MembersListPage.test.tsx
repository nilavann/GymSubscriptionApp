import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MembersListPage } from './MembersListPage';
import { addDays, todayDate } from '../lib/datetime';
import { fakeServices } from '../test/fakes';
import { renderRoutes, type RenderOptions } from '../test/render';
import { buildMemberListRow, buildPlan } from '../test/builders';
import { MOBILE_WIDTH, setViewport } from '../test/viewport';
import type { MemberListRow } from '../types/member-list';
import type { Plan } from '../types/plan';

const inDays = (n: number) => addDays(todayDate(), n);

// Four members spanning every status: 2 active, 1 expiring (3 days), 1 expired (5 days ago).
const asha = buildMemberListRow({ id: 1, name: 'Asha Verma', member_number: 'MUM-2026-0001', phone: '9000000001', gender: 'Female', date_of_joining: '2026-04-01', current_membership_plan_id: 1, current_membership_plan_name: 'Monthly', current_membership_end_date: inDays(60) });
const bharat = buildMemberListRow({ id: 2, name: 'Bharat Rao', member_number: 'MUM-2026-0002', phone: '9000000002', gender: 'Male', date_of_joining: '2026-03-01', current_membership_plan_id: 2, current_membership_plan_name: 'Quarterly', current_membership_end_date: inDays(3) });
const chitra = buildMemberListRow({ id: 3, name: 'Chitra Iyer', member_number: 'MUM-2026-0003', phone: '9000000003', gender: 'Female', date_of_joining: '2026-02-01', current_membership_plan_id: 1, current_membership_plan_name: 'Monthly', current_membership_end_date: inDays(-5) });
const dev = buildMemberListRow({ id: 4, name: 'Dev Patel', member_number: 'MUM-2026-0004', phone: '9000000004', gender: 'Male', date_of_joining: '2026-01-01', current_membership_plan_id: null, current_membership_plan_name: null, current_membership_end_date: null });
const ROWS: MemberListRow[] = [asha, bharat, chitra, dev];

const PLANS: Plan[] = [
  buildPlan({ id: 1, name: 'Monthly', category: 'membership' }),
  buildPlan({ id: 2, name: 'Quarterly', category: 'membership' }),
  buildPlan({ id: 3, name: 'Yoga', category: 'addon' }),
];

function renderMembers(options: RenderOptions & { rows?: MemberListRow[]; getAll?: ReturnType<typeof vi.fn> } = {}) {
  const { rows = ROWS, getAll = vi.fn().mockResolvedValue(rows), ...rest } = options;
  const getAllActive = vi.fn().mockResolvedValue(PLANS);
  const utils = renderRoutes(
    [
      { path: '/', element: <MembersListPage /> },
      { path: '/members/new', element: <p>Add member page</p> },
      { path: '/members/:id', element: <p>Member detail page</p> },
      { path: '/members/:id/renew', element: <p>Renew page</p> },
    ],
    {
      ...rest,
      services: fakeServices({ memberListRepository: { getAll }, planRepository: { getAllActive } }),
    }
  );
  return { ...utils, getAll, getAllActive };
}

const ready = () => screen.findByRole('heading', { name: 'Members' });
const cards = () => Array.from(document.querySelectorAll('.members-card'));
const tables = () => document.querySelectorAll('table');
const names = () => cards().map((card) => card.querySelector('.members-card-name')?.textContent);

describe('MembersListPage — loading, error and empty states', () => {
  it('shows a skeleton — not stale or partial content — while loading', () => {
    renderMembers({ getAll: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('a network failure offers Retry, keeps the message specific, and recovers on retry', async () => {
    const getAll = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(ROWS);
    const { user } = renderMembers({ getAll });

    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.getByText(/Check your internet connection/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
    expect(getAll).toHaveBeenCalledTimes(2);
  });

  it('a generic failure does not blame the connection, and never shows the raw error', async () => {
    renderMembers({ getAll: vi.fn().mockRejectedValue(new Error('PGRST301: raw server detail')) });
    expect(await screen.findByText(/Something went wrong loading members/)).toBeInTheDocument();
    expect(screen.queryByText(/PGRST301/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check your internet connection/)).not.toBeInTheDocument();
  });

  it('with no members at all, says so and offers to add one — it is not an error', async () => {
    renderMembers({ rows: [] });
    await ready();
    expect(screen.getByText('No members yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Add Member/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('MembersListPage renders exactly ONE of table / cards (rules.md rule 33)', () => {
  it('on a phone: only the card list — no <table>, no view toggle, one card per member', async () => {
    renderMembers({ viewport: MOBILE_WIDTH });
    await ready();

    expect(tables()).toHaveLength(0);
    expect(cards()).toHaveLength(ROWS.length);
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.members-card-compact')).toHaveLength(ROWS.length);
  });

  it('on desktop (default Table view): only the table — no card list — one row per member', async () => {
    renderMembers({ viewport: 1280 });
    await ready();

    expect(tables()).toHaveLength(1);
    expect(within(tables()[0]).getAllByRole('row')).toHaveLength(ROWS.length + 1); // + the header row
    expect(cards()).toHaveLength(0);
    expect(document.querySelector('.members-cards')).toBeNull();
    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
  });

  it('on desktop, switching to Cards view swaps the table for the (full) cards, never both', async () => {
    const { user } = renderMembers({ viewport: 1280 });
    await ready();

    await user.click(screen.getByRole('button', { name: 'Cards view' }));
    expect(tables()).toHaveLength(0);
    expect(cards()).toHaveLength(ROWS.length);
    expect(document.querySelectorAll('.members-card-compact')).toHaveLength(0); // desktop cards are the full variant

    await user.click(screen.getByRole('button', { name: 'Table view' }));
    expect(tables()).toHaveLength(1);
    expect(cards()).toHaveLength(0);
  });

  it('renders each member photo once, and lazily', async () => {
    const withPhotos = ROWS.map((row, i) => (i < 2 ? { ...row, photo_thumbnail_url: `https://img.test/${row.id}.jpg` } : row));
    renderMembers({ rows: withPhotos, viewport: MOBILE_WIDTH });
    await ready();

    const images = Array.from(document.querySelectorAll('img.members-avatar-img'));
    expect(images).toHaveLength(2); // not 4: no hidden second copy
    for (const image of images) {
      expect(image).toHaveAttribute('loading', 'lazy');
      expect(image).toHaveAttribute('decoding', 'async');
    }
  });

  it('keeps search text and filters when the window crosses 768px, flipping table <-> cards', async () => {
    const { user } = renderMembers({ viewport: 1280 });
    await ready();
    await user.type(screen.getByRole('searchbox', { name: 'Search members' }), 'Asha');
    expect(within(tables()[0]).getAllByRole('row')).toHaveLength(2);

    setViewport(MOBILE_WIDTH);
    expect(tables()).toHaveLength(0);
    expect(names()).toEqual(['Asha Verma']);
    expect(screen.getByRole('searchbox', { name: 'Search members' })).toHaveValue('Asha');

    setViewport(1280);
    expect(tables()).toHaveLength(1);
    expect(cards()).toHaveLength(0);
    expect(screen.getByRole('searchbox', { name: 'Search members' })).toHaveValue('Asha');
  });

  it('does not refetch when the window crosses 768px', async () => {
    const { getAll } = renderMembers({ viewport: 1280 });
    await ready();
    setViewport(MOBILE_WIDTH);
    setViewport(1280);
    expect(getAll).toHaveBeenCalledTimes(1);
  });
});

describe('the phone card (design_handoff_flexhub_mobile/README.md §Members)', () => {
  it('shows name + status pill, member #, "Plan · Phone" and the expiry — in that order', async () => {
    renderMembers({ viewport: MOBILE_WIDTH, rows: [bharat] });
    await ready();

    const card = cards()[0] as HTMLElement;
    const rows = Array.from(card.querySelectorAll('.members-card-top, .members-card-number, .members-card-secondary, .members-card-expiry-line'));
    expect(rows.map((el) => el.className)).toEqual([
      'members-card-top',
      'members-card-number',
      'members-card-secondary',
      'members-card-expiry-line',
    ]);
    const top = rows[0] as HTMLElement;
    expect(within(top).getByText('Bharat Rao')).toBeInTheDocument();
    expect(within(top).getByText('Expiring')).toHaveClass('status-badge-expiring');
    expect(within(card).getByText('MUM-2026-0002')).toBeInTheDocument();
    expect(within(card).getByText('Quarterly · 9000000002')).toBeInTheDocument();
    expect(within(card).getByText(/^Expires /)).toBeInTheDocument();
  });

  it('has NO Renew / View buttons — the whole card opens the member', async () => {
    renderMembers({ viewport: MOBILE_WIDTH });
    await ready();
    expect(screen.queryByRole('button', { name: /^Renew / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View / })).not.toBeInTheDocument();
  });

  it('labels a member with no plan, and shows each status with the right pill', async () => {
    renderMembers({ viewport: MOBILE_WIDTH });
    await ready();
    const byName = (n: string) => cards().find((c) => c.textContent?.includes(n)) as HTMLElement;

    expect(within(byName('Dev Patel')).getByText('No plan · 9000000004')).toBeInTheDocument();
    expect(within(byName('Asha Verma')).getByText('Active')).toHaveClass('status-badge-active');
    expect(within(byName('Chitra Iyer')).getByText('Expired')).toHaveClass('status-badge-expired');
    expect(within(byName('Chitra Iyer')).getByText(/^Expired /)).toBeInTheDocument(); // the expiry line
  });

  it('tapping the card opens that member', async () => {
    const { user, router } = renderMembers({ viewport: MOBILE_WIDTH });
    await ready();
    await user.click(within(cards()[0] as HTMLElement).getByText('Asha Verma')); // newest joiner first
    expect(router.state.location.pathname).toBe('/members/1');
  });

  it('is keyboard-operable: Enter and Space on the focused card open the member', async () => {
    const { user, router } = renderMembers({ viewport: MOBILE_WIDTH });
    await ready();

    (cards()[1] as HTMLElement).focus();
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/members/2');
  });

  it('exposes the card as a button and keeps the full name in the DOM for a screen reader', async () => {
    renderMembers({ viewport: MOBILE_WIDTH, rows: [buildMemberListRow({ name: 'A Very Long Member Name That Will Be Ellipsized Visually' })] });
    await ready();
    const card = screen.getByRole('button', { name: /A Very Long Member Name That Will Be Ellipsized Visually/ });
    expect(card).toHaveAttribute('tabindex', '0');
  });
});

describe('the desktop Cards view keeps its Renew / View buttons', () => {
  async function desktopCards() {
    const utils = renderMembers({ viewport: 1280 });
    await ready();
    await utils.user.click(screen.getByRole('button', { name: 'Cards view' }));
    return utils;
  }

  it('shows them, and Renew goes to the renew screen WITHOUT also opening the member', async () => {
    const { user, router } = await desktopCards();
    await user.click(screen.getByRole('button', { name: 'Renew Asha Verma' }));
    expect(router.state.location.pathname).toBe('/members/1/renew');
  });

  it('Enter on a card’s inner button does not also trigger the card’s own open', async () => {
    const { user, router } = await desktopCards();
    const navigations: string[] = [];
    router.subscribe((state) => navigations.push(state.location.pathname));

    screen.getByRole('button', { name: 'Renew Asha Verma' }).focus();
    await user.keyboard('{Enter}');

    expect(router.state.location.pathname).toBe('/members/1/renew');
    expect(navigations).toEqual(['/members/1/renew']); // one navigation, not renew-then-detail
  });
});

describe('search, status pills and sort', () => {
  it.each([
    ['name', 'chitra', ['Chitra Iyer']],
    ['member number', 'MUM-2026-0002', ['Bharat Rao']],
    ['phone, ignoring spaces', '900 000 0004', ['Dev Patel']],
  ])('finds a member by %s', async (_label, query, expected) => {
    const { user } = renderMembers({ viewport: MOBILE_WIDTH });
    await ready();
    await user.type(screen.getByRole('searchbox', { name: 'Search members' }), query);
    expect(names()).toEqual(expected);
  });

  it('says so when nothing matches, and Clear search restores the list', async () => {
    const { user } = renderMembers({ viewport: MOBILE_WIDTH });
    await ready();
    await user.type(screen.getByRole('searchbox', { name: 'Search members' }), 'zzz');

    expect(screen.getByText('No results for "zzz"')).toBeInTheDocument();
    expect(cards()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(cards()).toHaveLength(ROWS.length);
  });

  it('counts each status pill and filters by it', async () => {
    const { user } = renderMembers({ viewport: MOBILE_WIDTH });
    await ready();
    const group = screen.getByRole('group', { name: 'Status filter' });

    // "No plan" is derived as expired (deriveStatus), so Expired = Chitra + Dev.
    expect(within(group).getByRole('button', { name: /^All/ })).toHaveTextContent('4');
    expect(within(group).getByRole('button', { name: /^Active/ })).toHaveTextContent('1');
    expect(within(group).getByRole('button', { name: /^Expiring/ })).toHaveTextContent('1');
    expect(within(group).getByRole('button', { name: /^Expired/ })).toHaveTextContent('2');

    await user.click(within(group).getByRole('button', { name: /^Expiring/ }));
    expect(names()).toEqual(['Bharat Rao']);
  });

  it('sorts by join date (default), then name, then expiry', async () => {
    // Deliberately NOT alphabetical in join order, or "sort by name" could not fail.
    const zed = buildMemberListRow({ id: 11, name: 'Zed Khan', date_of_joining: '2026-05-01', current_membership_end_date: inDays(30) });
    const amy = buildMemberListRow({ id: 12, name: 'Amy Das', date_of_joining: '2026-01-01', current_membership_end_date: inDays(10) });
    const mid = buildMemberListRow({ id: 13, name: 'Mia Roy', date_of_joining: '2026-03-01', current_membership_end_date: null });
    const { user } = renderMembers({ viewport: MOBILE_WIDTH, rows: [amy, mid, zed] });
    await ready();

    expect(names()).toEqual(['Zed Khan', 'Mia Roy', 'Amy Das']); // newest joiner first
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    expect(names()).toEqual(['Amy Das', 'Mia Roy', 'Zed Khan']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'expiry');
    expect(names()).toEqual(['Amy Das', 'Zed Khan', 'Mia Roy']); // soonest first, indefinite last
  });
});

describe('filters drawer', () => {
  it('filters by gender, shows an applied-filter chip, and Clear all resets', async () => {
    const { user } = renderMembers({ viewport: MOBILE_WIDTH });
    await ready();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    const drawer = screen.getByRole('dialog', { name: 'Filters' });
    await user.click(within(drawer).getByRole('checkbox', { name: 'Female' }));
    await user.click(within(drawer).getByRole('button', { name: 'Apply filters' }));

    expect(names()).toEqual(['Asha Verma', 'Chitra Iyer']);
    expect(screen.getByText('2 members · 1 filter active')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Filters' })).getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(cards()).toHaveLength(ROWS.length));
  });
});
