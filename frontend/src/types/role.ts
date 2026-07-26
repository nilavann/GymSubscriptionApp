/** Mirrors the `roles` row — see spec/backend/auth.md §2 / domain-model.md §Role. */
export interface Role {
  id: number;
  name: string;
  description: string | null;
}
