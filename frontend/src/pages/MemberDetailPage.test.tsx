import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemberDetailPage } from './MemberDetailPage';
import { memberService as realMemberService } from '../services/member.service';
import { addDays, todayDate } from '../lib/datetime';
import { fakeServices } from '../test/fakes';
import { renderRoutes } from '../test/render';
import { buildBranch, buildMember, buildMemberListRow, buildPlan, buildProfile } from '../test/builders';
import type { Member } from '../types/member';
import type { MemberCurrentItem } from '../types/member-current-item';
import type { Subscription, SubscriptionItem } from '../types/subscription';

const inDays = (n: number) => addDays(todayDate(), n);

const MEMBER: Member = buildMember({
  id: 12,
  name: 'Neha Joshi',
  member_number: 'MUM-2026-0012',
  phone: '9000000012',
  gender: 'Female',
  date_of_birth: '1996-03-14',
  date_of_joining: '2026-01-15',
  email: 'neha@example.com',
  occupation: 'Designer',
  pincode: '400001',
  branch_id: 1,
  handled_by_staff: 'ravi',
  created_by: 'priya',
});
const PLANS = [buildPlan({ id: 1, name: 'Monthly', category: 'membership' }), buildPlan({ id: 3, name: 'Yoga', category: 'addon' })];
const BRANCHES = [buildBranch({ id: 1, name: 'Mumbai Central', code: 'MUM' })];
const STAFF = [buildProfile({ id: 'ravi', full_name: 'Ravi Kumar' }), buildProfile({ id: 'priya', full_name: 'Priya Sharma' })];

const currentItem = (overrides: Partial<MemberCurrentItem>): MemberCurrentItem => ({
  subscription_item_id: 1,
  subscription_id: 1,
  plan_id: 1,
  plan_name: 'Monthly',
  category: 'membership',
  member_id: 12,
  start_date: inDays(-10),
  end_date: inDays(20),
  quantity: 1,
  amount_paid: 1500,
  ...overrides,
});

const subscription = (overrides: Partial<Subscription>): Subscription => ({
  id: 1,
  member_id: 12,
  payment_mode: 'Cash',
  notes: null,
  created_at: '2026-06-01T10:00:00Z',
  ...overrides,
});

const historyItem = (overrides: Partial<SubscriptionItem>): SubscriptionItem => ({
  id: 1,
  subscription_id: 1,
  plan_id: 1,
  member_id: 12,
  shared_member_id: null,
  start_date: '2026-06-01',
  end_date: '2026-06-30',
  quantity: 1,
  amount_paid: 1500,
  ...overrides,
});

function renderDetail(
  options: {
    route?: string;
    routeState?: unknown;
    member?: Member | null;
    items?: MemberCurrentItem[];
    history?: Subscription[];
    historyItems?: SubscriptionItem[];
    getById?: ReturnType<typeof vi.fn>;
    updateMember?: ReturnType<typeof vi.fn>;
    uploadPhoto?: ReturnType<typeof vi.fn>;
    remove?: ReturnType<typeof vi.fn>;
    updateSubscription?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    route = '/members/12',
    routeState,
    member = MEMBER,
    items = [],
    history = [],
    historyItems = [],
    getById = vi.fn().mockResolvedValue(member),
    updateMember = vi.fn().mockResolvedValue({ name: 'Neha J.' }),
    uploadPhoto = vi.fn().mockResolvedValue(undefined),
    remove = vi.fn().mockResolvedValue(undefined),
    updateSubscription = vi.fn().mockResolvedValue(undefined),
  } = options;
  const utils = renderRoutes(
    [
      { path: '/members/:id', element: <MemberDetailPage /> },
      { path: '/members/:id/edit', element: <MemberDetailPage /> },
      { path: '/members/:id/renew', element: <p>Renew screen</p> },
      { path: '/', element: <p>Members screen</p> },
    ],
    {
      route,
      routeState,
      services: fakeServices({
        memberRepository: { getById, delete: remove },
        memberService: { ...realMemberService, updateMember, uploadPhoto },
        subscriptionRepository: {
          getCurrentItemsForMember: vi.fn().mockResolvedValue(items),
          getHistoryForMember: vi.fn().mockResolvedValue(history),
          getItemsForSubscriptions: vi.fn().mockResolvedValue(historyItems),
          update: updateSubscription,
        },
        planRepository: { getAllActive: vi.fn().mockResolvedValue(PLANS) },
        profileRepository: { getAllActive: vi.fn().mockResolvedValue(STAFF), getAllNonDeleted: vi.fn().mockResolvedValue(STAFF) },
        memberListRepository: { getAll: vi.fn().mockResolvedValue([buildMemberListRow({ id: 12, name: 'Neha Joshi' }), buildMemberListRow({ id: 13, name: 'Karan Shah' })]) },
        branchRepository: { getAllActive: vi.fn().mockResolvedValue(BRANCHES) },
      }),
    }
  );
  return { ...utils, getById, updateMember, uploadPhoto, remove, updateSubscription };
}

