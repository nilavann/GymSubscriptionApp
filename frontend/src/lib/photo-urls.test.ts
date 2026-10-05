import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSignedUrls } = vi.hoisted(() => ({ createSignedUrls: vi.fn() }));
vi.mock('./supabase-client', () => ({
  supabase: { storage: { from: () => ({ createSignedUrls }) } },
}));

import { resolvePhotoUrls } from './photo-urls';

const row = (photo_url: string | null, photo_thumbnail_url: string | null) => ({ id: 1, photo_url, photo_thumbnail_url });

describe('resolvePhotoUrls', () => {
  beforeEach(() => {
    createSignedUrls.mockReset();
  });

  it('replaces storage paths with signed URLs using ONE batched call, de-duplicating paths', async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: 'a/full.jpg', signedUrl: 'https://signed/full' },
        { path: 'a/thumb.jpg', signedUrl: 'https://signed/thumb' },
      ],
      error: null,
    });

    const rows = [row('a/full.jpg', 'a/thumb.jpg'), row('a/full.jpg', 'a/thumb.jpg')];
    const resolved = await resolvePhotoUrls(rows);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['a/full.jpg', 'a/thumb.jpg'], 3600);
    expect(resolved).toEqual([
      row('https://signed/full', 'https://signed/thumb'),
      row('https://signed/full', 'https://signed/thumb'),
    ]);
  });

  it('makes no network call at all when no row has a photo, and returns the rows untouched', async () => {
    const rows = [row(null, null)];
    await expect(resolvePhotoUrls(rows)).resolves.toBe(rows);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('nulls a photo whose path did not come back signed', async () => {
    createSignedUrls.mockResolvedValue({ data: [], error: null });
    await expect(resolvePhotoUrls([row('gone.jpg', null)])).resolves.toEqual([row(null, null)]);
  });

  it('throws when Storage returns an error, so the caller can show its retry state', async () => {
    const failure = new Error('storage down');
    createSignedUrls.mockResolvedValue({ data: null, error: failure });
    await expect(resolvePhotoUrls([row('a.jpg', null)])).rejects.toBe(failure);
  });
});
