import { profileRepository, type InviteUser, type UpdateUser } from '../repositories/profile.repository';
import type { ManagedUser, Profile, ProfileRole } from '../types/profile';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteUserDraft {
  email: string;
  full_name: string;
  roles: ProfileRole[];
}

export type InviteUserFormErrors = Partial<Record<'email' | 'full_name' | 'roles', string>>;

export interface EditUserDraft {
  full_name: string;
  roles: ProfileRole[];
  is_active: boolean;
}

export type EditUserFormErrors = Partial<Record<'full_name' | 'roles', string>>;

/** screens.md WSCR-10 §Fields. */
export function validateInvite(form: InviteUserDraft): InviteUserFormErrors {
  const errors: InviteUserFormErrors = {};
  if (!form.email.trim()) {
    errors.email = 'Email is required';
  } else if (!EMAIL_REGEX.test(form.email.trim())) {
    errors.email = 'Enter a valid email address';
  }
  const name = form.full_name.trim();
  if (!name) {
    errors.full_name = 'Name is required';
  } else if (name.length < 2 || name.length > 80) {
    errors.full_name = 'Name must be 2-80 characters';
  }
  if (form.roles.length === 0) {
    errors.roles = 'Select at least one role';
  }
  return errors;
}

/** screens.md WSCR-09 §Edit — same 2-80 char rule as invite. */
export function validateEditUser(form: EditUserDraft): EditUserFormErrors {
  const errors: EditUserFormErrors = {};
  const name = form.full_name.trim();
  if (!name) {
    errors.full_name = 'Name is required';
  } else if (name.length < 2 || name.length > 80) {
    errors.full_name = 'Name must be 2-80 characters';
  }
  if (form.roles.length === 0) {
    errors.roles = 'Select at least one role';
  }
  return errors;
}

export function isFormValid(errors: Record<string, string | undefined>): boolean {
  return Object.keys(errors).length === 0;
}

export const userService = {
  validateInvite,
  validateEditUser,
  isFormValid,

  async getAll(): Promise<ManagedUser[]> {
    return profileRepository.getAllUsers();
  },

  async invite(form: InviteUserDraft): Promise<void> {
    const payload: InviteUser = { email: form.email.trim(), full_name: form.full_name.trim(), roles: form.roles };
    return profileRepository.invite(payload);
  },

  /**
   * Only the fields actually supplied are sent — a caller editing their own row must
   * only ever pass `full_name` here, since `update-user` rejects `roles`/`is_active` on
   * the caller's own id (edge-functions.md §5 item 2). The Manage Users screen enforces
   * that client-side too (disabled controls on the signed-in admin's own row).
   */
  async update(id: string, patch: UpdateUser): Promise<Profile> {
    return profileRepository.update(id, patch);
  },

  async delete(id: string): Promise<void> {
    return profileRepository.delete(id);
  },
};

export type UserService = typeof userService;
