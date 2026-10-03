/** The fake Supabase project the E2E build is compiled against. Nothing ever listens here —
 *  every request is fulfilled by the route handlers in supabase-mock.ts. */
export const SUPABASE_URL = 'https://e2e.supabase.co';
export const SUPABASE_ANON_KEY = 'e2e-anon-key';

/** supabase-js stores the session under `sb-<first label of the project host>-auth-token`. */
export const SESSION_STORAGE_KEY = 'sb-e2e-auth-token';
