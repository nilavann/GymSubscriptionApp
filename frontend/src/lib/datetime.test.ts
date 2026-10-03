import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, addMonths, firstOfCurrentMonth, formatDate, formatMonth, monthsBetween, todayDate } from './datetime';
import { localDate } from '../test/fixtures';

describe('datetime helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(localDate(2026, 3, 5));
  });

  it('todayDate is the local calendar date, zero padded (REQ-MEM-001: date_of_joining default)', () => {
    expect(todayDate()).toBe('2026-03-05');
  });

  it('todayDate rolls over only at local midnight', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 1));
    expect(todayDate()).toBe('2026-01-01');
    vi.setSystemTime(new Date(2025, 11, 31, 23, 59, 59));
    expect(todayDate()).toBe('2025-12-31');
  });

  it('firstOfCurrentMonth (REQ-REPORT-001 default range start)', () => {
    expect(firstOfCurrentMonth()).toBe('2026-03-01');
  });

  describe('addDays (REQ-SUB-009 end_date arithmetic)', () => {
    it('adds and subtracts days', () => {
      expect(addDays('2026-07-01', 29)).toBe('2026-07-30');
      expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
    });
    it('crosses month and year boundaries', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    });
    it('handles leap years', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
      expect(addDays('2028-01-01', 365)).toBe('2028-12-31'); // 2028 has 366 days
    });
    it('adding 0 days is identity', () => {
      expect(addDays('2026-07-01', 0)).toBe('2026-07-01');
    });
  });

  describe('addMonths', () => {
    it('goes backward and forward', () => {
      expect(addMonths('2026-07-15', -12)).toBe('2025-07-15');
      expect(addMonths('2026-07-15', 3)).toBe('2026-10-15');
    });
    it('crosses year boundary', () => {
      expect(addMonths('2026-11-10', 3)).toBe('2027-02-10');
    });
  });

  describe('monthsBetween (REQ-REPORT-001: always calendar-month buckets)', () => {
    it('single month range -> one bucket', () => {
      expect(monthsBetween('2026-07-01', '2026-07-31')).toEqual(['2026-07']);
      expect(monthsBetween('2026-07-15', '2026-07-15')).toEqual(['2026-07']);
    });
    it('partial months at both ends are included', () => {
      expect(monthsBetween('2026-01-31', '2026-03-01')).toEqual(['2026-01', '2026-02', '2026-03']);
    });
    it('spans a year boundary in order', () => {
      expect(monthsBetween('2025-11-10', '2026-02-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });
    it('start after end -> no buckets', () => {
      expect(monthsBetween('2026-08-01', '2026-07-01')).toEqual([]);
    });
  });

  it('formatDate / formatMonth render calendar values without timezone shifts', () => {
    expect(formatDate('2026-06-27')).toMatch(/27/);
    expect(formatDate('2026-06-27')).toMatch(/2026/);
    expect(formatMonth('2026-07')).toMatch(/2026/);
  });
});
