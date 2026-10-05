import { readFileSync } from 'node:fs';
import type { Download, Page, TestInfo } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './fixtures/test';
import { ADMIN, seedListScreens } from './fixtures/data';
import type { Row, SupabaseMock } from './fixtures/supabase-mock';

// REQ-ADMIN-007: the admin exports every table to one workbook plus the photos as a zip. This drives the real
// production bundle, downloads the real files in the browser and inspects them — and proves the export reads ONLY
// through the admin-only export-data function (never a direct table read, which RLS would filter).

const KEYED = new Set(['branches', 'plans', 'roles', 'members', 'subscriptions', 'subscription_items', 'audit_log']);
const TS = '2026-01-15T10:11:12.123456+00:00';

function exportData(): Record<string, Row[]> {
  return {
    branches: [{ id: 1, name: 'Main Branch', code: 'MUM', created_at: TS }],
    plans: [{ id: 1, name: 'Monthly', category: 'membership', duration_days: 30, price: 1000, max_members: 1 }],
    roles: [{ id: 1, name: 'admin', description: null }, { id: 2, name: 'staff', description: null }],
    users: [
      { id: ADMIN.id, email: ADMIN.email, full_name: 'Anita', is_active: true },
      { id: 'u-gone', email: 'gone@fitandfine.in', full_name: 'Gone', is_active: false, deleted_at: TS, deleted_by: ADMIN.id },
    ],
    user_roles: [{ user_id: ADMIN.id, role_id: 1, granted_at: TS, granted_by: null }],
    configuration: [{ key: 'member_number_padding_width', value: '4', description: 'pad', created_at: TS }],
    member_number_sequences: [{ branch_id: 1, last_sequence: 3 }],
    members: [
      { id: 1, name: 'Meera Joshi', phone: '0987654321', member_number: 'MUM-2026-0001', branch_id: 1, photo_url: '1/original-1.jpg', photo_thumbnail_url: '1/thumbnail-1.jpg', aadhaar_number: '000011112222' },
      { id: 2, name: 'Deleted Dan', phone: '1111111111', member_number: 'MUM-2026-0002', branch_id: 1, photo_url: '2/original-2.jpg', deleted_at: TS, deleted_by: ADMIN.id },
      { id: 3, name: 'No Photo', phone: '2222222222', member_number: 'MUM-2026-0003', branch_id: 1, photo_url: null },
    ],
    subscriptions: [{ id: 1, member_id: 1, payment_mode: 'UPI', notes: null }],
    subscription_items: [{ id: 1, subscription_id: 1, plan_id: 1, member_id: 1, start_date: '2026-01-15', end_date: '2026-02-13', quantity: 1, amount_paid: 1000 }],
    audit_log: Array.from({ length: 5 }, (_, i) => ({ id: 1000 + i, change_id: 'c', table_name: 'members', record_id: '1', field_name: 'name', operation: 'insert', changed_at: TS })),
  };
}

/** The export-data Edge Function as the server behaves: keyset pages for big tables, one page for the small ones. */
function installExport(supabase: SupabaseMock, data = exportData(), pageSize = 2) {
  supabase.functions['export-data'] = (body) => {
    const { table, after, limit } = body as { table: string; after: number | null; limit: number };
    const rows = data[table] ?? [];
    if (!KEYED.has(table)) return { json: { rows, next: null, project_ref: 'e2eproject' } };
    const page = rows.filter((r) => (r.id as number) > (after ?? -1)).slice(0, Math.min(limit, pageSize));
    return { json: { rows: page, next: page.length ? page[page.length - 1].id : null, project_ref: 'e2eproject' } };
  };
  return data;
}

const exportedTables = (supabase: SupabaseMock) =>
  supabase.calls('/functions/v1/export-data').map((c) => (c.body as { table: string }).table);

async function open(download: Download, testInfo: TestInfo) {
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return unzipSync(new Uint8Array(readFileSync(path)));
}

const sheetNamesOf = (files: Record<string, Uint8Array>) =>
  [...strFromU8(files['xl/workbook.xml']).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);

async function download(page: Page, link: RegExp) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: link }).click()]);
  return file;
}

