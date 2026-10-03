import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable, awaitable fake of supabase-js's query builder that records every call.
const calls = vi.hoisted(() => ({ log: [] as [string, unknown[]][], result: { data: [] as unknown[], error: null as unknown }, profiles: { data: [] as unknown[], error: null as unknown } }));
vi.mock('../lib/supabase-client', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'gte', 'lte', 'eq', 'in', 'order', 'limit']) {
      b[m] = (...args: unknown[]) => { calls.log.push([`${table}.${m}`, args]); return b; };
    }
    b.then = (resolve: (v: unknown) => unknown) => resolve(table === 'audit_log' ? calls.result : calls.profiles);
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) } };
});
import { auditLogRepository } from './audit-log.repository';

const raw = (i: number, changedBy: string | null = 'u1') => ({
  id: i, change_id: 'c', table_name: 'members', record_id: '1', field_name: 'name', old_value: 'a', new_value: 'b', operation: 'update', changed_by: changedBy, changed_at: '2026-07-10T00:00:00Z',
});
const filters = { startDate: '2026-07-01', endDate: '2026-07-15', tableName: null, recordId: null, changedBy: null };

beforeEach(() => { calls.log.length = 0; calls.result = { data: [], error: null }; calls.profiles = { data: [], error: null }; });

describe('auditLogRepository.getFiltered (REQ-ADMIN-005)', () => {
  it('applies only the filters supplied', async () => {
    await auditLogRepository.getFiltered(filters);
    expect(calls.log.filter(([m]) => m === 'audit_log.eq')).toHaveLength(0);
    await auditLogRepository.getFiltered({ ...filters, tableName: 'plans', recordId: ' 7 ', changedBy: 'u9' });
    const eqs = calls.log.filter(([m]) => m === 'audit_log.eq').map(([, a]) => a);
    expect(eqs).toEqual([['table_name', 'plans'], ['record_id', '7'], ['changed_by', 'u9']]);
  });

  it('date range covers whole LOCAL days (start 00:00:00.000 to end 23:59:59.999)', async () => {
    await auditLogRepository.getFiltered(filters);
    const gte = calls.log.find(([m]) => m === 'audit_log.gte')![1];
    const lte = calls.log.find(([m]) => m === 'audit_log.lte')![1];
    expect(gte).toEqual(['changed_at', new Date('2026-07-01T00:00:00').toISOString()]);
    expect(lte).toEqual(['changed_at', new Date('2026-07-15T23:59:59.999').toISOString()]);
  });

  it('newest first, capped at 500 (+1 probe row to detect truncation)', async () => {
    await auditLogRepository.getFiltered(filters);
    expect(calls.log.find(([m]) => m === 'audit_log.order')![1]).toEqual(['changed_at', { ascending: false }]);
    expect(calls.log.find(([m]) => m === 'audit_log.limit')![1]).toEqual([501]);
  });

  it('exactly 500 rows is NOT truncated; 501 is, and the extra row is dropped', async () => {
    calls.result = { data: Array.from({ length: 500 }, (_, i) => raw(i)), error: null };
    expect((await auditLogRepository.getFiltered(filters)).truncated).toBe(false);
    calls.result = { data: Array.from({ length: 501 }, (_, i) => raw(i)), error: null };
    const page = await auditLogRepository.getFiltered(filters);
    expect(page.truncated).toBe(true);
    expect(page.rows).toHaveLength(500);
  });

  it('resolves the changer name; unknown (deleted) profiles and system writes get labels', async () => {
    calls.result = { data: [raw(1, 'u1'), raw(2, 'gone'), raw(3, null)], error: null };
    calls.profiles = { data: [{ id: 'u1', full_name: 'Sam Staff' }], error: null };
    const { rows } = await auditLogRepository.getFiltered(filters);
    expect(rows.map((r) => r.changed_by_name)).toEqual(['Sam Staff', 'Deleted user', 'System']);
  });

  it('empty result skips the profile lookup', async () => {
    await auditLogRepository.getFiltered(filters);
    expect(calls.log.some(([m]) => m === 'profiles.select')).toBe(false);
  });

  it('propagates database errors', async () => {
    calls.result = { data: [], error: { message: 'permission denied' } };
    await expect(auditLogRepository.getFiltered(filters)).rejects.toThrow('permission denied');
  });
});
