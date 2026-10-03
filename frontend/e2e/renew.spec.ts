import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { currentItemRow, dayFromToday, memberListRow, memberRow } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// The renew / add-subscription checkout in a real browser. The thing worth pinning here is the request:
// `create-subscription`'s body is the contract with the server, which alone computes end_date and the
// default amount (CLAUDE.md "Server-side authority"). Everything the client sends is asserted verbatim.

const card = (page: Page, index = 0) => page.locator('.renew-item-card').nth(index);
const planSelect = (page: Page, index = 0) => card(page, index).getByLabel(/^Plan/);
const startDate = (page: Page, index = 0) => card(page, index).getByLabel(/^Start date/);
const amount = (page: Page, index = 0) => card(page, index).getByLabel(/^Amount paid/);
const saveButton = (page: Page) => page.getByRole('button', { name: /^Save checkout$|^Saving…$/ });

function seedMember(supabase: SupabaseMock, items: Record<string, unknown>[] = []) {
  supabase.tables.members = [memberRow({ id: 1, name: 'Neha Joshi' })];
  supabase.tables.member_list_view = [memberListRow({ id: 1, name: 'Neha Joshi' })];
  supabase.tables.member_current_items = items;
}

/** Answers like the real function: a header + one item per line, `end_date` computed server-side. */
function answerCreateSubscription(supabase: SupabaseMock, receiptId = 501) {
  supabase.functions['create-subscription'] = (body) => {
    const payload = body as { member_id: number; payment_mode: string; notes: string | null; items: Record<string, unknown>[] };
    return {
      json: {
        subscription: { id: receiptId, member_id: payload.member_id, payment_mode: payload.payment_mode, notes: payload.notes, created_at: new Date().toISOString() },
        items: payload.items.map((item, i) => ({ id: 900 + i, subscription_id: receiptId, end_date: null, ...item })),
      },
    };
  };
}

const created = (supabase: SupabaseMock) => supabase.calls('/functions/v1/create-subscription');

