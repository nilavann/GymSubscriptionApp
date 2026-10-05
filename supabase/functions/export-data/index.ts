// Admin-only, paged, read-only export of ONE whitelisted table — the server half of REQ-ADMIN-007
// (spec/backend/data-export-import.md §4). The browser loops the pages and builds the Excel
// workbook; photo bytes never pass through here.
//
// Three deliberate properties, each covered by tests (_tests/export-data.test.ts):
//   1. Admin-only: the caller's JWT is verified, then `is_admin_user` — a staff user gets a 403
//      before any table is touched.
//   2. Whitelist + explicit column lists: the request names a key of EXPORT_TABLES, never a table;
//      every query selects an explicit column list (never `*`), so a column added to a table
//      later — especially a secret — is NOT exported until it is added below and in spec §3.3.
//   3. It INCLUDES soft-deleted rows. This is the one documented exception to "every service-role
//      read filters `deleted_at is null`" (spec/backend/rules.md rule 21, data-export-import.md
//      §4.3): an export that silently dropped deleted rows would not be a complete record.
//      Deleted rows are exported with their deleted_at/deleted_by so they stay distinguishable.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AUDIT_COLUMNS = ['created_at', 'created_by', 'changed_at', 'changed_by'];
const SOFT_DELETE_COLUMNS = ['deleted_at', 'deleted_by'];
const withInfo = (columns: string[]) => ['id', ...columns, ...AUDIT_COLUMNS, ...SOFT_DELETE_COLUMNS];

interface TableSpec {
  /** Real table the rows are read from. */
  from: string;
  /** EVERY column of the table, explicitly — see header note 2. */
  columns: string[];
  /** Keyset-paginated on this column (ascending). `null` = small table returned as a single page. */
  key: 'id' | null;
}

const EXPORT_TABLES: Record<string, TableSpec> = {
  branches: { from: 'branches', key: 'id', columns: withInfo(['name', 'code']) },
  plans: { from: 'plans', key: 'id', columns: withInfo(['name', 'category', 'duration_days', 'price', 'max_members']) },
  roles: { from: 'roles', key: 'id', columns: withInfo(['name', 'description']) },
  members: {
    from: 'members',
    key: 'id',
    columns: withInfo([
      'name',
      'phone',
      'date_of_birth',
      'date_of_joining',
      'gender',
      'weight_kg',
      'height_cm',
      'under_doctor_care',
      'doctor_care_details',
      'emergency_contact_name',
      'emergency_contact_phone',
      'emergency_contact_relationship',
      'email',
      'residential_address',
      'pincode',
      'aadhaar_number',
      'occupation',
      'photo_url',
      'photo_thumbnail_url',
      'branch_id',
      'member_number',
      'handled_by_staff',
    ]),
  },
  subscriptions: { from: 'subscriptions', key: 'id', columns: withInfo(['member_id', 'payment_mode', 'notes']) },
  subscription_items: {
    from: 'subscription_items',
    key: 'id',
    columns: withInfo([
      'subscription_id',
      'plan_id',
      'member_id',
      'shared_member_id',
      'start_date',
      'end_date',
      'quantity',
      'amount_paid',
    ]),
  },
  audit_log: {
    from: 'audit_log',
    key: 'id',
    columns: ['id', 'change_id', 'table_name', 'record_id', 'field_name', 'old_value', 'new_value', 'operation', 'changed_by', 'changed_at'],
  },
  // No `id` / soft-delete columns on these three — they have their own keys (see database.md).
  configuration: {
    from: 'configuration',
    key: null,
    columns: ['key', 'value', 'description', ...AUDIT_COLUMNS],
  },
  member_number_sequences: { from: 'member_number_sequences', key: null, columns: ['branch_id', 'last_sequence'] },
  user_roles: { from: 'user_roles', key: null, columns: ['user_id', 'role_id', 'granted_at', 'granted_by'] },
  // `profiles` + the login email, which lives only in auth.users. Handled separately below.
  users: { from: 'profiles', key: null, columns: withInfo(['full_name', 'is_active']) },
};

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000; // PostgREST's own max_rows (supabase/config.toml) caps a page at this anyway.
const AUTH_USERS_PER_PAGE = 200;

