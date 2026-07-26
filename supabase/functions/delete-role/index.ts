// Soft-deletes a role, guarded by a usage check — same shape as delete-plan/delete-branch
// (edge-functions.md §4, now covering Plans/Branches/Roles identically). Same
// count-then-update race-window trade-off, for the same reason (admin-only, low-frequency).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteRolePayload {
  role_id: number;
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

    // Admin-only, not just active-user — Manage Roles is an admin screen.
    const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: callerId });
    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return jsonError('Admin access required', 403);
    }

    const payload = (await req.json()) as DeleteRolePayload;
    if (!payload.role_id) {
      return jsonError('role_id is required', 400);
    }

    const { count, error: countError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('role_id', payload.role_id);
    if (countError) throw countError;
    if (count && count > 0) {
      return jsonError(`Cannot delete — used by ${count} user(s)`, 409);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('roles')
      .update({ deleted_at: new Date().toISOString(), deleted_by: callerId })
      .eq('id', payload.role_id)
      .is('deleted_at', null);
    if (deleteError) throw deleteError;

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    console.error('delete-role error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
