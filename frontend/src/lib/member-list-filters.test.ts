import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStatusPill, filterBeforeStatus, matchesSearch, sortMembers, statusPillCounts, type MemberListFilters } from './member-list-filters';
import { localDate, memberRow } from '../test/fixtures';

const NO_FILTERS: MemberListFilters = { search: '', genders: [], addonPlanIds: [], planIds: [] };

describe('Member list: search / pills / filters / sort (REQ-LIST-001..004)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(localDate(2026, 7, 15));
  });
  afterEach(() => vi.useRealTimers());

  describe('REQ-LIST-002 search', () => {
    const row = memberRow({ name: 'Priya Sharma', member_number: 'MUM-2026-0042', phone: '98765 43210' });

    it('matches name substring, case-insensitively', () => {
      expect(matchesSearch(row, 'priya')).toBe(true);
      expect(matchesSearch(row, 'SHARMA')).toBe(true);
      expect(matchesSearch(row, 'ya sh')).toBe(true);
    });
    it('matches member number substring, case-insensitively', () => {
      expect(matchesSearch(row, 'mum-2026-0042')).toBe(true);
      expect(matchesSearch(row, '0042')).toBe(true);
    });
    it('matches phone substring, ignoring spaces on both sides', () => {
      expect(matchesSearch(row, '9876543210')).toBe(true);
      expect(matchesSearch(row, '98765 43')).toBe(true);
      expect(matchesSearch(row, '43210')).toBe(true);
    });
    it('does not match unrelated text', () => {
      expect(matchesSearch(row, 'zzz')).toBe(false);
      expect(matchesSearch(row, '1111111111')).toBe(false);
    });
    it('empty / whitespace query matches everything', () => {
      expect(matchesSearch(row, '')).toBe(true);
      expect(matchesSearch(row, '   ')).toBe(true);
    });
    it('trims surrounding whitespace in the query', () => {
      expect(matchesSearch(row, '  priya  ')).toBe(true);
    });
    it('a name query with digits also still searches phone/number (no field is exclusive)', () => {
      expect(matchesSearch(memberRow({ name: 'Bob', phone: '9111111111', member_number: 'DEL-2026-0001' }), '9111')).toBe(true);
    });
    it('filterBeforeStatus drops non-matching rows', () => {
      const rows = [row, memberRow({ id: 2, name: 'Other', phone: '9000000000', member_number: 'X-1' })];
      expect(filterBeforeStatus(rows, { ...NO_FILTERS, search: 'priya' }).map((r) => r.id)).toEqual([1]);
    });
  });

  describe('REQ-LIST-003 status pills', () => {
    const rows = [
      memberRow({ id: 1, current_membership_plan_id: 1, current_membership_end_date: '2026-12-01' }), // active
      memberRow({ id: 2, current_membership_plan_id: 1, current_membership_end_date: null }), // indefinite -> active
      memberRow({ id: 3, current_membership_plan_id: 1, current_membership_end_date: '2026-07-22' }), // 7d -> expiring
      memberRow({ id: 4, current_membership_plan_id: 1, current_membership_end_date: '2026-07-15' }), // today -> expiring
      memberRow({ id: 5, current_membership_plan_id: null, current_membership_end_date: null }), // none -> expired
      memberRow({ id: 6, current_membership_plan_id: 1, current_membership_end_date: '2026-07-14' }), // ended -> expired
    ];
    it('All applies no status filter', () => expect(applyStatusPill(rows, 'all')).toHaveLength(6));
    it('Active', () => expect(applyStatusPill(rows, 'active').map((r) => r.id)).toEqual([1, 2]));
    it('Expiring (within 7 days inclusive)', () => expect(applyStatusPill(rows, 'expiring').map((r) => r.id)).toEqual([3, 4]));
    it('Expired (ended, or no current membership at all)', () => expect(applyStatusPill(rows, 'expired').map((r) => r.id)).toEqual([5, 6]));
    it('pill counts honour the other active filters and sum to the total', () => {
      expect(statusPillCounts(rows)).toEqual({ all: 6, active: 2, expiring: 2, expired: 2 });
      expect(statusPillCounts([])).toEqual({ all: 0, active: 0, expiring: 0, expired: 0 });
    });
    it('empty list stays empty for every pill', () => {
      expect(applyStatusPill([], 'active')).toEqual([]);
    });
  });

  describe('REQ-LIST-004 filter panel', () => {
    const rows = [
      memberRow({ id: 1, gender: 'Male', current_membership_plan_id: 10, current_addon_plan_ids: [20] }),
      memberRow({ id: 2, gender: 'Female', current_membership_plan_id: 11, current_addon_plan_ids: [20, 21] }),
      memberRow({ id: 3, gender: 'Other', current_membership_plan_id: null, current_addon_plan_ids: [] }),
      memberRow({ id: 4, gender: 'Female', current_membership_plan_id: 10, current_addon_plan_ids: [21] }),
    ];
    const ids = (f: Partial<MemberListFilters>) => filterBeforeStatus(rows, { ...NO_FILTERS, ...f }).map((r) => r.id);

    it('no selection -> everyone', () => expect(ids({})).toEqual([1, 2, 3, 4]));
    it('single gender', () => expect(ids({ genders: ['Female'] })).toEqual([2, 4]));
    it('multiple genders are OR-ed', () => expect(ids({ genders: ['Male', 'Other'] })).toEqual([1, 3]));
    it('add-on filter: member needs at least one selected add-on', () => {
      expect(ids({ addonPlanIds: [21] })).toEqual([2, 4]);
      expect(ids({ addonPlanIds: [20, 21] })).toEqual([1, 2, 4]);
    });
    it('plan filter uses the current membership plan; members with none never match', () => {
      expect(ids({ planIds: [10] })).toEqual([1, 4]);
      expect(ids({ planIds: [10, 11] })).toEqual([1, 2, 4]);
    });
    it('selections combine with AND across groups', () => {
      expect(ids({ genders: ['Female'], planIds: [10] })).toEqual([4]);
      expect(ids({ genders: ['Female'], planIds: [10], addonPlanIds: [20] })).toEqual([]);
    });
    it('combines with search and the pill (additive)', () => {
      const withNames = [
        memberRow({ id: 1, name: 'Ann', gender: 'Female', current_membership_plan_id: 10, current_membership_end_date: '2026-12-01' }),
        memberRow({ id: 2, name: 'Anna', gender: 'Female', current_membership_plan_id: 10, current_membership_end_date: '2026-07-16' }),
        memberRow({ id: 3, name: 'Bob', gender: 'Female', current_membership_plan_id: 10, current_membership_end_date: '2026-07-16' }),
      ];
      const stage1 = filterBeforeStatus(withNames, { search: 'ann', genders: ['Female'], addonPlanIds: [], planIds: [10] });
      expect(applyStatusPill(stage1, 'expiring').map((r) => r.id)).toEqual([2]);
    });
    it('unselecting everything restores the full list', () => expect(ids({ genders: [] })).toHaveLength(4));
  });

  describe('REQ-LIST-001 sorting', () => {
    const rows = [
      memberRow({ id: 1, name: 'Bravo', date_of_joining: '2026-02-01', current_membership_end_date: '2026-09-01' }),
      memberRow({ id: 2, name: 'alpha', date_of_joining: '2026-05-01', current_membership_end_date: null }),
      memberRow({ id: 3, name: 'Charlie', date_of_joining: '2026-03-01', current_membership_end_date: '2026-08-01' }),
      memberRow({ id: 4, name: 'Delta', date_of_joining: '2026-05-01', current_membership_end_date: null }),
    ];
    it('default: date_of_joining DESCENDING (most recently joined first)', () => {
      expect([2, 4]).toContain(sortMembers(rows, 'join-date')[0].id);
      expect(sortMembers(rows, 'join-date').map((r) => r.date_of_joining)).toEqual(['2026-05-01', '2026-05-01', '2026-03-01', '2026-02-01']);
    });
    it('by name ascending, case-insensitive-ish locale order', () => {
      expect(sortMembers(rows, 'name').map((r) => r.name)).toEqual(['alpha', 'Bravo', 'Charlie', 'Delta']);
    });
    it('by expiry ascending with members lacking an end date (indefinite / none) last', () => {
      expect(sortMembers(rows, 'expiry').map((r) => r.id).slice(0, 2)).toEqual([3, 1]);
      expect(sortMembers(rows, 'expiry').slice(2).every((r) => r.current_membership_end_date === null)).toBe(true);
    });
    it('does not mutate the input array', () => {
      const copy = rows.map((r) => r.id);
      sortMembers(rows, 'name');
      expect(rows.map((r) => r.id)).toEqual(copy);
    });
    it('search/filters never change the default ordering (still join date desc)', () => {
      const filtered = filterBeforeStatus(rows, { ...NO_FILTERS, search: 'a' });
      const dates = sortMembers(filtered, 'join-date').map((r) => r.date_of_joining);
      expect([...dates].sort().reverse()).toEqual(dates);
    });
    it('empty list', () => expect(sortMembers([], 'expiry')).toEqual([]));
  });
});

