-- RPC functions backing the create-subscription / update-subscription Edge Functions.
-- See spec/backend/subscription-management.md §4 for the full write-up these implement.
-- Safe to run multiple times / against an existing project (idempotent create/replace).
--
-- Why RPC functions instead of plain supabase-js inserts from the Edge Function: a single
-- plpgsql function body is one implicit Postgres transaction. Two separate supabase-js
-- calls (insert header, then insert items) are two separate statements/transactions —
-- if the second one failed, the first would already be durably committed, leaving an
-- orphaned header. Wrapping both inserts in one function call is what actually gives
-- "either all rows land or none do" (subscription-management.md §4 step 4).
--
-- Both functions are locked down to service_role only (see the revoke/grant at the end of
-- each) — Postgres grants EXECUTE to PUBLIC by default, and PUBLIC includes every role
-- including `authenticated`. Without the revoke, any signed-in user could call
-- supabase.rpc(...) directly from the browser, bypassing the Edge Function's validation
-- entirely — the same class of gap flagged for member_number_sequences (database.md).

---------------------------------------------------------------------------
-- create_subscription_with_items
---------------------------------------------------------------------------

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
  v_subscription   subscriptions;
  v_item           jsonb;
  v_inserted_item  subscription_items;
  v_items          jsonb := '[]'::jsonb;
begin
  -- This function only ever runs on the service-role connection (called from the
  -- create-subscription Edge Function, never directly by a client — see the revoke/grant
  -- below), so auth.uid() would otherwise resolve to NULL and set_audit_fields() would
  -- stamp created_by/changed_by as NULL on every row. Faking the JWT claim for the rest
  -- of THIS transaction only (the `true` argument scopes it to LOCAL, auto-reset at
  -- commit) lets the existing, unmodified trigger attribute rows to the real acting user.
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  insert into subscriptions (member_id, payment_mode, notes)
  values (p_member_id, p_payment_mode, p_notes)
  returning * into v_subscription;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into subscription_items (
      subscription_id, plan_id, member_id, shared_member_id,
      start_date, end_date, quantity, amount_paid
    )
    values (
      v_subscription.id,
      (v_item ->> 'plan_id')::bigint,
      (v_item ->> 'member_id')::bigint,
      nullif(v_item ->> 'shared_member_id', '')::bigint,
      (v_item ->> 'start_date')::date,
      nullif(v_item ->> 'end_date', '')::date,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'amount_paid')::numeric
    )
    returning * into v_inserted_item;

    v_items := v_items || to_jsonb(v_inserted_item);
  end loop;

  -- Every validation (plan lookups, quantity rules, indefinite-item hard block, shared-
  -- member checks) already happened in the Edge Function before this was called — this
  -- function's only job is the atomic write. If any insert above violates a CHECK/FK
  -- constraint anyway (e.g. a stale/forged plan_id), the whole function call — both the
  -- header and every item inserted so far in this loop — rolls back together.
  return jsonb_build_object('subscription', to_jsonb(v_subscription), 'items', v_items);
end;
$$;

revoke all on function create_subscription_with_items(uuid, bigint, text, text, jsonb) from public;
grant execute on function create_subscription_with_items(uuid, bigint, text, text, jsonb) to service_role;

---------------------------------------------------------------------------
-- update_subscription_header
---------------------------------------------------------------------------
-- Header-only edit (payment_mode, notes) — line items have no update path at all
-- (subscription-management.md §4). A single UPDATE doesn't need a wrapping transaction
-- for atomicity the way create does, but it has the exact same auth.uid()-via-service-
-- role problem, so it gets the same set_config() treatment for correct changed_by/changed_at.

create or replace function update_subscription_header(
  p_caller_id       uuid,
  p_subscription_id bigint,
  p_payment_mode    text,
  p_notes           text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription subscriptions;
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  update subscriptions
  set payment_mode = coalesce(p_payment_mode, payment_mode),
      notes        = p_notes
  where id = p_subscription_id
    and deleted_at is null
  returning * into v_subscription;

  if v_subscription.id is null then
    raise exception 'Subscription % not found', p_subscription_id;
  end if;

  return to_jsonb(v_subscription);
end;
$$;

revoke all on function update_subscription_header(uuid, bigint, text, text) from public;
grant execute on function update_subscription_header(uuid, bigint, text, text) to service_role;
