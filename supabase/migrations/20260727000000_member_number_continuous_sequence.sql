-- Changes member-number generation from "resets to 0001 every calendar year, per branch"
-- to "increments continuously per branch, never resets" - a deliberate correction to
-- REQ-MEM-005's original wording (requirements-template.md updated to match). The
-- member_number STRING still embeds the year a member actually registered in (e.g.
-- MUM-2025-0042, MUM-2026-0043) - only the counter itself no longer restarts at
-- member_number_start_sequence just because the calendar rolled over.
--
-- member_number_sequences was keyed by (branch_id, year); it's now keyed by branch_id
-- alone, since there's only ever one counter per branch now, not one per branch per year.

-- 1. Consolidate existing rows to one per branch, keeping the highest last_sequence any
-- year reached - the continuous counter should pick up from a branch's true high-water
-- mark, not restart from whichever year happens to survive the dedupe.
delete from member_number_sequences a
using member_number_sequences b
where a.branch_id = b.branch_id
  and a.last_sequence < b.last_sequence;

-- Two different years could theoretically have reached the exact same last_sequence
-- value for a branch (both survive the delete above, since neither is strictly less than
-- the other) - break the remaining tie by physical row order, arbitrarily but safely
-- (the values are equal, so which one survives doesn't matter).
delete from member_number_sequences a
using member_number_sequences b
where a.branch_id = b.branch_id
  and a.ctid < b.ctid;

-- 2. Drop `year` from the key entirely.
alter table member_number_sequences drop constraint member_number_sequences_pkey;
alter table member_number_sequences drop column year;
alter table member_number_sequences add primary key (branch_id);

-- These two keys' seed descriptions (20260720000000_master_data.sql) said "per branch per
-- year" - no longer accurate now that the counter never resets. Fixed via UPDATE rather
-- than editing that already-applied migration (never edit a past migration in this repo -
-- add a new one instead).
update configuration set description = 'First sequence number issued to a branch, the first time that branch is ever used.'
where key = 'member_number_start_sequence';
update configuration set description = 'Step size between consecutive member numbers within a branch. The counter never resets.'
where key = 'member_number_increment';

-- 3. generate_member_number(): key the upsert by branch_id alone. v_year is still
-- computed and still embedded in the formatted member_number string - only the ON
-- CONFLICT target changes, from (branch_id, year) to branch_id, so the counter is no
-- longer reset by a year boundary.
create or replace function generate_member_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_code text;
  v_year        integer := extract(year from now())::integer;
  v_start       integer;
  v_increment   integer;
  v_width       integer;
  v_sequence    integer;
begin
  if tg_op = 'UPDATE' then
    new.member_number := old.member_number;
    new.branch_id      := old.branch_id;
    return new;
  end if;

  select code into v_branch_code from branches where id = new.branch_id and deleted_at is null;
  if v_branch_code is null then
    raise exception 'branch_id % does not reference an active branch', new.branch_id;
  end if;

  select value::integer into v_start     from configuration where key = 'member_number_start_sequence';
  select value::integer into v_increment from configuration where key = 'member_number_increment';
  select value::integer into v_width     from configuration where key = 'member_number_padding_width';

  insert into member_number_sequences (branch_id, last_sequence)
  values (new.branch_id, v_start)
  on conflict (branch_id)
  do update set last_sequence = member_number_sequences.last_sequence + v_increment
  returning last_sequence into v_sequence;

  new.member_number := v_branch_code || '-' || v_year || '-' || lpad(v_sequence::text, v_width, '0');
  return new;
end;
$$;
