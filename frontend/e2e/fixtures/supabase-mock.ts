import type { Page, Request, Route } from '@playwright/test';
import { SESSION_STORAGE_KEY, SUPABASE_URL } from './constants';

/**
 * Network-level fake of the Supabase project (CLAUDE.md "Testing rules" #4). The app under test is
 * the real production bundle talking to the real supabase-js client — only the HTTP responses are
 * ours. That exercises the actual request shapes (filters, headers, payloads) without Docker, and
 * without ever touching a real project.
 *
 * Scope, stated plainly: this fakes PostgREST/Auth/Functions/Storage *responses*. It does NOT run
 * RLS, triggers or Edge Function code — those are the server's job and are verified against a real
 * backend (planned follow-up), not here.
 *
 * Any request it can't answer is recorded in `unmocked` and answered with a 599; the `supabase`
 * fixture (test.ts) fails the test if that list is non-empty, so a missing mock can never pass silently.
 */

export type Row = Record<string, unknown>;
export interface MockUser {
  id: string;
  email: string;
  password: string;
}
export interface FunctionResponse {
  status?: number;
  json: unknown;
}
export type FunctionHandler = (body: unknown) => FunctionResponse | Promise<FunctionResponse>;
export interface RecordedRequest {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-expose-headers': 'content-range,content-type',
};

// 1x1 transparent PNG — member photos resolve to signed URLs that the browser then really requests.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A structurally valid (unsigned) JWT — supabase-js never verifies the signature client-side. */
function unsignedJwt(user: MockUser, expiresAt: number): string {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const payload = base64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: expiresAt });
  return `${header}.${payload}.e2e`;
}

