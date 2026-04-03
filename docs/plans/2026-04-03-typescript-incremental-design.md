# Phase 19: TypeScript Incremental Adoption — Design

**Date:** 2026-04-03  
**Branch:** to be created from `main`  
**Effort:** 1–2 weeks  
**Priority:** Whenever (no production urgency)

---

## What This Does

Adds TypeScript as a **safety net**, not a rewrite. Existing `.js` files are never renamed or restructured. TypeScript watches the codebase and catches bugs (typos in permission strings, wrong API shapes, missing fields) at the editor level before they reach production.

Node.js still runs `.js` files directly. Vite still bundles the frontend. Zero runtime changes.

---

## Approach: Hybrid (allowJs + new `.ts`/`.d.ts` files)

- `tsconfig.json` added to both `backend/` and `frontend/` with `allowJs: true`, `noEmit: true`
- All existing `.js` files stay `.js` — untouched
- New **type-only** files written as `.d.ts` (backend declarations) or `.ts` (frontend, Vite-native)
- Shared runtime constants stay as `.js` (`shared/constants.js`) so Node.js can `require()` them
- Existing `.js` files opt into checking individually via `// @ts-check` at the top, added only when a file is touched for another reason

**Why not rename services to `.ts` now?**  
The backend is CommonJS (`require`/`module.exports`). Renaming 16 service and middleware files to `.ts` risks import resolution quirks, requires `ts-node` or a compile step, and contradicts the "zero breaking changes" goal. The hybrid approach gives 80% of the value at 5% of the risk.

---

## File Structure

```
oneshoppos/
├── shared/
│   └── constants.js          ← NEW: runtime constants, @ts-check, Node-importable
│
├── backend/
│   ├── tsconfig.json         ← NEW: allowJs, noEmit, commonjs
│   └── types/
│       ├── express.d.ts      ← NEW: augments Express.Request with tenant/employee fields
│       ├── tenant.d.ts       ← NEW: Tenant, Plan, TenantPlan interfaces
│       └── employee.d.ts     ← NEW: Employee, Role interfaces
│
└── frontend/
    ├── tsconfig.json         ← NEW: allowJs, noEmit, bundler moduleResolution
    └── src/types/
        ├── auth.ts           ← NEW: AuthEmployee, JWT payload shape
        └── api.ts            ← NEW: common API response wrappers
```

---

## File Details

### `shared/constants.js`

Plain JavaScript with `// @ts-check`. Importable by both Node.js (`require`) and Vite (ESM `import`).

Contains only the constants used on **both** backend and frontend:

**Permissions** — all 10 permission strings used in `requirePerm()` (backend) and `hasPerm()` (frontend):
- `all_access`, `manage_inventory`, `manage_orders`, `view_reports`
- `manage_employees`, `manage_customers`, `pos_discount`, `void_sales`, `pos_park`, `pos_void`

**Billing status** — trial lifecycle states used in subscription middleware and frontend banners:
- `trial`, `active`, `grace`, `expired`

**Feature flags (shared subset only)** — integration flags referenced in both sides:
- `fbr_integration`, `ai_insights`, `accounting_core`, `backup_restore`, `supplier_payables`
- The 30+ `ui_redesign_*` flags stay in `backend/middleware/feature-flags.js` — backend-internal only

**Import pattern:**
```js
// backend — CommonJS
const { PERMISSIONS, BILLING_STATUS } = require('../shared/constants');

// frontend — ESM via Vite path alias
import { PERMISSIONS, BILLING_STATUS } from '@shared/constants';
```

---

### `backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["../shared/*"] }
  },
  "include": ["**/*.js", "**/*.ts", "**/*.d.ts"],
  "exclude": ["node_modules", "tests"]
}
```

`checkJs: false` globally — existing `.js` files are not checked unless they opt in with `// @ts-check`. This means zero noise from legacy code on day one.

---

### `backend/types/express.d.ts`

The highest-value file in the entire plan. Augments Express `Request` so every route file gets type-aware access to `req.tenantId`, `req.employee`, `req.employeePerms` — fields set by `tenant-auth.js` middleware that TypeScript currently knows nothing about.

Shape confirmed from reading `backend/middleware/tenant-auth.js`:

```ts
declare global {
  namespace Express {
    interface Request {
      tenantId?: number;       // decoded.tid from JWT
      tenantSlug?: string;     // resolved by resolveTenant middleware
      employee?: {
        id: number;            // decoded.eid
        role_id: number;       // decoded.rid
        name?: string;         // loaded after JWT decode from DB
      };
      employeePerms?: string[]; // loaded from role_permissions table
      requestId?: string;       // UUID set by request-id middleware
      log?: object;             // Pino child logger (typed loosely to avoid @types/pino dep)
    }
  }
}

export {};
```

