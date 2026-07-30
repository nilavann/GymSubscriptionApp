// Header-only edits to an existing subscription — payment_mode, notes. Line items
// (subscription_items) have no update path at all in this revision: not plan_id, not
// dates, not quantity, not shared_member_id after creation. Adding, removing, or changing
// an item always means a new create-subscription checkout, never an edit to this one.
// See spec/backend/subscription-management.md §4.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateSubscriptionPayload {
  subscription_id: number;
  payment_mode?: 'Cash' | 'UPI' | 'Card';
  notes?: string | null;
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

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_active, deleted_at')
      .eq('id', callerId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.is_active || profile.deleted_at) {
      return jsonError('Account is not active', 403);
    }

    const payload = (await req.json()) as UpdateSubscriptionPayload;
    if (!payload.subscription_id) {
      return jsonError('subscription_id is required', 400);
    }
    if (payload.payment_mode !== undefined && !['Cash', 'UPI', 'Card'].includes(payload.payment_mode)) {
      return jsonError('payment_mode must be Cash, UPI, or Card', 400);
    }

    const { data: result, error: rpcError } = await supabaseAdmin.rpc('update_subscription_header', {
      p_caller_id: callerId,
      p_subscription_id: payload.subscription_id,
      p_payment_mode: payload.payment_mode ?? null,
      p_notes: payload.notes ?? null,
      // Distinguishes "notes omitted from the payload" (leave untouched) from "notes
      // explicitly sent as null" (clear it) - both look identical by the time p_notes
      // reaches the RPC above, so this flag is what actually carries that distinction.
      p_notes_provided: payload.notes !== undefined,
    });
    if (rpcError) throw rpcError;

    return jsonResponse(result, 200);
  } catch (err) {
    console.error('update-subscription error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
