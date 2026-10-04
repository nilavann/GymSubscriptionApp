import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { dayFromToday, memberListRow } from './fixtures/data';

// What a real browser actually computes from the tokens — jsdom skips CSS, so none of this is
// reachable from the unit tests (which cover the token FILE: contrast, completeness, no stray hex).

const dataTint = (page: Page) => page.evaluate(() => document.documentElement.dataset.tint);
const rootVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.describe('Stone & Amber default', () => {
  test('a fresh device gets the amber tint', async ({ page }) => {
    await page.goto('/login');
    // Polled: ThemeProvider sets data-tint in an effect after mount, which WebKit can reach after 'load'.
    await expect.poll(() => dataTint(page)).toBe('amber');
    expect(await rootVar(page, '--tint-ink')).toBe('#b45309');
    expect(await rootVar(page, '--color-surface-page')).toBe('#fafaf9');
  });

  test('a device that stored the OLD default under the pre-v3 key still lands on amber', async ({ page }) => {
    // Every returning device has this: the provider wrote it on mount. If the key had not been
    // bumped, this would pin them to the old orange look forever.
    await page.addInitScript(() =>
      window.localStorage.setItem('flexhub-theme', JSON.stringify({ tint: 'wild', radius: 'soft' }))
    );
    await page.goto('/login');
    await expect.poll(() => dataTint(page)).toBe('amber');
  });

  test('the UI font is Rubik, with the system stack as fallback', async ({ page }) => {
    await page.goto('/login');
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toContain('Rubik Variable');
  });

  test('the page background carries the 18px dot grid', async ({ page, supabase, signedInAs }) => {
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    const shell = page.locator('.app-shell');
    expect(await shell.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('radial-gradient');
    expect(await shell.evaluate((el) => getComputedStyle(el).backgroundSize)).toBe('18px 18px');
    expect(supabase.unmocked).toEqual([]);
  });
});

test.describe('Settings > Appearance', () => {
  test('choosing another tint applies immediately and survives a reload', async ({ page, supabase, signedInAs }) => {
    await signedInAs('admin');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(await dataTint(page)).toBe('amber');
    expect(supabase.unmocked).toEqual([]);

    await page.getByRole('button', { name: 'Violet' }).click();
    expect(await dataTint(page)).toBe('violet');
    expect(await rootVar(page, '--tint-ink')).toBe('#6d28d9');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(await dataTint(page)).toBe('violet');
    expect(await page.evaluate(() => window.localStorage.getItem('flexhub-theme-v3'))).toBe(
      JSON.stringify({ tint: 'violet', radius: 'soft' })
    );
  });

  test('offers Amber first and marks it as the selected one by default', async ({ page, supabase, signedInAs }) => {
    await signedInAs('admin');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Amber' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Wild' })).toHaveAttribute('aria-pressed', 'false');
    expect(supabase.unmocked).toEqual([]);
  });
});

test.describe('membership pills use the v3 colours', () => {
  const colours = (page: Page, selector: string) =>
    page
      .locator(selector)
      .filter({ visible: true })
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color };
      });

  test('Active is neutral stone, Expiring light amber, Expired red', async ({ page, supabase, signedInAs }) => {
    supabase.tables.member_list_view = [
      memberListRow({ id: 1, name: 'Active Person', current_membership_end_date: dayFromToday(60) }),
      memberListRow({ id: 2, name: 'Expiring Person', current_membership_end_date: dayFromToday(3) }),
      memberListRow({ id: 3, name: 'Expired Person', current_membership_end_date: dayFromToday(-5) }),
    ];
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    expect(await colours(page, '.status-badge-active')).toEqual({ background: 'rgb(245, 245, 244)', color: 'rgb(41, 37, 36)' });
    expect(await colours(page, '.status-badge-expiring')).toEqual({ background: 'rgb(255, 251, 235)', color: 'rgb(146, 64, 14)' });
    expect(await colours(page, '.status-badge-expired')).toEqual({ background: 'rgb(254, 226, 226)', color: 'rgb(185, 28, 28)' });
  });
});
