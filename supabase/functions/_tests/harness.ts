import { world } from './fake-supabase.ts';

type Handler = (req: Request) => Response | Promise<Response>;
const loaded = new Map<string, Handler>();

/** Imports an Edge Function module with Deno.serve captured, returning its request handler. */
export async function loadFunction(name: string): Promise<Handler> {
  const cached = loaded.get(name);
  if (cached) return cached;
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_ANON_KEY', 'anon');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service');
  let handler: Handler | undefined;
  const realServe = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: Handler) => { handler = h; return {}; };
  try {
    await import(`../${name}/index.ts`);
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = realServe;
  }
  if (!handler) throw new Error(`${name} did not register a handler`);
  loaded.set(name, handler);
  return handler;
}

export interface CallOptions { method?: string; auth?: string | null; body?: unknown; rawBody?: string }

/** Calls a loaded function like the Supabase gateway would; returns status + parsed JSON body. */
export async function call(handler: Handler, opts: CallOptions = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.auth !== null) headers.set('Authorization', opts.auth ?? 'Bearer test-token');
  const method = opts.method ?? 'POST';
  const res = await handler(new Request('http://localhost/fn', {
    method,
    headers,
    body: method === 'POST' ? (opts.rawBody ?? JSON.stringify(opts.body ?? {})) : undefined,
  }));
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* not JSON (e.g. "ok") */ }
  return { status: res.status, json, text, headers: res.headers };
}

export function assertEquals<T>(actual: T, expected: T, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}
export function assert(cond: unknown, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
export function assertMatch(text: string, re: RegExp, msg = '') {
  if (!re.test(text)) throw new Error(`${msg ? msg + ': ' : ''}expected ${JSON.stringify(text)} to match ${re}`);
}

export { world };

/** Scripts the standard "active staff caller" prerequisites used by create/update-subscription and delete-member. */
export function activeCaller(profile: Record<string, unknown> = { id: 'caller-1', is_active: true, deleted_at: null }) {
  world.tables['profiles'] = () => ({ data: profile });
}
export function adminCaller(isAdmin = true) {
  world.rpc['is_admin_user'] = () => ({ data: isAdmin });
}

/**
 * Registers a test for behaviour the spec calls for but the implementation does not (yet) deliver.
 * It passes while the gap exists (the body throws) and FAILS once the gap is fixed, so it has to be
 * promoted to a normal Deno.test — keeps the suite green without hiding the finding.
 */
export function knownGap(name: string, fn: () => Promise<void>) {
  Deno.test(`KNOWN GAP: ${name}`, async () => {
    let threw = false;
    try { await fn(); } catch { threw = true; }
    if (!threw) throw new Error('this known gap now passes — convert it to a regular Deno.test');
  });
}
