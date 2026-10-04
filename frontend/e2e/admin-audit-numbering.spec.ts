import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { ADMIN, seedListScreens } from './fixtures/data';
import type { SupabaseMock } from './fixtures/supabase-mock';

// Audit Log (strictly view-only) and Member Numbering (global format settings + a per-branch counter that can be
// moved forward). Both are admin-only. The audit filters and the numbering writes are asserted as requests.

const content = (page: Page) => page.locator('.app-shell-content');
const YEAR = new Date().getFullYear();
const number = (code: string, sequence: number, width = 4) => `${code}-${YEAR}-${String(sequence).padStart(width, '0')}`;

// ---- Audit Log ---------------------------------------------------------------------------------------

const entries = (page: Page) => page.locator('.audit-log-table tbody tr, .audit-log-card');
const auditRequests = (supabase: SupabaseMock) => supabase.calls('/rest/v1/audit_log').filter((call) => call.method === 'GET' && !call.search.includes('count'));
const lastAudit = (supabase: SupabaseMock) => new URLSearchParams(auditRequests(supabase).at(-1)!.search);

test.describe('Audit Log', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedListScreens(supabase);
    // Three changes to three different plans, plus one to a branch by someone else.
    supabase.tables.audit_log = [
      ...[1, 2, 3].map((id) => ({
        id,
        change_id: `c-${id}`,
        table_name: 'plans',
        record_id: String(id),
        field_name: 'price',
        old_value: '1000',
        new_value: '1500',
        operation: 'update',
        changed_by: ADMIN.id,
        changed_at: new Date().toISOString(),
      })),
      {
        id: 4,
        change_id: 'c-4',
        table_name: 'branches',
        record_id: '2',
        field_name: 'code',
        old_value: 'PUN',
        new_value: null,
        operation: 'delete',
        changed_by: 'u-staff',
        changed_at: new Date().toISOString(),
      },
    ];
    await signedInAs('admin');
  });

  test('lists who changed what, loading this month up to today by default', async ({ page, supabase }) => {
    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(entries(page)).toHaveCount(4);

    const plansChange = entries(page).filter({ hasText: 'plans' }).first();
    await expect(plansChange).toContainText('price');
    await expect(plansChange).toContainText('1000');
    await expect(plansChange).toContainText('1500');
    await expect(plansChange).toContainText('Anita Admin');
    await expect(entries(page).filter({ hasText: 'branches' })).toContainText('Priya Sharma');

    const params = lastAudit(supabase);
    const bounds = params.getAll('changed_at');
    expect(bounds).toHaveLength(2);
    expect(bounds.some((b) => b.startsWith('gte.'))).toBe(true);
    expect(bounds.some((b) => b.startsWith('lte.'))).toBe(true);
    expect(params.has('table_name')).toBe(false); // no other filter yet
  });

  test('Apply sends every filter to the database and narrows the list', async ({ page, supabase }) => {
    await page.goto('/audit-log');
    await expect(entries(page)).toHaveCount(4);

    await page.getByLabel('Table').selectOption('plans');
    await page.getByLabel('Record ID').fill('2');
    await expect(page.getByLabel('Changed by').locator('option')).toHaveCount(4); // Anyone + three users
    await page.getByLabel('Changed by').selectOption(ADMIN.id);
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(entries(page)).toHaveCount(1);
    await expect(entries(page).first()).toContainText('plans');
    const params = lastAudit(supabase);
    expect(params.get('table_name')).toBe('eq.plans');
    expect(params.get('record_id')).toBe('eq.2');
    expect(params.get('changed_by')).toBe(`eq.${ADMIN.id}`);
  });

  test('"Changed by" lists users alphabetically, after "Anyone"', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(entries(page)).toHaveCount(4);
    await expect(page.getByLabel('Changed by').locator('option')).toHaveText(['Anyone', 'Anita Admin', 'Priya Sharma', 'Ravi Kumar']);
  });

  test('refuses an end date before the start date without asking the database again', async ({ page, supabase }) => {
    await page.goto('/audit-log');
    await expect(entries(page)).toHaveCount(4);
    const before = auditRequests(supabase).length;

    await page.getByLabel('Start date').fill('2026-06-20');
    await page.getByLabel('End date').fill('2026-06-10');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('End date must be on or after the start date.')).toBeVisible();
    expect(auditRequests(supabase)).toHaveLength(before);
  });

  test('says so when nothing matches, and offers no way to edit anything', async ({ page, supabase }) => {
    supabase.tables.audit_log = [];
    await page.goto('/audit-log');
    await expect(page.getByText('No changes match these filters.')).toBeVisible();
    await expect(page.getByRole('button', { name: /edit|delete|remove/i })).toHaveCount(0);
  });

  test('warns when the 500-row cap truncated the result, and shows exactly 500', async ({ page, supabase }) => {
    supabase.tables.audit_log = Array.from({ length: 501 }, (_, i) => ({
      id: i + 1,
      change_id: `c-${i + 1}`,
      table_name: 'plans',
      record_id: String(i + 1),
      field_name: 'price',
      old_value: '1',
      new_value: '2',
      operation: 'update',
      changed_by: ADMIN.id,
      changed_at: new Date().toISOString(),
    }));
    await page.goto('/audit-log');
    await expect(page.getByText(/Showing the most recent 500 changes/)).toBeVisible();
    await expect(entries(page)).toHaveCount(500);
  });

  test('is strictly view-only: every entry is read-only text', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(entries(page)).toHaveCount(4);
    await expect(content(page).locator('.audit-log-table, .audit-log-cards').getByRole('button')).toHaveCount(0);
    await expect(content(page).locator('.audit-log-table, .audit-log-cards').getByRole('textbox')).toHaveCount(0);
  });
});

