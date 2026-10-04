import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { dayFromToday, memberListRow } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// Reports: a member summary + "expiring this week", and the transactions list for a chosen date range. The range
// is a real database filter, so each preset's request is asserted. The list renders as a table on desktop and as
// cards on a phone — exactly one of them (lists-render-once.spec.ts proves the one-of-two; here it is the content).

const isWide = (page: Page) => page.viewportSize()!.width >= 768;
const tile = (page: Page, label: string) => page.locator('.reports-tile').filter({ has: page.locator('.reports-tile-label', { hasText: label }) });
const txRows = (page: Page) => page.locator('.reports-tx-table tbody tr, .reports-tx-card');

const today = () => dayFromToday(0);
const firstOfMonth = () => `${today().slice(0, 8)}01`;

/** The `start_date` bounds the app asked the database for, in request order. */
function rangeRequests(supabase: SupabaseMock) {
  return supabase.calls('/rest/v1/subscription_items').map((call) => {
    const bounds = new URLSearchParams(call.search).getAll('start_date');
    return {
      from: bounds.find((b) => b.startsWith('gte.'))?.slice(4),
      to: bounds.find((b) => b.startsWith('lte.'))?.slice(4),
    };
  });
}

function seed(supabase: SupabaseMock, itemDays: number[] = [0, 0, 0]) {
  supabase.tables.member_list_view = [
    memberListRow({ id: 1, name: 'Active One', current_membership_plan_name: 'Monthly', current_membership_end_date: dayFromToday(90) }),
    memberListRow({ id: 2, name: 'Active Two', current_membership_end_date: null }),
    memberListRow({ id: 3, name: 'Soon Sarah', current_membership_plan_name: 'Quarterly', current_membership_end_date: dayFromToday(2) }),
    memberListRow({ id: 4, name: 'Gone Gita', current_membership_end_date: dayFromToday(-10) }),
  ];
  supabase.tables.members = [
    { id: 1, name: 'Older Olga', phone: '9000000001', member_number: 'MUM-2026-0001' },
    { id: 2, name: 'Newest Neel', phone: '9000000002', member_number: 'MUM-2026-0002' },
    { id: 3, name: 'Yoga Yash', phone: '9000000003', member_number: 'MUM-2026-0003' },
  ];
  supabase.tables.subscriptions = [
    { id: 1, payment_mode: 'UPI' },
    { id: 2, payment_mode: 'Card' },
    { id: 3, payment_mode: 'Cash' },
  ];
  supabase.tables.subscription_items = [
    { id: 1, subscription_id: 1, plan_id: 1, member_id: 1, start_date: dayFromToday(itemDays[0]), amount_paid: 1000 },
    { id: 2, subscription_id: 2, plan_id: 1, member_id: 2, start_date: dayFromToday(itemDays[1]), amount_paid: 2500 },
    { id: 3, subscription_id: 3, plan_id: 3, member_id: 3, start_date: dayFromToday(itemDays[2]), amount_paid: 500 },
  ];
}

