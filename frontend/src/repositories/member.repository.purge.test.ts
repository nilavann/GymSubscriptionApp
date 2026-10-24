import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase-client', () => ({ supabase: { functions: { invoke } } }));

import { memberRepository } from './member.repository';

beforeEach(() => invoke.mockReset());

describe('memberRepository.purge', () => {
  it('invokes purge-member with the member id', async () => {
    invoke.mockResolvedValue({ data: { success: true, photos_removed: true }, error: null });
    await expect(memberRepository.purge(12)).resolves.toEqual({ photosRemoved: true });
    expect(invoke).toHaveBeenCalledWith('purge-member', { body: { member_id: 12 } });
  });

  it('reports when the rows were erased but the photo files were not', async () => {
    invoke.mockResolvedValue({ data: { success: true, photos_removed: false }, error: null });
    await expect(memberRepository.purge(12)).resolves.toEqual({ photosRemoved: false });
  });

  it("throws the function's own error message", async () => {
    const context = new Response(JSON.stringify({ error: 'System admin access required' }), { status: 403 });
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('non-2xx'), { context }) });
    await expect(memberRepository.purge(12)).rejects.toThrow('System admin access required');
  });
});
