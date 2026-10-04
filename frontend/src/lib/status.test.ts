import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveStatus, EXPIRING_SOON_THRESHOLD_DAYS, getMemberListRowStatus, STATUS_BADGE_CLASS, STATUS_LABEL } from './status';
import { buildMemberListRow } from '../test/builders';

// "Today" is pinned to 27 Jun 2026 (local) so every boundary below is exact.
const TODAY = '2026-06-27';

describe('deriveStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 27, 12, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const withEnd = (current_membership_end_date: string | null) => ({
    current_membership_plan_id: 1,
    current_membership_end_date,
  });

  it('treats a member with no membership plan as expired (current behavior: there is no "no plan" state yet)', () => {
    expect(deriveStatus({ current_membership_plan_id: null, current_membership_end_date: null })).toBe('expired');
  });

  it('treats an indefinite membership (no end date) as active', () => {
    expect(deriveStatus(withEnd(null))).toBe('active');
  });

  it('is expiring on the last day (expires today)', () => {
    expect(deriveStatus(withEnd(TODAY))).toBe('expiring');
  });

  it(`is expiring at exactly ${EXPIRING_SOON_THRESHOLD_DAYS} days remaining and active at ${EXPIRING_SOON_THRESHOLD_DAYS + 1}`, () => {
    expect(deriveStatus(withEnd('2026-07-04'))).toBe('expiring'); // +7
    expect(deriveStatus(withEnd('2026-07-05'))).toBe('active'); // +8
  });

  it('is expired the day after the end date', () => {
    expect(deriveStatus(withEnd('2026-06-26'))).toBe('expired');
  });

  it('uses the browser LOCAL date, so late evening local time is still "today"', () => {
    vi.setSystemTime(new Date(2026, 5, 27, 23, 59));
    expect(deriveStatus(withEnd(TODAY))).toBe('expiring');
  });

  it('is computed from a list row via getMemberListRowStatus', () => {
    const row = buildMemberListRow({ current_membership_end_date: '2026-06-20' });
    expect(getMemberListRowStatus(row)).toBe('expired');
  });
});

describe('status presentation maps', () => {
  it('has a label and a badge class for every status', () => {
    expect(STATUS_LABEL).toEqual({ active: 'Active', expiring: 'Expiring', expired: 'Expired' });
    expect(STATUS_BADGE_CLASS).toEqual({
      active: 'status-badge-active',
      expiring: 'status-badge-expiring',
      expired: 'status-badge-expired',
    });
  });
});