// ---- Member Numbering --------------------------------------------------------------------------------

const branchRow = (page: Page, name: string) => page.locator('.member-numbering-table tbody tr, .member-numbering-card').filter({ hasText: name });

test.describe('Member Numbering', () => {
  test.beforeEach(async ({ supabase, signedInAs }) => {
    seedListScreens(supabase); // configuration 1 / 1 / 4, Mumbai last=41, the other two branches have no member yet
    await signedInAs('admin');
  });

  test('previews the last issued and next number for each branch, padded as configured', async ({ page }) => {
    await page.goto('/member-numbering');
    await expect(page.getByRole('heading', { name: 'Member Numbering' })).toBeVisible();

    const mumbai = branchRow(page, 'Mumbai Central');
    await expect(mumbai).toContainText(number('MUM', 42)); // next
    const pune = branchRow(page, 'Pune Camp');
    await expect(pune).toContainText(number('PUN', 1)); // a fresh branch starts at the configured start sequence
    await expect(page.getByLabel('Start sequence')).toHaveValue('1');
    await expect(page.getByLabel('Increment')).toHaveValue('1');
    await expect(page.getByLabel('Padding width')).toHaveValue('4');
  });

  test('saving the format settings sends them atomically in one call and re-previews with the new padding', async ({ page, supabase }) => {
    supabase.rpcs['update_member_number_config'] = (body) => {
      const { p_start_sequence, p_increment, p_padding_width } = body as Record<string, number>;
      supabase.tables.configuration = [
        { key: 'member_number_start_sequence', value: String(p_start_sequence) },
        { key: 'member_number_increment', value: String(p_increment) },
        { key: 'member_number_padding_width', value: String(p_padding_width) },
      ];
      return { json: undefined };
    };
    await page.goto('/member-numbering');
    await expect(branchRow(page, 'Mumbai Central')).toContainText(number('MUM', 42));

    await page.getByLabel('Padding width').fill('6');
    await page.getByRole('button', { name: 'Save Settings' }).click();

    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(branchRow(page, 'Mumbai Central')).toContainText(number('MUM', 42, 6));
    expect(supabase.calls('/rest/v1/rpc/update_member_number_config').map((call) => call.body)).toEqual([
      { p_start_sequence: 1, p_increment: 1, p_padding_width: 6 },
    ]);
    // One transaction server-side — never three separate configuration updates.
    expect(supabase.calls('/rest/v1/configuration').filter((call) => call.method !== 'GET')).toEqual([]);
  });

  test('moving a branch counter forward goes through the Edge Function and reloads the preview', async ({ page, supabase }) => {
    supabase.functions['update-member-number-sequence'] = (body) => {
      const { branch_id, next_sequence } = body as { branch_id: number; next_sequence: number };
      supabase.tables.member_number_sequences = [{ branch_id, last_sequence: next_sequence - 1 }];
      return { json: { next_sequence, requested: next_sequence, adjusted: false } };
    };
    await page.goto('/member-numbering');
    const mumbai = branchRow(page, 'Mumbai Central');
    await mumbai.getByRole('button', { name: /Edit/ }).click();

    const input = mumbai.getByRole('textbox');
    await expect(input).toHaveValue('42');
    await input.fill('5a0'); // non-digits are stripped as typed
    await expect(input).toHaveValue('50');
    await mumbai.locator('.member-numbering-icon-button-primary').click();

    await expect(branchRow(page, 'Mumbai Central')).toContainText(number('MUM', 50));
    expect(supabase.calls('/functions/v1/update-member-number-sequence').map((call) => call.body)).toEqual([{ branch_id: 1, next_sequence: 50 }]);
  });

  test('tells the admin when the requested number was already used and the counter skipped forward', async ({ page, supabase }) => {
    supabase.functions['update-member-number-sequence'] = () => ({ json: { next_sequence: 57, requested: 50, adjusted: true } });
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await page.goto('/member-numbering');
    const mumbai = branchRow(page, 'Mumbai Central');
    await mumbai.getByRole('button', { name: /Edit/ }).click();
    await mumbai.getByRole('textbox').fill('50');
    await mumbai.locator('.member-numbering-icon-button-primary').click();

    await expect.poll(() => dialogs).toEqual(['Mumbai Central: 50 was already used for this branch — set to 57 instead.']);
  });

  test('cancelling an edit changes nothing', async ({ page, supabase }) => {
    await page.goto('/member-numbering');
    const mumbai = branchRow(page, 'Mumbai Central');
    await mumbai.getByRole('button', { name: /Edit/ }).click();
    await mumbai.getByRole('textbox').fill('99');
    await mumbai.locator('.member-numbering-icon-button').first().click(); // the ✕

    await expect(mumbai.getByRole('textbox')).toHaveCount(0);
    await expect(mumbai).toContainText(number('MUM', 42));
    expect(supabase.calls('/functions/v1/update-member-number-sequence')).toHaveLength(0);
  });

  test('the sequence field refuses empty input and sends nothing', async ({ page, supabase }) => {
    await page.goto('/member-numbering');
    const mumbai = branchRow(page, 'Mumbai Central');
    await mumbai.getByRole('button', { name: /Edit/ }).click();
    await mumbai.getByRole('textbox').fill('');
    await mumbai.locator('.member-numbering-icon-button-primary').click();

    await expect(mumbai.locator('.member-numbering-field-error')).toBeVisible();
    expect(supabase.calls('/functions/v1/update-member-number-sequence')).toHaveLength(0);
  });
});
