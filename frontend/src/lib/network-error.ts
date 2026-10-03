/**
 * True when a request never got an answer — the device is offline or the connection dropped — as opposed
 * to the server answering with an error. Screens use it to say "check your connection" (and offer Retry)
 * instead of a generic failure.
 *
 * The wording is the browser's, and differs: Chrome says "Failed to fetch", Safari (every iPhone) says
 * "Load failed", Firefox "NetworkError when attempting to fetch resource." supabase-js also prefixes the
 * error name on a failed read ("TypeError: Failed to fetch"), so an exact match on one string misses most
 * real cases. Takes an Error or the message string a screen already extracted from one.
 */
const NETWORK_FAILURE = /^(?:\w+: )?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/;

export function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return NETWORK_FAILURE.test(message);
}
