// Invites a new admin/staff user — see spec/backend/edge-functions.md §5 "invite-user"
// and database.md's Profile Creation Trigger. This is the ONLY path (besides the one-time
// manual bootstrap admin) that creates an auth.users row for this app.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InviteUserPayload {
  email: string;
  full_name: string;
  roles: string[];
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

    const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: callerId });
    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return jsonError('Admin access required', 403);
    }

    const payload = (await req.json()) as InviteUserPayload;
    if (!payload.email || !payload.full_name || !Array.isArray(payload.roles) || payload.roles.length === 0) {
      return jsonError('email, full_name, and at least one role are required', 400);
    }

    // Validated against the live `roles` catalog, not a hardcoded set — an admin-added
    // role (Manage Roles) is assignable immediately, no code change needed.
    const { data: roleRows, error: roleRowsError } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .in('name', payload.roles)
      .is('deleted_at', null);
    if (roleRowsError) throw roleRowsError;
    if (!roleRows || roleRows.length !== payload.roles.length) {
      return jsonError('One or more roles do not exist or are not active', 400);
    }

    // handle_new_auth_user() (database.md) reads full_name/invited_by from
    // raw_user_meta_data and creates the matching `profiles` row automatically.
    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(payload.email, {
      data: { full_name: payload.full_name, invited_by: callerId },
    });
    if (inviteError) {
      const isDuplicate = inviteError.message?.toLowerCase().includes('already been registered');
      return jsonError(isDuplicate ? 'This email is already registered.' : inviteError.message, isDuplicate ? 409 : 500);
    }

    // By the time inviteUserByEmail resolves, trg_handle_new_auth_user has already run
    // (same transaction as the auth.users insert) — the profiles row exists, so this
    // insert's user_id FK is always valid.
    const { error: userRolesError } = await supabaseAdmin
      .from('user_roles')
      .insert(roleRows.map((r) => ({ user_id: invited.user.id, role_id: r.id, granted_by: callerId })));
    if (userRolesError) throw userRolesError;

    return jsonResponse({ id: invited.user.id, email: invited.user.email }, 201);
  } catch (err) {
    console.error('invite-user error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
