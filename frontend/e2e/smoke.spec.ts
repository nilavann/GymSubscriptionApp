import { expect, test } from './fixtures/test';
import { memberListRow } from './fixtures/data';

// Smoke: the production bundle boots, restores a session, loads real data through the real
// supabase-js client and renders it — on every project (desktop + both mobile engines).
test('a signed-in staff member sees the Members list', async ({ page, supabase, signedInAs }) => {
  supabase.tables.member_list_view = [
    memberListRow({ id: 1, name: 'Asha Verma' }),
    memberListRow({ id: 2, name: 'Rohan Mehta' }),
  ];
  await signedInAs('staff');

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  // `visible: true` because the list is currently rendered twice (card list + table) with one
  // hidden by CSS; the render-once phase replaces this with an exact-count assertion.
  await expect(page.getByText('Asha Verma').filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Rohan Mehta').filter({ visible: true })).toBeVisible();
});

test('a signed-out visitor is sent to the login screen', async ({ page }) => {
  // No `supabase` fixture on purpose: signed out, the app must not need the backend to decide this.
  await page.goto('/members/123');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /Welcome to Fit & Fine/ })).toBeVisible();
});
