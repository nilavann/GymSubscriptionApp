import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { ADMIN, STAFF, seedListScreens } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// Manage Users + Invite User. Users live in Supabase Auth, so every operation is an Edge Function; the mock keeps
// a small stateful roster so an action's effect shows up in the list the way it would for real. Self-protection
// (an admin cannot deactivate or delete themselves) is enforced server-side; the UI also disables the buttons.

interface RosterUser {
  id: string;
  full_name: string;
  roles: string[];
  is_active: boolean;
  email: string;
  deleted_at: string | null;
}

const content = (page: Page) => page.locator('.app-shell-content');
const dialog = (page: Page) => page.locator('.users-delete-dialog');
const updates = (supabase: SupabaseMock) => supabase.calls('/functions/v1/update-user').map((call) => call.body);

/** Installs list-users + update-user over a mutable roster and returns it. */
function installRoster(supabase: SupabaseMock): RosterUser[] {
  const roster: RosterUser[] = [
    { id: ADMIN.id, full_name: 'Anita Admin', roles: ['admin'], is_active: true, email: ADMIN.email, deleted_at: null },
    { id: STAFF.id, full_name: 'Priya Sharma', roles: ['staff'], is_active: true, email: STAFF.email, deleted_at: null },
    { id: 'u-third', full_name: 'Ravi Kumar', roles: ['staff'], is_active: false, email: 'ravi@fitandfine.in', deleted_at: null },
  ];
  supabase.functions['list-users'] = (body) => {
    const includeDeleted = (body as { include_deleted?: boolean } | null)?.include_deleted === true;
    return { json: { users: roster.filter((u) => includeDeleted || u.deleted_at === null) } };
  };
  supabase.functions['update-user'] = (body) => {
    const { user_id, ...change } = body as { user_id: string; full_name?: string; roles?: string[]; is_active?: boolean; delete?: boolean; restore?: boolean };
    const user = roster.find((u) => u.id === user_id)!;
    if (change.delete) user.deleted_at = new Date().toISOString();
    else if (change.restore) user.deleted_at = null;
    else Object.assign(user, change);
    return { json: user };
  };
  return roster;
}

test.describe('Manage Users', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedListScreens(supabase);
    installRoster(supabase);
    await signedInAs('admin');
  });

  test('lists everyone with their status; an admin cannot deactivate or delete themselves', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Manage Users' })).toBeVisible();

    for (const name of ['Priya Sharma', 'Ravi Kumar']) await expect(content(page).getByText(name, { exact: true })).toBeVisible();
    await expect(content(page).getByText('Anita Admin')).toBeVisible();
    await expect(content(page).locator('.users-you-tag')).toHaveText('(you)'); // and only on the signed-in admin
    await expect(page.getByRole('button', { name: 'Deactivate Anita Admin' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete Anita Admin' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Deactivate Priya Sharma' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Reactivate Ravi Kumar' })).toBeEnabled(); // already deactivated
  });

  test('editing a name and roles sends only what changed', async ({ page, supabase }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Edit Ravi Kumar' }).click();
    await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();

    await page.getByLabel(/^Name/).fill('Ravi K');
    await page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'admin' }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(content(page).getByText('Ravi K', { exact: true })).toBeVisible();
    expect(updates(supabase)).toEqual([{ user_id: 'u-third', full_name: 'Ravi K', roles: ['staff', 'admin'] }]);
  });

  test('a user must keep at least one role, and a name is required — nothing is sent otherwise', async ({ page, supabase }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Edit Ravi Kumar' }).click();
    await page.getByLabel(/^Name/).fill('');
    await page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'staff' }).click(); // untick the only role
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Select at least one role')).toBeVisible();
    expect(updates(supabase)).toEqual([]);
  });

  test('deactivating asks first, then flips the status; reactivating flips it back', async ({ page, supabase }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Deactivate Priya Sharma' }).click();
    await expect(page.getByRole('heading', { name: 'Deactivate user?' })).toBeVisible();
    expect(updates(supabase)).toEqual([]); // asking changes nothing

    await dialog(page).getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('button', { name: 'Reactivate Priya Sharma' })).toBeVisible();

    await page.getByRole('button', { name: 'Reactivate Priya Sharma' }).click();
    await dialog(page).getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByRole('button', { name: 'Deactivate Priya Sharma' })).toBeVisible();
    expect(updates(supabase)).toEqual([
      { user_id: 'u-staff', is_active: false },
      { user_id: 'u-staff', is_active: true },
    ]);
  });

  test('deleting is a soft delete: the user leaves the list, "Show deleted users" brings them back to restore', async ({ page, supabase }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Delete Priya Sharma' }).click();
    await expect(page.getByRole('heading', { name: 'Delete user?' })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect(content(page).getByText('Priya Sharma', { exact: true })).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Show deleted users' }).check();
    await expect(content(page).getByText('Priya Sharma', { exact: true })).toBeVisible();
    await expect(content(page).getByText('Deleted', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Restore Priya Sharma' }).click();
    await dialog(page).getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('checkbox', { name: 'Show deleted users' }).uncheck();
    await expect(content(page).getByText('Priya Sharma', { exact: true })).toBeVisible();

    expect(updates(supabase)).toEqual([
      { user_id: 'u-staff', delete: true },
      { user_id: 'u-staff', restore: true },
    ]);
    expect(supabase.requests.filter((r) => r.method === 'DELETE')).toEqual([]); // never a hard delete
  });

  test('Cancel on a confirmation changes nothing', async ({ page, supabase }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Delete Priya Sharma' }).click();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Delete user?' })).toHaveCount(0);
    expect(updates(supabase)).toEqual([]);
  });

  test('a dropped connection while confirming says so and keeps the dialog', async ({ page, supabase }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Delete Priya Sharma' }).click();
    supabase.offline = true;
    await dialog(page).getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText("Couldn't delete — check your connection and try again.")).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Delete user?' })).toBeVisible();
  });
});

