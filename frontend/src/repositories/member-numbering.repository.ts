import { supabase } from '../lib/supabase-client';
import { extractFunctionErrorMessage } from '../lib/edge-function-error';
import type { Branch } from '../types/branch';
import type { MemberNumberConfig, BranchSequence, UpdateSequenceResult } from '../types/member-numbering';

const CONFIG_KEYS = ['member_number_start_sequence', 'member_number_increment', 'member_number_padding_width'] as const;

interface ConfigRow {
  key: string;
  value: string;
}

interface SequenceRow {
  branch_id: number;
  last_sequence: number;
}

/**
 * Backs the Member Numbering settings screen (spec/backend/member-management.md §3.1).
 * Global config (`configuration`) is a direct RLS-guarded read/write, same as Plan/Branch —
 * admin-only `select`/`update` policies already exist. Per-branch sequences are read
 * directly too (`member_number_sequences_select_admin`), but writing one goes through the
 * `update-member-number-sequence` Edge Function — a raw client update can't safely do the
 * collision-skip-forward check against `members`.
 */
export const memberNumberingRepository = {
  async getConfig(): Promise<MemberNumberConfig> {
    const { data, error } = await supabase.from('configuration').select('key, value').in('key', CONFIG_KEYS);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ConfigRow[];
    const valueOf = (key: string, fallback: number) => {
      const row = rows.find((r) => r.key === key);
      const parsed = row ? Number.parseInt(row.value, 10) : NaN;
      return Number.isInteger(parsed) ? parsed : fallback;
    };
    return {
      start_sequence: valueOf('member_number_start_sequence', 1),
      increment: valueOf('member_number_increment', 1),
      padding_width: valueOf('member_number_padding_width', 4),
    };
  },

  /**
   * Atomic — all three configuration rows update together in one server-side transaction
   * (`update_member_number_config`), not three independent client-side `.update()` calls.
   * Three separate statements could partially succeed on a mid-batch failure, leaving the
   * DB in a mixed old/new state the UI had no way to detect (spec/crud-review.md).
   */
  async updateConfig(config: MemberNumberConfig): Promise<void> {
    const { error } = await supabase.rpc('update_member_number_config', {
      p_start_sequence: config.start_sequence,
      p_increment: config.increment,
      p_padding_width: config.padding_width,
    });
    if (error) throw new Error(error.message);
  },

  /** Every active branch's counter — one row per branch, since the counter never resets
   * per year (a branch that's never had a member registered shows `last_sequence: null`). */
  async getSequences(config: MemberNumberConfig): Promise<BranchSequence[]> {
    const [branchesResult, sequencesResult] = await Promise.all([
      supabase.from('branches').select('id, name, code').order('name'),
      supabase.from('member_number_sequences').select('branch_id, last_sequence'),
    ]);
    if (branchesResult.error) throw branchesResult.error;
    if (sequencesResult.error) throw sequencesResult.error;

    const branches = (branchesResult.data ?? []) as unknown as Branch[];
    const sequenceByBranch = new Map(((sequencesResult.data ?? []) as SequenceRow[]).map((s) => [s.branch_id, s.last_sequence]));

    return branches.map((branch) => {
      const lastSequence = sequenceByBranch.get(branch.id) ?? null;
      return {
        branch_id: branch.id,
        branch_name: branch.name,
        branch_code: branch.code,
        last_sequence: lastSequence,
        next_sequence: lastSequence === null ? config.start_sequence : lastSequence + config.increment,
      };
    });
  },

  async updateSequence(branchId: number, nextSequence: number): Promise<UpdateSequenceResult> {
    const { data, error } = await supabase.functions.invoke('update-member-number-sequence', {
      body: { branch_id: branchId, next_sequence: nextSequence },
    });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
    return data as UpdateSequenceResult;
  },
};

export type MemberNumberingRepository = typeof memberNumberingRepository;