describe('Section 10 NFR: member list responsiveness with ~2,000 members', () => {
  it('search + every filter + pill + sort over 2,000 rows runs in well under 100ms (client-side by design)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 7, 15));
    const rows = Array.from({ length: 2000 }, (_, i) =>
      memberRow({
        id: i, name: `Member ${i}`, phone: String(9000000000 + i), member_number: `MUM-2026-${String(i).padStart(4, '0')}`,
        gender: (['Male', 'Female', 'Other'] as const)[i % 3], date_of_joining: `2026-0${1 + (i % 9)}-1${i % 9}`,
        current_membership_plan_id: i % 5 === 0 ? null : (i % 4) + 1, current_addon_plan_ids: i % 3 === 0 ? [7] : [],
        current_membership_end_date: i % 7 === 0 ? null : `2026-${String(1 + (i % 12)).padStart(2, '0')}-15`,
      })
    );
    const start = performance.now();
    const filtered = filterBeforeStatus(rows, { search: 'member 1', genders: ['Male', 'Female'], addonPlanIds: [7], planIds: [1, 2, 3] });
    const result = sortMembers(applyStatusPill(filtered, 'active'), 'expiry');
    statusPillCounts(filtered);
    const elapsed = performance.now() - start;
    expect(result.length).toBeLessThanOrEqual(filtered.length);
    expect(elapsed).toBeLessThan(100);
  });
});
