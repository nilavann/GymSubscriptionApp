import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrls = vi.hoisted(() => vi.fn());
vi.mock('./supabase-client', () => ({ supabase: { storage: { from: () => ({ createSignedUrls }) } } }));
import { resolvePhotoUrls } from './photo-urls';

const row = (id: number, photo_url: string | null, photo_thumbnail_url: string | null) => ({ id, photo_url, photo_thumbnail_url });

beforeEach(() => createSignedUrls.mockReset());

describe('resolvePhotoUrls (private member-photos bucket, REQ-MEM-004)', () => {
  it('does not call storage at all when no row has a photo', async () => {
    const rows = [row(1, null, null)];
    expect(await resolvePhotoUrls(rows)).toBe(rows);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('replaces stored paths with short-lived signed URLs, in ONE batched call for all rows', async () => {
    createSignedUrls.mockResolvedValue({ data: [
      { path: '1/o.jpg', signedUrl: 'https://s/o1' }, { path: '1/t.jpg', signedUrl: 'https://s/t1' },
      { path: '2/t.jpg', signedUrl: 'https://s/t2' },
    ], error: null });
    const out = await resolvePhotoUrls([row(1, '1/o.jpg', '1/t.jpg'), row(2, null, '2/t.jpg')]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(expect.arrayContaining(['1/o.jpg', '1/t.jpg', '2/t.jpg']), 3600);
    expect(out).toEqual([row(1, 'https://s/o1', 'https://s/t1'), row(2, null, 'https://s/t2')]);
  });

  it('de-duplicates identical paths', async () => {
    createSignedUrls.mockResolvedValue({ data: [{ path: 'a.jpg', signedUrl: 'u' }], error: null });
    await resolvePhotoUrls([row(1, 'a.jpg', 'a.jpg'), row(2, 'a.jpg', null)]);
    expect(createSignedUrls.mock.calls[0][0]).toEqual(['a.jpg']);
  });

  it('a path that could not be signed becomes null rather than leaking the raw path', async () => {
    createSignedUrls.mockResolvedValue({ data: [], error: null });
    expect(await resolvePhotoUrls([row(1, 'x.jpg', 'y.jpg')])).toEqual([row(1, null, null)]);
  });

  it('storage errors propagate', async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: new Error('nope') });
    await expect(resolvePhotoUrls([row(1, 'x.jpg', null)])).rejects.toThrow('nope');
  });
});
