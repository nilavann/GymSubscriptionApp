import { expect, test } from './fixtures/test';
import { seedListScreens } from './fixtures/data';

// Every list screen used to render BOTH a card list and a <table> for the same rows, hiding one with
// CSS (the hidden copy still ran and still downloaded its images). Now exactly one exists in the DOM —
// proven here with real browsers at real widths. (Unit tests cover the same rule per page in jsdom.)

const SCREENS = [
  { route: '/', name: 'Members', cards: '.members-cards', table: '.members-table' },
  { route: '/plans', name: 'Plans', cards: '.plans-cards', table: '.plans-table' },
  { route: '/branches', name: 'Branches', cards: '.branches-cards', table: '.branches-table' },
  { route: '/roles', name: 'Roles', cards: '.roles-cards', table: '.roles-table' },
  { route: '/users', name: 'Users', cards: '.users-cards', table: '.users-table' },
  { route: '/audit-log', name: 'Audit Log', cards: '.audit-log-cards', table: '.audit-log-table' },
  { route: '/member-numbering', name: 'Member Numbering', cards: '.member-numbering-cards', table: '.member-numbering-table' },
  { route: '/reports', name: 'Reports transactions', cards: '.reports-tx-cards', table: '.reports-tx-table' },
];

for (const screen of SCREENS) {
  test(`${screen.name}: exactly one of table / cards is in the DOM`, async ({ page, supabase, signedInAs }) => {
    seedListScreens(supabase);
    await signedInAs('admin');
    await page.goto(screen.route);
    await expect(page.locator('.app-shell-content h1').first()).toBeVisible();

    const wide = page.viewportSize()!.width >= 768;
    // Wait for the list to actually load (skeletons are replaced) before counting.
    await expect(page.locator(wide ? screen.table : screen.cards)).toHaveCount(1);

    await expect(page.locator(wide ? screen.cards : screen.table), `${screen.name}: the hidden twin must not exist`).toHaveCount(0);
    expect(supabase.unmocked).toEqual([]);
  });
}

test('Members: one <img> per member photo, not two', async ({ page, supabase, signedInAs }) => {
  seedListScreens(supabase);
  supabase.tables.member_list_view = supabase.tables.member_list_view.map((row, i) =>
    i < 3 ? { ...row, photo_thumbnail_url: `members/${row.id}/thumb.jpg`, photo_url: `members/${row.id}/full.jpg` } : row
  );
  await signedInAs('staff');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

  await expect(page.locator('img.members-avatar-img')).toHaveCount(3);

  // The list signs all its photo paths (3 members x original + thumbnail = 6) in ONE batched call. (A
  // second, smaller sign call also happens: AppShell's Action Center badge fetch signs the photos of every
  // member in the queue just to show a count — a known inefficiency, separate from this render-once rule.)
  const batches = supabase
    .calls('/storage/v1/object/sign/member-photos')
    .map((call) => (call.body as { paths: string[] }).paths);
  expect(batches.filter((paths) => paths.length === 6)).toHaveLength(1);
});