test.describe('Invite User', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedListScreens(supabase);
    installRoster(supabase);
    await signedInAs('admin');
  });

  const fillAndSend = async (page: Page, email = 'meera@fitandfine.in') => {
    await page.getByLabel(/Email/).fill(email);
    await page.getByLabel(/Name/).fill('Meera Nair');
    await page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'staff' }).click();
    await page.getByRole('button', { name: 'Send Invitation' }).click();
  };

  test('sends the invitation and returns to Manage Users with a confirmation', async ({ page, supabase }) => {
    supabase.functions['invite-user'] = () => ({ json: {} });
    await page.goto('/users/invite');
    await expect(page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'admin' })).toBeVisible(); // roles loaded

    await fillAndSend(page);

    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByText('Invitation sent to meera@fitandfine.in')).toBeVisible();
    expect(supabase.calls('/functions/v1/invite-user').map((call) => call.body)).toEqual([
      { email: 'meera@fitandfine.in', full_name: 'Meera Nair', roles: ['staff'] },
    ]);
  });

  test('refuses an empty or malformed form and sends nothing', async ({ page, supabase }) => {
    supabase.functions['invite-user'] = () => ({ json: {} });
    await page.goto('/users/invite');
    await expect(page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'admin' })).toBeVisible();

    await page.getByRole('button', { name: 'Send Invitation' }).click();
    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Select at least one role')).toBeVisible();

    await page.getByLabel(/Email/).fill('not-an-email');
    await page.getByLabel(/Name/).fill('Meera Nair');
    await page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'staff' }).click();
    await page.getByRole('button', { name: 'Send Invitation' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    expect(supabase.calls('/functions/v1/invite-user')).toHaveLength(0);
  });

  test('says so when the email is already registered, and keeps what was typed', async ({ page, supabase }) => {
    supabase.functions['invite-user'] = () => ({ status: 422, json: { error: 'User already registered' } });
    await page.goto('/users/invite');
    await expect(page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'admin' })).toBeVisible();

    await fillAndSend(page, 'priya@fitandfine.in');

    await expect(page.getByText('This email is already registered.')).toBeVisible();
    await expect(page).toHaveURL(/\/users\/invite$/);
    await expect(page.getByLabel(/Email/)).toHaveValue('priya@fitandfine.in');
  });

  test('says so when offline (not the SDK wording) and lets the admin try again', async ({ page, supabase }) => {
    supabase.functions['invite-user'] = () => ({ json: {} });
    await page.goto('/users/invite');
    await expect(page.getByRole('group', { name: 'Roles' }).getByRole('button', { name: 'admin' })).toBeVisible();

    supabase.offline = true;
    await fillAndSend(page);
    await expect(page.getByText("Couldn't send the invite — check your connection and try again.")).toBeVisible();
    await expect(page.getByText(/Failed to send a request/)).toHaveCount(0);

    supabase.offline = false;
    await page.getByRole('button', { name: 'Send Invitation' }).click();
    await expect(page).toHaveURL(/\/users$/);
  });
});
