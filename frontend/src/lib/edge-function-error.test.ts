import { describe, expect, it } from 'vitest';
import { extractFunctionErrorMessage } from './edge-function-error';

function httpError(message: string, body: unknown, jsonThrows = false) {
  const error = new Error(message) as Error & { context: { json: () => Promise<unknown> } };
  error.context = {
    json: () => (jsonThrows ? Promise.reject(new SyntaxError('not json')) : Promise.resolve(body)),
  };
  return error;
}

describe('extractFunctionErrorMessage', () => {
  it("returns the Edge Function's `{ error }` body message instead of supabase-js's generic one", async () => {
    const error = httpError('Edge Function returned a non-2xx status code', { error: 'Plan is in use' });
    await expect(extractFunctionErrorMessage(error)).resolves.toBe('Plan is in use');
  });

  it('falls back to the error message when the body has no string `error`', async () => {
    const error = httpError('generic failure', { message: 'something else' });
    await expect(extractFunctionErrorMessage(error)).resolves.toBe('generic failure');
  });

  it('falls back to the error message when the body is not JSON', async () => {
    const error = httpError('generic failure', null, true);
    await expect(extractFunctionErrorMessage(error)).resolves.toBe('generic failure');
  });

  it('reports a request that never reached the server as the browser\'s "Failed to fetch", which every page treats as offline', async () => {
    // supabase-js: `new FunctionsFetchError(originalError)` — name set explicitly, message is the SDK's own wording.
    const error = Object.assign(new Error('Failed to send a request to the Edge Function'), {
      name: 'FunctionsFetchError',
      context: new TypeError('Failed to fetch'),
    });
    await expect(extractFunctionErrorMessage(error)).resolves.toBe('Failed to fetch');
  });

  it('uses the message of a plain Error with no response context', async () => {
    await expect(extractFunctionErrorMessage(new Error('Network down'))).resolves.toBe('Network down');
  });

  it('returns a generic message for a non-Error value', async () => {
    await expect(extractFunctionErrorMessage('weird')).resolves.toBe('Unexpected error');
  });
});
