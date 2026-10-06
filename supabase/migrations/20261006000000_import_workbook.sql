-- import_workbook — the single write path behind the import-data Edge Function's MERGE mode
-- (REQ-ADMIN-008, spec/backend/data-export-import.md §5–§6).
--
-- Merge = add (and, on request, update) branches, plans, members and subscriptions through the app's
-- NORMAL write rules: every trigger stays on, so new rows get new ids, a regenerated member_number, the
-- importing admin as created_by, and ordinary audit_log entries. It never deletes and never un-deletes.
--
-- One call = one transaction:
--   * every row runs in its own sub-block, so a bad row becomes an `error` outcome and its partial writes
--     (including the member-number counter bump) roll back with it;
--   * p_dry_run does the real work and then rolls EVERYTHING back (preview == real outcome);
--   * with p_skip_invalid = false, any error rolls everything back (all-or-nothing).
-- The outcome list lives in a PL/pgSQL LOCAL VARIABLE: PL/pgSQL keeps local variables when an EXCEPTION clause
-- rolls back the block's database changes, which is what lets a dry run / abort still return what happened.
--
-- Payload (built and validated by the Edge Function; the RPC still enforces every schema constraint):
--   { "branches":      [ {row, name, code} ],
--     "plans":         [ {row, name, category, duration_days, price, max_members} ],
--     "members":       [ {row, name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
--                         under_doctor_care, doctor_care_details, emergency_contact_*, email,
--                         residential_address, pincode, aadhaar_number, occupation, branch_code,
--                         handled_by_email} ],
--     "subscriptions": [ {row, member_phone, payment_mode, notes,
--                         items: [ {plan_name, member_phone, shared_member_phone, start_date, quantity, amount_paid} ]} ] }
-- A JSON null / empty string means "no value": on update it never overwrites an existing value.
--
-- Privileges: callable ONLY by service_role. `revoke … from public` alone is NOT enough on Supabase — new
-- public functions are also granted EXECUTE directly to anon/authenticated by default (test-traceability.md
-- finding F10) — so all three are revoked by name. This function takes p_caller_id as a PARAMETER and writes
-- with definer rights: if a signed-in staff user could call it they could create admin-only plans/branches and
-- forge who did it.

-- User-facing wording for the constraint violations an import row can hit; anything else passes through.
-- A NOT NULL violation carries the column (and, from PostgreSQL 18, also a generated constraint name — so this keys
-- on the message + column, not on the constraint name): "Weight kg is required".
create or replace function import_error_message(p_message text, p_constraint text, p_column text default null)
returns text
language sql
immutable
as $$
  select case
    when p_column is not null and p_message like '%not-null constraint%'
      then upper(left(replace(p_column, '_', ' '), 1)) || substr(replace(p_column, '_', ' '), 2) || ' is required'
    else case p_constraint
    when 'idx_members_phone_active'                   then 'A member with this phone number already exists'
    when 'idx_branches_code_active'                   then 'A branch with this code already exists'
    when 'idx_plans_name_active'                      then 'A plan with this name already exists'
    when 'chk_doctor_care_details_required'           then 'Details are required when the member is under doctor''s care'
    when 'chk_branches_name_not_blank'                then 'Branch name must not be blank'
    when 'chk_branches_code_not_blank'                then 'Branch code must not be blank'
    when 'chk_plans_name_not_blank'                   then 'Plan name must not be blank'
    when 'chk_plan_duration_required_when_membership' then 'A membership plan needs a duration'
    when 'chk_plan_max_members_only_for_membership'   then 'Only membership plans can have more than 1 member'
    else p_message
    end
  end
$$;

revoke all on function import_error_message(text, text, text) from public, anon, authenticated;
grant execute on function import_error_message(text, text, text) to service_role;

