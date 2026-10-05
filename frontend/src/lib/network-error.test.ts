import { describe, expect, it } from 'vitest';
import { isNetworkError } from './network-error';

describe('isNetworkError', () => {
  it.each([
    ['Chrome / Edge', 'Failed to fetch'],
    ['Safari (every iPhone)', 'Load failed'],
    ['Firefox', 'NetworkError when attempting to fetch resource.'],
    ['supabase-js on a failed read, name-prefixed', 'TypeError: Failed to fetch'],
    ['supabase-js on a failed read in Safari', 'TypeError: Load failed'],
  ])('recognises %s', (_browser, message) => {
    expect(isNetworkError(new Error(message))).toBe(true);
    expect(isNetworkError(message)).toBe(true); // screens often pass the extracted message
  });

  it.each([
    'duplicate key value violates unique constraint "members_phone_key"',
    'Cannot delete — used by 4 subscription record(s)',
    'plans-timeout',
    'JWT expired',
    'Failed to fetch the plan', // mentions fetching, but is not the network failure
    'Unexpected Load failed handler', // contains the phrase, is not it
    '',
  ])('does not mistake the server answering (%s) for being offline', (message) => {
    expect(isNetworkError(new Error(message))).toBe(false);
    expect(isNetworkError(message)).toBe(false);
  });

  it('is false for anything that is not an error or a message', () => {
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError({ message: 'Failed to fetch' })).toBe(false); // a plain object is not an Error
    expect(isNetworkError(42)).toBe(false);
  });
});