export function buildSession(user: MockUser) {
  const expires_at = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // far future: never triggers a refresh
  return {
    access_token: unsignedJwt(user, expires_at),
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at,
    refresh_token: 'e2e-refresh-token',
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

function parseBody(request: Request): unknown {
  const raw = request.postData();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // e.g. a multipart photo upload — callers only assert on JSON bodies
  }
}

// ---- PostgREST filtering -------------------------------------------------------------------

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

function compare(cell: unknown, value: string): number {
  const a = Number(cell);
  const b = Number(value);
  if (Number.isFinite(a) && Number.isFinite(b) && cell !== '' && value !== '') return a - b;
  return String(cell).localeCompare(value);
}

function matches(cell: unknown, op: string, value: string): boolean {
  switch (op) {
    case 'eq':
      return String(cell) === value;
    case 'neq':
      return String(cell) !== value;
    case 'is':
      return value === 'null' ? cell === null || cell === undefined : String(cell) === value;
    case 'in': {
      const list = value.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''));
      return list.includes(String(cell));
    }
    case 'gt':
      return cell != null && compare(cell, value) > 0;
    case 'gte':
      return cell != null && compare(cell, value) >= 0;
    case 'lt':
      return cell != null && compare(cell, value) < 0;
    case 'lte':
      return cell != null && compare(cell, value) <= 0;
    case 'like':
    case 'ilike': {
      const pattern = new RegExp(`^${value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, op === 'ilike' ? 'i' : '');
      return pattern.test(String(cell ?? ''));
    }
    default:
      throw new Error(`unsupported PostgREST operator "${op}"`);
  }
}

function filterRows(rows: Row[], params: URLSearchParams): Row[] {
  let result = rows;
  for (const [key, raw] of params) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (key === 'or' || key === 'and') throw new Error(`unsupported PostgREST logical filter "${key}" — extend supabase-mock.ts`);
    const negate = raw.startsWith('not.');
    const expression = negate ? raw.slice(4) : raw;
    const dot = expression.indexOf('.');
    if (dot === -1) throw new Error(`unparseable PostgREST filter ${key}=${raw}`);
    const op = expression.slice(0, dot);
    const value = expression.slice(dot + 1);
    result = result.filter((row) => matches(row[key], op, value) !== negate);
  }

  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((part) => {
      const [column, direction] = part.split('.');
      return { column, descending: direction === 'desc' };
    });
    result = [...result].sort((x, y) => {
      for (const { column, descending } of keys) {
        const diff = compare(x[column] ?? '', String(y[column] ?? ''));
        if (diff !== 0) return descending ? -diff : diff;
      }
      return 0;
    });
  }

  const offset = Number(params.get('offset') ?? 0);
  const limit = params.get('limit');
  if (offset || limit) result = result.slice(offset, limit ? offset + Number(limit) : undefined);
  return result;
}

// ---- The mock ---------------------------------------------------------------------------------

export class SupabaseMock {
  /** Table/view name -> rows. A table that is absent here answers 599 (unmocked) rather than []. */
  readonly tables: Record<string, Row[]>;
  /** Edge Function name -> handler. A function that is absent answers 599 (unmocked). */
  readonly functions: Record<string, FunctionHandler> = {};
  /** Postgres function name (called as `supabase.rpc(name)`) -> handler. Absent ones answer 599 (unmocked). */
  readonly rpcs: Record<string, FunctionHandler> = {};
  readonly users: MockUser[];
  /** Every request the app made, in order — assert request payloads/contracts against this. */
  readonly requests: RecordedRequest[] = [];
  readonly unmocked: string[] = [];
  /** When true, every Supabase request fails at the network level (the "can't reach the server" state). */
  offline = false;

  constructor(
    private readonly page: Page,
    init: { tables?: Record<string, Row[]>; users?: MockUser[] } = {}
  ) {
    this.tables = init.tables ?? {};
    this.users = init.users ?? [];
  }

  async install(): Promise<void> {
    await this.page.route(`${SUPABASE_URL}/**`, (route) => this.handle(route));
  }

  /** Starts the page already signed in as `user` (writes supabase-js's session key before any script runs). */
  async signIn(user: MockUser): Promise<void> {
    await this.page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_STORAGE_KEY, JSON.stringify(buildSession(user))] as const
    );
  }

  /** Recorded requests whose path matches, e.g. `calls('/functions/v1/create-subscription')`. */
  calls(path: string | RegExp): RecordedRequest[] {
    return this.requests.filter((r) => (typeof path === 'string' ? r.path === path : path.test(r.path)));
  }

  // ---- routing --------------------------------------------------------------------------------

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { ...CORS, 'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*' },
      });
      return;
    }
    if (this.offline) {
      await route.abort('failed');
      return;
    }

    const body = parseBody(request);
    this.requests.push({ method, path: url.pathname, search: url.search, body });

    try {
      const { pathname } = url;
      if (pathname.startsWith('/rest/v1/')) return await this.rest(route, request, url, body);
      if (pathname.startsWith('/auth/v1/')) return await this.auth(route, request, url, body);
      if (pathname.startsWith('/functions/v1/')) return await this.edgeFunction(route, url, body);
      if (pathname.startsWith('/storage/v1/')) return await this.storage(route, request, url, body);
      throw new Error('no handler for this path');
    } catch (error) {
      this.unmocked.push(`${method} ${url.pathname}${url.search} — ${(error as Error).message}`);
      await route.fulfill({ status: 599, headers: CORS, body: `UNMOCKED: ${method} ${url.pathname}` });
    }
  }

  private json(route: Route, status: number, data: unknown, headers: Record<string, string> = {}) {
    return route.fulfill({
      status,
      headers: { ...CORS, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  }

  // ---- PostgREST ------------------------------------------------------------------------------

  private async rest(route: Route, request: Request, url: URL, body: unknown): Promise<void> {
    const table = url.pathname.slice('/rest/v1/'.length);

    if (table.startsWith('rpc/')) {
      const name = table.slice('rpc/'.length);
      const handler = this.rpcs[name];
      if (!handler) throw new Error(`rpc "${name}" is not in the mock — add it to rpcs`);
      const { status = 200, json } = await handler(body);
      // A void Postgres function answers with no body; anything else answers with JSON.
      return void (await (json === undefined ? route.fulfill({ status: 204, headers: CORS }) : this.json(route, status, json)));
    }

    const rows = this.tables[table];
    if (!rows) throw new Error(`table/view "${table}" is not in the mock — add it to tables`);

    const headers = request.headers();
    const wantsObject = (headers['accept'] ?? '').includes('vnd.pgrst.object+json');
    const wantsRepresentation = (headers['prefer'] ?? '').includes('return=representation');
    const method = request.method();

    const respondWith = (result: Row[], status: number) => {
      if (!wantsRepresentation) return route.fulfill({ status: status === 200 ? 204 : status, headers: CORS });
      if (wantsObject) {
        return result.length === 1 ? this.json(route, status, result[0]) : this.pgrstNoSingleRow(route);
      }
      return this.json(route, status, result);
    };

    switch (method) {
      case 'GET':
      case 'HEAD': {
        const found = filterRows(rows, url.searchParams);
        const contentRange = `${found.length ? `0-${found.length - 1}` : '*'}/${found.length}`;
        if (method === 'HEAD') return void (await route.fulfill({ status: 200, headers: { ...CORS, 'content-range': contentRange } }));
        if (wantsObject) {
          return void (await (found.length === 1
            ? this.json(route, 200, found[0], { 'content-range': contentRange })
            : this.pgrstNoSingleRow(route)));
        }
        return void (await this.json(route, 200, found, { 'content-range': contentRange }));
      }
      case 'POST': {
        const created = (Array.isArray(body) ? body : [body]).map((item) => {
          const row = { ...(item as Row) };
          if (row.id === undefined && rows.every((r) => typeof r.id === 'number')) {
            row.id = rows.reduce((max, r) => Math.max(max, r.id as number), 0) + 1;
          }
          rows.push(row);
          return row;
        });
        return void (await respondWith(created, 201));
      }
      case 'PATCH': {
        const targets = filterRows(rows, url.searchParams);
        targets.forEach((row) => Object.assign(row, body as Row));
        return void (await respondWith(targets, 200));
      }
      case 'DELETE': {
        const targets = new Set(filterRows(rows, url.searchParams));
        this.tables[table] = rows.filter((row) => !targets.has(row));
        return void (await respondWith([...targets], 200));
      }
      default:
        throw new Error(`unsupported REST method ${method}`);
    }
  }

  private pgrstNoSingleRow(route: Route) {
    return this.json(route, 406, {
      code: 'PGRST116',
      details: 'The result contains 0 or multiple rows',
      hint: null,
      message: 'JSON object requested, multiple (or no) rows returned',
    });
  }

  // ---- Auth -----------------------------------------------------------------------------------

  private async auth(route: Route, request: Request, url: URL, body: unknown): Promise<void> {
    const { pathname, searchParams } = url;
    const method = request.method();

    if (pathname === '/auth/v1/token' && searchParams.get('grant_type') === 'password') {
      const { email, password } = (body ?? {}) as { email?: string; password?: string };
      const user = this.users.find((u) => u.email === email && u.password === password);
      if (!user) {
        return void (await this.json(route, 400, {
          code: 400,
          error_code: 'invalid_credentials',
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
          msg: 'Invalid login credentials',
        }));
      }
      return void (await this.json(route, 200, buildSession(user)));
    }
    if (pathname === '/auth/v1/token' && searchParams.get('grant_type') === 'refresh_token') {
      const user = this.users[0];
      if (!user) throw new Error('refresh requested but the mock has no users');
      return void (await this.json(route, 200, buildSession(user)));
    }
    if (pathname === '/auth/v1/user' && method === 'GET') {
      const bearer = (request.headers()['authorization'] ?? '').replace(/^Bearer /, '');
      const payload = bearer.split('.')[1];
      const sub = payload ? (JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string }).sub : undefined;
      const user = this.users.find((u) => u.id === sub);
      if (!user) return void (await this.json(route, 401, { code: 401, msg: 'invalid JWT' }));
      return void (await this.json(route, 200, buildSession(user).user));
    }
    if (pathname === '/auth/v1/logout') return void (await route.fulfill({ status: 204, headers: CORS }));
    if (pathname === '/auth/v1/recover') return void (await this.json(route, 200, {}));
    throw new Error('auth endpoint is not mocked');
  }

  // ---- Edge Functions -------------------------------------------------------------------------

  private async edgeFunction(route: Route, url: URL, body: unknown): Promise<void> {
    const name = url.pathname.slice('/functions/v1/'.length);
    const handler = this.functions[name];
    if (!handler) throw new Error(`Edge Function "${name}" is not in the mock — add it to functions`);
    const { status = 200, json } = await handler(body);
    await this.json(route, status, json);
  }

  // ---- Storage --------------------------------------------------------------------------------

  private async storage(route: Route, request: Request, url: URL, body: unknown): Promise<void> {
    const { pathname } = url;
    const method = request.method();

    if (method === 'POST' && pathname.startsWith('/storage/v1/object/sign/')) {
      const bucket = pathname.slice('/storage/v1/object/sign/'.length);
      const { paths = [] } = (body ?? {}) as { paths?: string[] };
      return void (await this.json(
        route,
        200,
        paths.map((path) => ({ error: null, path, signedURL: `/object/sign/${bucket}/${path}?token=e2e` }))
      ));
    }
    if (method === 'GET' && pathname.startsWith('/storage/v1/object/sign/')) {
      return void (await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: PIXEL_PNG }));
    }
    if ((method === 'POST' || method === 'PUT') && pathname.startsWith('/storage/v1/object/')) {
      return void (await this.json(route, 200, { Key: pathname.slice('/storage/v1/object/'.length), Id: 'e2e' }));
    }
    if (method === 'DELETE' && pathname.startsWith('/storage/v1/object/')) return void (await this.json(route, 200, []));
    throw new Error('storage endpoint is not mocked');
  }
}
