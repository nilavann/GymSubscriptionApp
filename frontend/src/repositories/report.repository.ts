import { supabase } from '../lib/supabase-client';
import type { ReportTransactionRow } from '../types/report';

const ITEM_SELECT = 'id, subscription_id, plan_id, member_id, start_date, amount_paid' as const;
const SUBSCRIPTION_SELECT = 'id, payment_mode' as const;
const PLAN_SELECT = 'id, name, category' as const;
const MEMBER_SELECT = 'id, name, phone, member_number' as const;

interface RawItem {
  id: number;
  subscription_id: number;
  plan_id: number;
  member_id: number;
  start_date: string;
  amount_paid: number;
}

/**
 * Every plan referenced by a non-deleted subscription_items row is guaranteed active — the
 * plan-deletion usage guard blocks deleting a plan still in use (spec/backend/reporting.md §2).
 */
function dedupe(ids: number[]): number[] {
  return Array.from(new Set(ids));
}

/**
 * Fetches flat rows and joins client-side in TypeScript rather than a Postgres-side nested
 * select — same pattern as subscriptionRepository, avoiding supabase-js's dynamic-select
 * type-inference bug (see member.repository.ts). No Edge Function needed — RLS already
 * permits every table read here to any active user (spec/backend/reporting.md §3).
 */
export const reportRepository = {
  async getTransactions(startDate: string, endDate: string): Promise<ReportTransactionRow[]> {
    const { data: items, error: itemsError } = await supabase
      .from('subscription_items')
      .select(ITEM_SELECT)
      .gte('start_date', startDate)
      .lte('start_date', endDate);
    if (itemsError) throw itemsError;
    const rows = (items ?? []) as unknown as RawItem[];
    if (rows.length === 0) return [];

    const [subscriptionsResult, plansResult, membersResult] = await Promise.all([
      supabase
        .from('subscriptions')
        .select(SUBSCRIPTION_SELECT)
        .in('id', dedupe(rows.map((r) => r.subscription_id))),
      supabase
        .from('plans')
        .select(PLAN_SELECT)
        .in('id', dedupe(rows.map((r) => r.plan_id))),
      supabase
        .from('members')
        .select(MEMBER_SELECT)
        .in('id', dedupe(rows.map((r) => r.member_id))),
    ]);
    if (subscriptionsResult.error) throw subscriptionsResult.error;
    if (plansResult.error) throw plansResult.error;
    if (membersResult.error) throw membersResult.error;

    const subscriptionMap = new Map(
      ((subscriptionsResult.data ?? []) as unknown as { id: number; payment_mode: ReportTransactionRow['payment_mode'] }[]).map(
        (s) => [s.id, s.payment_mode]
      )
    );
    const planMap = new Map(
      ((plansResult.data ?? []) as unknown as { id: number; name: string; category: 'membership' | 'addon' }[]).map((p) => [
        p.id,
        p,
      ])
    );
    const memberMap = new Map(
      ((membersResult.data ?? []) as unknown as { id: number; name: string; phone: string; member_number: string }[]).map(
        (m) => [m.id, m]
      )
    );

    return rows.map((row) => {
      const plan = planMap.get(row.plan_id);
      const member = memberMap.get(row.member_id);
      return {
        subscription_item_id: row.id,
        member_id: row.member_id,
        member_name: member?.name ?? 'Unknown member',
        member_number: member?.member_number ?? '—',
        phone: member?.phone ?? '—',
        transaction_type: plan?.category === 'addon' ? 'Add-on' : 'Subscription',
        plan_name: plan?.name ?? 'Unknown plan',
        start_date: row.start_date,
        amount_paid: row.amount_paid,
        payment_mode: subscriptionMap.get(row.subscription_id) ?? 'Cash',
      };
    });
  },
};

export type ReportRepository = typeof reportRepository;