Note: `outlet_id` is intentionally NOT on `req.employee` — employees belong to multiple outlets, resolved per-context, not per-request.

---

### `backend/types/tenant.d.ts`

```ts
export interface Tenant {
  id: number;
  slug: string;
  name: string;
  plan: string;
  status: string;
  schema_name: string;
}

export interface TenantPlan {
  max_outlets: number;
  max_employees: number;
  max_products: number;
  features: string[];
}
```

---

### `backend/types/employee.d.ts`

```ts
export interface Employee {
  id: number;
  name: string;
  username: string;
  role_id: number;
  outlet_id: number | null;
  email: string | null;
  is_active: boolean;
}

export interface Role {
  id: number;
  name: string;
  permissions: string[];
}
```

---

### `frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": false,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@shared/*": ["../shared/*"] }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

`moduleResolution: "bundler"` — correct for Vite. Do NOT use `"node"` or `"node16"` — Vite's bundler does not follow Node resolution for bare imports.

---

### `frontend/src/types/auth.ts`

```ts
export interface AuthEmployee {
  id: number;
  name: string;
  role_id: number;
  username: string;
  outlet_id: number | null;
  permissions: string[];
  token: string;
  refreshToken?: string;
}

export interface JwtPayload {
  eid: number;   // employee id
  tid: number;   // tenant id
  rid: number;   // role id
  iat: number;
  exp: number;
}
```

---

### `frontend/src/types/api.ts`

```ts
export interface ApiOk<T = unknown> {
  data?: T;
  message?: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

export type ApiResponse<T = unknown> = ApiOk<T> | ApiError;
```

---

## JSDoc Opt-in Strategy

For existing `.js` files in `services/` and `middleware/` — no renames, no rewrites. When a file is touched for any other reason (bug fix, new feature), add two things:

1. `// @ts-check` at the top of the file
2. JSDoc on the specific function being changed

Example:
```js
// @ts-check
const { PERMISSIONS } = require('../../shared/constants');

/**
 * @param {import('../types/employee').Employee} employee
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission(employee, permission) { ... }
```

This is **opportunistic** — never touch a file just to add JSDoc. Only when the file is already open for another change.

---

## Migration Order

| Step | What | Files | Risk |
|------|------|-------|------|
| 1 | Install `typescript` dev dep | `backend/package.json`, `frontend/package.json` | Zero |
| 2 | Add `tsconfig.json` files | `backend/tsconfig.json`, `frontend/tsconfig.json` | Zero |
| 3 | Add `shared/constants.js` | New file | Zero |
| 4 | Add Vite path alias for `@shared` | `frontend/vite.config.js` | Minimal |
| 5 | Add `backend/types/express.d.ts` | New file | Zero |
| 6 | Add `backend/types/tenant.d.ts` + `employee.d.ts` | New files | Zero |
| 7 | Add `frontend/src/types/auth.ts` + `api.ts` | New files | Zero |
| 8 | Add `typecheck` scripts to both `package.json` | Config only | Zero |
| 9 | Services/middleware JSDoc | Opportunistic, when touched | Minimal |
| 10 | Route files | Opportunistic only | Minimal |

---

## npm Scripts Added

```json
// backend/package.json
"typecheck": "tsc --noEmit"

// frontend/package.json  
"typecheck": "tsc --noEmit"
```

Run `npm run typecheck` to see all type errors without compiling anything.

---

## What This Does NOT Do

- Does NOT rename any `.js` file to `.ts`
- Does NOT add a build step — Node.js and Vite run unchanged
- Does NOT enable `strict: true` — too much noise on day one with existing JS
- Does NOT add `ts-node` — backend still runs with `node`
- Does NOT migrate route files proactively — only when touched for other reasons
- Does NOT enumerate all 40 feature flags in shared — only the 5 cross-cutting ones

---

## Dependencies Added

```
backend:  typescript (devDependency)
frontend: typescript (devDependency) — likely already present via Vite, confirm first
```

No `@types/express` required for the `.d.ts` declaration approach (global augmentation works without it). Add `@types/express` only if/when a service file is converted to `.ts` and needs Express types directly.

---

## Success Criteria

- `npm run typecheck` passes in both `backend/` and `frontend/` with zero errors
- A typo in a permission string (e.g. `"manage_inventori"`) shows a red underline in the editor immediately
- No existing test suite broken
- No change to how the app boots or runs
