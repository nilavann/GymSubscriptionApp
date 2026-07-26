import { supabase } from '../lib/supabase-client';
import { extractFunctionErrorMessage } from '../lib/edge-function-error';
import type { Role } from '../types/role';

const ROLE_SELECT = 'id, name, description' as const;

export interface NewRole {
  name: string;
  description: string | null;
}

export type UpdateRole = Partial<NewRole>;

/**
 * Reads/create/update are direct RLS-guarded calls — no Edge Function needed, same
 * reasoning as branches/plans. Read is open to any active user (`roles_select_active_users`,
 * needed so the role picker on Manage Users/Invite User can render every role); insert/update
 * are admin-only. Delete is the one exception — it needs the delete-role Edge Function for
 * its usage guard (used-by-N-users check).
 */
export const roleRepository = {
  /** Live row count for the Settings hub's Data Management card (screens.md WSCR-11). */
  async getCount(): Promise<number> {
    const { count, error } = await supabase.from('roles').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  },

  async getAllActive(): Promise<Role[]> {
    const { data, error } = await supabase.from('roles').select(ROLE_SELECT).order('name');
    if (error) throw error;
    return (data ?? []) as unknown as Role[];
  },

  async create(data: NewRole): Promise<Role> {
    const { data: created, error } = await supabase.from('roles').insert(data).select(ROLE_SELECT).single();
    if (error) throw error;
    return created as unknown as Role;
  },

  async update(id: number, data: UpdateRole): Promise<void> {
    const { error } = await supabase.from('roles').update(data).eq('id', id);
    if (error) throw error;
  },

  async delete(id: number): Promise<void> {
    const { error } = await supabase.functions.invoke('delete-role', { body: { role_id: id } });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
  },
};

export type RoleRepository = typeof roleRepository;
