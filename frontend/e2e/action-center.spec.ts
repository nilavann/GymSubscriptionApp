import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { dayFromToday, memberListRow } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// Action Center: the renewal queue (everything expiring in the next 30 days + everything that lapsed in the last
// 12 months). The window is a real server-side filter, so the request itself is asserted; the carousel is
// scroll-snap on a phone and arrow-driven on desktop.

const isWide = (page: Page) => page.viewportSize()!.width >= 768;
const names = (page: Page) => page.locator('.action-center-card-name');
const badge = (page: Page) => page.locator('.app-shell-nav-badge');
const queueRequests = (supabase: SupabaseMock) =>
  supabase.calls('/rest/v1/member_list_view').filter((call) => call.search.includes('current_membership_end_date=gte.'));

function seedQueue(supabase: SupabaseMock) {
  supabase.tables.member_list_view = [
    memberListRow({ id: 1, name: 'Due Later', member_number: 'M-0001', current_membership_end_date: dayFromToday(20) }),
    memberListRow({ id: 3, name: 'Due Soon', member_number: 'M-0003', phone: '9000000003', current_membership_end_date: dayFromToday(3) }),
    memberListRow({ id: 4, name: 'Recently Lapsed', current_membership_end_date: dayFromToday(-5) }),
    // Outside the window on both sides: must never reach the page.
    memberListRow({ id: 5, name: 'Far Future', current_membership_end_date: dayFromToday(90) }),
    memberListRow({ id: 6, name: 'Long Gone', current_membership_end_date: dayFromToday(-430) }),
  ];
}

test.describe('Action Center', () => {
  test('lists the queue soonest-first, counts both tabs and shows the queue size on the nav badge', async ({ page, supabase, signedInAs }) => {
    seedQueue(supabase);
    await signedInAs('staff');
    await page.goto('/action-center');

    await expect(names(page)).toHaveText(['Due Soon', 'Due Later']);
    const summary = page.locator('.action-center-summary-row');
    await expect(summary.getByText('Expiring in 30 days').locator('xpath=preceding-sibling::*[1]')).toHaveText('2');
    await expect(summary.getByText('Expired', { exact: true }).locator('xpath=preceding-sibling::*[1]')).toHaveText('1');
    await expect(page.getByRole('button', { name: /Expiring soon/ })).toContainText('2');
    await expect(page.getByRole('button', { name: /^Expired/ })).toContainText('1');

    // The badge counts the whole queue (both tabs), not the visible tab.
    await expect(badge(page)).toHaveText('3');
  });

  test('asks the server for exactly the window — never the whole member table', async ({ page, supabase, signedInAs }) => {
    seedQueue(supabase);
    await signedInAs('staff');
    await page.goto('/action-center');
    await expect(names(page)).toHaveCount(2);

    const [call] = queueRequests(supabase);
    expect(call).toBeDefined();
    const bounds = new URLSearchParams(call.search).getAll('current_membership_end_date');
    expect(bounds).toHaveLength(2);
    expect(bounds).toContain(`lte.${dayFromToday(30)}`); // the next 30 days...
    const from = bounds.find((value) => value.startsWith('gte.'))?.slice(4);
    expect(from, 'a lower bound').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // ...back to 12 months ago (a month-aware date, so 365/366 days — never the whole table).
    expect(from! <= dayFromToday(-360)).toBe(true);
    expect(from! > dayFromToday(-400)).toBe(true);
  });

  test('cards carry identity, plan and a relative expiry; the Expired tab flips to most-recently-lapsed', async ({ page, supabase, signedInAs }) => {
    seedQueue(supabase);
    await signedInAs('staff');
    await page.goto('/action-center');

    const soon = page.locator('.action-center-card').filter({ hasText: 'Due Soon' });
    await expect(soon).toContainText('M-0003');
    await expect(soon).toContainText('9000000003');
    await expect(soon.getByText('Expires in 3 days')).toHaveClass(/action-center-pill-urgent/);
    await expect(page.locator('.action-center-card').filter({ hasText: 'Due Later' }).getByText('Expires in 20 days')).toHaveClass(
      /action-center-pill-soon/
    );

    await page.getByRole('button', { name: /^Expired/ }).click();
    await expect(names(page)).toHaveText(['Recently Lapsed']);
    await expect(page.getByText('Expired 5 days ago')).toHaveClass(/action-center-pill-expired/);
  });

  test('switching tabs shows the other list without asking the server again', async ({ page, supabase, signedInAs }) => {
    seedQueue(supabase);
    await signedInAs('staff');
    await page.goto('/action-center');
    await expect(names(page)).toHaveCount(2);
    const before = supabase.requests.length;

    await page.getByRole('button', { name: /^Expired/ }).click();
    await expect(names(page)).toHaveCount(1);
    await page.getByRole('button', { name: /Expiring soon/ }).click();
    await expect(names(page)).toHaveCount(2);

    expect(supabase.requests.length).toBe(before);
  });

  test('Renew and View go to the right member', async ({ page, supabase, signedInAs }) => {
    seedQueue(supabase);
    supabase.tables.members = [{ id: 3, name: 'Due Soon' }];
    await signedInAs('staff');
    await page.goto('/action-center');

    const soon = page.locator('.action-center-card').filter({ hasText: 'Due Soon' });
    await soon.getByRole('button', { name: /Renew/ }).click();
    await expect(page).toHaveURL(/\/members\/3\/renew$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/action-center$/);
    await expect(names(page)).toHaveCount(2);

    await soon.getByRole('button', { name: /View/ }).click();
    await expect(page).toHaveURL(/\/members\/3$/);
  });

  test('says so when nothing is due, per tab', async ({ page, supabase, signedInAs }) => {
    supabase.tables.member_list_view = [memberListRow({ id: 1, current_membership_end_date: dayFromToday(90) })];
    await signedInAs('staff');
    await page.goto('/action-center');

    await expect(page.getByText('Nothing expiring in the next 30 days')).toBeVisible();
    await page.getByRole('button', { name: /^Expired/ }).click();
    await expect(page.getByText('No expired memberships')).toBeVisible();
    await expect(badge(page)).toHaveCount(0); // an empty queue shows no badge
  });

  test('a failed load offers Retry and recovers', async ({ page, supabase, signedInAs }) => {
    // supabase-js retries a failed GET three times (1s + 2s + 4s) before giving up, so the offline screen
    // appears ~7s after the click. That is the SDK's behaviour, and this test waits for it.
    test.setTimeout(60_000);
    seedQueue(supabase);
    await signedInAs('staff');
    // Sign in and land somewhere else first: going offline BEFORE the first load would also fail the profile
    // fetch, and that is the sign-in flow's problem (auth.spec), not this screen's.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    supabase.offline = true;
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /Action Center/ }).click();
    await expect(page.getByText('Check your internet connection and try again.')).toBeVisible({ timeout: 20_000 });

    supabase.offline = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(names(page)).toHaveText(['Due Soon', 'Due Later']);
  });

  test('tapping a member photo enlarges it and Escape closes it', async ({ page, supabase, signedInAs }) => {
    seedQueue(supabase);
    supabase.tables.member_list_view = supabase.tables.member_list_view.map((row) =>
      row.id === 3 ? { ...row, photo_thumbnail_url: 'members/3/thumb.jpg', photo_url: 'members/3/full.jpg' } : row
    );
    await signedInAs('staff');
    await page.goto('/action-center');

    await page.locator('img.action-center-avatar-img').click();
    const lightbox = page.getByRole('dialog', { name: 'Due Soon' });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByRole('img')).toHaveAttribute('src', /members\/3\/full\.jpg/);

    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(/\/action-center$/); // closing must not also activate the card underneath
  });
});

