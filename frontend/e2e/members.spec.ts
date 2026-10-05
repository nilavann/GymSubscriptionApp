import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { currentItemRow, dayFromToday, memberListRow, memberRow } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// The member flows end to end, in a real browser, on every project (desktop Chrome, Pixel 7, iPhone 13):
// find a member, open them, add one, edit one, delete one. Each write asserts the request the client sent —
// that payload is the contract with the database (the mock only fakes the answers, never the questions).

const rows = (page: Page) => page.locator('.members-card, .members-table-row');
const content = (page: Page) => page.locator('.app-shell-content');

function seedMembers(supabase: SupabaseMock) {
  supabase.tables.member_list_view = [
    memberListRow({ id: 1, name: 'Asha Verma', gender: 'Female', date_of_joining: '2026-03-01', current_membership_end_date: dayFromToday(60) }),
    memberListRow({ id: 2, name: 'Bharat Rao', gender: 'Male', date_of_joining: '2026-02-01', current_membership_end_date: dayFromToday(5) }),
    memberListRow({ id: 3, name: 'Chitra Iyer', gender: 'Female', date_of_joining: '2026-01-01', current_membership_end_date: dayFromToday(-5) }),
    memberListRow({
      id: 4,
      name: 'Dev Patel',
      gender: 'Male',
      date_of_joining: '2025-12-01',
      current_membership_plan_id: null,
      current_membership_plan_name: null,
      current_membership_end_date: null,
    }),
  ];
  supabase.tables.members = [
    memberRow({ id: 1, name: 'Asha Verma' }),
    memberRow({ id: 2, name: 'Bharat Rao', gender: 'Male' }),
    memberRow({ id: 3, name: 'Chitra Iyer' }),
    memberRow({ id: 4, name: 'Dev Patel', gender: 'Male' }),
  ];
}

