// Soft-deletes a member, guarded by a usage check — same "used by X" shape as delete-plan
// and delete-branch (spec/backend/member-management.md §9, domain-model-review.md's High
// finding this closes). Unlike Plan/Branch, Member deletion isn't admin-only (REQ-MEM-007
// says staff/admin) - the caller only needs to be an active, non-deleted user, checked
// directly against `profiles` here since is_active_user() reads auth.uid(), which is null
// under this function's service-role client.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteMemberPayload {
  member_id: number;
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

    // Active, non-deleted user - same bar members_update_active_users already applies to a
    // direct client-side update, just re-checked here since this function now owns the write.
    const { data: callerProfile, error: callerError } = await supabaseAdmin
      .from('profiles')
      .select('is_active, deleted_at')
      .eq('id', callerId)
      .maybeSingle();
    if (callerError) throw callerError;
    if (!callerProfile || !callerProfile.is_active || callerProfile.deleted_at) {
      return jsonError('Active account required', 403);
    }

    const payload = (await req.json()) as DeleteMemberPayload;
    if (!payload.member_id) {
      return jsonError('member_id is required', 400);
    }

    const { count, error: countError } = await supabaseAdmin
      .from('subscription_items')
      .select('id', { count: 'exact', head: true })
      .or(`member_id.eq.${payload.member_id},shared_member_id.eq.${payload.member_id}`)
      .is('deleted_at', null);
    if (countError) throw countError;
    if (count && count > 0) {
      return jsonError(`Cannot delete — used by ${count} subscription/add-on record(s)`, 409);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('members')
      .update({ deleted_at: new Date().toISOString(), deleted_by: callerId })
      .eq('id', payload.member_id)
      .is('deleted_at', null);
    if (deleteError) throw deleteError;

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    console.error('delete-member error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
