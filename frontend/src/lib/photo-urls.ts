import { supabase } from './supabase-client';

const PHOTO_SIGNED_URL_EXPIRY_SECONDS = 3600;

/**
 * Replaces member-photos storage paths with short-lived signed URLs. Call on any
 * fetched row(s) with photo_url/photo_thumbnail_url — those columns store a
 * bucket-relative path now that member-photos is a private bucket, never a directly
 * usable URL. Batches every path in one createSignedUrls call regardless of row count.
 */
export async function resolvePhotoUrls<T extends { photo_url: string | null; photo_thumbnail_url: string | null }>(
  rows: T[]
): Promise<T[]> {
  const paths = Array.from(
    new Set(rows.flatMap((r) => [r.photo_url, r.photo_thumbnail_url]).filter((p): p is string => !!p))
  );
  if (paths.length === 0) return rows;

  const { data, error } = await supabase.storage
    .from('member-photos')
    .createSignedUrls(paths, PHOTO_SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw error;

  const signedByPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({
    ...r,
    photo_url: r.photo_url ? (signedByPath.get(r.photo_url) ?? null) : null,
    photo_thumbnail_url: r.photo_thumbnail_url ? (signedByPath.get(r.photo_thumbnail_url) ?? null) : null,
  }));
}
