import { expect, test } from './fixtures/test';
import { memberListRow } from './fixtures/data';

// On a phone the WINDOW scrolls (desktop scrolls an inner container instead), and React Router does
// not reset the window offset on navigation. A page opened from mid-list therefore inherits the old
// offset, clamped to the new page's height. Chromium happens to clamp to 0 (the destination's loading
// skeleton is short), but WebKit lands 25px down — so this failed on mobile-safari until AppShell
// rendered <ScrollRestoration/>. Keep it running on every mobile engine.
test.describe('scroll position across routes (mobile, window scroll)', () => {
  test.skip(({ isMobile }) => !isMobile, 'desktop scrolls an inner container, not the window');

  test('a newly opened page starts at the top, not at the previous page’s offset', async ({
    page,
    supabase,
    signedInAs,
  }) => {
    supabase.tables.member_list_view = Array.from({ length: 40 }, (_, i) =>
      memberListRow({ id: i + 1, name: `Scroll Member ${i + 1}` })
    );
    await signedInAs('staff');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    // dispatchEvent, not click(): click() would first scroll the link into view and reset the
    // offset itself, hiding exactly the bug under test.
    const openAddMember = () => page.getByRole('link', { name: /Add Member/ }).first().dispatchEvent('click');

    // First visit loads the lazy route chunk. While it loads, <Suspense> swaps in the full-screen
    // LoadingView, which collapses the page height and clamps the scroll offset to 0 BY ACCIDENT —
    // so that visit can't prove anything. Visit once, come back, then test with the chunk cached.
    await openAddMember();
    await expect(page.getByRole('heading', { name: 'Add Member' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 1200));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

    await openAddMember();
    await expect(page.getByRole('heading', { name: 'Add Member' })).toBeVisible();

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
});
