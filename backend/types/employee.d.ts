/** A row from the tenant `employees` table. */
export interface Employee {
  id: number;
  name: string;
  role: string;
  role_id: number;
  email: string | null;
  /** Soft-delete timestamp — null means active. */
  deleted_at: string | null;
  tokens_revoked_before: string | null;
  joining_date: string | null;
  department: string | null;
}

/** A row from the tenant `roles` table with its permissions joined in. */
export interface Role {
  id: number;
  name: string;
  /** Aggregated from role_permissions join — not a direct DB column. */
  permissions: string[];
}
