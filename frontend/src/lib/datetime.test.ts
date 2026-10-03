import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, addMonths, firstOfCurrentMonth, formatDate, formatMonth, monthsBetween, todayDate } from './datetime';

describe('datetime', () => {
  beforeEach(() => {
    // Only Date is faked so promises/timers in other tests' helpers still behave normally.
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('todayDate', () => {
    it("is the browser's LOCAL calendar date as YYYY-MM-DD (not UTC)", () => {
      vi.setSystemTime(new Date(2026, 5, 27, 23, 30)); // 27 Jun 2026, 11:30 PM local
      expect(todayDate()).toBe('2026-06-27');
    });

    it('zero-pads month and day', () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0));
      expect(todayDate()).toBe('2026-01-05');
    });
  });

  describe('firstOfCurrentMonth', () => {
    it('is the 1st of the current local month', () => {
      vi.setSystemTime(new Date(2026, 10, 18, 12, 0));
      expect(firstOfCurrentMonth()).toBe('2026-11-01');
    });
  });

  describe('addDays', () => {
    it.each([
      ['2026-02-27', 2, '2026-03-01'],
      ['2026-12-31', 1, '2027-01-01'],
      ['2028-02-28', 1, '2028-02-29'], // leap year
      ['2026-03-01', -1, '2026-02-28'],
      ['2026-06-27', 0, '2026-06-27'],
    ])('%s + %i days = %s', (start, days, expected) => {
      expect(addDays(start, days)).toBe(expected);
    });
  });

  describe('addMonths', () => {
    it('goes backward for negative months (Action Center 12-month window bound)', () => {
      expect(addMonths('2026-03-15', -12)).toBe('2025-03-15');
    });

    it('rolls the year over', () => {
      expect(addMonths('2026-11-10', 3)).toBe('2027-02-10');
    });

    it('overflows into the next month rather than clamping (current behavior, pinned)', () => {
      // 31 Jan + 1 month has no 31 Feb, so JS date math lands on 3 Mar.
      expect(addMonths('2026-01-31', 1)).toBe('2026-03-03');
    });
  });

  describe('monthsBetween', () => {
    it('lists every calendar month touched by the range, inclusive, across a year boundary', () => {
      expect(monthsBetween('2026-11-20', '2027-01-03')).toEqual(['2026-11', '2026-12', '2027-01']);
    });

    it('returns a single month when start and end share one', () => {
      expect(monthsBetween('2026-07-01', '2026-07-31')).toEqual(['2026-07']);
    });

    it('returns nothing when end is before start', () => {
      expect(monthsBetween('2026-08-01', '2026-07-01')).toEqual([]);
    });
  });

  describe('formatDate / formatMonth', () => {
    it('formats a calendar date without shifting it through a timezone', () => {
      const text = formatDate('2026-06-27');
      expect(text).toMatch(/27/);
      expect(text).toMatch(/Jun/);
      expect(text).toMatch(/2026/);
    });

    it('formats a year-month', () => {
      const text = formatMonth('2026-07');
      expect(text).toMatch(/Jul/);
      expect(text).toMatch(/2026/);
    });
  });
});
