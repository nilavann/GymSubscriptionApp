import { describe, expect, it } from 'vitest';
import { sanitizeDecimal, sanitizeDigits } from './input-masks';

describe('sanitizeDigits', () => {
  it('strips every non-digit', () => {
    expect(sanitizeDigits('98a76-54 32', 10)).toBe('98765432');
  });

  it('caps the length, which maxLength alone does not do for pasted text', () => {
    expect(sanitizeDigits('98765432109876', 10)).toBe('9876543210');
  });

  it('returns an empty string for input with no digits', () => {
    expect(sanitizeDigits('abc', 10)).toBe('');
  });
});

describe('sanitizeDecimal', () => {
  it('keeps a trailing decimal point so "72.5" stays reachable while typing', () => {
    expect(sanitizeDecimal('72.', 1)).toBe('72.');
  });

  it('caps the fractional part', () => {
    expect(sanitizeDecimal('72.567', 1)).toBe('72.5');
    expect(sanitizeDecimal('72.567', 2)).toBe('72.56');
  });

  it('keeps only the first decimal point', () => {
    expect(sanitizeDecimal('7.2.5', 2)).toBe('7.25');
  });

  it('strips letters and symbols', () => {
    expect(sanitizeDecimal('7a2,5kg', 2)).toBe('725');
  });

  it('passes a plain integer through', () => {
    expect(sanitizeDecimal('175', 1)).toBe('175');
  });
});