const ready = () => screen.findByText('Neha Joshi', { selector: '.member-detail-name' });
const field = (id: string) => document.getElementById(`detail-${id}`) as HTMLInputElement;
const strip = () => document.querySelector('.member-detail-membership-strip') as HTMLElement;

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('MemberDetailPage — data states', () => {
  it('shows a skeleton while loading', () => {
    renderDetail({ getById: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a member that does not exist says so, offers a way back, and does NOT offer Retry (retrying cannot help)', async () => {
    renderDetail({ member: null });
    expect(await screen.findByText('This member could not be found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Members' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a network failure offers Retry and recovers', async () => {
    const getById = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(MEMBER);
    const { user } = renderDetail({ getById });
    expect(await screen.findByText("Couldn't load this member — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a generic failure never shows the raw error', async () => {
    renderDetail({ getById: vi.fn().mockRejectedValue(new Error('PGRST raw')) });
    expect(await screen.findByText('Something went wrong loading this member. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).not.toBeInTheDocument();
  });

  it('shows the receipt toast Renew hands over, and it can be dismissed', async () => {
    const { user } = renderDetail({ routeState: { toast: 'Checkout saved · receipt #501' } });
    await ready();
    expect(screen.getByText('Checkout saved · receipt #501')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Checkout saved · receipt #501')).not.toBeInTheDocument();
  });
});

describe('MemberDetailPage — hero', () => {
  it('shows who they are, how long they have been a member and who handles them', async () => {
    renderDetail();
    await ready();
    expect(screen.getByText(/MUM-2026-0012 · 9000000012 · Female · joined /)).toBeInTheDocument();
    expect(screen.getByText('Handled by: Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/');
  });

  it('shows initials when there is no photo', async () => {
    renderDetail();
    await ready();
    expect(document.querySelector('.member-detail-avatar')).toHaveTextContent('NJ');
  });

  it('says "Not set" when nobody handles the member', async () => {
    renderDetail({ member: { ...MEMBER, handled_by_staff: null } });
    await ready();
    expect(screen.getByText('Handled by: Not set')).toBeInTheDocument();
  });
});

describe('MemberDetailPage — membership strip', () => {
  it('no membership: says so and offers to add one', async () => {
    renderDetail({ items: [] });
    await ready();
    expect(within(strip()).getByText('No active membership')).toBeInTheDocument();
    expect(within(strip()).getByRole('link', { name: 'Add membership' })).toHaveAttribute('href', '/members/12/renew');
    expect(screen.getByText('Expired', { selector: '.status-badge' })).toBeInTheDocument();
  });

  it('active: shows the plan, its period, the amount, days remaining and a Renew link — and an Active pill', async () => {
    renderDetail({ items: [currentItem({})] });
    await ready();
    expect(strip()).toHaveClass('member-detail-membership-strip-active');
    expect(within(strip()).getByText('Current membership')).toBeInTheDocument();
    expect(within(strip()).getByText('Monthly')).toBeInTheDocument();
    expect(within(strip()).getByText('₹1500')).toBeInTheDocument();
    expect(within(strip()).getByText(/\d+ days remaining/)).toBeInTheDocument();
    expect(within(strip()).getByRole('link', { name: 'Renew' })).toHaveAttribute('href', '/members/12/renew');
    expect(screen.getByText('Active', { selector: '.status-badge' })).toHaveClass('status-badge-active');
  });

  it('expired: a red strip saying so, "Renew now", and that entry is blocked at the gate', async () => {
    renderDetail({ items: [currentItem({ start_date: inDays(-40), end_date: inDays(-10) })] });
    await ready();
    expect(strip()).toHaveClass('member-detail-membership-strip-expired');
    expect(within(strip()).getByText('Membership expired')).toBeInTheDocument();
    expect(within(strip()).getByRole('link', { name: 'Renew now' })).toHaveAttribute('href', '/members/12/renew');
    expect(within(strip()).getByText('Entry blocked at the gate')).toBeInTheDocument();
    expect(screen.getByText('Expired', { selector: '.status-badge' })).toHaveClass('status-badge-expired');
  });

  it('the header pill and the strip never disagree (both come from the same status)', async () => {
    renderDetail({ items: [currentItem({ end_date: inDays(3) })] });
    await ready();
    expect(screen.getByText('Expiring', { selector: '.status-badge' })).toHaveClass('status-badge-expiring');
  });
});

describe('MemberDetailPage — add-ons and subscription history', () => {
  it('shows an empty state for add-ons rather than disappearing', async () => {
    renderDetail();
    await ready();
    expect(screen.getByText('No add-ons yet')).toBeInTheDocument();
  });

  it('lists current add-ons with their end date and an Active / Expiring Soon pill', async () => {
    renderDetail({
      items: [
        currentItem({ subscription_item_id: 2, plan_id: 3, plan_name: 'Yoga', category: 'addon', end_date: inDays(20) }),
        currentItem({ subscription_item_id: 3, plan_id: 4, plan_name: 'Locker', category: 'addon', end_date: inDays(2) }),
        currentItem({ subscription_item_id: 4, plan_id: 5, plan_name: 'Joining Fee', category: 'addon', end_date: null }),
      ],
    });
    await ready();
    const row = (name: string) => screen.getByText(name).closest('.member-detail-addon-row') as HTMLElement;
    expect(within(row('Yoga')).getByText('Active')).toBeInTheDocument();
    expect(within(row('Locker')).getByText('Expiring Soon')).toBeInTheDocument();
    expect(within(row('Joining Fee')).getByText('No expiry')).toBeInTheDocument();
  });

  it('shows an empty history state', async () => {
    renderDetail();
    await ready();
    expect(screen.getByText('No subscription history yet')).toBeInTheDocument();
  });

  it('summarises each checkout (payment mode and total) and expands to its line items, incl. a shared member', async () => {
    const { user } = renderDetail({
      history: [subscription({ id: 1, payment_mode: 'UPI' })],
      historyItems: [
        historyItem({ id: 1, plan_id: 1, amount_paid: 1500 }),
        historyItem({ id: 2, plan_id: 3, amount_paid: 500, shared_member_id: 13 }),
      ],
    });
    await ready();
    const row = document.querySelector('.member-detail-history-row') as HTMLElement;
    expect(within(row).getByText(/UPI · ₹2000/)).toBeInTheDocument();
    expect(within(row).queryByText(/Monthly \(membership\)/)).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /UPI · ₹2000/ }));
    expect(within(row).getByText(/Monthly \(membership\)/)).toBeInTheDocument();
    expect(within(row).getByText(/Yoga \(add-on\)/)).toBeInTheDocument();
    expect(within(row).getByText(/Shared with Karan Shah/)).toBeInTheDocument();
  });

  it('edits a past checkout’s payment mode and notes in place, via update-subscription', async () => {
    const { user, updateSubscription } = renderDetail({
      history: [subscription({ id: 7, payment_mode: 'Cash', notes: null })],
      historyItems: [historyItem({ subscription_id: 7 })],
    });
    await ready();
    await user.click(document.querySelector('.member-detail-history-edit') as HTMLElement);
    await user.selectOptions(screen.getByLabelText('Payment mode'), 'Card');
    await user.type(screen.getByLabelText('Notes'), '  paid by card  ');
    const form = document.querySelector('.member-detail-history-edit-form') as HTMLElement;
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(updateSubscription).toHaveBeenCalledWith({ subscription_id: 7, payment_mode: 'Card', notes: 'paid by card' });
    expect(await screen.findByText(/Card · ₹1500/)).toBeInTheDocument();
  });

  it.each([
    ['offline', new Error('Failed to fetch'), "Couldn't save — check your connection and try again."],
    ['anything else', new Error('boom'), 'Something went wrong saving. Please try again.'],
  ])('a failed history edit shows a specific message (%s) and keeps the form', async (_label, error, message) => {
    const { user } = renderDetail({
      history: [subscription({ id: 7 })],
      historyItems: [historyItem({ subscription_id: 7 })],
      updateSubscription: vi.fn().mockRejectedValue(error),
    });
    await ready();
    await user.click(document.querySelector('.member-detail-history-edit') as HTMLElement);
    await user.click(within(document.querySelector('.member-detail-history-edit-form') as HTMLElement).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(document.querySelector('.member-detail-history-edit-form')).not.toBeNull();
  });
});

describe('MemberDetailPage — read view of the profile', () => {
  it('hides the long tail of personal details behind a count, then reveals them', async () => {
    const { user } = renderDetail();
    await ready();
    expect(screen.queryByText('neha@example.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 8 more details' }));
    expect(screen.getByText('neha@example.com')).toBeInTheDocument();
    expect(screen.getByText('Designer')).toBeInTheDocument();
    expect(screen.getByText('Mumbai Central')).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument(); // created by
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });
});

describe('MemberDetailPage — editing the member', () => {
  it('Edit turns the profile into a form; Cancel throws the changes away', async () => {
    const { user } = renderDetail();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(field('name')).toHaveValue('Neha Joshi');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    await user.clear(field('name'));
    await user.type(field('name'), 'Changed');
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    expect(field('name')).toBeNull();
    expect(screen.getByText('Neha Joshi', { selector: '.member-detail-name' })).toBeInTheDocument();
  });

  it('/members/:id/edit opens straight into edit mode (deep link)', async () => {
    renderDetail({ route: '/members/12/edit' });
    await ready();
    expect(field('name')).toHaveValue('Neha Joshi');
  });

  it('validates before saving, shows the problem and does not call the service', async () => {
    const { user, updateMember } = renderDetail();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(field('name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(updateMember).not.toHaveBeenCalled();
  });

  it('saves via the service, merges the result into what is on screen, and leaves edit mode', async () => {
    const { user, updateMember } = renderDetail();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(field('name'));
    await user.type(field('name'), 'Neha J.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateMember).toHaveBeenCalledTimes(1);
    expect(updateMember.mock.calls[0][0]).toBe(12);
    expect(updateMember.mock.calls[0][1]).toMatchObject({ name: 'Neha J.', phone: '9000000012' });
    expect(await screen.findByText('Neha J.', { selector: '.member-detail-name' })).toBeInTheDocument();
    expect(field('name')).toBeNull();
  });

  it('masks the phone as it is typed', async () => {
    const { user } = renderDetail();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(field('phone'));
    await user.type(field('phone'), '98a76-5432109999');
    expect(field('phone')).toHaveValue('9876543210');
  });

  it.each([
    ['a duplicate phone number', new Error('duplicate key … phone'), 'This phone number is already used by another member.'],
    ['being offline', new Error('Failed to fetch'), "Couldn't save this member — check your connection and try again."],
    ['anything else', new Error('boom'), 'Something went wrong saving this member. Please try again.'],
  ])('shows a specific message for %s and stays in edit mode', async (_label, error, message) => {
    const { user } = renderDetail({ updateMember: vi.fn().mockRejectedValue(error) });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(field('name')).toHaveValue('Neha Joshi');
  });
});

describe('MemberDetailPage — deleting', () => {
  const dialog = () => document.querySelector('.member-detail-delete-dialog') as HTMLElement;

  it('asks first, naming the member, then deletes and returns to the list', async () => {
    const { user, remove, router } = renderDetail();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('heading', { name: 'Delete member?' })).toBeInTheDocument();
    expect(within(dialog()).getByText(/"Neha Joshi" will be removed/)).toBeInTheDocument();

    await user.click(within(dialog()).getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith(12);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('Cancel deletes nothing', async () => {
    const { user, remove } = renderDetail();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Delete member?' })).not.toBeInTheDocument();
  });

  it.each([
    ['the server’s own "in use" message, verbatim', new Error('Cannot delete — used by 4 subscription record(s)'), 'Cannot delete — used by 4 subscription record(s)'],
    ['being offline', new Error('Failed to fetch'), "Couldn't delete this member — check your connection and try again."],
  ])('shows %s and keeps the dialog open', async (_label, error, message) => {
    const { user } = renderDetail({ remove: vi.fn().mockRejectedValue(error) });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete member?' })).toBeInTheDocument();
  });
});

describe('MemberDetailPage — photo', () => {
  it('uploads a chosen photo, then re-reads the member so the new picture shows', async () => {
    const { user, uploadPhoto, getById } = renderDetail();
    await ready();
    const file = new File(['img'], 'me.jpg', { type: 'image/jpeg' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

    expect(uploadPhoto).toHaveBeenCalledWith(12, file);
    await vi.waitFor(() => expect(getById).toHaveBeenCalledTimes(2));
  });

  it('a failed upload says so and can be dismissed', async () => {
    const { user } = renderDetail({ uploadPhoto: vi.fn().mockRejectedValue(new Error('storage down')) });
    await ready();
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText(/The photo couldn't be uploaded\. Please try again\./)).toBeInTheDocument();
    expect(screen.queryByText(/storage down/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/The photo couldn't be uploaded/)).not.toBeInTheDocument();
  });

  it('Take photo opens the camera dialog', async () => {
    const { user } = renderDetail();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(screen.getByRole('dialog', { name: 'Take a photo' })).toBeInTheDocument();
  });

  it('tapping the photo enlarges the original, and it can be closed', async () => {
    const { user } = renderDetail({ member: { ...MEMBER, photo_url: 'https://img.test/full.jpg', photo_thumbnail_url: 'https://img.test/thumb.jpg' } });
    await ready();
    await user.click(document.querySelector('img.member-detail-avatar-img') as HTMLElement);
    expect(screen.getByRole('img', { name: 'Neha Joshi' })).toHaveAttribute('src', 'https://img.test/full.jpg');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Neha Joshi' })).not.toBeInTheDocument();
  });
});