test.describe('Members list', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedMembers(supabase);
    await signedInAs('staff');
  });

  test('search narrows the list, says so when nothing matches, and clears', async ({ page }) => {
    await page.goto('/');
    await expect(rows(page)).toHaveCount(4);

    const search = page.getByRole('searchbox', { name: 'Search members' });
    await search.fill('bharat');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Bharat Rao');

    await search.fill('zzz');
    await expect(page.getByText('No results for "zzz"')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(rows(page)).toHaveCount(4);
    await expect(search).toHaveValue('');
  });

  test('the status pills count and filter by membership state', async ({ page }) => {
    await page.goto('/');
    const group = page.getByRole('group', { name: 'Status filter' });
    await expect(rows(page)).toHaveCount(4);

    await expect(group.getByRole('button', { name: /^All/ })).toContainText('4');
    await expect(group.getByRole('button', { name: /^Active/ })).toContainText('1');
    await expect(group.getByRole('button', { name: /^Expiring/ })).toContainText('1');
    await expect(group.getByRole('button', { name: /^Expired/ })).toContainText('2'); // expired + never subscribed

    await group.getByRole('button', { name: /^Expiring/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Bharat Rao');

    await group.getByRole('button', { name: /^Expired/ }).click();
    await expect(rows(page)).toHaveCount(2);
  });

  test('the Filters drawer narrows by gender and can be cleared', async ({ page }) => {
    await page.goto('/');
    await expect(rows(page)).toHaveCount(4);

    await page.getByRole('button', { name: /Filters/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Filters' });
    await drawer.getByRole('checkbox', { name: 'Male', exact: true }).check();
    await drawer.getByRole('button', { name: 'Apply filters' }).click();

    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('2 members · 1 filter active')).toBeVisible();

    await page.getByRole('button', { name: /Filters/ }).click();
    await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Clear all' }).click();
    await expect(rows(page)).toHaveCount(4);
  });

  test('opening a member shows their page; the back link returns to the list', async ({ page }) => {
    await page.goto('/');
    await rows(page).filter({ hasText: 'Bharat Rao' }).first().click();

    await expect(page).toHaveURL(/\/members\/2$/);
    await expect(page.locator('.member-detail-name')).toHaveText('Bharat Rao');

    // A drill-in screen: on a phone the tab bar is gone and the back link is the way out.
    if (page.viewportSize()!.width < 768) {
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    }
    await content(page).getByRole('link', { name: 'Members', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(rows(page)).toHaveCount(4);
  });
});

test.describe('Add member', () => {
  test('creates the member with exactly the fields the client owns, then opens their page', async ({ page, supabase, signedInAs }) => {
    supabase.tables.members = [];
    await signedInAs('staff');
    await page.goto('/members/new');
    await expect(page.getByRole('heading', { name: 'Add Member' })).toBeVisible();

    await page.locator('#name').fill('Neha Joshi');
    await page.locator('#phone').fill('9876543210');
    await page.locator('#date_of_birth').fill('1996-03-14');
    await page.locator('#branch_id').selectOption('1');
    await page.getByRole('group', { name: /Gender/ }).getByRole('button', { name: 'Female' }).click();
    await page.locator('#weight_kg').fill('58.5');
    await page.locator('#height_cm').fill('162');
    await page.locator('#emergency_contact_name').fill('Meera Joshi');
    await page.locator('#emergency_contact_phone').fill('9123456780');
    await page.locator('#emergency_contact_relationship').fill('Mother');
    await page.getByRole('button', { name: 'Create member' }).click();

    await expect(page).toHaveURL(/\/members\/1$/);
    await expect(page.locator('.member-detail-name')).toHaveText('Neha Joshi');

    const [create] = supabase.calls('/rest/v1/members').filter((call) => call.method === 'POST');
    expect(create.body).toMatchObject({
      name: 'Neha Joshi',
      phone: '9876543210',
      date_of_birth: '1996-03-14',
      gender: 'Female',
      weight_kg: 58.5,
      height_cm: 162,
      branch_id: 1,
      emergency_contact_name: 'Meera Joshi',
    });
    // Server-owned: the number comes from a trigger, the audit author from auth.uid() (CLAUDE.md "Server-side authority").
    expect(create.body).not.toHaveProperty('member_number');
    expect(create.body).not.toHaveProperty('created_by');
  });

  test('refuses an incomplete form and sends nothing', async ({ page, supabase, signedInAs }) => {
    await signedInAs('staff');
    await page.goto('/members/new');
    await expect(page.getByRole('heading', { name: 'Add Member' })).toBeVisible();

    await page.getByRole('button', { name: 'Create member' }).click();

    await expect(page.getByText('Name is required', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/members\/new$/);
    expect(supabase.calls('/rest/v1/members').filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  test('says so when the phone number already belongs to another member, and keeps what was typed', async ({
    page,
    supabase,
    signedInAs,
  }) => {
    await signedInAs('staff');
    // A unique-violation, exactly as PostgREST reports it.
    await page.route(/\/rest\/v1\/members(\?|$)/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 409,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "members_phone_key"', details: null, hint: null }),
      });
    });
    await page.goto('/members/new');
    await expect(page.getByRole('heading', { name: 'Add Member' })).toBeVisible();

    await page.locator('#name').fill('Neha Joshi');
    await page.locator('#phone').fill('9876543210');
    await page.locator('#date_of_birth').fill('1996-03-14');
    await page.locator('#branch_id').selectOption('1');
    await page.getByRole('group', { name: /Gender/ }).getByRole('button', { name: 'Female' }).click();
    await page.locator('#weight_kg').fill('58.5');
    await page.locator('#height_cm').fill('162');
    await page.locator('#emergency_contact_name').fill('Meera Joshi');
    await page.locator('#emergency_contact_phone').fill('9123456780');
    await page.locator('#emergency_contact_relationship').fill('Mother');
    await page.getByRole('button', { name: 'Create member' }).click();

    await expect(page.getByText('This phone number is already used by another member.')).toBeVisible();
    await expect(page.locator('#name')).toHaveValue('Neha Joshi');
    await expect(page.getByRole('button', { name: 'Create member' })).toBeEnabled();
    expect(supabase.unmocked).toEqual([]);
  });
});

test.describe('Member detail', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedMembers(supabase);
    await signedInAs('admin');
  });

  test('editing sends only the editable fields and shows the new name', async ({ page, supabase }) => {
    await page.goto('/members/2');
    await expect(page.locator('.member-detail-name')).toHaveText('Bharat Rao');

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('#detail-name').fill('Bharat R. Rao');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.member-detail-name')).toHaveText('Bharat R. Rao');
    await expect(page.locator('#detail-name')).toHaveCount(0); // back to the read view

    const [update] = supabase.calls('/rest/v1/members').filter((call) => call.method === 'PATCH');
    expect(update.search).toContain('id=eq.2');
    expect(update.body).toMatchObject({ name: 'Bharat R. Rao', phone: '9876543210' });
    // The branch a member belongs to — and their number — never change through this form.
    expect(update.body).not.toHaveProperty('branch_id');
    expect(update.body).not.toHaveProperty('member_number');
  });

  test('the hero keeps the identity readable beside the avatar, and the sections follow the handoff order on a phone', async ({ page, supabase }) => {
    supabase.tables.member_current_items = [currentItemRow({ member_id: 2, plan_name: 'Monthly', end_date: dayFromToday(40) })];
    await page.goto('/members/2');
    await expect(page.locator('.member-detail-name')).toHaveText('Bharat Rao');
    await expect(page.locator('.member-detail-membership-strip')).toBeVisible();

    const top = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y;
    const personal = await top(page.locator('legend', { hasText: 'Personal' }));
    const medical = await top(page.locator('legend', { hasText: 'Medical' }));
    const emergency = await top(page.locator('legend', { hasText: 'Emergency contact' }));
    const addOns = await top(page.getByRole('heading', { name: 'Add-ons' }));
    const history = await top(page.getByRole('heading', { name: 'Subscription History' }));

    if (page.viewportSize()!.width < 760) {
      // Regression: the actions row used to take half the card, squeezing the name to one word per line and
      // letting Edit / Delete sit on top of the member number.
      const info = (await page.locator('.member-detail-hero-info').boundingBox())!;
      const actions = (await page.locator('.member-detail-hero-actions').boundingBox())!;
      expect(info.width, 'identity column is squeezed').toBeGreaterThan(200);
      expect(actions.y, 'Edit / Delete overlap the identity text').toBeGreaterThanOrEqual(info.y + info.height);
      expect(actions.height, 'Edit / Delete are below the 44px touch minimum').toBeGreaterThanOrEqual(44);

      const strip = (await page.locator('.member-detail-membership-strip').boundingBox())!;
      const renew = (await page.locator('.member-detail-membership-strip .member-detail-renew-button').boundingBox())!;
      expect(renew.width, 'Renew is not full width in the strip').toBeGreaterThan(strip.width - 40);
      expect(renew.height).toBeGreaterThanOrEqual(44);

      expect([personal, medical, emergency, addOns, history], 'phone order: Personal, Medical, Emergency, Add-ons, History').toEqual(
        [personal, medical, emergency, addOns, history].sort((a, b) => a - b)
      );
    } else {
      // Desktop is unchanged: the add-on and history cards come first, then the two-column profile grid.
      expect(addOns).toBeLessThan(history);
      expect(history).toBeLessThan(medical);
    }
  });

  test('/members/:id/edit opens straight into the form', async ({ page }) => {
    await page.goto('/members/2/edit');
    await expect(page.locator('#detail-name')).toHaveValue('Bharat Rao');
  });

  test('deleting asks first, calls the delete-member function, and returns to the list without them', async ({ page, supabase }) => {
    supabase.functions['delete-member'] = (body) => {
      const id = (body as { member_id: number }).member_id;
      supabase.tables.member_list_view = supabase.tables.member_list_view.filter((row) => row.id !== id);
      return { json: {} };
    };
    await page.goto('/members/2');
    await expect(page.locator('.member-detail-name')).toHaveText('Bharat Rao');

    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.locator('.member-detail-delete-dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete member?' })).toBeVisible();
    await expect(dialog).toContainText('"Bharat Rao" will be removed');
    expect(supabase.calls('/functions/v1/delete-member')).toHaveLength(0); // asking must not delete

    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).filter({ hasText: 'Bharat Rao' })).toHaveCount(0);
    expect(supabase.calls('/functions/v1/delete-member').map((call) => call.body)).toEqual([{ member_id: 2 }]);
    // Soft delete only, and only through the Edge Function — never a direct DELETE (CLAUDE.md).
    expect(supabase.requests.filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  test('deleting while offline says so (not the SDK’s wording) and keeps the dialog open', async ({ page, supabase }) => {
    supabase.functions['delete-member'] = () => ({ json: {} });
    await page.goto('/members/2');
    await expect(page.locator('.member-detail-name')).toHaveText('Bharat Rao');

    await page.getByRole('button', { name: 'Delete' }).click();
    supabase.offline = true;
    await page.locator('.member-detail-delete-dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText("Couldn't delete this member — check your connection and try again.")).toBeVisible();
    await expect(page.getByText(/Failed to send a request/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Delete member?' })).toBeVisible();
  });

  test('keeps the dialog open and shows the server’s reason when the delete is refused', async ({ page, supabase }) => {
    supabase.functions['delete-member'] = () => ({ status: 409, json: { error: 'Cannot delete — used by 4 subscription record(s)' } });
    await page.goto('/members/2');
    await expect(page.locator('.member-detail-name')).toHaveText('Bharat Rao');

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.locator('.member-detail-delete-dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Cannot delete — used by 4 subscription record(s)')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Delete member?' })).toBeVisible();
    await expect(page).toHaveURL(/\/members\/2$/);
  });
});
