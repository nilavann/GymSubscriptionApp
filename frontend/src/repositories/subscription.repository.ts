import { supabase } from '../lib/supabase-client';
import { extractFunctionErrorMessage } from '../lib/edge-function-error';
import type { CreateSubscriptionResult, NewSubscription, Subscription, SubscriptionItem, UpdateSubscription } from '../types/subscription';
import type { MemberCurrentItem } from '../types/member-current-item';

const CURRENT_ITEM_SELECT =
  'subscription_item_id, subscription_id, plan_id, plan_name, category, member_id, start_date, end_date, quantity, amount_paid' as const;

/**
 * subscriptions/subscription_items are read-only for direct client access (RLS grants no
 * insert/update) — create-subscription/update-subscription Edge Functions are the only
 * write path. See spec/backend/subscription-management.md §4/§5.
 */
export const subscriptionRepository = {
  /** Live row count for the Settings hub's count-only Subscriptions card (screens.md WSCR-11). */
  async getCount(): Promise<number> {
    const { count, error } = await supabase.from('subscriptions').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  },

  /** member_current_items for one member — feeds the Renewal Start Date Default and the Overlap Warning. */
  async getCurrentItemsForMember(memberId: number): Promise<MemberCurrentItem[]> {
    const { data, error } = await supabase
      .from('member_current_items')
      .select(CURRENT_ITEM_SELECT)
      .eq('member_id', memberId);
    if (error) throw error;
    return (data ?? []) as unknown as MemberCurrentItem[];
  },

  async getHistoryForMember(memberId: number): Promise<Subscription[]> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, member_id, payment_mode, notes, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Subscription[];
  },

  async getItemsForSubscriptions(subscriptionIds: number[]): Promise<SubscriptionItem[]> {
    if (subscriptionIds.length === 0) return [];
    const { data, error } = await supabase
      .from('subscription_items')
      .select('id, subscription_id, plan_id, member_id, shared_member_id, start_date, end_date, quantity, amount_paid')
      .in('subscription_id', subscriptionIds);
    if (error) throw error;
    return (data ?? []) as unknown as SubscriptionItem[];
  },

  async create(payload: NewSubscription): Promise<CreateSubscriptionResult> {
    const { data, error } = await supabase.functions.invoke('create-subscription', { body: payload });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
    return data as CreateSubscriptionResult;
  },

  async update(payload: UpdateSubscription): Promise<void> {
    const { error } = await supabase.functions.invoke('update-subscription', { body: payload });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
  },
};

export type SubscriptionRepository = typeof subscriptionRepository;
