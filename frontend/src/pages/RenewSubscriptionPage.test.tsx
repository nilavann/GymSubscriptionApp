import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { RenewSubscriptionPage } from './RenewSubscriptionPage';
import { addDays, todayDate } from '../lib/datetime';
import { fakeServices } from '../test/fakes';
import { renderRoutes } from '../test/render';
import { buildMember, buildPlan } from '../test/builders';
import type { MemberCurrentItem } from '../types/member-current-item';
import type { Plan } from '../types/plan';

const inDays = (n: number) => addDays(todayDate(), n);

const MEMBER = buildMember({ id: 12, name: 'Neha Joshi', member_number: 'MUM-2026-0012' });
const PLANS: Plan[] = [
  buildPlan({ id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1500 }),
  buildPlan({ id: 2, name: 'Quarterly', category: 'membership', duration_days: 90, price: 4000 }),
  buildPlan({ id: 3, name: 'Yoga', category: 'addon', duration_days: 30, price: 500 }),
  buildPlan({ id: 4, name: 'Joining Fee', category: 'addon', duration_days: null, price: 300 }),
];

const current = (plan: Plan, start: string, end: string | null): MemberCurrentItem => ({
  subscription_item_id: plan.id * 10,
  subscription_id: 1,
  plan_id: plan.id,
  plan_name: plan.name,
  category: plan.category,
  member_id: 12,
  start_date: start,
  end_date: end,
  quantity: 1,
  amount_paid: plan.price,
});

function renderRenew(
  options: {
    plans?: Plan[];
    items?: MemberCurrentItem[];
    member?: typeof MEMBER | null;
    getById?: ReturnType<typeof vi.fn>;
    getAllActive?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    plans = PLANS,
    items = [],
    member = MEMBER,
    getById = vi.fn().mockResolvedValue(member),
    getAllActive = vi.fn().mockResolvedValue(plans),
    create = vi.fn().mockResolvedValue({ subscription: { id: 501 }, items: [] }),
  } = options;
  const getCurrentItemsForMember = vi.fn().mockResolvedValue(items);
  const utils = renderRoutes(
    [
      { path: '/members/:id/renew', element: <RenewSubscriptionPage /> },
      { path: '/members/:id', element: <p>Member detail screen</p> },
    ],
    {
      route: '/members/12/renew',
      services: fakeServices({
        memberRepository: { getById },
        planRepository: { getAllActive },
        subscriptionRepository: { getCurrentItemsForMember, create },
      }),
    }
  );
  return { ...utils, getById, getAllActive, getCurrentItemsForMember, create };
}

const ready = () => screen.findByRole('heading', { name: 'Renew / Add Subscription' });
const itemCards = () => Array.from(document.querySelectorAll('.renew-item-card')) as HTMLElement[];
const planSelect = (i = 0) => within(itemCards()[i]).getByLabelText(/^Plan/) as HTMLSelectElement;
const startDate = (i = 0) => within(itemCards()[i]).getByLabelText(/^Start date/) as HTMLInputElement;
const amount = (i = 0) => within(itemCards()[i]).getByLabelText(/^Amount paid/) as HTMLInputElement;
const save = () => screen.getByRole('button', { name: /^Save checkout$|^Saving…$/ });

async function fillMonthly(user: ReturnType<typeof renderRenew>['user']) {
  await user.selectOptions(planSelect(0), '1');
}

