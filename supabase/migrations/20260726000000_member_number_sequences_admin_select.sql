-- Lets admin view current per-branch member-number counters (new Member Numbering settings
-- screen). member_number_sequences previously had zero RLS policies for any client role at
-- all (database.md: "no policies granted to any client role at all") - only
-- generate_member_number()'s security-definer trigger touched it. This adds read-only
-- admin access; writes still go exclusively through the new
-- update-member-number-sequence Edge Function (service role), not a direct client update,
-- since setting a new value safely requires the collision-skip-forward check against
-- `members` and an atomic upsert - not something to expose as a raw RLS-gated update.
--
-- The table's structure at this point is still (branch_id, year) -> last_sequence; the next
-- migration (20260727000000) restructures it to branch_id alone (a continuous per-branch
-- counter that never resets) - this policy itself is unaffected by that column change and
-- needs no update.
drop policy if exists "member_number_sequences_select_admin" on member_number_sequences;
create policy "member_number_sequences_select_admin" on member_number_sequences
  for select using (is_active_admin());
