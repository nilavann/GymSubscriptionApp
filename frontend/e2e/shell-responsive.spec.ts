import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { currentItemRow, dayFromToday, memberListRow, memberRow, seedListScreens } from './fixtures/data';

// The app shell in a real browser: exactly one navigation structure per width, correct hit areas,
// a tab bar that really sits at the bottom, and no sideways scrolling. (The component-level
// render-once assertions live in src/components/AppShell.test.tsx; this proves it with real CSS.)

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box (not rendered / not visible)');
  return b;
}

test.describe('one navigation structure per width', () => {
  // Resizing a desktop window is the cleanest way to hit every boundary width exactly; the real
  // device projects below cover touch behaviour.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'width sweep runs once, on desktop-chrome');
  });

  const cases = [
    { width: 390, mobile: true },
    { width: 767, mobile: true },
    { width: 768, mobile: false },
    { width: 1023, mobile: false },
    { width: 1024, mobile: false },
  ];

  for (const { width, mobile } of cases) {
    test(`${width}px renders the ${mobile ? 'header + tab bar' : 'sidebar + footer'} and nothing of the other`, async ({
      page,
      supabase,
      signedInAs,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await signedInAs('admin');
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

      // Exactly one "Main navigation" landmark in the DOM — not two with one hidden.
      await expect(mainNav(page)).toHaveCount(1);

      await expect(page.getByRole('banner')).toHaveCount(mobile ? 1 : 0);
      await expect(page.getByRole('contentinfo')).toHaveCount(mobile ? 0 : 1);
      await expect(page.locator('.app-shell-tabbar')).toHaveCount(mobile ? 1 : 0);
      await expect(page.locator('.app-shell-sidebar')).toHaveCount(mobile ? 0 : 1);
      expect(supabase.unmocked).toEqual([]);
    });
  }

  test('resizing across 768px swaps the structures live without reloading', async ({ page, signedInAs }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.locator('.app-shell-sidebar')).toHaveCount(1);

    await page.setViewportSize({ width: 600, height: 800 });
    await expect(page.locator('.app-shell-tabbar')).toHaveCount(1);
    await expect(page.locator('.app-shell-sidebar')).toHaveCount(0);

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.locator('.app-shell-sidebar')).toHaveCount(1);
    await expect(page.locator('.app-shell-tabbar')).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone behaviour');

  test('the tab bar is pinned to the bottom of the screen and has an active tab', async ({ page, signedInAs }) => {
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    const bar = await box(page.locator('.app-shell-tabbar'));
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(Math.round(bar.y + bar.height)).toBe(viewport!.height);
    expect(Math.round(bar.width)).toBe(viewport!.width);

    await expect(page.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
  });

  test('every tab and the avatar are at least 44x44 (touch targets)', async ({ page, signedInAs }) => {
    await signedInAs('admin');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    for (const link of await mainNav(page).getByRole('link').all()) {
      const b = await box(link);
      expect(b.height, `tab "${await link.innerText()}" height`).toBeGreaterThanOrEqual(44);
      expect(b.width, `tab "${await link.innerText()}" width`).toBeGreaterThanOrEqual(44);
    }
    const avatar = await box(page.getByRole('button', { name: 'Account menu' }));
    expect(avatar.width).toBeGreaterThanOrEqual(44);
    expect(avatar.height).toBeGreaterThanOrEqual(44);
  });

  test('the header is 58px and stays at the top while the page scrolls', async ({ page, supabase, signedInAs }) => {
    supabase.tables.member_list_view = Array.from({ length: 40 }, (_, i) => memberListRow({ id: i + 1, name: `Row ${i + 1}` }));
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    const header = page.getByRole('banner');
    expect((await box(header)).height).toBeCloseTo(58, 0);

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(async () => Math.round((await box(header)).y)).toBe(0);
  });

  test('the last item can be scrolled clear of the tab bar (not hidden behind it)', async ({ page, supabase, signedInAs }) => {
    supabase.tables.member_list_view = Array.from({ length: 30 }, (_, i) => memberListRow({ id: i + 1, name: `Row ${i + 1}` }));
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const bar = await box(page.locator('.app-shell-tabbar'));
    const lastCard = await box(page.locator('.members-card').last());
    expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(bar.y + 1);
  });

  test('the tab bar is absent on drill-in screens, where the header remains', async ({ page, signedInAs }) => {
    await signedInAs('staff');
    await page.goto('/members/new');
    await expect(page.getByRole('heading', { name: 'Add Member' })).toBeVisible();

    await expect(page.locator('.app-shell-tabbar')).toHaveCount(0);
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('staff sign out from the header avatar menu', async ({ page, signedInAs, supabase }) => {
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('group', { name: 'Account' })).toContainText('Priya Sharma');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    expect(supabase.calls('/auth/v1/logout')).toHaveLength(1);
  });

  test('the account menu closes on an outside tap and on Escape', async ({ page, signedInAs }) => {
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    const menu = page.getByRole('group', { name: 'Account' });
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(menu).toBeVisible();
    await page.getByRole('heading', { name: 'Members' }).click();
    await expect(menu).toHaveCount(0);

    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('Settings stays highlighted on an admin sub-screen', async ({ page, signedInAs }) => {
    await signedInAs('admin');
    await page.goto('/plans');
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop behaviour');

  test('staff sign out from the sidebar', async ({ page, signedInAs, supabase }) => {
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(supabase.calls('/auth/v1/logout')).toHaveLength(1);
  });

  test('the sidebar marks the current section, and the mobile header is absent', async ({ page, signedInAs }) => {
    await signedInAs('staff');
    await page.goto('/reports');
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
  });
});

test.describe('no sideways scrolling', () => {
  // Every screen, including the ones that need a loaded member: a long name, long staff/branch names and a
  // current subscription are seeded on purpose, since overflow comes from content that does not wrap.
  const routes = [
    '/',
    '/action-center',
    '/reports',
    '/members/new',
    '/members/1',
    '/members/1/renew',
    '/members/1/edit',
    '/settings',
    '/plans',
    '/branches',
    '/roles',
    '/users',
    '/users/invite',
    '/audit-log',
    '/member-numbering',
  ];

  for (const route of routes) {
    test(`${route} does not overflow horizontally`, async ({ page, supabase, signedInAs }) => {
      seedListScreens(supabase);
      const longName = 'Aishwarya Lakshmi Narayanan Venkataraghavan Subramaniam';
      supabase.tables.member_list_view = Array.from({ length: 6 }, (_, i) =>
        memberListRow({ id: i + 1, name: i === 0 ? longName : `A rather long member name number ${i + 1} to stress wrapping` })
      );
      supabase.tables.members = [memberRow({ id: 1, name: longName, email: 'aishwarya.lakshmi.narayanan@a-very-long-domain-name.example.com' })];
      supabase.tables.member_current_items = [
        currentItemRow({ subscription_item_id: 1, plan_id: 1, plan_name: 'Monthly', category: 'membership', end_date: dayFromToday(5) }),
        currentItemRow({ subscription_item_id: 2, plan_id: 3, plan_name: 'Yoga', category: 'addon', end_date: dayFromToday(5) }),
      ];
      await signedInAs('admin');
      await page.goto(route);
      await expect(page.locator('.app-shell-content h1, .app-shell-content .member-detail-name').first()).toBeVisible();
      // Let the screen finish loading its data: an empty skeleton is narrower than the real thing.
      await expect(page.locator('[aria-label="Loading"]')).toHaveCount(0);

      // Compare against the DEVICE's configured viewport, not window.innerWidth: Chrome on Android silently
      // widens the layout viewport to fit overflowing content (innerWidth then equals the overflowing
      // width and a naive check passes), while WebKit keeps it fixed. Only the device width is honest.
      const deviceWidth = page.viewportSize()!.width;
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `${route}: page is wider than the ${deviceWidth}px screen`).toBeLessThanOrEqual(deviceWidth + 1);
    });
  }
});
