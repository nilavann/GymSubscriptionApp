/**
 * Reads a FunctionsHttpError's JSON body (the `{ error: message }` shape every Edge
 * Function in this app returns) so failures surface a real message, not supabase-js's
 * generic "non-2xx status code" one. Shared by every repository that calls an Edge
 * Function — see repositories/subscription.repository.ts for the first place this
 * pattern was needed.
 *
 * A request that never reached the server (offline, dropped connection) is a
 * `FunctionsFetchError` whose message is "Failed to send a request to the Edge Function".
 * Pages recognise being offline by the browser's own `fetch` message, "Failed to fetch" —
 * which is what a direct supabase-js query reports — so it is normalised to that here;
 * otherwise an offline checkout would show the SDK's wording instead of the offline UI.
 */
export async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  if ((error as { name?: unknown } | null)?.name === 'FunctionsFetchError') return 'Failed to fetch';
  const maybeContext = (error as { context?: Response }).context;
  if (maybeContext && typeof maybeContext.json === 'function') {
    try {
      const body = await maybeContext.json();
      if (body && typeof body.error === 'string') return body.error;
    } catch {
      // Body wasn't JSON — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}
