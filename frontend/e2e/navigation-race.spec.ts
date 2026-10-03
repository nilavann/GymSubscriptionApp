import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { dayFromToday, memberListRow } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// Every page is a lazily-loaded chunk, so on a slow connection there is a window between tapping a link and the
// next screen existing. These specs hold the Renew chunk open (a gate we control, not a timer) to live in that
// window. The router uses startTransition so the current screen stays up until the next one is ready; without it
// the whole app was swapped for the loading view, and Back pressed inside the window left the OLD screen rendered
// under the NEW url — on every engine, reproducibly. See App.tsx.

function seed(supabase: SupabaseMock) {
  supabase.tables.member_list_view = [
    memberListRow({ id: 3, name: 'Due Soon', current_membership_end_date: dayFromToday(3) }),
    memberListRow({ id: 1, name: 'Due Later', current_membership_end_date: dayFromToday(20) }),
  ];
  supabase.tables.members = [{ id: 3, name: 'Due Soon' }];
}

/** Holds every request for the Renew screen's chunk until `release()`. */
async function holdRenewChunk(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let requested!: () => void;
  const sawRequest = new Promise<void>((resolve) => (requested = resolve));
  await page.route(/\/assets\/RenewSubscriptionPage-[^/]*\.js/, async (route: Route) => {
    requested();
    await gate;
    await route.continue();
  });
  return { release, sawRequest };
}

const renewHeading = (page: Page) => page.getByRole('heading', { name: 'Renew / Add Subscription' });
const actionCenterHeading = (page: Page) => page.getByRole('heading', { name: 'Action Center' });
const tapRenew = (page: Page) =>
  page.locator('.action-center-card').filter({ hasText: 'Due Soon' }).getByRole('button', { name: /Renew/ }).click();

test('a slow screen does not blank the app: the current screen stays up until the next one is ready', async ({ page, supabase, signedInAs }) => {
  seed(supabase);
  await signedInAs('staff');
  const chunk = await holdRenewChunk(page);
  await page.goto('/action-center');
  await expect(page.locator('.action-center-card')).toHaveCount(2);

  await tapRenew(page);
  await chunk.sawRequest;

  // Still on screen while the chunk is in flight — not replaced by the full-page loading view.
  await expect(actionCenterHeading(page)).toBeVisible();
  await expect(page.locator('.loading-view')).toHaveCount(0);

  chunk.release();
  await expect(renewHeading(page)).toBeVisible();
  await expect(actionCenterHeading(page)).toHaveCount(0);
});

test('Back pressed while the next screen is still loading returns to the previous screen, not a stale one', async ({
  page,
  supabase,
  signedInAs,
}) => {
  seed(supabase);
  await signedInAs('staff');
  const chunk = await holdRenewChunk(page);
  await page.goto('/action-center');
  await expect(page.locator('.action-center-card')).toHaveCount(2);

  await tapRenew(page);
  await chunk.sawRequest;
  await expect(page).toHaveURL(/\/members\/3\/renew$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/action-center$/);
  await expect(actionCenterHeading(page)).toBeVisible();

  // Now let the abandoned chunk arrive. It must not resurrect the screen the user already left.
  const arrived = page.waitForResponse(/\/assets\/RenewSubscriptionPage-[^/]*\.js/);
  chunk.release();
  await arrived;
  await page.waitForTimeout(500); // proving absence: give a stale render every chance to appear
  await expect(page).toHaveURL(/\/action-center$/);
  await expect(actionCenterHeading(page)).toBeVisible();
  await expect(renewHeading(page)).toHaveCount(0);
  await expect(page.locator('.action-center-card')).toHaveCount(2);
});

test('after the race, the app still navigates normally', async ({ page, supabase, signedInAs }) => {
  seed(supabase);
  await signedInAs('staff');
  const chunk = await holdRenewChunk(page);
  await page.goto('/action-center');
  await expect(page.locator('.action-center-card')).toHaveCount(2);

  await tapRenew(page);
  await chunk.sawRequest;
  await page.goBack();
  chunk.release();
  await expect(actionCenterHeading(page)).toBeVisible();

  await tapRenew(page);
  await expect(renewHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/members\/3\/renew$/);
});
