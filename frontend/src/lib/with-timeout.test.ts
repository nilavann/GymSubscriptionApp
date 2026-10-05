import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the promise value when it settles first, and leaves no timer behind', async () => {
    const result = withTimeout(Promise.resolve('ok'), 1000, new Error('timeout'));
    await expect(result).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the caller's error when the promise hangs past the limit", async () => {
    const hung = new Promise<string>(() => undefined);
    const timeoutError = new Error('Request timed out');
    const result = withTimeout(hung, 1000, timeoutError);
    const assertion = expect(result).rejects.toBe(timeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("propagates the promise's own rejection instead of the timeout", async () => {
    const failure = new Error('boom');
    const result = withTimeout(Promise.reject(failure), 1000, new Error('timeout'));
    await expect(result).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
