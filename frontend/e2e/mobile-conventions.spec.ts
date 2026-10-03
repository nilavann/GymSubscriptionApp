import { expect, test } from './fixtures/test';

// Computed-style behaviour jsdom can't verify (it skips CSS): these are real browser assertions.
// CLAUDE.md "Mobile conventions".

test('the viewport meta opts into the full screen so safe-area insets work', async ({ page }) => {
  await page.goto('/login');
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).toContain('viewport-fit=cover');
});

test.describe('form controls and iOS focus-zoom', () => {
  const fontSizeOf = (page: import('@playwright/test').Page, label: string) =>
    page.getByLabel(label, { exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  test('text inputs are at least 16px on a phone, so iOS Safari does not zoom on focus', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the 16px rule is scoped to < 768px');
    await page.goto('/login');
    expect(await fontSizeOf(page, 'Email')).toBeGreaterThanOrEqual(16);
    expect(await fontSizeOf(page, 'Password')).toBeGreaterThanOrEqual(16);
  });

  test('desktop keeps its compact input size (the rule must not leak above 768px)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    await page.goto('/login');
    expect(await fontSizeOf(page, 'Email')).toBeLessThan(16);
  });
});
