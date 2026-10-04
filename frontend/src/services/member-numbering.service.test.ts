import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberNumberingRepository } from '../repositories/member-numbering.repository';

const mocks = vi.hoisted(() => ({ updateConfig: vi.fn() }));
vi.mock('../repositories/member-numbering.repository', () => ({
  memberNumberingRepository: { updateConfig: mocks.updateConfig } satisfies Partial<MemberNumberingRepository>,
}));

import {
  configToDraft,
  isConfigValid,
  memberNumberingService,
  validateConfig,
  validateNextSequenceInput,
} from './member-numbering.service';

beforeEach(() => {
  mocks.updateConfig.mockReset();
});

describe('configToDraft', () => {
  it('stringifies each field for the form', () => {
    expect(configToDraft({ start_sequence: 1, increment: 1, padding_width: 4 })).toEqual({
      start_sequence: '1',
      increment: '1',
      padding_width: '4',
    });
  });
});

describe('validateConfig', () => {
  const valid = { start_sequence: '1', increment: '1', padding_width: '4' };

  it('accepts whole numbers in range', () => {
    const errors = validateConfig(valid);
    expect(errors).toEqual({});
    expect(isConfigValid(errors)).toBe(true);
  });

  it.each([
    ['zero start', { start_sequence: '0' }, 'start_sequence'],
    ['decimal start', { start_sequence: '1.5' }, 'start_sequence'],
    ['text start', { start_sequence: 'abc' }, 'start_sequence'],
    ['empty increment', { increment: '' }, 'increment'],
    ['zero increment', { increment: '0' }, 'increment'],
    ['zero padding', { padding_width: '0' }, 'padding_width'],
    ['padding over 10', { padding_width: '11' }, 'padding_width'],
  ])('rejects %s', (_label, patch, field) => {
    expect(Object.keys(validateConfig({ ...valid, ...patch }))).toEqual([field]);
  });

  it('accepts the padding boundaries 1 and 10', () => {
    expect(validateConfig({ ...valid, padding_width: '1' })).toEqual({});
    expect(validateConfig({ ...valid, padding_width: '10' })).toEqual({});
  });
});

describe('validateNextSequenceInput', () => {
  it('parses a positive whole number', () => {
    expect(validateNextSequenceInput(' 42 ')).toEqual({ value: 42, error: null });
  });

  it.each(['0', '-3', '1.5', '', 'x'])('rejects "%s"', (input) => {
    expect(validateNextSequenceInput(input)).toEqual({ value: null, error: 'Enter a whole number, at least 1' });
  });
});

describe('memberNumberingService.updateConfig', () => {
  it('sends numbers, not the string form state', async () => {
    mocks.updateConfig.mockResolvedValue(undefined);
    await memberNumberingService.updateConfig({ start_sequence: '100', increment: '5', padding_width: '6' });
    expect(mocks.updateConfig).toHaveBeenCalledWith({ start_sequence: 100, increment: 5, padding_width: 6 });
  });
});
