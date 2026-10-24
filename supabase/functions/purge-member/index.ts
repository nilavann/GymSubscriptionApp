// Permanently erases a member (REQ-MEM-008) — the one hard delete in the app. System admin
// only. The purge_member() RPC removes the member, their subscriptions, items and audit
// history in a single transaction and re-checks the caller itself; this function then
// removes the member's photo files, which are outside that transaction. The caller is
// verified from the JWT here first (is_system_admin_user() reads auth.uid(), which is null
// under this function's service-role client, so the id is passed explicitly).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PurgeMemberPayload {
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

    const { data: isSystemAdmin, error: isSystemAdminError } = await supabaseAdmin.rpc('is_system_admin_user', {
      p_user_id: callerId,
    });
    if (isSystemAdminError) throw isSystemAdminError;
    if (!isSystemAdmin) {
      return jsonError('System admin access required', 403);
    }

    const payload = (await req.json()) as PurgeMemberPayload;
    if (!Number.isInteger(payload.member_id) || payload.member_id <= 0) {
      return jsonError('member_id is required', 400);
    }

    const { data: purged, error: purgeError } = await supabaseAdmin.rpc('purge_member', {
      p_caller_id: callerId,
      p_member_id: payload.member_id,
    });
    if (purgeError) {
      const message = purgeError.message ?? 'Unexpected error';
      if (/not found/i.test(message)) return jsonError('Member not found', 404);
      if (/cannot purge/i.test(message)) return jsonError(message, 409);
      throw purgeError;
    }

    // The database rows are already gone and cannot be restored, so a storage failure is
    // reported (and logged) but never turned into an error response — retrying would only 404.
    // Photos are uploaded as `<member_id>/original-<ts>.jpg`, and a replaced photo leaves its
    // old files behind, so everything under the member's folder is removed, not just the two
    // paths the member row pointed at.
    const bucket = supabaseAdmin.storage.from('member-photos');
    const photoPaths = new Set<string>(purged?.photo_paths ?? []);
    let photosRemoved = true;
    try {
      const folder = String(payload.member_id);
      const pageSize = 100;
      for (let offset = 0; ; offset += pageSize) {
        const { data: files, error: listError } = await bucket.list(folder, { limit: pageSize, offset });
        if (listError) throw listError;
        for (const file of files ?? []) photoPaths.add(`${folder}/${file.name}`);
        if (!files || files.length < pageSize) break;
      }
      if (photoPaths.size > 0) {
        const { error: storageError } = await bucket.remove([...photoPaths]);
        if (storageError) throw storageError;
      }
    } catch (storageError) {
      photosRemoved = false;
      console.error('purge-member: member', payload.member_id, 'erased but photos were not (fully) removed:', [...photoPaths], storageError);
    }

    return jsonResponse({ success: true, photos_removed: photosRemoved }, 200);
  } catch (err) {
    console.error('purge-member error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
