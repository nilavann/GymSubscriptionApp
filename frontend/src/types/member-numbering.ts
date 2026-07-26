/** The three global `configuration` keys generate_member_number() reads — see
 * spec/backend/member-management.md §3. Apply uniformly to every branch's counter. */
export interface MemberNumberConfig {
  start_sequence: number;
  increment: number;
  padding_width: number;
}

/**
 * One branch's member-number counter — one row per branch, full stop. The counter
 * increments continuously for the branch's entire lifetime and never resets at a
 * calendar-year boundary (REQ-MEM-005); only the *year embedded in the formatted string*
 * changes from one registration to the next, reflecting whenever that member actually
 * registered — it isn't a reset trigger. `last_sequence` is `null` when no member has
 * ever been registered at this branch yet (no row exists); `next_sequence` is what the
 * next registration will actually receive (computed client-side: `last_sequence +
 * increment`, or `start_sequence` when there's no row yet).
 */
export interface BranchSequence {
  branch_id: number;
  branch_name: string;
  branch_code: string;
  last_sequence: number | null;
  next_sequence: number;
}

/** Result of update-member-number-sequence — `adjusted` is true when the requested value
 * collided with an already-issued number (in any year) and the function skipped forward. */
export interface UpdateSequenceResult {
  next_sequence: number;
  requested: number;
  adjusted: boolean;
}
