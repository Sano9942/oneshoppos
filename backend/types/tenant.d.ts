/** A row from the master `tenants` table. */
export interface Tenant {
  id: number;
  slug: string;
  name: string;
  plan: string;
  status: string;
  schema_name: string;
  created_at: string;
}

/** Plan capacity limits and feature gates for a tenant. */
export interface TenantPlan {
  max_outlets: number;
  max_employees: number;
  max_products: number;
  features: string[];
}
