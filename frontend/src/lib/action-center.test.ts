import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActionCenterWindow, getRelativeExpiryLabel, splitActionCenterQueue } from './action-center';
import { localDate, memberRow } from '../test/fixtures';

vi.mock('../repositories/member-list.repository', () => ({ memberListRepository: { getActionCenterQueue: vi.fn() } }));

describe('Action Center helpers (spec/frontend/action-center.md)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(localDate(2026, 7, 15));
  });

  it('window = 12 months back to 30 days ahead, from local today', () => {
    expect(getActionCenterWindow()).toEqual({ from: '2025-07-15', to: '2026-08-14' });
  });

  it('splitActionCenterQueue: upcoming stays soonest-first, expired is most-recent-first', () => {
    const rows = [
      memberRow({ id: 1, current_membership_end_date: '2026-06-01' }),
      memberRow({ id: 2, current_membership_end_date: '2026-07-10' }),
      memberRow({ id: 3, current_membership_end_date: '2026-07-15' }),
      memberRow({ id: 4, current_membership_end_date: '2026-08-01' }),
    ];
    const { upcoming, expired } = splitActionCenterQueue(rows);
    expect(upcoming.map((r) => r.id)).toEqual([3, 4]);
    expect(expired.map((r) => r.id)).toEqual([2, 1]);
  });

  it('ending today counts as upcoming, not expired', () => {
    expect(splitActionCenterQueue([memberRow({ current_membership_end_date: '2026-07-15' })]).upcoming).toHaveLength(1);
  });

  it('indefinite memberships (NULL end date) never appear in the queue', () => {
    const { upcoming, expired } = splitActionCenterQueue([memberRow({ current_membership_end_date: null })]);
    expect(upcoming).toHaveLength(0);
    expect(expired).toHaveLength(0);
  });

  describe('getRelativeExpiryLabel', () => {
    it('today / tomorrow / N days, urgent within 7 days then soon', () => {
      expect(getRelativeExpiryLabel('2026-07-15')).toEqual({ text: 'Expires today', tier: 'urgent' });
      expect(getRelativeExpiryLabel('2026-07-16')).toEqual({ text: 'Expires tomorrow', tier: 'urgent' });
      expect(getRelativeExpiryLabel('2026-07-22')).toEqual({ text: 'Expires in 7 days', tier: 'urgent' });
      expect(getRelativeExpiryLabel('2026-07-23')).toEqual({ text: 'Expires in 8 days', tier: 'soon' });
    });
    it('expired: 1 day ago, N days, months once >= 60 days', () => {
      expect(getRelativeExpiryLabel('2026-07-14')).toEqual({ text: 'Expired 1 day ago', tier: 'expired' });
      expect(getRelativeExpiryLabel('2026-07-01')).toEqual({ text: 'Expired 14 days ago', tier: 'expired' });
      expect(getRelativeExpiryLabel('2026-05-17')).toEqual({ text: 'Expired 59 days ago', tier: 'expired' });
      expect(getRelativeExpiryLabel('2026-05-16').text).toBe('Expired 2 months ago');
    });
  });
});
