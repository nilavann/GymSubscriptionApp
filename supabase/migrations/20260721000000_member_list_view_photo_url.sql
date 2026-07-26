-- Adds photo_url (the original, uncompressed upload) to member_list_view, alongside the
-- existing photo_thumbnail_url — feeds the Members List's photo lightbox (frontend/
-- member-management.md §3.4 "Photo lightbox"), which enlarges the ORIGINAL image on
-- click, not the compressed thumbnail already shown in the card/row. A new migration
-- rather than editing 20260720000200_views_and_audit.sql, per database.md's "new schema
-- changes always get a new migration file — never edit an already-applied migration."
--
-- Cheap to add: this is a URL string column, not the image bytes — Postgres/PostgREST
-- returns a few extra bytes of text per row; the browser only downloads the actual
-- original image when the lightbox is opened and its <img> src is set.
--
-- photo_url is appended at the END of the select list, not inserted next to
-- photo_thumbnail_url where it reads more naturally — CREATE OR REPLACE VIEW only
-- allows adding new output columns after all existing ones; inserting one in the
-- middle shifts every later column's position, which Postgres treats as an attempt to
-- rename them (SQLSTATE 42P16) and rejects.
create or replace view member_list_view as
select
  m.id,
  m.name,
  m.phone,
  m.member_number,
  m.date_of_joining,
  m.gender,
  m.photo_thumbnail_url,
  current_membership.plan_id   as current_membership_plan_id,
  current_membership.plan_name as current_membership_plan_name,
  current_membership.end_date  as current_membership_end_date,
  coalesce(current_addons.addon_plan_ids, '{}') as current_addon_plan_ids,
  m.photo_url
from members m
left join lateral (
  select mci.plan_id, mci.plan_name, mci.end_date
  from member_current_items mci
  where mci.member_id = m.id
    and mci.category = 'membership'
  order by mci.end_date desc nulls first
  limit 1
) current_membership on true
left join lateral (
  select array_agg(distinct mci.plan_id) as addon_plan_ids
  from member_current_items mci
  where mci.member_id = m.id
    and mci.category = 'addon'
) current_addons on true
where m.deleted_at is null;
