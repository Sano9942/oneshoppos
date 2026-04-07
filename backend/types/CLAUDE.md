# Types — Claude Guide

- **3 TypeScript declaration files** — reference only, no runtime code
- **`employee.d.ts`** — `Employee` interface (id, name, role, role_id, email, deleted_at, tokens_revoked_before). `Role` interface (id, name, permissions[] — aggregated from join, not a direct column)
- **`express.d.ts`** — augments `Express.Request` with: `tenantId?`, `tenantSlug?`, `employee?`, `employeePerms?`, `id?` (request UUID), `log?` (Pino child). Use middleware guards instead of reading `req.employeePerms` directly
- **`tenant.d.ts`** — `Tenant` interface (id, slug, name, plan, status). `TenantPlan` interface (max_outlets, max_employees, max_products). `0` = unlimited in plan limits
