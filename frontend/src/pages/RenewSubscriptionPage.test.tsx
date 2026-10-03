import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { formatDate } from '../lib/datetime';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RenewSubscriptionPage } from './RenewSubscriptionPage';
import { fakeAuth, setAuth, setServices } from '../test/mocks';
import { currentItem, localDate, member, plan } from '../test/fixtures';

const monthly = plan({ id: 1, name: 'Monthly', duration_days: 30, price: 1000 });
const quarterly = plan({ id: 2, name: 'Quarterly', duration_days: 90, price: 2500 });
const couple = plan({ id: 6, name: 'Couple Monthly', duration_days: 30, price: 1800, max_members: 2 });
const fee = plan({ id: 3, name: 'Membership Fee', category: 'addon', duration_days: null, price: 500 });
const zumba = plan({ id: 4, name: 'Zumba Class', category: 'addon', duration_days: 30, price: 800 });
const pt = plan({ id: 5, name: 'Personal Training', category: 'addon', duration_days: 30, price: 3000 });

let create: ReturnType<typeof vi.fn>;

function setup(opts: { items?: ReturnType<typeof currentItem>[]; plans?: ReturnType<typeof plan>[] } = {}) {
  create = vi.fn().mockResolvedValue({ subscription: { id: 99 }, items: [] });
  setAuth(fakeAuth());
  setServices({
    memberRepository: { getById: vi.fn().mockResolvedValue(member({ id: 5 })) } as never,
    subscriptionRepository: { getCurrentItemsForMember: vi.fn().mockResolvedValue(opts.items ?? []), create } as never,
    planRepository: { getAllActive: vi.fn().mockResolvedValue(opts.plans ?? [monthly, quarterly, couple, fee, zumba, pt]) } as never,
  });
  return render(
    <MemoryRouter initialEntries={['/members/5/renew']}>
      <Routes>
        <Route path="/members/:id/renew" element={<RenewSubscriptionPage />} />
        <Route path="/members/:id" element={<div>MEMBER DETAIL PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const planSelects = () => screen.getAllByRole('combobox');
const save = () => screen.getByRole('button', { name: /save checkout/i });

describe('Renew / add subscription checkout (REQ-SUB-001..009)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 7, 15));
  });
  const user = () => userEvent.setup({ advanceTimers: () => {} });

  it('REQ-SUB-001: starts with one blank membership item; Save disabled until a plan is chosen', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    expect(planSelects()).toHaveLength(1);
    expect(save()).toBeDisabled();
    expect(screen.getByText('✓ Contains exactly one membership item')).toBeInTheDocument();
  });

  it('REQ-SUB-001: picking a plan pre-fills start date = today and amount = price, and previews the end date', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    const startInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(startInput).toHaveValue('2026-07-15');
    expect(screen.getByLabelText(/Amount paid/)).toHaveValue('1,000');
    expect(screen.getByText(/Ends/)).toHaveTextContent(formatDate('2026-08-13')); // 15 Jul + 30 days - 1
    expect(save()).toBeEnabled();
  });

  it('REQ-SUB-009: quantity chips x1/x2/x3/x6/x12 + Custom; selecting x2 doubles amount and extends end date', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    for (const label of ['×1', '×2', '×3', '×6', '×12', 'Custom']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '×1' }).className).toContain('selected');
    await user().click(screen.getByRole('button', { name: '×2' }));
    expect(screen.getByLabelText(/Amount paid/)).toHaveValue('2,000');
    expect(screen.getByText(/Ends/)).toHaveTextContent(formatDate('2026-09-12')); // 15 Jul + 60 - 1
    await user().click(screen.getByRole('button', { name: '×12' }));
    expect(screen.getByLabelText(/Amount paid/)).toHaveValue('12,000');
  });

  it('REQ-SUB-009: custom quantity is clamped to a sane 1..60 and drives amount', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    await user().click(screen.getByRole('button', { name: 'Custom' }));
    const qty = screen.getByRole('spinbutton');
    fireEvent.change(qty, { target: { value: '4' } });
    expect(screen.getByLabelText(/Amount paid/)).toHaveValue('4,000');
    fireEvent.change(qty, { target: { value: '999' } });
    expect(qty).toHaveValue(60);
    expect(screen.getByLabelText(/Amount paid/)).toHaveValue('60,000');
  });

  it('REQ-SUB-009 / SUB-006: quantity chips and end date are hidden for an indefinite item ("Never expires")', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().click(screen.getByRole('button', { name: /add another item/i })); // second item = add-on
    await user().selectOptions(planSelects()[1], '3'); // Membership Fee (indefinite)
    const addonCard = screen.getAllByText('Add-on')[0].closest('.renew-item-card') as HTMLElement;
    expect(within(addonCard).queryByRole('button', { name: '×2' })).toBeNull();
    expect(within(addonCard).getByText('Never expires')).toBeInTheDocument();
  });

  it('REQ-SUB-001/003: only one membership item; additional items are add-ons; total sums every item', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    await user().click(screen.getByRole('button', { name: /add another item/i }));
    const second = planSelects()[1];
    // the second item's plan list only offers add-ons
    expect(within(second).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Zumba Class')]));
    expect(within(second).queryByText(/Monthly/)).toBeNull();
    await user().selectOptions(second, '4');
    expect(screen.getByText('Total this visit').nextElementSibling).toHaveTextContent('₹1,800'); // 1000 + 800
  });

  it('REQ-SUB-001: the sole membership item cannot be removed; an add-on can', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().click(screen.getByRole('button', { name: /add another item/i }));
    expect(screen.getByRole('button', { name: 'Remove membership item' })).toBeDisabled();
    await user().click(screen.getByRole('button', { name: 'Remove add-on item' }));
    expect(planSelects()).toHaveLength(1);
  });

  it('REQ-SUB-001: submit sends ONE call with the header + all items (payment mode once, per checkout)', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    await user().click(screen.getByRole('button', { name: /add another item/i }));
    await user().selectOptions(planSelects()[1], '4');
    await user().click(screen.getByRole('button', { name: 'UPI' }));
    await user().type(screen.getByLabelText(/Notes/), 'partial');
    await user().click(save());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toEqual({
      member_id: 5,
      payment_mode: 'UPI',
      notes: 'partial',
      items: [
        { plan_id: 1, member_id: 5, shared_member_id: null, start_date: '2026-07-15', quantity: 1, amount_paid: 1000 },
        { plan_id: 4, member_id: 5, shared_member_id: null, start_date: '2026-07-15', quantity: 1, amount_paid: 800 },
      ],
    });
    expect(await screen.findByText('MEMBER DETAIL PAGE')).toBeInTheDocument();
  });

  it('REQ-SUB-002: payment mode offers exactly Cash / UPI / Card, default Cash', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    const group = within(screen.getByRole('group', { name: 'Payment mode' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cash', 'UPI', 'Card']);
    expect(group.getByRole('button', { name: 'Cash' }).className).toContain('selected');
  });

  it('REQ-SUB-006: an indefinite item is sent with quantity null (server rejects any quantity for it)', async () => {
    setup({ plans: [monthly, fee] });
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    await user().click(screen.getByRole('button', { name: /add another item/i }));
    await user().selectOptions(planSelects()[1], '3');
    await user().click(save());
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].items[1]).toMatchObject({ plan_id: 3, quantity: null, amount_paid: 500 });
  });

  it('amount can be edited (0 allowed) and is what gets saved', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    const amount = screen.getByLabelText(/Amount paid/);
    await user().clear(amount);
    await user().type(amount, '0');
    await user().click(save());
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].items[0].amount_paid).toBe(0);
  });

  it('amount cannot be blanked: field error and Save disabled', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '1');
    await user().clear(screen.getByLabelText(/Amount paid/));
    expect(save()).toBeDisabled();
  });

  describe('renewal prefill', () => {
    it('prefills the current membership + each current add-on, with start = day after each current item ends', async () => {
      setup({
        items: [
          currentItem({ plan_id: 1, plan_name: 'Monthly', category: 'membership', end_date: '2026-07-20' }),
          currentItem({ subscription_item_id: 2, plan_id: 4, plan_name: 'Zumba Class', category: 'addon', end_date: '2026-07-25' }),
        ],
      });
      await screen.findByText('Renew / Add Subscription');
      expect(planSelects()).toHaveLength(2);
      expect(planSelects()[0]).toHaveValue('1');
      expect(planSelects()[1]).toHaveValue('4');
      const dates = Array.from(document.querySelectorAll('input[type="date"]')).map((i) => (i as HTMLInputElement).value);
      expect(dates).toEqual(['2026-07-21', '2026-07-26']);
      expect(save()).toBeEnabled();
    });
  });

  describe('REQ-SUB-005/008 overlap warning (warn, never block)', () => {
    it('REQ-SUB-008: re-adding the same add-on overlapping its current run shows a warning naming it and its end date', async () => {
      setup({ items: [currentItem({ plan_id: 4, plan_name: 'Zumba Class', category: 'addon', start_date: '2026-07-01', end_date: '2026-07-30' })] });
      await screen.findByText('Renew / Add Subscription');
      // prefill puts the add-on on 31 Jul (no overlap); pull the date back into the current run
      const addonDate = document.querySelectorAll('input[type="date"]')[1] as HTMLInputElement;
      await user().clear(addonDate);
      await user().type(addonDate, '2026-07-20');
      expect(screen.getByText(/Overlaps with current/)).toHaveTextContent('Zumba Class');
      expect(screen.getByText(/Overlaps with current/)).toHaveTextContent(formatDate('2026-07-30'));
    });

    it('REQ-SUB-005: "Save anyway" acknowledges; the checkout then saves with the payload unchanged and no overlap flag', async () => {
      setup({ items: [currentItem({ plan_id: 1, plan_name: 'Monthly', category: 'membership', start_date: '2026-07-01', end_date: '2026-07-30' })] });
      await screen.findByText('Renew / Add Subscription');
      const startDate = document.querySelector('input[type="date"]') as HTMLInputElement;
      await user().clear(startDate);
      await user().type(startDate, '2026-07-20');
      expect(await screen.findByText(/Overlaps with current/)).toBeInTheDocument();
      await user().click(screen.getByRole('button', { name: 'Save anyway' }));
      expect(screen.getByText('Overlap acknowledged.')).toBeInTheDocument();
      await user().click(save());
      await waitFor(() => expect(create).toHaveBeenCalled());
      const payload = create.mock.calls[0][0];
      expect(JSON.stringify(payload)).not.toMatch(/overlap/i);
      expect(payload.items[0].start_date).toBe('2026-07-20');
    });

    it('REQ-SUB-005: the warning\'s Cancel reverts the date to the last non-overlapping value', async () => {
      setup({ items: [currentItem({ plan_id: 1, plan_name: 'Monthly', category: 'membership', start_date: '2026-07-01', end_date: '2026-07-30' })] });
      await screen.findByText('Renew / Add Subscription');
      const startDate = document.querySelector('input[type="date"]') as HTMLInputElement;
      expect(startDate).toHaveValue('2026-07-31');
      fireEvent.change(startDate, { target: { value: '2026-07-20' } });
      const warning = (await screen.findByText(/Overlaps with current/)).closest('.renew-overlap-warning') as HTMLElement;
      await user().click(within(warning).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(document.querySelector('input[type="date"]')).toHaveValue('2026-07-31'));
    });

    it('REQ-SUB-008: a DIFFERENT add-on overlapping does not warn', async () => {
      setup({ items: [currentItem({ plan_id: 4, plan_name: 'Zumba Class', category: 'addon', end_date: '2026-07-30' })] });
      await screen.findByText('Renew / Add Subscription');
      await user().click(screen.getByRole('button', { name: /add another item/i }));
      await user().selectOptions(planSelects()[planSelects().length - 1], '5'); // Personal Training, starts today
      expect(screen.queryByText(/Overlaps with current/)).toBeNull();
    });
  });

  describe('failure handling', () => {
    it('REQ-SUB-007: the server\'s indefinite-plan block is shown to staff and the form is kept', async () => {
      setup();
      await screen.findByText('Renew / Add Subscription');
      await user().selectOptions(planSelects()[0], '1');
      create.mockRejectedValue(new Error('This member already has an active indefinite item for plan "Membership Fee" — it cannot be attached again'));
      await user().click(save());
      expect(await screen.findByText(/already has an active indefinite item/)).toBeInTheDocument();
      expect(planSelects()[0]).toHaveValue('1');
      expect(screen.queryByText('MEMBER DETAIL PAGE')).toBeNull();
    });

    it('a network failure keeps all items and offers "Retry save"', async () => {
      setup();
      await screen.findByText('Renew / Add Subscription');
      await user().selectOptions(planSelects()[0], '1');
      create.mockRejectedValueOnce(new Error('Failed to fetch'));
      await user().click(save());
      expect(await screen.findByText(/No payment was recorded; your items are kept/)).toBeInTheDocument();
      await user().click(screen.getByRole('button', { name: 'Retry save' }));
      expect(await screen.findByText('MEMBER DETAIL PAGE')).toBeInTheDocument();
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('leaving a dirty form asks before discarding', async () => {
      setup();
      await screen.findByText('Renew / Add Subscription');
      await user().selectOptions(planSelects()[0], '1');
      await user().click(screen.getAllByRole('button', { name: 'Cancel' }).pop() as HTMLElement);
      expect(screen.getByText('Discard this checkout?')).toBeInTheDocument();
      await user().click(screen.getByRole('button', { name: /keep editing/i }));
      expect(screen.queryByText('Discard this checkout?')).toBeNull();
    });

    it('no plans configured: explains an admin must add one first', async () => {
      setup({ plans: [] });
      expect(await screen.findByText(/No plans available/)).toBeInTheDocument();
    });
  });

  // REQ-SUB-004 (Must): for a plan with max_members = 2, staff can optionally set a shared member at creation.
  // RenewSubscriptionPage hard-codes `shared_member_id: null` and has no member picker at all.
  it.fails('SPEC GAP REQ-SUB-004: a couple (max_members = 2) membership offers an optional shared-member picker', async () => {
    setup();
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '6'); // Couple Monthly
    expect(screen.getByLabelText(/shared member|second member|partner/i)).toBeInTheDocument();
  });

  // REQ-SUB-005: membership overlap should be checked against ANY existing membership item (any plan).
  it.fails('SPEC GAP REQ-SUB-005: picking a DIFFERENT membership plan that overlaps the current one warns', async () => {
    setup({ items: [currentItem({ plan_id: 1, plan_name: 'Monthly', category: 'membership', start_date: '2026-07-01', end_date: '2026-07-30' })] });
    await screen.findByText('Renew / Add Subscription');
    await user().selectOptions(planSelects()[0], '2'); // Quarterly
    const startDate = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user().clear(startDate);
    await user().type(startDate, '2026-07-20');
    expect(await screen.findByText(/Overlaps with current/, undefined, { timeout: 300 })).toBeInTheDocument();
  });
});
