/** A row from the tenant `employees` table. */
export interface Employee {
  id: number;
  name: string;
  username: string;
  role_id: number;
  outlet_id: number | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

/** A row from the tenant `roles` table with its permissions joined. */
export interface Role {
  id: number;
  name: string;
  permissions: string[];
}
