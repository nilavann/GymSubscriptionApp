import { describe, expect, it } from 'vitest';
import { getAvatarColor, getInitials } from './avatar';

describe('getInitials', () => {
  it('uses the first letter of the first and last word', () => {
    expect(getInitials('Priya Sharma')).toBe('PS');
    expect(getInitials('Priya Kumari Sharma')).toBe('PS');
  });

  it('uses the first two letters of a single word', () => {
    expect(getInitials('priya')).toBe('PR');
  });

  it('collapses extra whitespace', () => {
    expect(getInitials('  Priya    Sharma ')).toBe('PS');
  });

  it('falls back to "?" for an empty name', () => {
    expect(getInitials('   ')).toBe('?');
  });
});

describe('getAvatarColor', () => {
  it('is deterministic for a given id', () => {
    expect(getAvatarColor(7)).toBe(getAvatarColor(7));
  });

  it('cycles through the six categorical data tokens by id', () => {
    expect(getAvatarColor(0)).toBe('var(--color-data-1)');
    expect(getAvatarColor(5)).toBe('var(--color-data-6)');
    expect(getAvatarColor(6)).toBe('var(--color-data-1)');
  });

  it('only ever returns a CSS variable, never a raw hex (rule 14)', () => {
    for (let id = 0; id < 20; id++) expect(getAvatarColor(id)).toMatch(/^var\(--color-data-\d\)$/);
  });
});
