-- Fixes a gap found in a CRUD-flow audit (spec/crud-review.md): the Member Numbering
-- Global Settings form updated all three `configuration` rows (member_number_start_sequence,
-- member_number_increment, member_number_padding_width) via three independent client-side
-- `.update()` calls (Promise.all) - three separate statements, not one transaction. If the
-- 2nd succeeded and the 3rd then failed (a transient network blip mid-batch), two of the
-- three keys were durably changed in the DB while the page's error handler never reloaded,
-- so the form kept showing the old draft even though generate_member_number() was already
-- reading a mixed old/new state.
--
-- Wrapping all three UPDATEs in one PL/pgSQL function call makes them genuinely atomic: a
-- function body runs inside the caller's single statement/transaction, so a failure partway
-- through rolls back everything the function already did, not just the failing UPDATE.
-- SECURITY INVOKER (the default) deliberately, not DEFINER - each UPDATE still runs as the
-- calling user, so the existing `configuration_update_admin` RLS policy keeps gating this
-- exactly as it already does for a direct client `.update()`; this function doesn't need to
-- re-implement its own admin check, RLS already does that per-statement.
create or replace function update_member_number_config(
  p_start_sequence integer,
  p_increment      integer,
  p_padding_width  integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update configuration set value = p_start_sequence::text where key = 'member_number_start_sequence';
  update configuration set value = p_increment::text     where key = 'member_number_increment';
  update configuration set value = p_padding_width::text where key = 'member_number_padding_width';
end;
$$;

revoke all on function update_member_number_config(integer, integer, integer) from public;
grant execute on function update_member_number_config(integer, integer, integer) to authenticated;
