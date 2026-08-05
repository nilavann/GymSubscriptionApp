import { supabase } from '../lib/supabase-client';
import { extractFunctionErrorMessage } from '../lib/edge-function-error';
import type { Plan, PlanCategory } from '../types/plan';

const PLAN_SELECT = 'id, name, category, duration_days, price, max_members' as const;

export interface NewPlan {
  name: string;
  category: PlanCategory;
  duration_days: number | null;
  price: number;
  max_members: number;
}

export type UpdatePlan = Partial<NewPlan>;

/**
 * Reads/create/update are direct RLS-guarded calls — no Edge Function needed
 * (master-data-management.md §3), same reasoning as branches. Read is open to any active
 * user (`plans_select_active_users`); insert/update are admin-only. Delete is the one
 * exception — it needs the delete-plan Edge Function for its usage guard (§5).
 */
export const planRepository = {
  /** Live row count for the Settings hub's Data Management card (screens.md WSCR-11). */
  async getCount(): Promise<number> {
    const { count, error } = await supabase.from('plans').select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  async getAllActive(): Promise<Plan[]> {
    const { data, error } = await supabase.from('plans').select(PLAN_SELECT).order('name');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Plan[];
  },

  async create(data: NewPlan): Promise<Plan> {
    const { data: created, error } = await supabase.from('plans').insert(data).select(PLAN_SELECT).single();
    if (error) throw new Error(error.message);
    return created as unknown as Plan;
  },

  async update(id: number, data: UpdatePlan): Promise<void> {
    const { error } = await supabase.from('plans').update(data).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async delete(id: number): Promise<void> {
    const { error } = await supabase.functions.invoke('delete-plan', { body: { plan_id: id } });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
  },
};

export type PlanRepository = typeof planRepository;
