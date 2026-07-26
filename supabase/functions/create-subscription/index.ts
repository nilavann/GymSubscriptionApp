// The only write path for subscriptions/subscription_items — see
// spec/backend/subscription-management.md §4 for the full write-up this implements.
// RLS grants no direct client insert on either table, so this function (running with the
// service-role key) is the sole authorized way to create a checkout.
//
// Deliberately NOT implemented here: the overlap warning (REQ-SUB-005/008) — that's
// resolved as a client-side-only check in the checkout form, before this function is ever
// called. See spec/frontend/subscription-management.md §5. A request that reaches this
// function with an overlapping date range is accepted with no resistance, by design.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NewSubscriptionItemPayload {
  plan_id: number;
  member_id: number;
  shared_member_id: number | null;
  start_date: string;
  quantity: number | null;
  amount_paid: number | null;
}

interface NewSubscriptionPayload {
  member_id: number;
  payment_mode: 'Cash' | 'UPI' | 'Card';
  notes: string | null;
  items: NewSubscriptionItemPayload[];
}

interface PlanRow {
  id: number;
  name: string;
  category: 'membership' | 'addon';
  duration_days: number | null;
  price: number;
  max_members: number;
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

/** `start_date + days` in plain YYYY-MM-DD arithmetic — no timezone involved, both sides are dates. */
function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

  // Service-role client: this function IS the authorized write path for
  // subscriptions/subscription_items (see database.md — no insert policy exists for
  // either table). Never exposed to or reachable from the browser directly.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonError('Missing Authorization header', 401);
    }

    // A second client, scoped to the caller's own JWT, used only to resolve who's
    // calling — never used for the privileged writes below.
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !userData.user) {
      return jsonError('Invalid or expired session', 401);
    }
    const callerId = userData.user.id;

    // Step 1: verify caller is an active, non-deleted user (mirrors is_active_user()).
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_active, deleted_at')
      .eq('id', callerId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.is_active || profile.deleted_at) {
      return jsonError('Account is not active', 403);
    }

    const payload = (await req.json()) as NewSubscriptionPayload;

    if (!payload.member_id || !payload.payment_mode) {
      return jsonError('member_id and payment_mode are required', 400);
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return jsonError('At least one item is required', 400);
    }
    for (const item of payload.items) {
      if (!item.plan_id || !item.member_id || !item.start_date) {
        return jsonError('Each item requires plan_id, member_id, and start_date', 400);
      }
    }

    // Step 2 (partial): resolve every referenced plan in one query — done before the
    // "exactly one membership item" check below, since category comes from the plan,
    // not the item payload.
    const planIds = [...new Set(payload.items.map((item) => item.plan_id))];
    const { data: plans, error: plansError } = await supabaseAdmin
      .from('plans')
      .select('id, name, category, duration_days, price, max_members')
      .in('id', planIds)
      .is('deleted_at', null);
    if (plansError) throw plansError;

    const planById = new Map<number, PlanRow>((plans ?? []).map((p) => [p.id, p as PlanRow]));
    for (const item of payload.items) {
      if (!planById.has(item.plan_id)) {
        return jsonError(`Plan ${item.plan_id} does not exist or is not active`, 400);
      }
    }

    // Step 2: exactly one membership item.
    const membershipItems = payload.items.filter((item) => planById.get(item.plan_id)!.category === 'membership');
    if (membershipItems.length !== 1) {
      return jsonError('A checkout must include exactly one membership-category item', 400);
    }

    // Step 3: per-item validation + computation.
    const itemsToInsert = [];
    for (const item of payload.items) {
      const plan = planById.get(item.plan_id)!;
      const isIndefinite = plan.duration_days === null;

      // 3b: quantity.
      let quantity = item.quantity ?? 1;
      if (isIndefinite) {
        if (item.quantity !== null && item.quantity !== undefined && item.quantity !== 1) {
          return jsonError(`Plan "${plan.name}" is indefinite and does not accept a quantity`, 400);
        }
        quantity = 1;
      } else if (!Number.isInteger(quantity) || quantity <= 0) {
        return jsonError(`Invalid quantity for plan "${plan.name}"`, 400);
      }

      // 3c: end_date.
      const endDate = isIndefinite ? null : addDays(item.start_date, plan.duration_days! * quantity - 1);

      // 3d: amount_paid.
      const amountPaid = item.amount_paid ?? Number(plan.price) * quantity;
      if (amountPaid < 0) {
        return jsonError(`amount_paid for plan "${plan.name}" cannot be negative`, 400);
      }

      // 3e: shared member (REQ-SUB-004).
      if (item.shared_member_id != null) {
        if (plan.category !== 'membership' || plan.max_members !== 2) {
          return jsonError(`Plan "${plan.name}" does not support a shared member`, 400);
        }
        if (item.shared_member_id === item.member_id) {
          return jsonError('shared_member_id cannot equal member_id', 400);
        }
      }

      // 3f: indefinite-item hard block (REQ-SUB-007) — no override for this one.
      if (isIndefinite) {
        const memberIdsToCheck = [item.member_id, ...(item.shared_member_id ? [item.shared_member_id] : [])];
        const orClause = memberIdsToCheck
          .flatMap((id) => [`member_id.eq.${id}`, `shared_member_id.eq.${id}`])
          .join(',');
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('subscription_items')
          .select('id')
          .eq('plan_id', item.plan_id)
          .is('deleted_at', null)
          .or(orClause)
          .limit(1);
        if (existingError) throw existingError;
        if (existing && existing.length > 0) {
          return jsonError(
            `This member already has an active indefinite item for plan "${plan.name}" — it cannot be attached again`,
            409,
          );
        }
      }

      itemsToInsert.push({
        plan_id: item.plan_id,
        member_id: item.member_id,
        shared_member_id: item.shared_member_id ?? null,
        start_date: item.start_date,
        end_date: endDate,
        quantity,
        amount_paid: amountPaid,
      });
    }

    // Step 4: insert header + all items atomically via one RPC call — see
    // 20260720000300_subscription_rpc_functions.sql for why this can't just be two
    // separate supabase-js insert() calls.
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('create_subscription_with_items', {
      p_caller_id: callerId,
      p_member_id: payload.member_id,
      p_payment_mode: payload.payment_mode,
      p_notes: payload.notes ?? null,
      p_items: itemsToInsert,
    });
    if (rpcError) throw rpcError;

    // Step 5: return the created subscription and its items.
    return jsonResponse(result, 201);
  } catch (err) {
    console.error('create-subscription error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonError(message, 500);
  }
});
