-- Fixes a latent footgun flagged in a full-app spec-vs-implementation audit
-- (spec/audit-findings.md): update_subscription_header always overwrote `notes`
-- unconditionally (`notes = p_notes`), unlike `payment_mode`, which correctly used
-- `coalesce(p_payment_mode, payment_mode)` to leave it untouched when omitted. Since the
-- calling Edge Function's payload type already declares `notes` as optional
-- (UpdateSubscriptionPayload.notes?: string | null), any caller that omits it entirely
-- (not just one that explicitly clears it) silently wiped existing notes to NULL. Harmless
-- today only because the one real caller (MemberDetailPage's history-edit form) always
-- sends the current value - this closes the gap rather than relying on that.
--
-- `notes` is nullable and legitimately clearable to NULL, so a plain coalesce can't
-- distinguish "omitted" from "explicitly cleared" (both look like NULL) - the new
-- p_notes_provided flag carries that distinction explicitly instead.

drop function if exists update_subscription_header(uuid, bigint, text, text);

create or replace function update_subscription_header(
  p_caller_id       uuid,
  p_subscription_id bigint,
  p_payment_mode    text,
  p_notes           text,
  p_notes_provided  boolean
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
      notes        = case when p_notes_provided then p_notes else notes end
  where id = p_subscription_id
    and deleted_at is null
  returning * into v_subscription;

  if v_subscription.id is null then
    raise exception 'Subscription % not found', p_subscription_id;
  end if;

  return to_jsonb(v_subscription);
end;
$$;

revoke all on function update_subscription_header(uuid, bigint, text, text, boolean) from public;
grant execute on function update_subscription_header(uuid, bigint, text, text, boolean) to service_role;
