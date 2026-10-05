import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { currentItemRow, dayFromToday, memberListRow, memberRow, seedListScreens } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// The nine handoff screens, captured on the two phone projects and attached to the report. This is a REVIEW aid,
// not a gate: it asserts only that each screen finished rendering real content (so a blank or half-loaded page
// can't be photographed as "fine"), and never compares pixels — baselines would be OS- and font-specific.
// Look at them under `playwright-report/` (npx playwright show-report) or `test-results/**/*.png`.

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'phone screens only');
});

const NAMES = ['Asha Verma', 'Bharat Rao', 'Chitra Iyer', 'Dev Patel', 'Esha Gupta', 'Farhan Sheikh'];
const END_DAYS = [60, 5, -5, 25, 2, -40];

function seedRealistic(supabase: SupabaseMock) {
  seedListScreens(supabase);
  supabase.tables.member_list_view = NAMES.map((name, i) =>
    memberListRow({
      id: i + 1,
      name,
      phone: `98765432${10 + i}`,
      gender: i % 2 ? 'Male' : 'Female',
      current_membership_plan_name: i % 2 ? 'Quarterly' : 'Monthly',
      current_membership_end_date: dayFromToday(END_DAYS[i]),
    })
  );
  supabase.tables.members = NAMES.map((name, i) =>
    memberRow({
      id: i + 1,
      name,
      phone: `98765432${10 + i}`,
      gender: i % 2 ? 'Male' : 'Female',
      email: `${name.split(' ')[0].toLowerCase()}@example.com`,
      occupation: 'Designer',
      pincode: '400001',
      handled_by_staff: 'u-staff',
    })
  );
  supabase.tables.member_current_items = [
    currentItemRow({ subscription_item_id: 1, plan_id: 1, plan_name: 'Monthly', category: 'membership', member_id: 1, end_date: dayFromToday(60) }),
    currentItemRow({ subscription_item_id: 2, plan_id: 3, plan_name: 'Yoga', category: 'addon', member_id: 1, amount_paid: 500, end_date: dayFromToday(20) }),
  ];
  supabase.tables.subscriptions = [
    { id: 1, payment_mode: 'Cash' },
    { id: 2, payment_mode: 'UPI' },
    { id: 3, payment_mode: 'Card' },
    { id: 11, member_id: 1, payment_mode: 'UPI', notes: 'Festival offer', created_at: '2026-06-01T10:00:00Z' },
    { id: 12, member_id: 1, payment_mode: 'Cash', notes: null, created_at: '2026-07-01T10:00:00Z' },
  ];
  supabase.tables.subscription_items = [
    ...[1, 2, 3].map((id) => ({ id, subscription_id: id, plan_id: id === 3 ? 3 : 1, member_id: id, start_date: dayFromToday(0), amount_paid: 1000 * id })),
    { id: 21, subscription_id: 11, plan_id: 1, member_id: 1, shared_member_id: null, start_date: '2026-06-01', end_date: '2026-06-30', quantity: 1, amount_paid: 1500 },
    { id: 22, subscription_id: 12, plan_id: 3, member_id: 1, shared_member_id: null, start_date: '2026-07-01', end_date: '2026-07-30', quantity: 1, amount_paid: 500 },
  ];
}

/**
 * Waits for the content, fonts and any entrance animation to finish, then saves a full-page PNG into the test's
 * output and the report. (A full-page capture paints `position: fixed` chrome — the tab bar — once, at the
 * viewport's position, so it appears mid-image; that is a screenshot artifact, not a layout bug.)
 */
async function capture(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.locator('[aria-label="Loading"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Finite animations only: a spinner would never finish.
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const SCREENS: { name: string; route: string; ready: (page: Page) => ReturnType<Page['locator']> }[] = [
  { name: '02-action-center', route: '/action-center', ready: (p) => p.locator('.action-center-card').first() },
  { name: '03-members', route: '/', ready: (p) => p.locator('.members-card').first() },
  { name: '04-member-detail', route: '/members/1', ready: (p) => p.locator('.member-detail-name') },
  { name: '05-renew', route: '/members/1/renew', ready: (p) => p.locator('.renew-item-card').first() },
  { name: '06-add-member', route: '/members/new', ready: (p) => p.getByRole('heading', { name: 'Add Member' }) },
  { name: '07-reports', route: '/reports', ready: (p) => p.locator('.reports-tx-card').first() },
  { name: '08-settings', route: '/settings', ready: (p) => p.locator('.settings-card-count').first() },
  { name: '09-plans', route: '/plans', ready: (p) => p.locator('.plans-card').first() },
];

test('01 login (signed out)', async ({ page, supabase }, testInfo) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await capture(page, testInfo, '01-login');
  expect(supabase.unmocked).toEqual([]);
});

for (const screen of SCREENS) {
  test(`${screen.name}`, async ({ page, supabase, signedInAs }, testInfo) => {
    seedRealistic(supabase);
    await signedInAs('admin');
    await page.goto(screen.route);
    await expect(screen.ready(page)).toBeVisible();
    await capture(page, testInfo, screen.name);
  });
}
