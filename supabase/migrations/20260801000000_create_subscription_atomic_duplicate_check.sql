-- crud-review.md Low/polish finding: the REQ-SUB-007 "no duplicate indefinite item" check ran
-- as a separate SELECT in the create-subscription Edge Function, *before* the
-- create_subscription_with_items() RPC call — outside that RPC's atomic transaction. Two
-- concurrent checkouts for the same member+plan could both pass the pre-check and then both
-- insert (TOCTOU race). Moving the check inside this function makes it part of the same
-- transaction as the insert it's guarding, closing the race. The Edge Function keeps no
-- pre-check of its own now — this is the single source of truth.

create or replace function create_subscription_with_items(
  p_caller_id    uuid,
  p_member_id    bigint,
  p_payment_mode text,
  p_notes        text,
  p_items        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription           subscriptions;
  v_item                   jsonb;
  v_inserted_item          subscription_items;
  v_items                  jsonb := '[]'::jsonb;
  v_plan                   plans;
  v_item_member_id         bigint;
  v_item_shared_member_id  bigint;
  v_conflict_exists        boolean;
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  insert into subscriptions (member_id, payment_mode, notes)
  values (p_member_id, p_payment_mode, p_notes)
  returning * into v_subscription;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_plan from plans where id = (v_item ->> 'plan_id')::bigint;
    v_item_member_id := (v_item ->> 'member_id')::bigint;
    v_item_shared_member_id := nullif(v_item ->> 'shared_member_id', '')::bigint;

    -- REQ-SUB-007 hard block: an indefinite-duration plan can't be attached twice to the
    -- same member (or shared member). Checked here, inside the transaction that also does
    -- the insert below, so a second concurrent request for the same member+plan can't slip
    -- past the check before the first request's insert commits.
    if v_plan.duration_days is null then
      select exists (
        select 1 from subscription_items
        where plan_id = v_plan.id
          and deleted_at is null
          and (
            member_id in (v_item_member_id, coalesce(v_item_shared_member_id, v_item_member_id))
            or shared_member_id in (v_item_member_id, coalesce(v_item_shared_member_id, v_item_member_id))
          )
      ) into v_conflict_exists;

      if v_conflict_exists then
        raise exception 'This member already has an active indefinite item for plan "%" — it cannot be attached again', v_plan.name;
      end if;
    end if;

    insert into subscription_items (
      subscription_id, plan_id, member_id, shared_member_id,
      start_date, end_date, quantity, amount_paid
    )
    values (
      v_subscription.id,
      (v_item ->> 'plan_id')::bigint,
      v_item_member_id,
      v_item_shared_member_id,
      (v_item ->> 'start_date')::date,
      nullif(v_item ->> 'end_date', '')::date,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'amount_paid')::numeric
    )
    returning * into v_inserted_item;

    v_items := v_items || to_jsonb(v_inserted_item);
  end loop;

  -- Every OTHER validation (plan lookups, quantity rules, shared-member checks) already
  -- happened in the Edge Function before this was called — this function's own job is the
  -- atomic write, plus the one check above that has to live here to actually be atomic. If
  -- any insert above violates a CHECK/FK constraint anyway (e.g. a stale/forged plan_id),
  -- the whole function call — both the header and every item inserted so far in this loop —
  -- rolls back together.
  return jsonb_build_object('subscription', to_jsonb(v_subscription), 'items', v_items);
end;
$$;

revoke all on function create_subscription_with_items(uuid, bigint, text, text, jsonb) from public;
grant execute on function create_subscription_with_items(uuid, bigint, text, text, jsonb) to service_role;
