import { roleRepository, type NewRole } from '../repositories/role.repository';
import type { Role } from '../types/role';

/** The Role form's working state — see spec/frontend/master-data-management.md. */
export interface RoleDraft {
  name: string;
  description: string;
}

export function emptyRoleDraft(): RoleDraft {
  return { name: '', description: '' };
}

export function roleToDraft(role: Role): RoleDraft {
  return { name: role.name, description: role.description ?? '' };
}

export type RoleFormErrors = Partial<Record<keyof RoleDraft, string>>;

export function validateRole(form: RoleDraft): RoleFormErrors {
  const errors: RoleFormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  return errors;
}

export function isRoleFormValid(errors: RoleFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

function draftToNewRole(form: RoleDraft): NewRole {
  return { name: form.name.trim(), description: form.description.trim() || null };
}

export const roleService = {
  emptyRoleDraft,
  roleToDraft,
  validateRole,
  isRoleFormValid,

  async create(form: RoleDraft): Promise<Role> {
    return roleRepository.create(draftToNewRole(form));
  },

  async update(id: number, form: RoleDraft): Promise<void> {
    return roleRepository.update(id, draftToNewRole(form));
  },
};

export type RoleService = typeof roleService;
