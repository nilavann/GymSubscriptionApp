// Admin-only MERGE import (REQ-ADMIN-008) — spec/backend/data-export-import.md §5–§6.
//
// Receives the JSON the browser built from an uploaded workbook (UNTRUSTED input), validates every value
// (merge-validation.ts), makes ONE call to the import_workbook RPC (a single atomic transaction; `dry_run` does the same
// work and rolls it back), and returns a per-row outcome list. Merge only adds, and — if asked — updates non-blank
// fields: it never deletes, never un-deletes, never imports users/roles/configuration/audit history. Data problems are
// per-row `error` outcomes inside a 200; only a malformed request or a server fault is an HTTP error.
//
// Restore (REQ-ADMIN-009) will add `mode: "restore"` actions to this same function later; it is rejected here for now.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SHEET_ORDER, parseRequest, prepareMerge, type RowOutcome, type SheetName } from './merge-validation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OUTCOMES = ['created', 'updated', 'unchanged', 'skipped_exists', 'skipped_deleted', 'error'] as const;
type Counts = Record<(typeof OUTCOMES)[number], number>;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}

interface RpcRow {
  sheet: SheetName;
  row: number;
  outcome: string;
  message?: string;
  warning?: string;
  id?: number;
}

interface RpcResult {
  committed: boolean;
  aborted: boolean;
  dry_run: boolean;
  rows: RpcRow[];
}

function emptyCounts(): Counts {
  return Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Counts;
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

    // 2. Admin-only, before the body is even read (the route guard is UX only).
    const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: callerId });
    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return jsonError('Admin access required', 403);
    }

    // 3. Parse + validate the envelope. A malformed request is a 400, never a 500.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError('Request body must be valid JSON', 400);
    }
    const parsed = parseRequest(body);
    if (!parsed.ok) {
      return jsonError(parsed.error, 400);
    }
    const { request } = parsed;

    // 4. Validate every row; build the payload from the ones that pass.
    const prepared = prepareMerge(request);
    const hasValidationErrors = prepared.errorCount > 0;
    const abortOnError = request.onError === 'abort';

    // Under "abort" a single invalid row means NOTHING is committed — but we still run the valid rows as a dry run so
    // the preview shows the whole picture (including problems only the database can see).
    const forceDryRun = hasValidationErrors && abortOnError;

    let rpcResult: RpcResult | null = null;
    if (prepared.validRowCount > 0) {
      const { data, error } = await supabaseAdmin.rpc('import_workbook', {
        p_caller_id: callerId,
        p_payload: prepared.rpcPayload,
        p_update_existing: request.updateExisting,
        p_skip_invalid: !abortOnError,
        p_dry_run: request.dryRun || forceDryRun,
      });
      if (error) throw error;
      rpcResult = data as RpcResult;
    }

    // 5. Merge the outcomes: those decided here (errors, deleted rows) + the RPC's, in sheet then row order.
    const rows: RowOutcome[] = [...prepared.outcomes, ...(rpcResult?.rows ?? [])];
    rows.sort((a, b) => SHEET_ORDER.indexOf(a.sheet) - SHEET_ORDER.indexOf(b.sheet) || a.row - b.row);

    const summary: Partial<Record<SheetName, Counts>> = {};
    for (const row of rows) {
      const counts = (summary[row.sheet] ??= emptyCounts());
      if (row.outcome in counts) counts[row.outcome as keyof Counts] += 1;
    }

    const warnings = [
      ...prepared.warnings,
      ...rows.filter((r) => r.warning).map((r) => `${r.sheet} row ${r.row}: ${r.warning}`),
    ];

    // "Aborted" = under all-or-nothing, something was invalid (found here, or by the database via the RPC).
    const aborted = abortOnError && (hasValidationErrors || (rpcResult?.aborted ?? false));
    const committed = !aborted && !request.dryRun && (rpcResult?.committed ?? false);

    // Counts only — the log never holds row contents (they are personal data).
    console.info(
      JSON.stringify({ event: 'import-data', mode: 'merge', caller: callerId, dry_run: request.dryRun, committed, aborted, summary }),
    );

    return jsonResponse({ committed, aborted, dry_run: request.dryRun, summary, rows, warnings }, 200);
  } catch (err) {
    console.error('import-data error:', err);
    // supabase-js query errors are plain `{ message }` objects, not Error instances.
    const message =
      err !== null && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : 'Unexpected error';
    return jsonError(message, 500);
  }
});