interface ExportRequest {
  table?: unknown;
  after?: unknown;
  limit?: unknown;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1. Authenticate the caller from their own JWT.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonError('Missing Authorization header', 401);
    }
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !userData.user) {
      return jsonError('Invalid or expired session', 401);
    }
    const callerId = userData.user.id;

    // 2. Admin-only, checked before any table is read (the route guard is UX only).
    const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: callerId });
    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return jsonError('Admin access required', 403);
    }

    // 3. Validate the request. A data problem is a 400, never a 500 (a malformed body included).
    let payload: ExportRequest;
    try {
      payload = (await req.json()) as ExportRequest;
    } catch {
      return jsonError('Request body must be valid JSON', 400);
    }
    if (payload === null || typeof payload !== 'object') {
      return jsonError('Request body must be a JSON object', 400);
    }

    const tableName = payload.table;
    if (typeof tableName !== 'string' || !Object.prototype.hasOwnProperty.call(EXPORT_TABLES, tableName)) {
      return jsonError('Unknown table', 400);
    }
    const spec = EXPORT_TABLES[tableName];

    const limit = payload.limit === undefined || payload.limit === null ? DEFAULT_LIMIT : payload.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return jsonError(`limit must be a whole number between 1 and ${MAX_LIMIT}`, 400);
    }
    const after = payload.after === undefined ? null : payload.after;
    if (after !== null && (typeof after !== 'number' || !Number.isInteger(after) || after < 0)) {
      return jsonError('after must be null or a non-negative whole number', 400);
    }

    // 4. Read the page — NO `deleted_at is null` filter, on purpose (header note 3).
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const selectList = spec.columns.join(', ');

    if (spec.key === null) {
      // Small table: one page. `count: 'exact'` makes a server-side row cap visible instead of silent.
      const { data, error, count } = await supabaseAdmin.from(spec.from).select(selectList, { count: 'exact' });
      if (error) throw error;
      let rows = (data ?? []) as Record<string, unknown>[];
      if (count !== null && count !== undefined && count > rows.length) {
        return jsonError(`${tableName} has more rows than fit in one export page (${rows.length} of ${count})`, 500);
      }

      if (tableName === 'users') {
        // Emails live only in auth.users — same Admin API paging as list-users.
        const emailById = new Map<string, string>();
        let page = 1;
        while (true) {
          const { data: pageData, error: pageError } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: AUTH_USERS_PER_PAGE,
          });
          if (pageError) throw pageError;
          for (const u of pageData.users) {
            if (u.email) emailById.set(u.id, u.email);
          }
          if (pageData.users.length < AUTH_USERS_PER_PAGE) break;
          page += 1;
        }
        // Explicit output shape: the profile columns + email. Nothing else from auth.users is ever read.
        rows = rows.map((row) => ({ ...row, email: emailById.get(row.id as string) ?? null }));
      }

      console.info(JSON.stringify({ event: 'export-data', caller: callerId, table: tableName, rows: rows.length, after: null }));
      return jsonResponse({ rows, next: null, project_ref: projectRef }, 200);
    }

    let query = supabaseAdmin.from(spec.from).select(selectList);
    if (after !== null) query = query.gt(spec.key, after);
    const { data, error } = await query.order(spec.key, { ascending: true }).limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];

    // The LAST page is an empty one (`next: null`). Deciding "last" from `rows.length < limit` would
    // silently truncate a backup if the server's own row cap were ever lower than the page size asked.
    const next = rows.length > 0 ? (rows[rows.length - 1][spec.key] as number) : null;

    console.info(JSON.stringify({ event: 'export-data', caller: callerId, table: tableName, rows: rows.length, after }));
    return jsonResponse({ rows, next, project_ref: projectRef }, 200);
  } catch (err) {
    console.error('export-data error:', err);
    // supabase-js query errors are plain `{ message }` objects, not Error instances.
    const message =
      err !== null && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : 'Unexpected error';
    return jsonError(message, 500);
  }
});