create or replace function import_workbook(
  p_caller_id       uuid,
  p_payload         jsonb,
  p_update_existing boolean,
  p_skip_invalid    boolean,
  p_dry_run         boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_update      boolean := coalesce(p_update_existing, false);
  v_skip        boolean := coalesce(p_skip_invalid, false);
  v_dry         boolean := coalesce(p_dry_run, false);

  v_results     jsonb   := '[]'::jsonb;   -- survives the rollback of the inner block (see header)
  v_has_error   boolean := false;
  v_committed   boolean := false;
  v_aborted     boolean := false;

  v_item        jsonb;
  v_it          jsonb;
  v_row         integer;
  v_outcome     text;
  v_warning     text;
  v_constraint  text;
  v_column      text;
  v_count       integer;

  v_id          bigint;
  v_name        text;
  v_code        text;
  v_old_name    text;
  v_category    text;
  v_duration    integer;
  v_price       numeric;
  v_max_members integer;
  v_plan        plans;

  v_phone       text;
  v_branch_code text;
  v_branch_id   bigint;
  v_email       text;
  v_handled_by  uuid;
  v_old         members;
  v_new         members;

  v_member_id   bigint;
  v_item_member bigint;
  v_shared      bigint;
  v_qty         integer;
  v_start       date;
  v_end         date;
  v_amount      numeric;
  v_items_json  jsonb;
  v_membership  integer;
  v_exists      boolean;
  v_created     jsonb;
begin
  -- Defence in depth: the Edge Function already checked, but this RPC must never trust its caller blindly.
  if not is_admin_user(p_caller_id) then
    raise exception 'Admin access required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The import payload must be a JSON object';
  end if;

  begin  -- the unit that is rolled back on abort / dry run
    -- Same attribution trick as replace_user_roles / create_subscription_with_items: under the service role
    -- auth.uid() is NULL, so set_audit_fields() would otherwise record nobody.
    perform set_config('request.jwt.claim.sub', p_caller_id::text, true);

    -------------------------------------------------------------------- 1. branches (key: code)
    for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'branches', '[]'::jsonb)) loop
      v_row := (v_item ->> 'row')::integer;
      begin
        v_code := nullif(btrim(v_item ->> 'code'), '');
        v_name := nullif(btrim(v_item ->> 'name'), '');

        select b.id, b.name into v_id, v_old_name
        from branches b where b.code = v_code and b.deleted_at is null;

        if found then
          if not v_update then
            v_outcome := 'skipped_exists';
          elsif v_name is not null and v_name is distinct from v_old_name then
            update branches set name = v_name where id = v_id;
            v_outcome := 'updated';
          else
            v_outcome := 'unchanged';
          end if;
        else
          insert into branches (name, code) values (v_name, v_code) returning id into v_id;
          v_outcome := 'created';
        end if;
        v_results := v_results || jsonb_build_object('sheet', 'branches', 'row', v_row, 'outcome', v_outcome, 'id', v_id);
      exception when others then
        get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
        v_results := v_results || jsonb_build_object('sheet', 'branches', 'row', v_row, 'outcome', 'error',
                                                     'message', import_error_message(sqlerrm, v_constraint, v_column));
        v_has_error := true;
      end;
    end loop;

    -------------------------------------------------------------------- 2. plans (key: name)
    for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'plans', '[]'::jsonb)) loop
      v_row := (v_item ->> 'row')::integer;
      begin
        v_name        := nullif(btrim(v_item ->> 'name'), '');
        v_category    := nullif(btrim(v_item ->> 'category'), '');
        v_duration    := (v_item ->> 'duration_days')::integer;
        v_price       := (v_item ->> 'price')::numeric;
        v_max_members := (v_item ->> 'max_members')::integer;

        select p.* into v_plan from plans p where p.name = v_name and p.deleted_at is null;

        if found then
          if not v_update then
            v_outcome := 'skipped_exists';
          elsif v_category is not null and v_category <> v_plan.category then
            raise exception 'Plan "%" already exists as a % item — its category cannot be changed', v_name, v_plan.category;
          else
            -- Never touches category; a blank value leaves the stored one alone.
            update plans
            set duration_days = coalesce(v_duration, duration_days),
                price         = coalesce(v_price, price),
                max_members   = coalesce(v_max_members, max_members)
            where id = v_plan.id
              and (duration_days is distinct from coalesce(v_duration, duration_days)
                or price         is distinct from coalesce(v_price, price)
                or max_members   is distinct from coalesce(v_max_members, max_members));
            get diagnostics v_count = row_count;
            v_outcome := case when v_count > 0 then 'updated' else 'unchanged' end;
          end if;
          v_id := v_plan.id;
        else
          insert into plans (name, category, duration_days, price, max_members)
          values (v_name, v_category, v_duration, v_price, coalesce(v_max_members, 1))
          returning id into v_id;
          v_outcome := 'created';
        end if;
        v_results := v_results || jsonb_build_object('sheet', 'plans', 'row', v_row, 'outcome', v_outcome, 'id', v_id);
      exception when others then
        get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
        v_results := v_results || jsonb_build_object('sheet', 'plans', 'row', v_row, 'outcome', 'error',
                                                     'message', import_error_message(sqlerrm, v_constraint, v_column));
        v_has_error := true;
      end;
    end loop;

    -------------------------------------------------------------------- 3. members (key: phone)
    for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'members', '[]'::jsonb)) loop
      v_row := (v_item ->> 'row')::integer;
      begin
        v_warning     := null;
        v_phone       := nullif(btrim(v_item ->> 'phone'), '');
        v_branch_code := nullif(btrim(v_item ->> 'branch_code'), '');
        v_email       := nullif(btrim(v_item ->> 'handled_by_email'), '');

        -- Staff handling the member: resolved by login email to a live, active profile. An unknown email is a
        -- warning, not an error — the member is still imported, with the field left empty.
        v_handled_by := null;
        if v_email is not null then
          select p.id into v_handled_by
          from profiles p join auth.users u on u.id = p.id
          where lower(u.email) = lower(v_email) and p.is_active and p.deleted_at is null;
          if v_handled_by is null then
            v_warning := format('handled_by_email "%s" is not an active user — left blank', v_email);
          end if;
        end if;

        select m.* into v_old from members m where m.phone = v_phone and m.deleted_at is null;

        if found then
          if not v_update then
            v_outcome := 'skipped_exists';
          else
            -- Only non-blank cells are applied; member_number, branch_id, photos and the phone itself are never
            -- touched (the generate_member_number trigger pins the first two regardless).
            v_new := v_old;
            v_new.name                           := coalesce(nullif(btrim(v_item ->> 'name'), ''), v_old.name);
            v_new.date_of_birth                  := coalesce((nullif(btrim(v_item ->> 'date_of_birth'), ''))::date, v_old.date_of_birth);
            v_new.date_of_joining                := coalesce((nullif(btrim(v_item ->> 'date_of_joining'), ''))::date, v_old.date_of_joining);
            v_new.gender                         := coalesce(nullif(btrim(v_item ->> 'gender'), ''), v_old.gender);
            v_new.weight_kg                      := coalesce((v_item ->> 'weight_kg')::numeric, v_old.weight_kg);
            v_new.height_cm                      := coalesce((v_item ->> 'height_cm')::numeric, v_old.height_cm);
            v_new.under_doctor_care              := coalesce((v_item ->> 'under_doctor_care')::boolean, v_old.under_doctor_care);
            v_new.doctor_care_details            := coalesce(nullif(btrim(v_item ->> 'doctor_care_details'), ''), v_old.doctor_care_details);
            v_new.emergency_contact_name         := coalesce(nullif(btrim(v_item ->> 'emergency_contact_name'), ''), v_old.emergency_contact_name);
            v_new.emergency_contact_phone        := coalesce(nullif(btrim(v_item ->> 'emergency_contact_phone'), ''), v_old.emergency_contact_phone);
            v_new.emergency_contact_relationship := coalesce(nullif(btrim(v_item ->> 'emergency_contact_relationship'), ''), v_old.emergency_contact_relationship);
            v_new.email                          := coalesce(nullif(btrim(v_item ->> 'email'), ''), v_old.email);
            v_new.residential_address            := coalesce(nullif(btrim(v_item ->> 'residential_address'), ''), v_old.residential_address);
            v_new.pincode                        := coalesce(nullif(btrim(v_item ->> 'pincode'), ''), v_old.pincode);
            v_new.aadhaar_number                 := coalesce(nullif(btrim(v_item ->> 'aadhaar_number'), ''), v_old.aadhaar_number);
            v_new.occupation                     := coalesce(nullif(btrim(v_item ->> 'occupation'), ''), v_old.occupation);
            v_new.handled_by_staff               := coalesce(v_handled_by, v_old.handled_by_staff);

            if v_new is not distinct from v_old then
              v_outcome := 'unchanged';
            else
              update members set
                name = v_new.name, date_of_birth = v_new.date_of_birth, date_of_joining = v_new.date_of_joining,
                gender = v_new.gender, weight_kg = v_new.weight_kg, height_cm = v_new.height_cm,
                under_doctor_care = v_new.under_doctor_care, doctor_care_details = v_new.doctor_care_details,
                emergency_contact_name = v_new.emergency_contact_name,
                emergency_contact_phone = v_new.emergency_contact_phone,
                emergency_contact_relationship = v_new.emergency_contact_relationship,
                email = v_new.email, residential_address = v_new.residential_address, pincode = v_new.pincode,
                aadhaar_number = v_new.aadhaar_number, occupation = v_new.occupation,
                handled_by_staff = v_new.handled_by_staff
              where id = v_old.id;
              v_outcome := 'updated';
            end if;
          end if;
          v_id := v_old.id;
        else
          if v_branch_code is null then
            raise exception 'Branch is required';
          end if;
          select b.id into v_branch_id from branches b where b.code = v_branch_code and b.deleted_at is null;
          if v_branch_id is null then
            raise exception 'Branch "%" not found', v_branch_code;
          end if;

          -- member_number is NOT supplied: generate_member_number() always creates it.
          insert into members (
            name, phone, date_of_birth, date_of_joining, gender, weight_kg, height_cm,
            under_doctor_care, doctor_care_details,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
            email, residential_address, pincode, aadhaar_number, occupation, branch_id, handled_by_staff
          ) values (
            nullif(btrim(v_item ->> 'name'), ''), v_phone,
            (nullif(btrim(v_item ->> 'date_of_birth'), ''))::date,
            coalesce((nullif(btrim(v_item ->> 'date_of_joining'), ''))::date, current_date),
            nullif(btrim(v_item ->> 'gender'), ''),
            (v_item ->> 'weight_kg')::numeric, (v_item ->> 'height_cm')::numeric,
            coalesce((v_item ->> 'under_doctor_care')::boolean, false),
            nullif(btrim(v_item ->> 'doctor_care_details'), ''),
            nullif(btrim(v_item ->> 'emergency_contact_name'), ''),
            nullif(btrim(v_item ->> 'emergency_contact_phone'), ''),
            nullif(btrim(v_item ->> 'emergency_contact_relationship'), ''),
            nullif(btrim(v_item ->> 'email'), ''), nullif(btrim(v_item ->> 'residential_address'), ''),
            nullif(btrim(v_item ->> 'pincode'), ''), nullif(btrim(v_item ->> 'aadhaar_number'), ''),
            nullif(btrim(v_item ->> 'occupation'), ''), v_branch_id, v_handled_by
          ) returning id into v_id;
          v_outcome := 'created';
        end if;

        v_results := v_results || jsonb_strip_nulls(jsonb_build_object(
          'sheet', 'members', 'row', v_row, 'outcome', v_outcome, 'id', v_id, 'warning', v_warning));
      exception when others then
        get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
        v_results := v_results || jsonb_build_object('sheet', 'members', 'row', v_row, 'outcome', 'error',
                                                     'message', import_error_message(sqlerrm, v_constraint, v_column));
        v_has_error := true;
      end;
    end loop;

    -------------------------------------------------------------------- 4. subscriptions (+ items)
    -- A subscription is an immutable header + line items, so it is created whole or skipped whole. It already
    -- exists when ANY of its items matches (member, plan, start_date) among live items.
    for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'subscriptions', '[]'::jsonb)) loop
      v_row := (v_item ->> 'row')::integer;
      begin
        v_phone := nullif(btrim(v_item ->> 'member_phone'), '');
        select m.id into v_member_id from members m where m.phone = v_phone and m.deleted_at is null;
        if v_member_id is null then
          raise exception 'Member with phone % not found', v_phone;
        end if;

        v_items_json := '[]'::jsonb;
        v_membership := 0;
        v_exists     := false;

        for v_it in select value from jsonb_array_elements(coalesce(v_item -> 'items', '[]'::jsonb)) loop
          select p.* into v_plan from plans p
          where p.name = nullif(btrim(v_it ->> 'plan_name'), '') and p.deleted_at is null;
          if not found then
            raise exception 'Plan "%" not found', v_it ->> 'plan_name';
          end if;

          v_phone := nullif(btrim(v_it ->> 'member_phone'), '');
          select m.id into v_item_member from members m where m.phone = v_phone and m.deleted_at is null;
          if v_item_member is null then
            raise exception 'Member with phone % not found', v_phone;
          end if;

          v_shared := null;
          v_phone  := nullif(btrim(v_it ->> 'shared_member_phone'), '');
          if v_phone is not null then
            select m.id into v_shared from members m where m.phone = v_phone and m.deleted_at is null;
            if v_shared is null then
              raise exception 'Shared member with phone % not found', v_phone;
            end if;
            if v_plan.category <> 'membership' or v_plan.max_members <> 2 then
              raise exception 'Plan "%" does not allow a shared member', v_plan.name;
            end if;
            if v_shared = v_item_member then
              raise exception 'A shared member cannot be the same person as the member';
            end if;
          end if;

          v_qty := coalesce((v_it ->> 'quantity')::integer, 1);
          if v_qty < 1 then
            raise exception 'Quantity for plan "%" must be at least 1', v_plan.name;
          end if;
          if v_plan.duration_days is null and v_qty <> 1 then
            raise exception 'Plan "%" is indefinite and does not accept a quantity', v_plan.name;
          end if;

          v_start  := (v_it ->> 'start_date')::date;
          -- end_date is ALWAYS recomputed here, never read from the file (same formula as create-subscription).
          v_end    := case when v_plan.duration_days is null then null
                           else v_start + (v_plan.duration_days * v_qty - 1) end;
          v_amount := coalesce((v_it ->> 'amount_paid')::numeric, v_plan.price * v_qty);

          if v_plan.category = 'membership' then v_membership := v_membership + 1; end if;
          if exists (
            select 1 from subscription_items si
            where si.member_id = v_item_member and si.plan_id = v_plan.id
              and si.start_date = v_start and si.deleted_at is null
          ) then
            v_exists := true;
          end if;

          v_items_json := v_items_json || jsonb_build_object(
            'plan_id', v_plan.id, 'member_id', v_item_member, 'shared_member_id', v_shared,
            'start_date', v_start, 'end_date', v_end, 'quantity', v_qty, 'amount_paid', v_amount);
        end loop;

        if jsonb_array_length(v_items_json) = 0 then
          raise exception 'A subscription needs at least one item';
        end if;
        if v_membership <> 1 then
          raise exception 'A subscription needs exactly one membership item (found %)', v_membership;
        end if;

        if v_exists then
          v_outcome := 'skipped_exists';
          v_id := null;
        else
          -- The existing atomic write: header + every item together, plus the REQ-SUB-007 indefinite-plan block.
          v_created := create_subscription_with_items(
            p_caller_id, v_member_id, coalesce(nullif(btrim(v_item ->> 'payment_mode'), ''), 'Cash'),
            nullif(btrim(v_item ->> 'notes'), ''), v_items_json);
          v_id := (v_created -> 'subscription' ->> 'id')::bigint;
          v_outcome := 'created';
        end if;
        v_results := v_results || jsonb_strip_nulls(jsonb_build_object(
          'sheet', 'subscriptions', 'row', v_row, 'outcome', v_outcome, 'id', v_id));
      exception when others then
        get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
        v_results := v_results || jsonb_build_object('sheet', 'subscriptions', 'row', v_row, 'outcome', 'error',
                                                     'message', import_error_message(sqlerrm, v_constraint, v_column));
        v_has_error := true;
      end;
    end loop;

    -------------------------------------------------------------------- finish
    if v_has_error and not v_skip then
      raise exception using errcode = 'P0A01', message = 'import_aborted';   -- all-or-nothing
    end if;
    if v_dry then
      raise exception using errcode = 'P0A02', message = 'import_dry_run';   -- preview: real work, then undo it
    end if;
    v_committed := true;
  exception
    when sqlstate 'P0A01' then v_aborted := true;
    when sqlstate 'P0A02' then null;
  end;

  return jsonb_build_object('committed', v_committed, 'aborted', v_aborted, 'dry_run', v_dry, 'rows', v_results);
end;
$$;

revoke all on function import_workbook(uuid, jsonb, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function import_workbook(uuid, jsonb, boolean, boolean, boolean) to service_role;
