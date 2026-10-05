import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn());
// No `from` on purpose: the export must never read a table directly (RLS would hide soft-deleted rows, and the
// admin-only function is the sanctioned path). Any attempt to would throw "supabase.from is not a function".
vi.mock('../lib/supabase-client', () => ({ supabase: { functions: { invoke }, storage: { from: storageFrom } } }));

import { dataTransferRepository } from './data-transfer.repository';

beforeEach(() => {
  invoke.mockReset();
  download.mockReset();
  storageFrom.mockReset().mockReturnValue({ download });
});

describe('dataTransferRepository.exportPage — admin-only Edge Function, never a table read', () => {
  it('calls export-data with exactly table / after / limit and returns the page as received', async () => {
    const page = { rows: [{ id: 1 }], next: 1, project_ref: 'abc' };
    invoke.mockResolvedValue({ data: page, error: null });
    expect(await dataTransferRepository.exportPage('members', 41, 1000)).toEqual(page);
    expect(invoke).toHaveBeenCalledWith('export-data', { body: { table: 'members', after: 41, limit: 1000 } });
  });

  it('sends after: null for the first page', async () => {
    invoke.mockResolvedValue({ data: { rows: [], next: null, project_ref: 'abc' }, error: null });
    await dataTransferRepository.exportPage('audit_log', null, 500);
    expect(invoke).toHaveBeenCalledWith('export-data', { body: { table: 'audit_log', after: null, limit: 500 } });
  });

  it('throws the server\'s own message (e.g. the 403) rather than the SDK\'s generic one', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'Admin access required' }) } } });
    await expect(dataTransferRepository.exportPage('members', null, 1000)).rejects.toThrow('Admin access required');
  });

  it('a request that never reached the server surfaces as "Failed to fetch", so the page shows the offline state', async () => {
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' }) });
    await expect(dataTransferRepository.exportPage('members', null, 1000)).rejects.toThrow('Failed to fetch');
  });
});

describe('dataTransferRepository.downloadPhoto — the admin\'s own session, the private bucket', () => {
  it('downloads from the member-photos bucket at the stored path', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    download.mockResolvedValue({ data: blob, error: null });
    expect(await dataTransferRepository.downloadPhoto('5/original-1.jpg')).toBe(blob);
    expect(storageFrom).toHaveBeenCalledWith('member-photos');
    expect(download).toHaveBeenCalledWith('5/original-1.jpg');
  });

  it('throws the storage error message when the object cannot be read', async () => {
    download.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    await expect(dataTransferRepository.downloadPhoto('x')).rejects.toThrow('Object not found');
  });

  it('throws a clear message when storage returns neither data nor an error', async () => {
    download.mockResolvedValue({ data: null, error: null });
    await expect(dataTransferRepository.downloadPhoto('x')).rejects.toThrow('Photo not found');
  });

  it('a lost connection keeps the browser wording, so the service recognises it as offline', async () => {
    download.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    await expect(dataTransferRepository.downloadPhoto('x')).rejects.toThrow('Failed to fetch');
  });
});
