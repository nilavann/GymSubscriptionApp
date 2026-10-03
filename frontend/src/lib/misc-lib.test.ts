import { describe, expect, it, vi } from 'vitest';
import { getAvatarColor, getInitials } from './avatar';
import { extractFunctionErrorMessage } from './edge-function-error';
import { withTimeout } from './with-timeout';

describe('avatar', () => {
  it('initials: first+last for multi-word, first two letters for one word, ? for empty', () => {
    expect(getInitials('Arjun Kumar')).toBe('AK');
    expect(getInitials('  maria  del  carmen ')).toBe('MC');
    expect(getInitials('Priya')).toBe('PR');
    expect(getInitials('   ')).toBe('?');
  });
  it('colour is deterministic per id and always from the palette', () => {
    expect(getAvatarColor(7)).toBe(getAvatarColor(7));
    expect(getAvatarColor(1)).toMatch(/^var\(--color-data-\d\)$/);
    expect(getAvatarColor(0)).toBe(getAvatarColor(6));
  });
});

describe('extractFunctionErrorMessage (surfaces the Edge Function guard messages verbatim)', () => {
  it('reads { error } from the response body', async () => {
    const err = { context: { json: async () => ({ error: 'Cannot delete — used by 2 subscription/add-on record(s)' }) } };
    expect(await extractFunctionErrorMessage(err)).toBe('Cannot delete — used by 2 subscription/add-on record(s)');
  });
  it('falls back to the Error message when the body is not JSON', async () => {
    const err = Object.assign(new Error('boom'), { context: { json: async () => { throw new Error('nope'); } } });
    expect(await extractFunctionErrorMessage(err)).toBe('boom');
  });
  it('falls back to a generic message for unknown values', async () => {
    expect(await extractFunctionErrorMessage('weird')).toBe('Unexpected error');
  });
  it('ignores a JSON body without a string error field', async () => {
    const err = Object.assign(new Error('generic'), { context: { json: async () => ({ error: 5 }) } });
    expect(await extractFunctionErrorMessage(err)).toBe('generic');
  });
});

describe('withTimeout', () => {
  it('resolves with the value when fast enough', async () => {
    await expect(withTimeout(Promise.resolve(1), 50, new Error('t'))).resolves.toBe(1);
  });
  it('rejects with the supplied error when the promise hangs', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000, new Error('slow'));
    const assertion = expect(p).rejects.toThrow('slow');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
  it('propagates the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('orig')), 50, new Error('t'))).rejects.toThrow('orig');
  });
});
