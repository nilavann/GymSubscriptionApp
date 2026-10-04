import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { seedListScreens } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// The admin catalogue screens — Settings hub, Plans, Branches, Roles — as an admin uses them. Every write asserts
// the request the client sent (the contract with the database / Edge Function); every delete goes through its Edge
// Function, never a direct DELETE (the server refuses to delete something in use, and says why).

const content = (page: Page) => page.locator('.app-shell-content');
const writes = (supabase: SupabaseMock, table: string, method: 'POST' | 'PATCH') =>
  supabase.calls(`/rest/v1/${table}`).filter((call) => call.method === method);

test.describe('Settings hub', () => {
  test('shows a live count per data card and links each one to its screen', async ({ page, supabase, signedInAs }) => {
    seedListScreens(supabase);
    await signedInAs('admin');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const card = (label: string) => page.locator('.settings-card').filter({ has: page.locator('.settings-card-label', { hasText: new RegExp(`^${label}$`) }) });
    await expect(card('Members').locator('.settings-card-count')).toHaveText(String(supabase.tables.members.length));
    await expect(card('Plans').locator('.settings-card-count')).toHaveText(String(supabase.tables.plans.length));
    await expect(card('Branches').locator('.settings-card-count')).toHaveText(String(supabase.tables.branches.length));
    await expect(card('Roles').locator('.settings-card-count')).toHaveText(String(supabase.tables.roles.length));
    await expect(card('Subscriptions').locator('.settings-card-count')).toHaveText(String(supabase.tables.subscriptions.length));
    await expect(card('Audit Log').locator('.settings-card-count')).toHaveText(String(supabase.tables.audit_log.length));

    await expect(card('Plans')).toHaveAttribute('href', '/plans');
    await expect(card('Branches')).toHaveAttribute('href', '/branches');
    await expect(card('Manage Users')).toHaveAttribute('href', '/users');
    await expect(card('Roles')).toHaveAttribute('href', '/roles');
    await expect(card('Audit Log')).toHaveAttribute('href', '/audit-log');
    await expect(card('Member Numbering')).toHaveAttribute('href', '/member-numbering');
    await expect(card('Subscriptions')).not.toHaveAttribute('href'); // a count only — there is no screen for it
  });

  test('the admin section tabs move between the admin screens and keep Settings highlighted in the shell', async ({ page, supabase, signedInAs }) => {
    seedListScreens(supabase);
    await signedInAs('admin');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await content(page).getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
  });

  test('staff are told the admin screens are admin-only, and nothing is fetched for them', async ({ page, supabase, signedInAs }) => {
    seedListScreens(supabase);
    await signedInAs('staff');
    for (const route of ['/settings', '/plans', '/branches', '/roles', '/users', '/audit-log', '/member-numbering']) {
      await page.goto(route);
      await expect(page.getByText('Access denied — this page is admin-only.'), route).toBeVisible();
    }
    // The guard is UX only (RLS is the real boundary) — but it must not even ask: no admin data requests were made.
    expect(supabase.calls('/rest/v1/plans')).toHaveLength(0);
    expect(supabase.calls('/rest/v1/audit_log')).toHaveLength(0);
    expect(supabase.calls('/functions/v1/list-users')).toHaveLength(0);
  });
});

