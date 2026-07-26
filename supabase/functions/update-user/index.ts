// Edits or soft-deletes another user's profile — see spec/backend/edge-functions.md §5
// "update-user". An Edge Function rather than a direct RLS-guarded supabase-js update
// because `profiles_update_admin`'s RLS policy has no row-level way to exclude "the
// caller's own id" — the self-protection rule below can only be enforced here.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateUserPayload {
  user_id: string;
  full_name?: string;
  roles?: string[];
  is_active?: boolean;
  delete?: boolean;
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

/** Would deactivating/deleting `userId` leave zero active admins? Only meaningful to call
 * when the target actually holds the admin role — `count_other_active_admins` alone can't
 * tell "not an admin" apart from "the only one", so `is_admin_user` gates it first. */
async function isLastActiveAdmin(supabaseAdmin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data: isAdmin, error: isAdminError } = await supabaseAdmin.rpc('is_admin_user', { p_user_id: userId });
  if (isAdminError) throw isAdminError;
  if (!isAdmin) return false;

  const { data: otherAdmins, error: countError } = await supabaseAdmin.rpc('count_other_active_admins', {
    p_exclude_user_id: userId,
  });
  if (countError) throw countError;
  return otherAdmins === 0;
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

    const payload = (await req.json()) as UpdateUserPayload;
    if (!payload.user_id) {
      return jsonError('user_id is required', 400);
    }
    const isSelf = payload.user_id === callerId;

    // Soft-delete (REQ-ADMIN-006) — a separate, more severe action from is_active,
    // independent of it (neither requires the other first).
    if (payload.delete) {
      if (isSelf) {
        return jsonError('You cannot delete your own account.', 403);
      }
      if (await isLastActiveAdmin(supabaseAdmin, payload.user_id)) {
        return jsonError('Cannot delete — this is the last active admin.', 409);
      }
      // RPC, not a direct .update() — set_audit_fields() (now attached to profiles) needs
      // auth.uid() to resolve the acting admin for changed_by, which a plain service-role
      // .update() can't provide (database.md §Role Assignment / update_profile_fields).
      const { error: deleteError } = await supabaseAdmin.rpc('soft_delete_profile', {
        p_caller_id: callerId,
        p_target_user_id: payload.user_id,
      });
      if (deleteError) throw deleteError;
      return jsonResponse({ success: true }, 200);
    }

    // Regular edit — full_name / roles / is_active, only the fields actually supplied.
    const changingRolesOrActive = payload.roles !== undefined || payload.is_active !== undefined;
    if (isSelf && changingRolesOrActive) {
      return jsonError('You cannot change your own roles or active status.', 403);
    }
    if (payload.is_active === false && (await isLastActiveAdmin(supabaseAdmin, payload.user_id))) {
      return jsonError('Cannot deactivate — this is the last active admin.', 409);
    }

    if (payload.roles !== undefined) {
      if (payload.roles.length === 0) {
        return jsonError('At least one role is required', 400);
      }
      const { data: roleRows, error: roleRowsError } = await supabaseAdmin
        .from('roles')
        .select('id')
        .in('name', payload.roles)
        .is('deleted_at', null);
      if (roleRowsError) throw roleRowsError;
      if (!roleRows || roleRows.length !== payload.roles.length) {
        return jsonError('One or more roles do not exist or are not active', 400);
      }
      // replace_user_roles() (database.md) carries its own last-admin guard for the
      // "removing the admin role itself" case — this call surfaces that as a 409.
      const { error: rolesError } = await supabaseAdmin.rpc('replace_user_roles', {
        p_caller_id: callerId,
        p_target_user_id: payload.user_id,
        p_role_ids: roleRows.map((r) => r.id),
      });
      if (rolesError) {
        const isLastAdmin = rolesError.message?.toLowerCase().includes('last active admin');
        return jsonError(isLastAdmin ? 'Cannot remove — this is the last active admin.' : rolesError.message, isLastAdmin ? 409 : 500);
      }
    }

    if (payload.full_name !== undefined || payload.is_active !== undefined) {
      const { error: updateError } = await supabaseAdmin.rpc('update_profile_fields', {
        p_caller_id: callerId,
        p_target_user_id: payload.user_id,
        p_full_name: payload.full_name ?? null,
        p_is_active: payload.is_active ?? null,
      });
      if (updateError) throw updateError;
    } else if (payload.roles === undefined) {
      return jsonError('No fields to update', 400);
    }

    const { data: updated, error: fetchError } = await supabaseAdmin
      .from('profiles_with_roles')
      .select('id, full_name, roles, is_active')
      .eq('id', payload.user_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!updated) {
      return jsonError('User not found', 404);
    }

    return jsonResponse(updated, 200);
  } catch (err) {
    console.error('update-user error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
