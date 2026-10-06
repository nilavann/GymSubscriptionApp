import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateNewMember, type NewMemberDraft } from './member.service';

// The Add Member form's rules (`validateNewMember`) are the client copy; the import-data Edge Function has a server copy
// (supabase/functions/import-data/merge-validation.ts `validateMemberFields`). They share ONE fixture, so changing a
// rule on either side without the other fails a test here or in the Deno suite (merge-validation.test.ts).

interface ParityCase {
  label: string;
  overrides: Record<string, unknown>;
  invalid: string[];
}

// `__dirname` (provided by vitest) rather than import.meta.url: under jsdom the latter is not a Node file: URL.
const fixturePath = resolve(__dirname, '../../../supabase/functions/_tests/fixtures/member-validation-cases.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { base: Record<string, unknown>; cases: ParityCase[] };

describe('Add Member form validation agrees with the server-side import validator (shared fixture)', () => {
  it('the fixture is substantial and mixes valid and invalid cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(60);
    expect(fixture.cases.some((c) => c.invalid.length === 0)).toBe(true);
    expect(fixture.cases.some((c) => c.invalid.length > 0)).toBe(true);
  });

  it.each(fixture.cases.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    // The form is keyed by branch_id where the import is keyed by branch_code; both are valid in the base case.
    const { branch_code: _branchCode, ...rest } = { ...fixture.base, ...c.overrides };
    const draft = { ...rest, branch_id: 1 } as unknown as NewMemberDraft;
    expect(Object.keys(validateNewMember(draft)).sort()).toEqual(c.invalid);
  });
});
