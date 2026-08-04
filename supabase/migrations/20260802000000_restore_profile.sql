-- restore_profile — reverses soft_delete_profile (clears deleted_at/deleted_by) so a
-- deleted user can be brought back instead of soft-delete being a dead end. Same
-- set_config() attribution trick as its sibling RPCs in 20260722000000_roles_and_user_roles.sql,
-- since set_audit_fields() needs auth.uid() to resolve changed_by under this service-role call.

create or replace function restore_profile(
  p_caller_id      uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

  update profiles
  set deleted_at = null, deleted_by = null
  where id = p_target_user_id and deleted_at is not null;
end;
$$;

revoke all on function restore_profile(uuid, uuid) from public;
grant execute on function restore_profile(uuid, uuid) to service_role;
