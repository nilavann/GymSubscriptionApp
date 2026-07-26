// Returns every non-deleted user (id, email, full_name, role, is_active) for the Manage
// Users screen — see spec/backend/edge-functions.md §5 "list-users". Needs its own
// function because `profiles` has no `email` column (login identity lives entirely in
// auth.users, per auth.md §2) and reading OTHER users' emails requires the Admin API,
// which requires the service role.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProfileWithRolesRow {
  id: string;
  full_name: string;
  roles: string[];
  is_active: boolean;
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

    // Admin-only, not just active-user — User Management (REQ-ADMIN-004) is an admin screen.
    const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: callerId });
    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return jsonError('Admin access required', 403);
    }

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles_with_roles')
      .select('id, full_name, roles, is_active')
      .is('deleted_at', null);
    if (profilesError) throw profilesError;

    // auth.admin.listUsers() is paginated — loop until a page comes back short of a full
    // page, which is the documented way to know there are no more pages left.
    const emailById = new Map<string, string>();
    let page = 1;
    const perPage = 200;
    while (true) {
      const { data: pageData, error: pageError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (pageError) throw pageError;
      for (const u of pageData.users) {
        if (u.email) emailById.set(u.id, u.email);
      }
      if (pageData.users.length < perPage) break;
      page += 1;
    }

    const users = ((profiles ?? []) as ProfileWithRolesRow[])
      .filter((p) => emailById.has(p.id)) // FK is on delete cascade, so this should never miss — skip rather than error if it somehow does.
      .map((p) => ({
        id: p.id,
        email: emailById.get(p.id)!,
        full_name: p.full_name,
        roles: p.roles,
        is_active: p.is_active,
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    return jsonResponse({ users }, 200);
  } catch (err) {
    console.error('list-users error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