test.describe('Action Center carousel', () => {
  async function seedMany(supabase: SupabaseMock) {
    supabase.tables.member_list_view = Array.from({ length: 10 }, (_, i) =>
      memberListRow({ id: i + 1, name: `Member ${String(i + 1).padStart(2, '0')}`, current_membership_end_date: dayFromToday(i + 1) })
    );
  }

  test('scrolls and snaps card by card; the arrows exist on desktop only', async ({ page, supabase, signedInAs }) => {
    await seedMany(supabase);
    await signedInAs('staff');
    await page.goto('/action-center');
    await expect(names(page)).toHaveCount(10);

    const scroller = page.locator('.action-center-scroller');
    const snap = await scroller.evaluate((el) => getComputedStyle(el).scrollSnapType);
    expect(snap).toMatch(/x\s+mandatory/); // swipe lands on a card, never between two
    expect(await page.locator('.action-center-card').first().evaluate((el) => getComputedStyle(el).scrollSnapAlign)).toMatch(/start/);

    const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows, 'ten cards must overflow the scroller, or this test proves nothing').toBe(true);

    const next = page.getByRole('button', { name: 'Scroll to next card' });
    const previous = page.getByRole('button', { name: 'Scroll to previous card' });

    if (isWide(page)) {
      await expect(next).toBeVisible();
      await next.click();
      await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await previous.click();
      await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);
    } else {
      // On a phone the carousel is swiped, so the arrows are gone (they are decoration there).
      await expect(next).toBeHidden();
      await expect(previous).toBeHidden();
    }
  });

  test('on a phone the page never scrolls sideways because of the carousel', async ({ page, supabase, signedInAs }) => {
    await seedMany(supabase);
    await signedInAs('staff');
    await page.goto('/action-center');
    await expect(names(page)).toHaveCount(10);

    const width = page.viewportSize()!.width;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page is ${overflow}px wider than the ${width}px viewport`).toBeLessThanOrEqual(0);
  });
});