describe('RenewSubscriptionPage — data states', () => {
  it('shows a skeleton while loading', () => {
    renderRenew({ getById: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a network failure offers Retry and recovers', async () => {
    const getById = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(MEMBER);
    const { user } = renderRenew({ getById });
    expect(await screen.findByText("Couldn't load this screen — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a member that no longer exists shows the generic error (never a blank screen)', async () => {
    renderRenew({ member: null });
    expect(await screen.findByText('Something went wrong loading this screen. Please try again.')).toBeInTheDocument();
  });

  it('with no plans in the catalog, says so and links back instead of showing an unusable form', async () => {
    renderRenew({ plans: [] });
    expect(await screen.findByText('No plans available — ask an admin to add one first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to member' })).toHaveAttribute('href', '/members/12');
  });
});

describe('RenewSubscriptionPage — header and member summary', () => {
  it('has a back link to the member (this route hides the tab bar) and names the member', async () => {
    renderRenew();
    await ready();
    expect(screen.getByRole('link', { name: 'Member' })).toHaveAttribute('href', '/members/12');
    expect(screen.getByText(/Neha Joshi · MUM-2026-0012 · one checkout, one or more items/)).toBeInTheDocument();
  });

  it('says "No active membership" for a lapsed member, with no status badge', async () => {
    renderRenew({ items: [] });
    await ready();
    expect(screen.getByText('No active membership')).toBeInTheDocument();
    expect(document.querySelector('.renew-member-card .status-badge')).toBeNull();
  });

  it('shows the current membership with days left and an Active pill when comfortably valid', async () => {
    renderRenew({ items: [current(PLANS[0], inDays(-10), inDays(20))] });
    await ready();
    expect(screen.getByText(/Monthly expires .* · 20 days/)).toBeInTheDocument();
    expect(document.querySelector('.renew-member-card .status-badge')).toHaveClass('status-badge-active');
  });

  it('shows an Expiring Soon pill when within a week', async () => {
    renderRenew({ items: [current(PLANS[0], inDays(-25), inDays(5))] });
    await ready();
    expect(screen.getByText('Expiring Soon')).toHaveClass('status-badge-expiring');
  });

  it('says "never expires" for an indefinite membership', async () => {
    renderRenew({ items: [current(buildPlan({ id: 1, name: 'Lifetime', category: 'membership', duration_days: null }), inDays(-100), null)] });
    await ready();
    expect(screen.getByText('Lifetime · never expires')).toBeInTheDocument();
  });
});

describe('RenewSubscriptionPage — the starting items', () => {
  it('starts with ONE blank Membership item and Save disabled for a member with nothing current', async () => {
    renderRenew();
    await ready();
    expect(itemCards()).toHaveLength(1);
    expect(within(itemCards()[0]).getByText('Membership')).toBeInTheDocument();
    expect(planSelect(0)).toHaveValue('');
    expect(save()).toBeDisabled(); // the blank item still needs a plan
    // The blank card already counts as the one membership item (the message is about count, not completeness);
    // "Add one membership item to continue" can't be reached from the UI because the only membership can't be removed.
    expect(screen.getByText('✓ Contains exactly one membership item')).toBeInTheDocument();
  });

  it('prefills "renew what they already have": the membership plus a card per current add-on', async () => {
    renderRenew({ items: [current(PLANS[0], inDays(-10), inDays(20)), current(PLANS[2], inDays(-10), inDays(20))] });
    await ready();
    expect(itemCards()).toHaveLength(2);
    expect(planSelect(0)).toHaveValue('1');
    expect(planSelect(1)).toHaveValue('3');
    expect(startDate(0)).toHaveValue(inDays(21)); // the day after the current one ends
    expect(amount(0)).toHaveValue('1,500');
    expect(amount(1)).toHaveValue('500');
    expect(save()).toBeEnabled();
  });

  it('offers only membership plans on the membership item', async () => {
    renderRenew();
    await ready();
    const labels = within(planSelect(0)).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Select a plan…', 'Monthly · 30 days · ₹1,500', 'Quarterly · 90 days · ₹4,000']);
  });
});

describe('RenewSubscriptionPage — an item', () => {
  it('choosing a plan fills the amount (price × quantity) and previews the end date', async () => {
    const { user } = renderRenew();
    await ready();
    await fillMonthly(user);

    expect(amount(0)).toHaveValue('1,500');
    expect(startDate(0)).toHaveValue(todayDate());
    expect(within(itemCards()[0]).getByText(inDays(29).slice(0, 4), { exact: false })).toBeInTheDocument(); // "Ends <date>" (start + 30 - 1)
    expect(within(itemCards()[0]).getByText('(computed on save)')).toBeInTheDocument();
  });

  it('a quantity preset recalculates the amount and the end date', async () => {
    const { user } = renderRenew();
    await ready();
    await fillMonthly(user);
    await user.click(within(itemCards()[0]).getByRole('button', { name: '×3' }));

    expect(amount(0)).toHaveValue('4,500');
    expect(within(itemCards()[0]).getByRole('button', { name: '×3' })).toHaveClass('renew-quantity-chip-selected');
  });

  it('Custom quantity takes a number clamped to 1–60, and "back to presets" returns', async () => {
    const { user } = renderRenew();
    await ready();
    await fillMonthly(user);
    await user.click(within(itemCards()[0]).getByRole('button', { name: 'Custom' }));

    const qty = within(itemCards()[0]).getByRole('spinbutton');
    fireEvent.change(qty, { target: { value: '500' } });
    expect(qty).toHaveValue(60);
    expect(amount(0)).toHaveValue('90,000');

    await user.click(within(itemCards()[0]).getByRole('button', { name: 'back to presets' }));
    expect(within(itemCards()[0]).getByRole('button', { name: '×12' })).toBeInTheDocument();
  });

  it('an indefinite add-on has no quantity and says it never expires', async () => {
    const { user } = renderRenew();
    await ready();
    await fillMonthly(user);
    await user.click(screen.getByRole('button', { name: '+ Add another item' }));
    await user.selectOptions(planSelect(1), '4');

    expect(within(itemCards()[1]).queryByText('Quantity')).not.toBeInTheDocument();
    expect(within(itemCards()[1]).getByText('Never expires')).toBeInTheDocument();
  });

  it('the amount is editable, shown with thousands separators when not focused', async () => {
    const { user } = renderRenew();
    await ready();
    await fillMonthly(user);
    await user.click(amount(0));
    expect(amount(0)).toHaveValue('1500');
    await user.clear(amount(0));
    await user.type(amount(0), '12ab34');
    expect(amount(0)).toHaveValue('1234');
    await user.tab();
    expect(amount(0)).toHaveValue('1,234');
  });

  it('flags a past start date with a warning style (it is allowed, but unusual)', async () => {
    const { user } = renderRenew();
    await ready();
    await fillMonthly(user);
    fireEvent.change(startDate(0), { target: { value: inDays(-3) } });
    expect(within(itemCards()[0]).getByText(/Defaults to day after current membership expires/)).toHaveClass('renew-helper-warning');
  });
});

describe('RenewSubscriptionPage — adding and removing items', () => {
  it('"+ Add another item" adds an Add-on (a checkout has exactly one membership), and it can be removed', async () => {
    const { user } = renderRenew();
    await ready();
    await user.click(screen.getByRole('button', { name: '+ Add another item' }));

    expect(itemCards()).toHaveLength(2);
    expect(within(itemCards()[1]).getByText('Add-on')).toBeInTheDocument();
    expect(within(planSelect(1)).getAllByRole('option').map((o) => o.textContent)).toContain('Yoga · 30 days · ₹500');

    await user.click(within(itemCards()[1]).getByRole('button', { name: 'Remove add-on item' }));
    expect(itemCards()).toHaveLength(1);
  });

  it('the only membership item cannot be removed', async () => {
    renderRenew();
    await ready();
    const remove = within(itemCards()[0]).getByRole('button', { name: 'Remove membership item' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', 'A checkout needs one membership.');
  });
});

describe('RenewSubscriptionPage — overlap warning (client-side only, by design)', () => {
  const overlapping = () => [current(PLANS[0], inDays(-10), inDays(20))];

  it('warns when the new period overlaps the same plan the member already has, naming it', async () => {
    renderRenew({ items: overlapping() });
    await ready();
    fireEvent.change(startDate(0), { target: { value: todayDate() } });
    expect(within(itemCards()[0]).getByText(/Overlaps with current/)).toBeInTheDocument();
    expect(within(itemCards()[0]).getByText('Monthly')).toBeInTheDocument();
  });

  it('does not warn for back-to-back periods', async () => {
    renderRenew({ items: overlapping() });
    await ready();
    expect(within(itemCards()[0]).queryByText(/Overlaps with current/)).not.toBeInTheDocument();
  });

  it('Cancel puts the start date back to its last non-overlapping value', async () => {
    const { user } = renderRenew({ items: overlapping() });
    await ready();
    const good = startDate(0).value;
    fireEvent.change(startDate(0), { target: { value: todayDate() } });
    await user.click(within(itemCards()[0]).getByRole('button', { name: 'Cancel' }));

    expect(startDate(0)).toHaveValue(good);
    expect(within(itemCards()[0]).queryByText(/Overlaps with current/)).not.toBeInTheDocument();
  });

  it('"Save anyway" silences the warning and notes it was acknowledged — it never blocks saving', async () => {
    const { user } = renderRenew({ items: overlapping() });
    await ready();
    fireEvent.change(startDate(0), { target: { value: todayDate() } });
    expect(save()).toBeEnabled(); // the warning is advisory
    await user.click(within(itemCards()[0]).getByRole('button', { name: 'Save anyway' }));

    expect(within(itemCards()[0]).getByText('Overlap acknowledged.')).toBeInTheDocument();
    expect(within(itemCards()[0]).queryByText(/Overlaps with current/)).not.toBeInTheDocument();
  });
});

describe('RenewSubscriptionPage — totals', () => {
  it('sums every item and says the checkout is valid once it has one membership', async () => {
    const { user } = renderRenew({ items: [current(PLANS[0], inDays(-10), inDays(20)), current(PLANS[2], inDays(-10), inDays(20))] });
    await ready();
    expect(screen.getByText('₹2,000')).toBeInTheDocument();
    expect(screen.getByText('✓ Contains exactly one membership item')).toBeInTheDocument();

    await user.click(within(itemCards()[1]).getByRole('button', { name: '×2' }));
    expect(screen.getByText('₹2,500')).toBeInTheDocument();
  });
});

describe('RenewSubscriptionPage — saving the checkout', () => {
  it('sends exactly the contract create-subscription expects, then opens the member with a receipt toast', async () => {
    const { user, create, router } = renderRenew({ items: [current(PLANS[0], inDays(-10), inDays(20)), current(PLANS[2], inDays(-10), inDays(20))] });
    await ready();
    await user.click(screen.getByRole('button', { name: 'UPI' }));
    await user.type(screen.getByLabelText(/^Notes/), '  balance next week  ');
    await user.click(within(itemCards()[0]).getByRole('button', { name: '×2' }));
    await user.click(save());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      member_id: 12,
      payment_mode: 'UPI',
      notes: 'balance next week',
      items: [
        { plan_id: 1, member_id: 12, shared_member_id: null, start_date: inDays(21), quantity: 2, amount_paid: 3000 },
        { plan_id: 3, member_id: 12, shared_member_id: null, start_date: inDays(21), quantity: 1, amount_paid: 500 },
      ],
    });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/members/12'));
    expect(router.state.location.state).toEqual({ toast: 'Checkout saved · receipt #501' });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('never sends end_date (the server computes it) and sends quantity null for an indefinite item', async () => {
    const { user, create } = renderRenew();
    await ready();
    await fillMonthly(user);
    await user.click(screen.getByRole('button', { name: '+ Add another item' }));
    await user.selectOptions(planSelect(1), '4');
    await user.click(save());

    const payload = create.mock.calls[0][0];
    expect(payload.items[1]).toMatchObject({ plan_id: 4, quantity: null });
    for (const item of payload.items) expect(item).not.toHaveProperty('end_date');
    expect(payload.notes).toBeNull();
    expect(payload.payment_mode).toBe('Cash');
  });

  it('locks the form while saving', async () => {
    const { user } = renderRenew({ create: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    await ready();
    await fillMonthly(user);
    await user.click(save());

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(planSelect(0)).toBeDisabled();
  });

  it('a network failure keeps every item, says no payment was recorded, and "Retry save" tries again', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue({ subscription: { id: 9 }, items: [] });
    const { user, router } = renderRenew({ create });
    await ready();
    await fillMonthly(user);
    await user.click(save());

    expect(await screen.findByText(/Checkout couldn't be saved — network error\. No payment was recorded; your items are kept\./)).toBeInTheDocument();
    expect(planSelect(0)).toHaveValue('1');

    await user.click(screen.getByRole('button', { name: 'Retry save' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/members/12'));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('a server rejection is shown verbatim (the Edge Function’s own message is already specific)', async () => {
    const { user } = renderRenew({ create: vi.fn().mockRejectedValue(new Error('Plan 1 is no longer available')) });
    await ready();
    await fillMonthly(user);
    await user.click(save());
    expect(await screen.findByText('Plan 1 is no longer available')).toBeInTheDocument();
  });
});

describe('RenewSubscriptionPage — leaving', () => {
  it('Cancel on an untouched form just goes back to the member', async () => {
    const { user, router } = renderRenew();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/members/12');
  });

  it('Cancel after editing asks first, and "Keep editing" stays put', async () => {
    const { user, router } = renderRenew();
    await ready();
    await fillMonthly(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { name: 'Discard this checkout?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('heading', { name: 'Discard this checkout?' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/members/12/renew');
    expect(planSelect(0)).toHaveValue('1');
  });

  it('"Discard" leaves without saving', async () => {
    const { user, router, create } = renderRenew();
    await ready();
    await fillMonthly(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(router.state.location.pathname).toBe('/members/12');
    expect(create).not.toHaveBeenCalled();
  });
});