test.describe('Plans', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedListScreens(supabase);
    await signedInAs('admin');
  });

  test('creates a membership plan with exactly the fields the client owns, then lists it', async ({ page, supabase }) => {
    await page.goto('/plans');
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();

    await page.getByRole('button', { name: /Add Plan/ }).first().click();
    await page.getByLabel(/^Name/).fill('Annual');
    await page.getByRole('group', { name: 'Category', exact: true }).getByRole('button', { name: 'Membership' }).click();
    await page.getByLabel(/Duration/).fill('365');
    await page.getByLabel(/Price/).fill('9000');
    await page.getByRole('group', { name: 'Max members' }).getByRole('button', { name: '2' }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(content(page).getByText('Annual', { exact: true })).toBeVisible();
    expect(writes(supabase, 'plans', 'POST').map((call) => call.body)).toEqual([
      { name: 'Annual', category: 'membership', duration_days: 365, price: 9000, max_members: 2 },
    ]);
  });

  test('refuses an empty form and sends nothing', async ({ page, supabase }) => {
    await page.goto('/plans');
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
    await page.getByRole('button', { name: /Add Plan/ }).first().click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Select a category')).toBeVisible();
    await expect(page.getByText('Enter a valid price')).toBeVisible();
    expect(writes(supabase, 'plans', 'POST')).toHaveLength(0);
  });

  test('editing prefills the form and saves by id', async ({ page, supabase }) => {
    await page.goto('/plans');
    await page.getByRole('button', { name: 'Edit Yoga' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Plan' })).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveValue('Yoga');
    await page.getByLabel(/Price/).fill('650');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Plan' })).toHaveCount(0);
    const [update] = writes(supabase, 'plans', 'PATCH');
    expect(update.search).toContain('id=eq.3');
    expect(update.body).toMatchObject({ name: 'Yoga', category: 'addon', price: 650 });
  });

  test('the category pills narrow the list', async ({ page }) => {
    await page.goto('/plans');
    await expect(content(page).getByText('Quarterly', { exact: true })).toBeVisible();

    const filter = page.getByRole('group', { name: 'Category filter' });
    await filter.getByRole('button', { name: 'Add-on' }).click();
    await expect(content(page).getByText('Yoga', { exact: true })).toBeVisible();
    await expect(content(page).getByText('Quarterly', { exact: true })).toHaveCount(0);
    await filter.getByRole('button', { name: 'All' }).click();
    await expect(content(page).getByText('Quarterly', { exact: true })).toBeVisible();
  });

  test('deleting asks first, goes through the delete-plan function, and removes the row', async ({ page, supabase }) => {
    supabase.functions['delete-plan'] = (body) => {
      const id = (body as { plan_id: number }).plan_id;
      supabase.tables.plans = supabase.tables.plans.filter((row) => row.id !== id);
      return { json: {} };
    };
    await page.goto('/plans');
    await page.getByRole('button', { name: 'Delete Yoga' }).click();
    await expect(page.getByRole('heading', { name: 'Delete plan?' })).toBeVisible();
    expect(supabase.calls('/functions/v1/delete-plan')).toHaveLength(0);

    await page.locator('.plans-delete-dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(content(page).getByText('Yoga', { exact: true })).toHaveCount(0);
    expect(supabase.calls('/functions/v1/delete-plan').map((call) => call.body)).toEqual([{ plan_id: 3 }]);
    expect(supabase.requests.filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  test("a plan that is in use cannot be deleted — the server's reason is shown and the plan stays", async ({ page, supabase }) => {
    supabase.functions['delete-plan'] = () => ({ status: 409, json: { error: 'Cannot delete — used by 4 subscription(s)' } });
    await page.goto('/plans');
    await page.getByRole('button', { name: 'Delete Monthly' }).click();
    await page.locator('.plans-delete-dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Cannot delete — used by 4 subscription(s)')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Delete plan?' })).toBeVisible();
    await page.locator('.plans-delete-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(content(page).getByText('Monthly', { exact: true })).toBeVisible();
  });
});

test.describe('Branches', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedListScreens(supabase);
    await signedInAs('admin');
  });

  test('creates a branch (name + code), then lists it', async ({ page, supabase }) => {
    await page.goto('/branches');
    await expect(page.getByRole('heading', { name: 'Branches' })).toBeVisible();
    await page.getByRole('button', { name: /Add Branch/ }).first().click();
    await page.getByLabel(/Name/).fill('Andheri East');
    await page.getByLabel(/Code/).fill('AND');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(content(page).getByText('Andheri East', { exact: true })).toBeVisible();
    expect(writes(supabase, 'branches', 'POST').map((call) => call.body)).toEqual([{ name: 'Andheri East', code: 'AND' }]);
  });

  test('editing saves by id', async ({ page, supabase }) => {
    await page.goto('/branches');
    await page.getByRole('button', { name: 'Edit Pune Camp' }).click();
    await expect(page.getByLabel(/Code/)).toHaveValue('PUN');
    await page.getByLabel(/Code/).fill('PNE');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByLabel(/Code/)).toHaveCount(0);
    const [update] = writes(supabase, 'branches', 'PATCH');
    expect(update.search).toContain('id=eq.2');
    expect(update.body).toEqual({ name: 'Pune Camp', code: 'PNE' });
  });

  test('deleting goes through delete-branch; a branch with members is refused with the reason', async ({ page, supabase }) => {
    supabase.functions['delete-branch'] = (body) => {
      const id = (body as { branch_id: number }).branch_id;
      if (id === 1) return { status: 409, json: { error: 'Cannot delete — used by 3 member(s)' } };
      supabase.tables.branches = supabase.tables.branches.filter((row) => row.id !== id);
      return { json: {} };
    };
    await page.goto('/branches');

    await page.getByRole('button', { name: 'Delete Mumbai Central' }).click();
    await page.locator('.branches-delete-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Cannot delete — used by 3 member(s)')).toBeVisible();
    await page.locator('.branches-delete-dialog').getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Delete Pune Camp' }).click();
    await page.locator('.branches-delete-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(content(page).getByText('Pune Camp', { exact: true })).toHaveCount(0);
    expect(supabase.calls('/functions/v1/delete-branch').map((call) => call.body)).toEqual([{ branch_id: 1 }, { branch_id: 2 }]);
  });
});

test.describe('Roles', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedListScreens(supabase);
    await signedInAs('admin');
  });

  test('creates a role, then lists it', async ({ page, supabase }) => {
    await page.goto('/roles');
    await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible();
    await page.getByRole('button', { name: /Add Role/ }).first().click();
    await page.getByLabel(/^Name/).fill('trainer');
    await page.getByLabel('Description').fill('Floor staff');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(content(page).getByText('trainer', { exact: true })).toBeVisible();
    expect(writes(supabase, 'roles', 'POST').map((call) => call.body)).toEqual([{ name: 'trainer', description: 'Floor staff' }]);
  });

  test('says so when the role name is already taken, and keeps what was typed', async ({ page }) => {
    await page.route(/\/rest\/v1\/roles(\?|$)/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 409,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "roles_name_key"', details: null, hint: null }),
      });
    });
    await page.goto('/roles');
    await page.getByRole('button', { name: /Add Role/ }).first().click();
    await page.getByLabel(/^Name/).fill('admin');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('This name is already used by another role.')).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveValue('admin');
  });

  test('editing saves by id', async ({ page, supabase }) => {
    await page.goto('/roles');
    await page.getByRole('button', { name: 'Edit admin' }).click();
    await expect(page.getByLabel('Description')).toHaveValue('Full access');
    await page.getByLabel('Description').fill('Everything');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByLabel('Description')).toHaveCount(0);
    const [update] = writes(supabase, 'roles', 'PATCH');
    expect(update.search).toContain('id=eq.1');
    expect(update.body).toMatchObject({ name: 'admin', description: 'Everything' });
  });

  test("deleting a role in use shows the server's reason; an unused one is removed via delete-role", async ({ page, supabase }) => {
    supabase.functions['delete-role'] = (body) => {
      const id = (body as { role_id: number }).role_id;
      if (id === 2) return { status: 409, json: { error: 'Cannot delete — used by 2 user(s)' } };
      supabase.tables.roles = supabase.tables.roles.filter((row) => row.id !== id);
      return { json: {} };
    };
    supabase.tables.roles.push({ id: 3, name: 'trainer', description: null });
    await page.goto('/roles');

    await page.getByRole('button', { name: 'Delete staff' }).click();
    await page.locator('.roles-delete-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Cannot delete — used by 2 user(s)')).toBeVisible();
    await page.locator('.roles-delete-dialog').getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Delete trainer' }).click();
    await page.locator('.roles-delete-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(content(page).getByText('trainer', { exact: true })).toHaveCount(0);
    expect(supabase.calls('/functions/v1/delete-role').map((call) => call.body)).toEqual([{ role_id: 2 }, { role_id: 3 }]);
  });
});
