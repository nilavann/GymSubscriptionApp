// Soft-deletes a branch, guarded by a usage check — see spec/backend/master-data-management.md
// §5 and edge-functions.md §4. Same count-then-update shape as delete-plan, same accepted
// race-window trade-off for the same reason (admin-only, low-frequency action).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteBranchPayload {
  branch_id: number;
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

    // Admin-only, not just active-user — Branch Management (REQ-ADMIN-003) is an admin screen.
    const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: callerId });
    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return jsonError('Admin access required', 403);
    }

    const payload = (await req.json()) as DeleteBranchPayload;
    if (!payload.branch_id) {
      return jsonError('branch_id is required', 400);
    }

    const { count, error: countError } = await supabaseAdmin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', payload.branch_id)
      .is('deleted_at', null);
    if (countError) throw countError;
    if (count && count > 0) {
      return jsonError(`Cannot delete — used by ${count} member(s)`, 409);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('branches')
      .update({ deleted_at: new Date().toISOString(), deleted_by: callerId })
      .eq('id', payload.branch_id)
      .is('deleted_at', null);
    if (deleteError) throw deleteError;

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    console.error('delete-branch error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
