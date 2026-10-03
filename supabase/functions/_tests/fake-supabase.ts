// A scriptable stand-in for @supabase/supabase-js, so the Edge Functions' own logic (auth gates,
// validation, guards, payload shaping) can be tested without a Supabase project. Tests set
// `world.tables[...]` / `world.rpc[...]` handlers and then assert on `world.log`.

export type Op = [method: string, args: unknown[]];
export interface QueryCall {
  table: string;
  ops: Op[];
  /** Convenience accessors over `ops` for assertions. */
  has(method: string, ...args: unknown[]): boolean;
  arg(method: string): unknown[] | undefined;
}
export interface Result {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

export const world = {
  user: { id: 'caller-1' } as { id: string } | null,
  tables: {} as Record<string, (q: QueryCall) => Result | Promise<Result>>,
  rpc: {} as Record<string, (args: Record<string, unknown>) => Result | Promise<Result>>,
  listUsersPages: [] as { id: string; email: string | null }[][],
  inviteUser: (_email: string, _opts: unknown): Result => ({ data: { user: { id: 'new-user', email: 'x' } }, error: null }),
  log: [] as { kind: 'query' | 'rpc'; name: string; q?: QueryCall; args?: unknown }[],
  reset() {
    this.user = { id: 'caller-1' };
    this.tables = {};
    this.rpc = {};
    this.listUsersPages = [];
    this.inviteUser = () => ({ data: { user: { id: 'new-user', email: 'x' } }, error: null });
    this.log = [];
  },
};

function makeCall(table: string, ops: Op[]): QueryCall {
  const same = (a: unknown[], b: unknown[]) => JSON.stringify(a) === JSON.stringify(b);
  return {
    table,
    ops,
    has: (method, ...args) => ops.some(([m, a]) => m === method && same(a, args)),
    arg: (method) => ops.find(([m]) => m === method)?.[1],
  };
}

class Query {
  ops: Op[] = [];
  constructor(private table: string) {}
  private add(m: string, a: unknown[]) {
    this.ops.push([m, a]);
    return this;
  }
  select(...a: unknown[]) { return this.add('select', a); }
  insert(...a: unknown[]) { return this.add('insert', a); }
  update(...a: unknown[]) { return this.add('update', a); }
  upsert(...a: unknown[]) { return this.add('upsert', a); }
  eq(...a: unknown[]) { return this.add('eq', a); }
  in(...a: unknown[]) { return this.add('in', a); }
  is(...a: unknown[]) { return this.add('is', a); }
  or(...a: unknown[]) { return this.add('or', a); }
  like(...a: unknown[]) { return this.add('like', a); }
  order(...a: unknown[]) { return this.add('order', a); }
  limit(...a: unknown[]) { return this.add('limit', a); }
  maybeSingle(...a: unknown[]) { return this.add('maybeSingle', a); }
  single(...a: unknown[]) { return this.add('single', a); }
  // deno-lint-ignore no-explicit-any
  then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
    const q = makeCall(this.table, this.ops);
    world.log.push({ kind: 'query', name: this.table, q });
    const handler = world.tables[this.table];
    const out = handler ? Promise.resolve(handler(q)) : Promise.reject(new Error(`unscripted query on table "${this.table}"`));
    return out.then((r) => ({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null })).then(resolve, reject);
  }
}

export function createClient(_url: string, _key: string, _opts?: unknown) {
  return {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      world.log.push({ kind: 'rpc', name, args });
      const h = world.rpc[name];
      if (!h) return Promise.reject(new Error(`unscripted rpc "${name}"`));
      return Promise.resolve(h(args)).then((r) => ({ data: r.data ?? null, error: r.error ?? null }));
    },
    auth: {
      getUser: () =>
        Promise.resolve(world.user ? { data: { user: world.user }, error: null } : { data: { user: null }, error: { message: 'invalid jwt' } }),
      admin: {
        listUsers: ({ page }: { page: number; perPage: number }) =>
          Promise.resolve({ data: { users: world.listUsersPages[page - 1] ?? [] }, error: null }),
        inviteUserByEmail: (email: string, opts: unknown) => Promise.resolve(world.inviteUser(email, opts)),
      },
    },
  };
}
