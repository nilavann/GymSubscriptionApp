import { test as base, expect } from '@playwright/test';
import { ADMIN, defaultTables, STAFF } from './data';
import { SupabaseMock } from './supabase-mock';

type Role = 'admin' | 'staff';

interface Fixtures {
  /** The fake Supabase backend for this test. Mutate `supabase.tables` / `.functions` before `page.goto`. */
  supabase: SupabaseMock;
  /** Start the page already signed in as the seeded admin or staff user. */
  signedInAs: (role: Role) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  supabase: async ({ page }, use) => {
    const mock = new SupabaseMock(page, { tables: defaultTables(), users: [ADMIN, STAFF] });
    await mock.install();
    await use(mock);
    // A request nobody mocked is a missing fixture, not a passing test (CLAUDE.md "Testing rules" #4).
    expect(mock.unmocked, 'Supabase requests that no mock answered').toEqual([]);
  },

  signedInAs: async ({ supabase }, use) => {
    await use((role) => supabase.signIn(role === 'admin' ? ADMIN : STAFF));
  },
});

export { expect };
