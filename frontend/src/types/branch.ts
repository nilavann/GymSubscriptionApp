/** Mirrors an active `branches` row — see spec/backend/database.md. */
export interface Branch {
  id: number;
  name: string;
  code: string;
}
