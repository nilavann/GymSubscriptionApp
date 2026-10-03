import '../test/page-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ManagePlansPage } from './ManagePlansPage';
import { planService as realPlanService } from '../services/plan.service';
import { adminProfile, fakeAuth, setAuth, setServices } from '../test/mocks';
import { plan } from '../test/fixtures';

const catalog = [
  plan({ id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1000, max_members: 1 }),
  plan({ id: 2, name: 'Couple Monthly', category: 'membership', duration_days: 30, price: 1800, max_members: 2 }),
  plan({ id: 3, name: 'Membership Fee', category: 'addon', duration_days: null, price: 500 }),
  plan({ id: 4, name: 'Zumba Class', category: 'addon', duration_days: 30, price: 800 }),
];

let planRepository: Record<string, ReturnType<typeof vi.fn>>;
let planService: typeof realPlanService;

function renderPage(plans = catalog) {
  planRepository = { getAllActive: vi.fn().mockResolvedValue(plans), delete: vi.fn().mockResolvedValue(undefined) };
  planService = { ...realPlanService, create: vi.fn().mockResolvedValue(plan()), update: vi.fn().mockResolvedValue(undefined) } as never;
  setAuth(fakeAuth(adminProfile));
  setServices({ planRepository: planRepository as never, planService });
  return render(<MemoryRouter><ManagePlansPage /></MemoryRouter>);
}

const rowsOf = () => Array.from(document.querySelectorAll('table tbody tr')).map((r) => r.textContent ?? '');
const el = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('Plan management (REQ-ADMIN-002)', () => {
  beforeEach(() => vi.useRealTimers());

  it('lists membership plans AND add-ons together with name, category, duration, price, max members', async () => {
    renderPage();
    await waitFor(() => expect(rowsOf()).toHaveLength(4));
    const all = rowsOf().join('|');
    for (const name of ['Monthly', 'Couple Monthly', 'Membership Fee', 'Zumba Class']) expect(all).toContain(name);
    const headers = Array.from(document.querySelectorAll('table thead th')).map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining([expect.stringMatching(/name/i), expect.stringMatching(/category/i), expect.stringMatching(/duration/i), expect.stringMatching(/price/i), expect.stringMatching(/max/i)]));
  });

  it('can be filtered by category', async () => {
    renderPage();
    await waitFor(() => expect(rowsOf()).toHaveLength(4));
    await userEvent.click(screen.getByRole('button', { name: 'Add-on' }));
    expect(rowsOf()).toHaveLength(2);
    expect(rowsOf().join('|')).not.toContain('Couple Monthly');
    await userEvent.click(screen.getByRole('button', { name: 'Membership' }));
    expect(rowsOf()).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(rowsOf()).toHaveLength(4);
  });

  it('indefinite add-ons show as never expiring; add-ons show "—" for max members', async () => {
    renderPage();
    await waitFor(() => expect(rowsOf()).toHaveLength(4));
    const fee = rowsOf().find((r) => r.includes('Membership Fee')) as string;
    expect(fee).toMatch(/never|—|indefinite|no expiry/i);
  });

  it('membership with blank duration is blocked with a validation error and nothing is sent', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Plan' }));
    await user.type(el('plan-name'), 'Weekend Pass');
    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: /membership/i }));
    await user.type(el('plan-price'), '300');
    await user.click(document.querySelector('button.plans-submit') as HTMLElement);
    expect(planService.create).not.toHaveBeenCalled();
    expect(await screen.findByText(/Enter a whole number of days/)).toBeInTheDocument();
  });

  it('add-on may be created with "never expires" (no duration)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Plan' }));
    await user.type(el('plan-name'), 'Locker');
    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: /add-on/i }));
    await user.type(el('plan-price'), '150');
    await user.click(screen.getByLabelText(/never expires/i));
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    await waitFor(() => expect(planService.create).toHaveBeenCalled());
    expect((planService.create as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ name: 'Locker', category: 'addon', neverExpires: true, price: '150' });
  });

  it('name and price are required', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Plan' }));
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Select a category')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid price')).toBeInTheDocument();
  });

  it('price field only accepts a decimal with at most 2 places', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Plan' }));
    await user.type(el('plan-price'), '12a3.456.7');
    expect(el('plan-price')).toHaveValue('123.45');
  });

  it('editing a plan opens it prefilled and saves via update (not create)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Edit Monthly' }))[0]);
    expect(el('plan-name')).toHaveValue('Monthly');
    expect(el('plan-price')).toHaveValue('1000');
    await user.clear(el('plan-price'));
    await user.type(el('plan-price'), '1100');
    await user.click(screen.getByRole('button', { name: /^(save|update)/i }));
    await waitFor(() => expect(planService.update).toHaveBeenCalledWith(1, expect.objectContaining({ price: '1100' })));
    expect(planService.create).not.toHaveBeenCalled();
  });

  it('a duplicate plan name is reported as already used', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Plan' }));
    (planService.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('duplicate key value violates unique constraint "idx_plans_name_active"'));
    await user.type(el('plan-name'), 'Monthly');
    await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: /membership/i }));
    await user.type(el('plan-duration'), '30');
    await user.type(el('plan-price'), '10');
    await user.click(screen.getByRole('button', { name: /^(save|create)/i }));
    expect(await screen.findByText('This name is already used by another plan.')).toBeInTheDocument();
  });

  it('delete asks for confirmation, then calls delete-plan', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Delete Zumba Class' }))[0]);
    expect(screen.getByText('Delete plan?')).toBeInTheDocument();
    const dialog = screen.getByText('Delete plan?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(planRepository.delete).toHaveBeenCalledWith(4));
  });

  it('a plan used by subscriptions can\'t be deleted: the guard\'s "used by X" message is shown verbatim', async () => {
    const user = userEvent.setup();
    renderPage();
    planRepository.delete.mockRejectedValue(new Error('Cannot delete — used by 3 subscription(s)'));
    await user.click((await screen.findAllByRole('button', { name: 'Delete Monthly' }))[0]);
    const dialog = screen.getByText('Delete plan?').parentElement as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText('Cannot delete — used by 3 subscription(s)')).toBeInTheDocument();
    expect(screen.getByText('Delete plan?')).toBeInTheDocument(); // dialog stays open
  });

  it('load failure offers retry', async () => {
    planRepository = { getAllActive: vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(catalog) };
    setAuth(fakeAuth(adminProfile));
    setServices({ planRepository: planRepository as never, planService: realPlanService });
    render(<MemoryRouter><ManagePlansPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(rowsOf()).toHaveLength(4));
  });
});