test.describe('Renew / Add Subscription', () => {
  test('a first checkout: pick a plan, the amount fills in, saving sends the exact contract and opens the member with a receipt', async ({
    page,
    supabase,
    signedInAs,
  }) => {
    seedMember(supabase);
    answerCreateSubscription(supabase);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();
    await expect(page.getByText(/Neha Joshi · MUM-2026-0001/)).toBeVisible();

    await planSelect(page).selectOption('1'); // Monthly · ₹1,500
    await expect(amount(page)).toHaveValue('1,500');
    await expect(startDate(page)).toHaveValue(dayFromToday(0));
    await expect(page.getByText('✓ Contains exactly one membership item')).toBeVisible();

    await saveButton(page).click();

    await expect(page).toHaveURL(/\/members\/1$/);
    await expect(page.getByText('Checkout saved · receipt #501')).toBeVisible();
    expect(created(supabase).map((call) => call.body)).toEqual([
      {
        member_id: 1,
        payment_mode: 'Cash',
        notes: null,
        items: [{ plan_id: 1, member_id: 1, shared_member_id: null, start_date: dayFromToday(0), quantity: 1, amount_paid: 1500 }],
      },
    ]);
    // Never computed by the client — the server owns the date arithmetic.
    expect(JSON.stringify(created(supabase)[0].body)).not.toContain('end_date');
  });

  test('a renewal starts the day after the current membership ends and keeps their add-on', async ({ page, supabase, signedInAs }) => {
    seedMember(supabase, [
      currentItemRow({ subscription_item_id: 1, plan_id: 1, plan_name: 'Monthly', category: 'membership', end_date: dayFromToday(20) }),
      currentItemRow({ subscription_item_id: 2, plan_id: 3, plan_name: 'Yoga', category: 'addon', amount_paid: 500, end_date: dayFromToday(20) }),
    ]);
    answerCreateSubscription(supabase);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();

    await expect(page.locator('.renew-item-card')).toHaveCount(2);
    await expect(startDate(page, 0)).toHaveValue(dayFromToday(21));
    await expect(startDate(page, 1)).toHaveValue(dayFromToday(21));

    await page.getByRole('button', { name: 'UPI' }).click();
    await page.getByLabel(/^Notes/).fill('  balance next week  ');
    await card(page, 0).getByRole('button', { name: '×2' }).click();
    await expect(amount(page, 0)).toHaveValue('3,000');
    await saveButton(page).click();

    await expect(page).toHaveURL(/\/members\/1$/);
    expect(created(supabase).map((call) => call.body)).toEqual([
      {
        member_id: 1,
        payment_mode: 'UPI',
        notes: 'balance next week', // trimmed
        items: [
          { plan_id: 1, member_id: 1, shared_member_id: null, start_date: dayFromToday(21), quantity: 2, amount_paid: 3000 },
          { plan_id: 3, member_id: 1, shared_member_id: null, start_date: dayFromToday(21), quantity: 1, amount_paid: 500 },
        ],
      },
    ]);
  });

  test('adding and removing an add-on item updates the total; the lone membership item cannot be removed', async ({
    page,
    supabase,
    signedInAs,
  }) => {
    seedMember(supabase);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();

    await planSelect(page).selectOption('1');
    await expect(card(page).getByRole('button', { name: 'Remove membership item' })).toBeDisabled();

    await page.getByRole('button', { name: '+ Add another item' }).click();
    await expect(page.locator('.renew-item-card')).toHaveCount(2);
    await planSelect(page, 1).selectOption('3'); // Yoga · ₹500
    await expect(page.locator('.renew-footer-amount')).toHaveText('₹2,000');

    await card(page, 1).getByRole('button', { name: 'Remove add-on item' }).click();
    await expect(page.locator('.renew-item-card')).toHaveCount(1);
    await expect(page.locator('.renew-footer-amount')).toHaveText('₹1,500');
  });

  test('overlapping the current membership warns but never blocks — "Save anyway" is advisory (client-side only, by design)', async ({
    page,
    supabase,
    signedInAs,
  }) => {
    seedMember(supabase, [currentItemRow({ plan_id: 1, plan_name: 'Monthly', category: 'membership', end_date: dayFromToday(20) })]);
    answerCreateSubscription(supabase);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();
    await expect(card(page).getByText(/Overlaps with current/)).toHaveCount(0);

    await startDate(page).fill(dayFromToday(0));
    await expect(card(page).getByText(/Overlaps with current/)).toBeVisible();
    await expect(saveButton(page)).toBeEnabled();

    await card(page).getByRole('button', { name: 'Save anyway' }).click();
    await expect(card(page).getByText('Overlap acknowledged.')).toBeVisible();
    await saveButton(page).click();

    await expect(page).toHaveURL(/\/members\/1$/);
    expect((created(supabase)[0].body as { items: { start_date: string }[] }).items[0].start_date).toBe(dayFromToday(0));
  });

  test('"Cancel" on an overlap restores the last good start date', async ({ page, supabase, signedInAs }) => {
    seedMember(supabase, [currentItemRow({ end_date: dayFromToday(20) })]);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();

    await startDate(page).fill(dayFromToday(0));
    await card(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(startDate(page)).toHaveValue(dayFromToday(21));
    await expect(card(page).getByText(/Overlaps with current/)).toHaveCount(0);
  });

  test('a dropped connection keeps every item, records no payment, and "Retry save" completes it', async ({ page, supabase, signedInAs }) => {
    seedMember(supabase);
    answerCreateSubscription(supabase);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();
    await planSelect(page).selectOption('1');

    supabase.offline = true;
    await saveButton(page).click();
    await expect(page.getByText(/Checkout couldn't be saved — network error\. No payment was recorded; your items are kept\./)).toBeVisible();
    await expect(planSelect(page)).toHaveValue('1');
    expect(created(supabase)).toHaveLength(0);

    supabase.offline = false;
    await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(page).toHaveURL(/\/members\/1$/);
    expect(created(supabase)).toHaveLength(1);
  });

  test('a server rejection is shown verbatim and keeps the form', async ({ page, supabase, signedInAs }) => {
    seedMember(supabase);
    supabase.functions['create-subscription'] = () => ({ status: 400, json: { error: 'Plan 1 is no longer available' } });
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();
    await planSelect(page).selectOption('1');
    await saveButton(page).click();

    await expect(page.getByText('Plan 1 is no longer available')).toBeVisible();
    await expect(page).toHaveURL(/\/members\/1\/renew$/);
    await expect(planSelect(page)).toHaveValue('1');
  });

  test('leaving a touched checkout asks first; Discard sends nothing, Keep editing stays', async ({ page, supabase, signedInAs }) => {
    seedMember(supabase);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();
    await planSelect(page).selectOption('1');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard this checkout?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('heading', { name: 'Discard this checkout?' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/members\/1\/renew$/);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/members\/1$/);
    expect(created(supabase)).toHaveLength(0);
  });

  test('this is a drill-in: no tab bar on a phone, and the back link returns to the member', async ({ page, supabase, signedInAs }) => {
    seedMember(supabase);
    await signedInAs('staff');
    await page.goto('/members/1/renew');
    await expect(page.getByRole('heading', { name: 'Renew / Add Subscription' })).toBeVisible();

    if (page.viewportSize()!.width < 768) {
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    }
    await page.locator('.app-shell-content').getByRole('link', { name: 'Member', exact: true }).click();
    await expect(page).toHaveURL(/\/members\/1$/);
  });
});
