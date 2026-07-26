import { memberNumberingRepository } from '../repositories/member-numbering.repository';
import type { MemberNumberConfig } from '../types/member-numbering';

/**
 * The Global Settings form's working state — string fields while editing, same reasoning
 * as plan.service.ts's `price: string` (a controlled `type="number"` input eats a trailing
 * digit/decimal on every keystroke if the state itself is a number).
 */
export interface ConfigDraft {
  start_sequence: string;
  increment: string;
  padding_width: string;
}

export function configToDraft(config: MemberNumberConfig): ConfigDraft {
  return {
    start_sequence: String(config.start_sequence),
    increment: String(config.increment),
    padding_width: String(config.padding_width),
  };
}

export type ConfigFormErrors = Partial<Record<keyof ConfigDraft, string>>;

function parseWholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

export function validateConfig(form: ConfigDraft): ConfigFormErrors {
  const errors: ConfigFormErrors = {};
  const start = parseWholeNumber(form.start_sequence);
  if (start === null || start < 1) errors.start_sequence = 'Enter a whole number, at least 1';

  const increment = parseWholeNumber(form.increment);
  if (increment === null || increment < 1) errors.increment = 'Enter a whole number, at least 1';

  const width = parseWholeNumber(form.padding_width);
  if (width === null || width < 1 || width > 10) errors.padding_width = 'Enter a whole number from 1 to 10';

  return errors;
}

export function isConfigValid(errors: ConfigFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

function draftToConfig(form: ConfigDraft): MemberNumberConfig {
  return {
    start_sequence: parseWholeNumber(form.start_sequence)!,
    increment: parseWholeNumber(form.increment)!,
    padding_width: parseWholeNumber(form.padding_width)!,
  };
}

/** Client-side pre-check only, mirroring the Edge Function's own `next_sequence >= 1` rule —
 * the collision skip-forward itself can only happen server-side (needs to query `members`). */
export function validateNextSequenceInput(value: string): { value: number | null; error: string | null } {
  const parsed = parseWholeNumber(value);
  if (parsed === null || parsed < 1) return { value: null, error: 'Enter a whole number, at least 1' };
  return { value: parsed, error: null };
}

export const memberNumberingService = {
  configToDraft,
  validateConfig,
  isConfigValid,
  validateNextSequenceInput,

  async updateConfig(form: ConfigDraft): Promise<void> {
    return memberNumberingRepository.updateConfig(draftToConfig(form));
  },
};

export type MemberNumberingService = typeof memberNumberingService;