test.describe('Reports', () => {
  test('summarises members by status and lists who expires this week', async ({ page, supabase, signedInAs }) => {
    seed(supabase);
    await signedInAs('staff');
    await page.goto('/reports');

    await expect(tile(page, 'Total')).toContainText('4');
    await expect(tile(page, 'Active')).toContainText('2');
    await expect(tile(page, 'Expiring Soon')).toContainText('1');
    await expect(tile(page, 'Expired')).toContainText('1');

    const soon = page.locator('.reports-expiring-row').filter({ hasText: 'Soon Sarah' });
    await expect(soon).toContainText('Quarterly');
    await expect(page.locator('.reports-expiring-row')).toHaveCount(1);
  });

  test('says so when nobody expires this week — an empty state, not an error', async ({ page, supabase, signedInAs }) => {
    seed(supabase);
    supabase.tables.member_list_view = [memberListRow({ id: 1, name: 'Active One', current_membership_end_date: dayFromToday(90) })];
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(page.getByText('No memberships expiring this week.')).toBeVisible();
  });

  test('starts on "This month" and each preset asks the database for exactly its range', async ({ page, supabase, signedInAs }) => {
    seed(supabase);
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(txRows(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'This month' })).toHaveClass(/reports-range-chip-active/);
    expect(rangeRequests(supabase).at(-1)).toEqual({ from: firstOfMonth(), to: today() });

    await page.getByRole('button', { name: 'Today' }).click();
    await expect.poll(() => rangeRequests(supabase).at(-1)).toEqual({ from: today(), to: today() });

    await page.getByRole('button', { name: 'This week' }).click();
    await expect.poll(() => rangeRequests(supabase).at(-1)).toEqual({ from: dayFromToday(-6), to: today() });
  });

  test('a custom range applies; a reversed one is refused without asking the database', async ({ page, supabase, signedInAs }) => {
    seed(supabase);
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(txRows(page)).toHaveCount(3);
    await expect(page.getByLabel('Start date')).toHaveCount(0);

    await page.getByRole('button', { name: 'Custom…' }).click();
    await page.getByLabel('Start date').fill('2026-06-20');
    await page.getByLabel('End date').fill('2026-06-10');
    const before = rangeRequests(supabase).length;
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Start date must be on or before the end date.')).toBeVisible();
    expect(rangeRequests(supabase)).toHaveLength(before);

    await page.getByLabel('Start date').fill('2026-05-01');
    await page.getByLabel('End date').fill('2026-05-31');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => rangeRequests(supabase).at(-1)).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    await expect(page.getByText('No transactions in this date range.')).toBeVisible();
  });

  test('transactions list newest first, with rupees, the payment mode and a distinct add-on badge', async ({ page, supabase, signedInAs }) => {
    seed(supabase, [-2, 0, -1]); // Olga 2 days ago, Neel today, Yash yesterday
    await signedInAs('staff');
    await page.goto('/reports');
    await page.getByRole('button', { name: 'This week' }).click(); // a range that always contains "2 days ago"
    await expect(txRows(page)).toHaveCount(3);

    const names = ['Newest Neel', 'Yoga Yash', 'Older Olga'];
    for (const [index, name] of names.entries()) await expect(txRows(page).nth(index)).toContainText(name);

    if (isWide(page)) {
      const table = page.locator('.reports-tx-table');
      await expect(table).toContainText('₹2500');
      await expect(table.getByText('Add-on')).toHaveClass(/reports-tx-type-addon/);
      await expect(page.locator('.reports-tx-cards')).toHaveCount(0);
    } else {
      const first = txRows(page).first();
      await expect(first).toContainText('₹2500 · Card');
      await expect(first).toContainText('MUM-2026-0002 · 9000000002');
      await expect(page.locator('.reports-tx-table')).toHaveCount(0);
    }
  });

  test('says so when the range has no transactions', async ({ page, supabase, signedInAs }) => {
    seed(supabase);
    supabase.tables.subscription_items = [];
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(page.getByText('No transactions in this date range.')).toBeVisible();
    await expect(page.locator('.reports-tx-table')).toHaveCount(0);
  });

  test('shows both monthly charts and the payment legend in a fixed Cash / UPI / Card order', async ({ page, supabase, signedInAs }) => {
    seed(supabase);
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(txRows(page)).toHaveCount(3);

    await expect(page.getByText('New Subscriptions per Month')).toBeVisible();
    await expect(page.getByText('New Add-ons per Month')).toBeVisible();
    const legend = (await page.locator('.reports-payment-legend').textContent()) ?? '';
    expect(legend.indexOf('Cash')).toBeGreaterThanOrEqual(0);
    expect(legend.indexOf('Cash')).toBeLessThan(legend.indexOf('UPI'));
    expect(legend.indexOf('UPI')).toBeLessThan(legend.indexOf('Card'));
  });

  test('never makes the page scroll sideways — wide content scrolls inside its own container', async ({ page, supabase, signedInAs }) => {
    seed(supabase);
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(txRows(page)).toHaveCount(3);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);
  });

  test('a failed section offers its own Retry and leaves the other alone', async ({ page, supabase, signedInAs }) => {
    test.setTimeout(60_000); // the SDK retries a failed read (1s + 2s + 4s) before reporting it
    seed(supabase);
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(txRows(page)).toHaveCount(3);

    const summaryCallsBefore = supabase.calls('/rest/v1/member_list_view').filter((c) => !c.search.includes('gte.')).length;
    supabase.offline = true;
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 20_000 });
    // The member summary above it is untouched.
    await expect(tile(page, 'Total')).toContainText('4');

    supabase.offline = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(txRows(page)).toHaveCount(3);
    expect(supabase.calls('/rest/v1/member_list_view').filter((c) => !c.search.includes('gte.')).length).toBe(summaryCallsBefore);
    expect(rangeRequests(supabase).at(-1)).toEqual({ from: today(), to: today() }); // Retry re-runs the SAME range
  });
});