const exportButton = (page: Page) => page.getByRole('button', { name: 'Export data' });

test.describe('Data Backup — export', () => {
  test.beforeEach(async ({ signedInAs }) => {
    await signedInAs('admin');
  });

  test('exports a workbook with every sheet and a photo zip — reading only through the admin-only function', async ({ page, supabase }, testInfo) => {
    installExport(supabase);
    await page.goto('/data-backup');
    await expect(page.getByRole('heading', { name: 'Data Backup' })).toBeVisible();
    await exportButton(page).click();
    await expect(page.getByText('Export ready. Download the files below.')).toBeVisible();

    // The workbook: README first, then every data sheet, in the documented order.
    const workbook = await download(page, /Download data \(\.xlsx\)/);
    expect(workbook.suggestedFilename()).toMatch(/^fit-and-fine-data-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const files = await open(workbook, testInfo);
    expect(sheetNamesOf(files)).toEqual([
      'README', 'Branches', 'Plans', 'Roles', 'Members', 'Subscriptions', 'SubscriptionItems', 'Users', 'UserRoles',
      'Configuration', 'MemberNumberSequences', 'AuditLog',
    ]);
    const strings = strFromU8(files['xl/sharedStrings.xml']);
    expect(strings).toContain('0987654321'); // a leading zero survives as text
    expect(strings).toContain('000011112222');
    expect(strings).toContain(ADMIN.email); // README exported_by
    expect(strings).toContain('e2eproject'); // README source_project, from the function
    expect(strings).toContain('Deleted Dan'); // soft-deleted rows are exported
    expect(strings).toContain('MUM-2026-0001.png'); // photo_file points at the zip entry

    // The photos: one entry per member with a photo, deleted members included, named by member number.
    const photos = await download(page, /Download photos \(\.zip\)/);
    expect(photos.suggestedFilename()).toMatch(/^fit-and-fine-photos-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(Object.keys(await open(photos, testInfo)).sort()).toEqual(['MUM-2026-0001.png', 'MUM-2026-0002.png']);

    // Every table came through the function (paged), and NOTHING was read straight from a table.
    expect([...new Set(exportedTables(supabase))]).toEqual([
      'branches', 'plans', 'roles', 'users', 'user_roles', 'configuration', 'member_number_sequences', 'members',
      'subscriptions', 'subscription_items', 'audit_log',
    ]);
    expect(supabase.calls('/functions/v1/export-data').filter((c) => (c.body as { table: string }).table === 'members').map((c) => (c.body as { after: number | null }).after)).toEqual([null, 2, 3]);
    // (The app shell makes its own unrelated reads — the signed-in profile, the Action Center count — hence the table list.)
    const exportedTableNames = /^\/rest\/v1\/(branches|plans|roles|members|subscriptions|subscription_items|audit_log|configuration|member_number_sequences|user_roles|profiles)$/;
    expect(supabase.calls(exportedTableNames)).toHaveLength(0);
    expect(supabase.calls(/^\/storage\/v1\/object\/member-photos\//)).toHaveLength(2);
  });

  test('the audit log and the photos can be left out — they are then never requested', async ({ page, supabase }, testInfo) => {
    installExport(supabase);
    await page.goto('/data-backup');
    await page.getByRole('checkbox', { name: 'Include audit log (can be large)' }).uncheck();
    await page.getByRole('checkbox', { name: 'Include member photos (separate .zip)' }).uncheck();
    await exportButton(page).click();
    await expect(page.getByText('Export ready. Download the file below.')).toBeVisible();

    await expect(page.getByRole('link', { name: /photos/i })).toHaveCount(0);
    const files = await open(await download(page, /Download data/), testInfo);
    expect(sheetNamesOf(files)).not.toContain('AuditLog');
    expect(sheetNamesOf(files)).toContain('Members');
    expect(exportedTables(supabase)).not.toContain('audit_log');
    expect(supabase.calls(/^\/storage\//)).toHaveLength(0);
  });

  test('a photo that cannot be read is reported and the export still completes', async ({ page, supabase }, testInfo) => {
    installExport(supabase);
    supabase.missingObjects.add('member-photos/2/original-2.jpg');
    await page.goto('/data-backup');
    await exportButton(page).click();

    await expect(page.getByText('Heads-up (1)')).toBeVisible();
    await expect(page.getByText('Photo for member MUM-2026-0002 could not be read and was skipped.')).toBeVisible();
    const photos = await open(await download(page, /Download photos \(\.zip\)/), testInfo);
    expect(Object.keys(photos)).toEqual(['MUM-2026-0001.png']);
  });

  test('offline: says so and offers Retry, never a partial file — Retry then completes', async ({ page, supabase }) => {
    installExport(supabase);
    await page.goto('/data-backup');
    await expect(exportButton(page)).toBeVisible(); // the app (profile, page chunk) must be up BEFORE the network drops
    supabase.offline = true;
    await exportButton(page).click();

    await expect(page.getByText("Couldn't finish the export — check your connection and try again.")).toBeVisible();
    await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);

    supabase.offline = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(/Export ready/)).toBeVisible();
  });

  test('a refusal from the server is shown with its message', async ({ page, supabase }) => {
    supabase.functions['export-data'] = () => ({ status: 403, json: { error: 'Admin access required' } });
    await page.goto('/data-backup');
    await exportButton(page).click();
    await expect(page.getByText('The export failed: Admin access required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('Cancel stops the export — no further tables are requested and nothing is offered for download', async ({ page, supabase }) => {
    const data = exportData();
    installExport(supabase, data);
    const serve = supabase.functions['export-data'];
    supabase.functions['export-data'] = async (body) => {
      await new Promise((resolve) => setTimeout(resolve, 400)); // slow enough to cancel mid-way
      return serve(body);
    };
    await page.goto('/data-backup');
    await exportButton(page).click();
    await expect(page.getByRole('progressbar', { name: 'Export progress' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Export cancelled. Nothing was downloaded.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);
    await page.waitForTimeout(900); // anything still in flight would have landed by now
    expect(exportedTables(supabase)).not.toContain('audit_log');
    await expect(exportButton(page)).toBeEnabled();
  });
});

test.describe('Data Backup — access and navigation', () => {
  test('staff are told it is admin-only and nothing is requested', async ({ page, supabase, signedInAs }) => {
    installExport(supabase);
    await signedInAs('staff');
    await page.goto('/data-backup');
    await expect(page.getByText('Access denied — this page is admin-only.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export data' })).toHaveCount(0);
    expect(supabase.calls('/functions/v1/export-data')).toHaveLength(0);
  });

  test('is reachable from the Settings hub card and the admin section tabs', async ({ page, supabase, signedInAs }) => {
    seedListScreens(supabase);
    installExport(supabase);
    await signedInAs('admin');
    await page.goto('/settings');
    const card = page.locator('.settings-card').filter({ has: page.locator('.settings-card-label', { hasText: /^Data Backup$/ }) });
    await expect(card).toHaveAttribute('href', '/data-backup');
    await expect(card.locator('.settings-card-count')).toHaveCount(0);

    await card.click();
    await expect(page).toHaveURL(/\/data-backup$/);
    await expect(page.getByRole('heading', { name: 'Data Backup' })).toBeVisible();

    const tabs = page.locator('.app-shell-content').getByRole('navigation', { name: 'Admin sections' });
    await expect(tabs.getByRole('link', { name: 'Backup' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/plans$/);
  });
});

test.describe('Data Backup — layout on every device', () => {
  test('controls meet the 44px touch target and the page never scrolls sideways', async ({ page, supabase, signedInAs }) => {
    installExport(supabase);
    await signedInAs('admin');
    await page.goto('/data-backup');
    await expect(page.getByRole('heading', { name: 'Data Backup' })).toBeVisible();

    // 43.5, not 44: WebKit lays a `min-height: 44px` box out at 43.99999px; a genuinely undersized target is far below this.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.data-backup-page button, .data-backup-page .data-backup-check, .data-backup-page a')]
        .map((el) => ({ label: (el.textContent ?? '').trim().slice(0, 30), h: el.getBoundingClientRect().height }))
        .filter((el) => el.h > 0 && el.h < 43.5)
    );
    expect(small, 'targets under 44px').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await exportButton(page).click();
    await expect(page.getByText(/Export ready/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
});
