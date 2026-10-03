import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveStatus, EXPIRING_SOON_THRESHOLD_DAYS } from './status';
import { localDate } from '../test/fixtures';

// REQ-LIST-003 / business-logic.md §Member Status — Active / Expiring (<= 7 days, inclusive) / Expired.
const TODAY = localDate(2026, 7, 15);

function status(planId: number | null, endDate: string | null) {
  return deriveStatus({ current_membership_plan_id: planId, current_membership_end_date: endDate });
}

describe('deriveStatus (REQ-LIST-003)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => vi.useRealTimers());

  it('uses a 7 day threshold', () => {
    expect(EXPIRING_SOON_THRESHOLD_DAYS).toBe(7);
  });

  it('member with no current membership item is Expired', () => {
    expect(status(null, null)).toBe('expired');
  });

  it('indefinite (NULL end_date) membership is always Active', () => {
    expect(status(1, null)).toBe('active');
  });

  it('end_date far in the future is Active', () => {
    expect(status(1, '2027-07-15')).toBe('active');
  });

  it('8 days remaining is Active (just outside the threshold)', () => {
    expect(status(1, '2026-07-23')).toBe('active');
  });

  it('exactly 7 days remaining is Expiring (inclusive boundary)', () => {
    expect(status(1, '2026-07-22')).toBe('expiring');
  });

  it('1 day remaining is Expiring', () => {
    expect(status(1, '2026-07-16')).toBe('expiring');
  });

  it('ending today is still Expiring, not Expired (end_date today or later)', () => {
    expect(status(1, '2026-07-15')).toBe('expiring');
  });

  it('ended yesterday is Expired', () => {
    expect(status(1, '2026-07-14')).toBe('expired');
  });

  it('handles month and year boundaries', () => {
    vi.setSystemTime(localDate(2026, 12, 28));
    expect(status(1, '2027-01-04')).toBe('expiring'); // exactly 7 days across the year boundary
    expect(status(1, '2027-01-05')).toBe('active');
  });

  it('handles a leap day (2028-02-29)', () => {
    vi.setSystemTime(localDate(2028, 2, 25));
    expect(status(1, '2028-03-03')).toBe('expiring'); // 7 days, passes through Feb 29
    expect(status(1, '2028-03-04')).toBe('active');
  });

  it('uses the browser LOCAL date, not UTC (Timezone Rule)', () => {
    // 23:30 local on the 15th: even if UTC has already rolled over, "today" is still the 15th.
    vi.setSystemTime(localDate(2026, 7, 15, 23));
    expect(status(1, '2026-07-15')).toBe('expiring');
  });
});
