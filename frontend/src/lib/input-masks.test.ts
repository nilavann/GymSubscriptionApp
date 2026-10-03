import { describe, expect, it } from 'vitest';
import { sanitizeDecimal, sanitizeDigits } from './input-masks';

describe('sanitizeDigits (phone entry)', () => {
  it('strips non-digits', () => expect(sanitizeDigits('98a-76 5', 10)).toBe('98765'));
  it('caps length', () => expect(sanitizeDigits('98765432109876', 10)).toBe('9876543210'));
  it('empty stays empty', () => expect(sanitizeDigits('', 10)).toBe(''));
  it('pasted +91 style prefix keeps digits only', () => expect(sanitizeDigits('+91 98765 43210', 12)).toBe('919876543210'));
});

describe('sanitizeDecimal (weight / height / price)', () => {
  it('keeps one decimal point', () => expect(sanitizeDecimal('7.2.5', 2)).toBe('7.25'));
  it('caps fractional digits', () => expect(sanitizeDecimal('72.555', 2)).toBe('72.55'));
  it('keeps a trailing dot while typing', () => expect(sanitizeDecimal('72.', 2)).toBe('72.'));
  it('drops letters and signs (no negatives)', () => expect(sanitizeDecimal('-7e2', 2)).toBe('72'));
  it('leading dot is preserved as typed', () => expect(sanitizeDecimal('.5', 2)).toBe('.5'));
  it('empty stays empty', () => expect(sanitizeDecimal('', 2)).toBe(''));
});
