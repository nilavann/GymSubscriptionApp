-- member_list_view now reports a member's LATEST membership even after it has ended.
--
-- Until now current_membership_* came from member_current_items, which drops every item whose
-- end_date has passed. A member whose only plan lapsed therefore looked identical to one who
-- never subscribed (all three columns NULL), so the client could not tell "Expired" from
-- "No plans". Now the membership lateral reads every non-deleted membership item (own, or as
-- the shared member of a couple plan) and picks the latest end_date (NULL = indefinite, first).
--   * never subscribed        -> NULL columns  (client: "No plans")
--   * latest end_date < today -> past end_date (client: "Expired")
-- Add-ons stay current-only: an expired add-on is not something the list shows or filters by.
-- Same output columns, same order — CREATE OR REPLACE VIEW requires it.
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
  select si.plan_id, p.name as plan_name, si.end_date
  from subscription_items si
  join plans p on p.id = si.plan_id
  where (si.member_id = m.id or si.shared_member_id = m.id)
    and si.deleted_at is null
    and p.category = 'membership'
  order by si.end_date desc nulls first
  limit 1
) current_membership on true
left join lateral (
  select array_agg(distinct mci.plan_id) as addon_plan_ids
  from member_current_items mci
  where mci.member_id = m.id
    and mci.category = 'addon'
) current_addons on true
where m.deleted_at is null;
