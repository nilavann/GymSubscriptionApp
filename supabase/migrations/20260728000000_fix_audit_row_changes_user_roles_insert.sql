-- Fixes a critical bug found in a full-schema audit (spec/crud-review.md): audit_row_changes()'s
-- INSERT branch computed `v_record_id := v_new ->> 'id'` with no fallback. That's correct for
-- every table with a surrogate `id` column, but user_roles has none (its natural key is
-- (user_id, role_id)) - so for every `insert into user_roles`, v_record_id evaluated to NULL,
-- and the resulting `insert into audit_log` violated audit_log.record_id's `not null`
-- constraint, aborting the whole transaction. Since trg_user_roles_audit_fields fires `after
-- insert or delete` on user_roles, this broke every role grant: replace_user_roles() (used by
-- both invite-user and update-user for any role assignment) and the documented manual
-- bootstrap-admin `insert into user_roles ...` step.
--
-- The DELETE branch already had the correct fix (20260722000000_roles_and_user_roles.sql:150):
-- `coalesce(v_old ->> 'id', (v_old ->> 'user_id') || ':' || (v_old ->> 'role_id'))`. This
-- mirrors that same fallback into the INSERT branch (the one that was actually broken) and
-- the UPDATE branch (currently unreachable for user_roles specifically, since its trigger
-- only fires on INSERT/DELETE - fixed anyway since this function is shared across every
-- audited table, so leaving a latent trap for a future table/trigger change is not worth it).
--
-- Safe for every other table: they all have a real `id` column, so `v_new ->> 'id'` already
-- resolves correctly and the coalesce's fallback branch is simply never reached for them.
create or replace function audit_row_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change_id uuid := gen_random_uuid();
  v_old       jsonb;
  v_new       jsonb;
  v_record_id text;
  v_key       text;
  v_excluded  text[] := array['created_at', 'created_by', 'changed_at', 'changed_by'];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_record_id := coalesce(v_new ->> 'id', (v_new ->> 'user_id') || ':' || (v_new ->> 'role_id'));
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all(v_excluded) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, null, v_new ->> v_key, 'insert', auth.uid(), now());
      end if;
    end loop;
    return new;

  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := coalesce(v_new ->> 'id', (v_new ->> 'user_id') || ':' || (v_new ->> 'role_id'));
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all(v_excluded) and (v_old ->> v_key) is distinct from (v_new ->> v_key) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, v_old ->> v_key, v_new ->> v_key, 'update', auth.uid(), now());
      end if;
    end loop;
    return new;

  elsif tg_op = 'DELETE' then
    -- Reachable only for user_roles (the one table exempt from prevent_hard_delete).
    v_old := to_jsonb(old);
    v_record_id := coalesce(v_old ->> 'id', (v_old ->> 'user_id') || ':' || (v_old ->> 'role_id'));
    for v_key in select jsonb_object_keys(v_old) loop
      if v_key <> all(v_excluded) then
        insert into audit_log (change_id, table_name, record_id, field_name, old_value, new_value, operation, changed_by, changed_at)
        values (v_change_id, tg_table_name, v_record_id, v_key, v_old ->> v_key, null, 'delete', auth.uid(), now());
      end if;
    end loop;
    return old;
  end if;

  return null;
end;
$$;
