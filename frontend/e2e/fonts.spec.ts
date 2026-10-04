import { expect, test } from './fixtures/test';
import { memberListRow } from './fixtures/data';

// Rubik and Schibsted Grotesk are self-hosted Fontsource variable fonts. The build emits every script subset
// (Cyrillic, Hebrew, Arabic, Latin-ext…), but each @font-face carries a unicode-range, so a browser only fetches
// the subsets the page's characters need. This pins that: a phone on mobile data must not download ~150KB of
// scripts nobody reads, and the app must actually use the fonts rather than fall back to the system face.

test('only the Latin font subsets are downloaded, and the app really renders in them', async ({ page, supabase, signedInAs }) => {
  supabase.tables.member_list_view = [memberListRow({ id: 1, name: 'Asha Verma' })];
  await signedInAs('staff');

  const fontRequests: string[] = [];
  page.on('request', (request) => {
    if (/\.woff2?(\?|$)/.test(new URL(request.url()).pathname)) fontRequests.push(new URL(request.url()).pathname);
  });

  await page.goto('/');
  await expect(page.locator('.members-card, .members-table-row').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  expect(fontRequests.length, 'no font file was requested at all').toBeGreaterThan(0);
  for (const path of fontRequests) {
    expect(path, `${path} is not a Latin subset`).toMatch(/-latin-wght-normal-[\w-]+\.woff2$/);
  }

  // Body copy is Rubik; the display face (Schibsted Grotesk) is the brand wordmark — the mobile header's title,
  // or the sidebar's brand on desktop.
  const families = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    brand: getComputedStyle(document.querySelector('.mobile-header-title, .app-shell-brand')!).fontFamily,
    loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family),
  }));
  expect(families.body).toContain('Rubik Variable');
  expect(families.brand).toContain('Schibsted Grotesk Variable');
  expect(families.loaded.some((name) => name.includes('Rubik'))).toBe(true);
  expect(families.loaded.some((name) => name.includes('Schibsted'))).toBe(true);
});
