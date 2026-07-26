// Admin-configurable override for a branch's member-number counter — see
// spec/backend/member-management.md §3.1. Lets an admin set what the NEXT member
// registered at a given branch will be numbered — each branch's counter stays fully
// independent (member_number_sequences is keyed by branch_id alone, exactly as
// generate_member_number() already relies on) and, since the schema-continuous-sequence
// migration, never resets at a year boundary either — it's one continuously-incrementing
// counter per branch, for the branch's entire lifetime.
//
// The requested value is a *target*, not a guarantee: member_number is never reused
// (REQ-MEM-007), so if the requested sequence was already issued to some member (active
// or soft-deleted) at this branch — in ANY year, since the counter no longer resets per
// year — this walks forward by the configured increment until it finds one that has never
// been used, then stores that as the new counter position. The response always reports
// the value actually applied, which the frontend surfaces if it differs from what was
// requested.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateSequencePayload {
  branch_id: number;
  next_sequence: number;
}

// Guards against a pathological run of consecutive already-used numbers turning into an
// effectively unbounded loop - this app's real scale (low-thousands of members) will never
// come close to exercising this, it's a safety valve, not an expected path.
const MAX_ATTEMPTS = 10000;

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

    // Admin-only — this is a Settings-hub configuration screen, same bar as Plan/Branch/Role
    // management, not a day-to-day staff action.
    const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: callerId });
    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return jsonError('Admin access required', 403);
    }

    const payload = (await req.json()) as UpdateSequencePayload;
    if (!payload.branch_id || !Number.isInteger(payload.next_sequence)) {
      return jsonError('branch_id and next_sequence are required', 400);
    }
    if (payload.next_sequence < 1) {
      return jsonError('next_sequence must be at least 1', 400);
    }

    const { data: branch, error: branchError } = await supabaseAdmin
      .from('branches')
      .select('id, code')
      .eq('id', payload.branch_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (branchError) throw branchError;
    if (!branch) {
      return jsonError('branch_id does not reference an active branch', 400);
    }

    const { data: configRows, error: configError } = await supabaseAdmin
      .from('configuration')
      .select('key, value')
      .in('key', ['member_number_increment', 'member_number_padding_width']);
    if (configError) throw configError;
    const configMap = new Map((configRows ?? []).map((r) => [r.key, r.value]));
    const increment = Number.parseInt(configMap.get('member_number_increment') ?? '1', 10);
    const width = Number.parseInt(configMap.get('member_number_padding_width') ?? '4', 10);
    if (!Number.isInteger(increment) || increment < 1) {
      return jsonError('member_number_increment is misconfigured (must be a positive integer)', 500);
    }

    // The counter no longer resets per year, so "already used" has to be checked across
    // every year this branch has ever issued a number in - not just one. member_number is
    // always `{code}-{year}-{padded sequence}`, so every used sequence value for this
    // branch is pulled once (prefix-filtered on the branch code) and compared in memory,
    // rather than trying to express "same trailing segment, any year" as a single SQL
    // filter against an arbitrary branch code.
    const { data: existingNumbers, error: existingError } = await supabaseAdmin
      .from('members')
      .select('member_number')
      .like('member_number', `${branch.code}-%`);
    if (existingError) throw existingError;
    const usedSequences = new Set(
      (existingNumbers ?? [])
        .map((row) => row.member_number as string)
        .map((num) => num.slice(num.lastIndexOf('-') + 1))
        .map((tail) => Number.parseInt(tail, 10))
        .filter((n) => Number.isInteger(n))
    );

    let candidate = payload.next_sequence;
    let attempts = 0;
    while (usedSequences.has(candidate) && attempts < MAX_ATTEMPTS) {
      candidate += increment;
      attempts += 1;
    }
    if (attempts >= MAX_ATTEMPTS) {
      return jsonError(`Could not find an available member number after ${MAX_ATTEMPTS} attempts`, 409);
    }

    // Store as `last_sequence` = candidate - increment, so the next real registration's
    // `last_sequence + increment` (generate_member_number()'s own arithmetic) lands exactly
    // on `candidate` - this Edge Function never writes member_number itself, only primes
    // the counter the trigger reads.
    const { error: upsertError } = await supabaseAdmin
      .from('member_number_sequences')
      .upsert({ branch_id: payload.branch_id, last_sequence: candidate - increment }, { onConflict: 'branch_id' });
    if (upsertError) throw upsertError;

    return jsonResponse(
      { success: true, next_sequence: candidate, requested: payload.next_sequence, adjusted: candidate !== payload.next_sequence },
      200,
    );
  } catch (err) {
    console.error('update-member-number-sequence error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
