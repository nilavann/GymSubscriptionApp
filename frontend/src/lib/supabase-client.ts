import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy frontend/.env.example to frontend/.env.local and fill in your project values.'
  );
}

/** AuthContext listens for this to redirect to /login with a friendly message — see below. */
export const SESSION_EXPIRED_EVENT = 'supabase:session-expired';

/**
 * A 401 from REST/RPC/Storage/an Edge Function always means the caller's access token was
 * missing/invalid/expired — every Edge Function in this app checks it explicitly and returns
 * 401 for exactly that, and PostgREST itself only returns 401 for a bad JWT, never for an
 * RLS/permission rejection (those come back as 403 or an empty result). `/auth/v1/*` is
 * excluded — AuthContext's onAuthStateChange/getSession already own that lifecycle, and a
 * wrong-password sign-in returns 400, not 401, so there's no overlap to worry about.
 * Dispatched as a window event rather than importing AuthContext directly, to avoid a
 * fetch-layer -> React-context import cycle (supabase-client is a dependency of auth.context,
 * not the other way around).
 */
async function authAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (response.status === 401 && !url.includes('/auth/v1/')) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  return response;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: authAwareFetch },
});
