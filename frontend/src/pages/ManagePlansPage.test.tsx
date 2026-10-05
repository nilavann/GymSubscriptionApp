import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ManagePlansPage } from './ManagePlansPage';
import { planService as realPlanService } from '../services/plan.service';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildPlan } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';
import type { Plan } from '../types/plan';

const PLANS: Plan[] = [
  buildPlan({ id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1500, max_members: 1 }),
  buildPlan({ id: 2, name: 'Couple', category: 'membership', duration_days: 30, price: 2500, max_members: 2 }),
  buildPlan({ id: 3, name: 'Yoga', category: 'addon', duration_days: 30, price: 500, max_members: 1 }),
  buildPlan({ id: 4, name: 'Joining Fee', category: 'addon', duration_days: null, price: 300, max_members: 1 }),
];

function renderPlans(
  options: RenderOptions & {
    plans?: Plan[];
    getAllActive?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
    remove?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    plans = PLANS,
    getAllActive = vi.fn().mockResolvedValue(plans),
    create = vi.fn().mockResolvedValue(buildPlan()),
    update = vi.fn().mockResolvedValue(undefined),
    remove = vi.fn().mockResolvedValue(undefined),
    ...rest
  } = options;
  const utils = renderWithProviders(<ManagePlansPage />, {
    ...rest,
    services: fakeServices({
      planRepository: { getAllActive, delete: remove },
      planService: { ...realPlanService, create, update },
    }),
  });
  return { ...utils, getAllActive, create, update, remove };
}

const ready = () => screen.findByRole('heading', { name: 'Plans' });
const openAdd = (user: ReturnType<typeof renderPlans>['user']) => user.click(screen.getAllByRole('button', { name: /Add Plan/ })[0]);
const cardNames = () => Array.from(document.querySelectorAll('.plans-card')).map((c) => c.textContent ?? '');

