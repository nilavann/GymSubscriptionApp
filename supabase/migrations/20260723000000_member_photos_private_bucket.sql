-- Makes member-photos private, closing security-review-findings.md's Medium finding
-- (bucket was fully public, no auth check, predictable {memberId}/... object paths) and
-- bundling in the adjacent Low finding (no file_size_limit/allowed_mime_types) since the
-- same bucket row is already being touched. See spec/backend/security-review-findings.md.
--
-- Reads now go through short-lived signed URLs, generated client-side by
-- frontend/src/lib/photo-urls.ts right after fetching member rows — members.photo_url/
-- photo_thumbnail_url switch meaning from "a public URL" to "a member-photos-relative
-- storage path" (a signed URL itself can't be persisted, it expires). Safe to run
-- multiple times / against an existing project.

-- 1. Flip the bucket private; add size/type restrictions while we're already touching
-- this row (the existing `insert ... on conflict do nothing` from
-- 20260720000100_transactional_data.sql won't update an already-existing row).
update storage.buckets
set public = false,
    file_size_limit = 5242880, -- 5 MiB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'member-photos';

-- 2. Replace the public read policy with the same is_active_user() gate the
-- write/update policies already use.
drop policy if exists "member_photos_read_public" on storage.objects;
drop policy if exists "member_photos_read_active_users" on storage.objects;
create policy "member_photos_read_active_users" on storage.objects
  for select using (bucket_id = 'member-photos' and is_active_user());

-- 3. Backfill: any member photographed before this migration has a full public URL
-- stored (https://<project>.supabase.co/storage/v1/object/public/member-photos/<path>),
-- not a bare path — createSignedUrl() needs the bare path. Idempotent: an already-
-- migrated row no longer matches the `like` guard, so safe to rerun.
update members set photo_url = regexp_replace(photo_url, '^.*/member-photos/', '')
where photo_url like '%/member-photos/%';

update members set photo_thumbnail_url = regexp_replace(photo_thumbnail_url, '^.*/member-photos/', '')
where photo_thumbnail_url like '%/member-photos/%';
