/** A role name, as stored in `roles.name` (admin-managed catalog, spec/backend/auth.md §2). */
export type ProfileRole = string;

/** Mirrors `profiles_with_roles` — see spec/backend/auth.md §2. A user can hold more than
 * one role, hence `roles: ProfileRole[]` rather than a single `role`. */
export interface Profile {
  id: string;
  full_name: string;
  roles: ProfileRole[];
  is_active: boolean;
}

/**
 * A `Profile` plus its `auth.users.email` — only obtainable via the `list-users` Edge
 * Function (service role), since `profiles` itself has no email column (spec/backend/
 * edge-functions.md §5). Feeds the Manage Users screen (screens.md WSCR-09).
 */
export interface ManagedUser extends Profile {
  email: string;
}