describe('ManagePlansPage — data states', () => {
  it('shows a skeleton while loading', () => {
    renderPlans({ getAllActive: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a network failure offers Retry and recovers', async () => {
    const getAllActive = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(PLANS);
    const { user } = renderPlans({ getAllActive });
    expect(await screen.findByText("Couldn't load plans — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a generic failure never shows the raw error', async () => {
    renderPlans({ getAllActive: vi.fn().mockRejectedValue(new Error('PGRST raw')) });
    expect(await screen.findByText('Something went wrong loading plans. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).not.toBeInTheDocument();
  });

  it('with no plans, says so, offers to add one and hides the category filter', async () => {
    renderPlans({ plans: [] });
    await ready();
    expect(screen.getByText('No plans yet.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Category filter' })).not.toBeInTheDocument();
  });
});

describe('ManagePlansPage renders exactly ONE of table / cards', () => {
  it('on desktop: a table, one row per plan, no cards', async () => {
    renderPlans({ viewport: 1280 });
    await ready();
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(within(document.querySelector('table') as HTMLElement).getAllByRole('row')).toHaveLength(PLANS.length + 1);
    expect(document.querySelector('.plans-cards')).toBeNull();
  });

  it('on a phone: cards, one per plan, no table', async () => {
    renderPlans({ viewport: MOBILE_WIDTH });
    await ready();
    expect(document.querySelectorAll('table')).toHaveLength(0);
    expect(document.querySelectorAll('.plans-card')).toHaveLength(PLANS.length);
  });
});

describe('ManagePlansPage — category filter', () => {
  it('narrows the list to membership or add-on plans, then back to all', async () => {
    const { user } = renderPlans({ viewport: MOBILE_WIDTH });
    await ready();
    const group = screen.getByRole('group', { name: 'Category filter' });

    await user.click(within(group).getByRole('button', { name: 'Add-on' }));
    expect(cardNames()).toHaveLength(2);
    expect(cardNames().join(' ')).toContain('Yoga');
    expect(cardNames().join(' ')).not.toContain('Monthly');

    await user.click(within(group).getByRole('button', { name: 'Membership' }));
    expect(cardNames()).toHaveLength(2);
    expect(cardNames().join(' ')).toContain('Couple');

    await user.click(within(group).getByRole('button', { name: 'All' }));
    expect(cardNames()).toHaveLength(PLANS.length);
  });
});

describe('ManagePlansPage — add / edit', () => {
  it('validates on submit and does not call the service', async () => {
    const { user, create } = renderPlans();
    await ready();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Select a category')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid price')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows the fields each category needs: membership has Max members, add-on has Never expires', async () => {
    const { user } = renderPlans();
    await ready();
    await openAdd(user);

    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Membership' }));
    expect(screen.getByRole('group', { name: 'Max members' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Never expires/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Duration/)).toBeInTheDocument();

    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Add-on' }));
    expect(screen.queryByRole('group', { name: 'Max members' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Never expires/)).toBeInTheDocument();
  });

  it('an add-on that never expires needs no duration', async () => {
    const { user } = renderPlans();
    await ready();
    await openAdd(user);
    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Add-on' }));
    expect(screen.getByLabelText(/Duration/)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Never expires/));
    expect(screen.queryByLabelText(/Duration/)).not.toBeInTheDocument();
  });

  it('masks the price as the user types (digits and one decimal point, two places)', async () => {
    const { user } = renderPlans();
    await ready();
    await openAdd(user);
    await user.type(screen.getByLabelText(/Price/), '12a3.456');
    expect(screen.getByLabelText(/Price/)).toHaveValue('123.45');
  });

  it('creates a membership plan and reloads the list', async () => {
    const { user, create, getAllActive } = renderPlans();
    await ready();
    await openAdd(user);

    await user.type(screen.getByLabelText(/^Name/), 'Annual');
    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Membership' }));
    await user.type(screen.getByLabelText(/Duration/), '365');
    await user.type(screen.getByLabelText(/Price/), '9000');
    await user.click(within(screen.getByRole('group', { name: 'Max members' })).getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(create).toHaveBeenCalledWith({
      name: 'Annual',
      category: 'membership',
      duration_days: 365,
      neverExpires: false,
      price: '9000',
      max_members: 2,
    });
    await vi.waitFor(() => expect(getAllActive).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['a duplicate name', new Error('duplicate key … name'), 'This name is already used by another plan.'],
    ['being offline', new Error('Failed to fetch'), "Couldn't save this plan — check your connection and try again."],
    ['anything else', new Error('boom'), 'Something went wrong saving this plan. Please try again.'],
  ])('shows a specific message for %s and keeps the form', async (_label, error, message) => {
    const { user } = renderPlans({ create: vi.fn().mockRejectedValue(error) });
    await ready();
    await openAdd(user);
    await user.type(screen.getByLabelText(/^Name/), 'Dup');
    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Add-on' }));
    await user.click(screen.getByLabelText(/Never expires/));
    await user.type(screen.getByLabelText(/Price/), '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Dup');
  });

  it('editing prefills the form (an indefinite add-on shows Never expires ticked) and saves by id', async () => {
    const { user, update } = renderPlans({ viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Edit Joining Fee' }));

    expect(screen.getByRole('heading', { name: 'Edit Plan' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Never expires/)).toBeChecked();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Joining Fee');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(4, expect.objectContaining({ name: 'Joining Fee', category: 'addon', neverExpires: true }));
  });
});

describe('ManagePlansPage — delete', () => {
  const dialog = () => document.querySelector('.plans-delete-dialog') as HTMLElement;

  it('asks for confirmation, then deletes and reloads', async () => {
    const { user, remove, getAllActive } = renderPlans({ viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete Yoga' }));
    expect(screen.getByRole('heading', { name: 'Delete plan?' })).toBeInTheDocument();
    await user.click(within(dialog()).getByRole('button', { name: 'Delete' }));

    expect(remove).toHaveBeenCalledWith(3);
    await vi.waitFor(() => expect(getAllActive).toHaveBeenCalledTimes(2));
  });

  it('shows the server’s own "in use by subscriptions" message verbatim and keeps the dialog', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Cannot delete — used by 4 subscription(s)'));
    const { user } = renderPlans({ remove, viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete Monthly' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Cannot delete — used by 4 subscription(s)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete plan?' })).toBeInTheDocument();
  });

  it('Cancel deletes nothing', async () => {
    const { user, remove } = renderPlans({ viewport: 1280 });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Delete Yoga' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
  });
});
