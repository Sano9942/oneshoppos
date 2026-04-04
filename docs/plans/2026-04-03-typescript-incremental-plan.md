# Phase 19: TypeScript Incremental Adoption — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add TypeScript as a zero-runtime-impact safety net — catching permission typos, wrong API shapes, and missing fields at the editor level without renaming any existing `.js` file.

**Architecture:** Hybrid `allowJs` approach. Two `tsconfig.json` files (backend + frontend) with `noEmit: true` — TypeScript checks code but never compiles it. New type files are `.d.ts` declarations (backend) or `.ts` (frontend). Shared runtime constants stay `.js` so Node.js can `require()` them directly. Existing `.js` files opt into checking individually via `// @ts-check` when touched for other reasons.

**Tech Stack:** TypeScript 5.x (devDependency only), Vite path aliases for `@shared/*`, Node.js CommonJS backend, React 19 + Vite 7 frontend.

**Design doc:** `docs/plans/2026-04-03-typescript-incremental-design.md`

---

## Pre-flight Checks

Before starting:
1. Confirm you are on branch `fix/audit-phases-13-21` (or a new branch from `main`)
2. Confirm `npm run typecheck` does NOT exist yet in either `package.json` (it shouldn't — we're adding it)
3. Confirm zero `.ts` files exist: `find . -name "*.ts" | grep -v node_modules` should return empty

---

## Task 1: Install TypeScript in both packages

**Files:**
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

**Step 1: Install in backend**

```bash
cd backend && npm install --save-dev typescript
```

Expected: `typescript` appears in `devDependencies` in `backend/package.json`.

**Step 2: Install in frontend**

```bash
cd frontend && npm install --save-dev typescript
```

Expected: `typescript` appears in `devDependencies` in `frontend/package.json`.
Note: Vite may already have installed it as a transitive dep — this makes it explicit.

**Step 3: Verify**

```bash
cd backend && npx tsc --version
cd frontend && npx tsc --version
```

Expected: Both print `Version 5.x.x`.

**Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
git commit -m "chore: add typescript devDependency to backend and frontend"
```

---

## Task 2: Add `backend/tsconfig.json`

**Files:**
- Create: `backend/tsconfig.json`

**Step 1: Create the file**

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
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["**/*.js", "**/*.ts", "**/*.d.ts"],
  "exclude": ["node_modules", "tests"]
}
```

**Step 2: Add typecheck script to `backend/package.json`**

In the `"scripts"` block, add:
```json
"typecheck": "tsc --noEmit"
```

**Step 3: Run typecheck — expect zero errors**

```bash
cd backend && npm run typecheck
```

Expected: Exits with code 0, no output (or only warnings about untyped modules — those are fine for now).

If you see errors: they are pre-existing issues in JS files. Since `checkJs: false`, this should not happen. If it does, check that `checkJs` is definitely `false` in tsconfig.

**Step 4: Commit**

```bash
git add backend/tsconfig.json backend/package.json
git commit -m "chore: add backend tsconfig.json with allowJs noEmit"
```

---

## Task 3: Add `frontend/tsconfig.json`

**Files:**
- Create: `frontend/tsconfig.json`

**Step 1: Check if tsconfig already exists**

```bash
ls frontend/tsconfig.json 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

If it EXISTS — read it first, then merge the settings below rather than overwriting.
If NOT FOUND — create fresh.

**Step 2: Create / update the file**

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
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 3: Add typecheck script to `frontend/package.json`**

In the `"scripts"` block, add:
```json
"typecheck": "tsc --noEmit"
```

**Step 4: Run typecheck — expect zero errors**

```bash
cd frontend && npm run typecheck
```

Expected: Exits with code 0.

If you see errors about `.jsx` files: add `"allowJs": true` is set and `"jsx": "react-jsx"` is present. If errors about missing React types, run `npm install --save-dev @types/react @types/react-dom` — add those and re-run.

**Step 5: Commit**

```bash
git add frontend/tsconfig.json frontend/package.json
git commit -m "chore: add frontend tsconfig.json with allowJs noEmit"
```

---

## Task 4: Create `shared/constants.js`

**Files:**
- Create: `shared/constants.js`

**Step 1: Create the `shared/` directory and file**

```bash
mkdir -p shared
```

**Step 2: Write `shared/constants.js`**

```js
// @ts-check

/**
 * All permission strings used in requirePerm() (backend) and hasPerm() (frontend).
 * @type {Readonly<{
 *   ALL_ACCESS: 'all_access',
 *   MANAGE_INVENTORY: 'manage_inventory',
 *   MANAGE_ORDERS: 'manage_orders',
 *   VIEW_REPORTS: 'view_reports',
 *   MANAGE_EMPLOYEES: 'manage_employees',
 *   MANAGE_CUSTOMERS: 'manage_customers',
 *   POS_DISCOUNT: 'pos_discount',
 *   VOID_SALES: 'void_sales',
 *   POS_PARK: 'pos_park',
 *   POS_VOID: 'pos_void',
 * }>}
 */
const PERMISSIONS = Object.freeze({
  ALL_ACCESS: 'all_access',
  MANAGE_INVENTORY: 'manage_inventory',
  MANAGE_ORDERS: 'manage_orders',
  VIEW_REPORTS: 'view_reports',
  MANAGE_EMPLOYEES: 'manage_employees',
  MANAGE_CUSTOMERS: 'manage_customers',
  POS_DISCOUNT: 'pos_discount',
  VOID_SALES: 'void_sales',
  POS_PARK: 'pos_park',
  POS_VOID: 'pos_void',
});

/**
 * Tenant subscription lifecycle states.
 * @type {Readonly<{
 *   TRIAL: 'trial',
 *   ACTIVE: 'active',
 *   GRACE: 'grace',
 *   EXPIRED: 'expired',
 * }>}
 */
const BILLING_STATUS = Object.freeze({
  TRIAL: 'trial',
  ACTIVE: 'active',
  GRACE: 'grace',
  EXPIRED: 'expired',
});

/**
 * Cross-cutting feature flag keys (used on both backend and frontend).
 * The full flag set (including ui_redesign_* flags) lives in
 * backend/middleware/feature-flags.js — do not duplicate them here.
 * @type {Readonly<{
 *   FBR_INTEGRATION: 'fbr_integration',
 *   AI_INSIGHTS: 'ai_insights',
 *   ACCOUNTING_CORE: 'accounting_core',
 *   BACKUP_RESTORE: 'backup_restore',
 *   SUPPLIER_PAYABLES: 'supplier_payables',
 * }>}
 */
const FEATURE_FLAGS = Object.freeze({
  FBR_INTEGRATION: 'fbr_integration',
  AI_INSIGHTS: 'ai_insights',
  ACCOUNTING_CORE: 'accounting_core',
  BACKUP_RESTORE: 'backup_restore',
  SUPPLIER_PAYABLES: 'supplier_payables',
});

module.exports = { PERMISSIONS, BILLING_STATUS, FEATURE_FLAGS };
```

**Step 3: Verify Node.js can import it**

```bash
node -e "const { PERMISSIONS } = require('./shared/constants'); console.log(PERMISSIONS.ALL_ACCESS);"
```

Expected output: `all_access`

**Step 4: Verify TypeScript can check it**

```bash
cd backend && npm run typecheck
```

Expected: Still zero errors.

**Step 5: Commit**

```bash
git add shared/constants.js
git commit -m "feat: add shared/constants.js with permissions, billing status, feature flag keys"
```

---

## Task 5: Add Vite path alias for `@shared`

**Files:**
- Modify: `frontend/vite.config.js`

**Step 1: Read the current vite.config.js**

Read `frontend/vite.config.js` in full before editing.

**Step 2: Add the `@shared` alias**

In the `resolve.alias` section (create it if it doesn't exist), add:

```js
import path from 'path';

// inside defineConfig:
resolve: {
  alias: {
    '@shared': path.resolve(__dirname, '../shared'),
    // keep any existing aliases
  },
},
```

Full example if starting from scratch:
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
```

**Step 3: Verify the alias works**

In any frontend component, temporarily add:
```js
import { PERMISSIONS } from '@shared/constants';
console.log(PERMISSIONS.ALL_ACCESS); // should be 'all_access'
```

Run `cd frontend && npm run dev` — check browser console shows `all_access`. Remove the test import after verifying.

**Step 4: Run frontend typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: Zero errors.

**Step 5: Commit**

```bash
git add frontend/vite.config.js
git commit -m "chore: add @shared path alias in Vite config"
```

---

## Task 6: Create `backend/types/express.d.ts`

**Files:**
- Create: `backend/types/express.d.ts`

This is the highest-value file in the plan. It makes `req.tenantId`, `req.employee`, and `req.employeePerms` known to TypeScript across every route file.

**Step 1: Create `backend/types/` directory**

```bash
mkdir -p backend/types
```

**Step 2: Write `backend/types/express.d.ts`**

```ts
// Global augmentation of the Express Request type.
// This file is declaration-only — no runtime code, no imports needed.
// TypeScript picks it up automatically via tsconfig "include".

declare global {
  namespace Express {
    interface Request {
      /** Tenant database ID. Set by loadTenantAndPerms middleware. */
      tenantId?: number;

      /** Tenant URL slug (e.g. "packagesmall"). Set by resolveTenant middleware. */
      tenantSlug?: string;

      /** Authenticated employee. Set by loadTenantAndPerms after JWT decode. */
      employee?: {
        id: number;
        role_id: number;
        name?: string;
      };

      /**
       * Flat array of permission strings for the authenticated employee.
       * e.g. ["view_reports", "manage_inventory"]
       * Use requirePerm() / requireAnyPerm() middleware to check — don't read this directly in routes.
       */
      employeePerms?: string[];

      /** UUID assigned by request-id middleware. Included in all Pino log entries. */
      requestId?: string;

      /** Pino child logger enriched with tenantSlug + employeeId. Set by request-id middleware. */
      log?: {
        info: (msg: string, obj?: object) => void;
        warn: (msg: string, obj?: object) => void;
        error: (msg: string, obj?: object) => void;
        debug: (msg: string, obj?: object) => void;
      };
    }
  }
}

export {};
```

**Step 3: Run typecheck — expect zero errors**

```bash
cd backend && npm run typecheck
```

**Step 4: Verify the augmentation is active (optional editor check)**

Open any route file (e.g. `backend/routes/sales.js`) and type `req.tenantId` — your editor should now autocomplete it and show the `number | undefined` type tooltip. This is the visual confirmation it works.

**Step 5: Commit**

```bash
git add backend/types/express.d.ts
git commit -m "feat: add Express Request type augmentation for tenant/employee fields"
```

---

## Task 7: Create `backend/types/tenant.d.ts` and `backend/types/employee.d.ts`

**Files:**
- Create: `backend/types/tenant.d.ts`
- Create: `backend/types/employee.d.ts`

**Step 1: Write `backend/types/tenant.d.ts`**

```ts
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
```

**Step 2: Write `backend/types/employee.d.ts`**

```ts
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
```

**Step 3: Run typecheck — expect zero errors**

```bash
cd backend && npm run typecheck
```

**Step 4: Commit**

```bash
git add backend/types/tenant.d.ts backend/types/employee.d.ts
git commit -m "feat: add Tenant and Employee declaration types for backend"
```

---

## Task 8: Create `frontend/src/types/auth.ts` and `frontend/src/types/api.ts`

**Files:**
- Create: `frontend/src/types/auth.ts`
- Create: `frontend/src/types/api.ts`

**Step 1: Create `frontend/src/types/` directory**

```bash
mkdir -p frontend/src/types
```

**Step 2: Write `frontend/src/types/auth.ts`**

```ts
/**
 * The employee object stored in AuthProvider after a successful login.
 * Matches the shape returned by POST /api/auth/login and /api/auth/mt-login.
 */
export interface AuthEmployee {
  id: number;
  name: string;
  username: string;
  role_id: number;
  outlet_id: number | null;
  permissions: string[];
  token: string;
  refreshToken?: string;
}

/**
 * Decoded JWT payload shape (for reference — not used at runtime,
 * decoding is done server-side).
 */
export interface JwtPayload {
  eid: number;   // employee id
  tid: number;   // tenant id
  rid: number;   // role id
  iat: number;
  exp: number;
}
```

**Step 3: Write `frontend/src/types/api.ts`**

```ts
/**
 * Standard shape of a successful API response body.
 * Most endpoints return either { data } or a direct object — this covers the wrapper pattern.
 */
export interface ApiOk<T = unknown> {
  data?: T;
  message?: string;
}

/**
 * Standard shape of an error API response body.
 * Backend always returns { error: string } on failure.
 */
export interface ApiError {
  error: string;
  details?: unknown;
}

export type ApiResponse<T = unknown> = ApiOk<T> | ApiError;

/** Type guard to narrow an ApiResponse to the error case. */
export function isApiError(res: ApiResponse): res is ApiError {
  return typeof (res as ApiError).error === 'string';
}
```

**Step 4: Run frontend typecheck — expect zero errors**

```bash
cd frontend && npm run typecheck
```

**Step 5: Commit**

```bash
git add frontend/src/types/auth.ts frontend/src/types/api.ts
git commit -m "feat: add AuthEmployee and ApiResponse TypeScript types for frontend"
```

---

## Task 9: Smoke-test the whole setup end-to-end

**Goal:** Confirm TypeScript actually catches a real mistake before calling Phase 19 done.

**Step 1: Add a deliberate type error in a test file**

Create a temporary file `backend/types/_typecheck-smoke.d.ts`:

```ts
// Temporary smoke test — delete this file after verifying
import { Employee } from './employee';

// This should cause a type error: 'nonexistent_field' does not exist on Employee
declare const emp: Employee;
declare const _test: typeof emp.nonexistent_field; // ERROR expected here
```

**Step 2: Run typecheck — expect ONE error**

```bash
cd backend && npm run typecheck
```

Expected output contains something like:
```
error TS2339: Property 'nonexistent_field' does not exist on type 'Employee'
```

If you see this error — TypeScript is working correctly. If you see zero errors, check that `backend/types/` is included in `tsconfig.json`.

**Step 3: Delete the smoke test file**

```bash
rm backend/types/_typecheck-smoke.d.ts
```

**Step 4: Run typecheck — back to zero errors**

```bash
cd backend && npm run typecheck && cd ../frontend && npm run typecheck
```

Expected: Both pass with zero errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "test: verify TypeScript type checking catches property errors (smoke test passed)"
```

---

## Task 10: Update `docs/architecture-audit.md` Phase 19 status

**Files:**
- Modify: `docs/architecture-audit.md`

**Step 1: Find the Phase 19 section**

Search for `### Phase 19` in `docs/architecture-audit.md`.

**Step 2: Add completion note**

Below the Phase 19 heading, add:

```markdown
**Status:** Foundation complete (2026-04-03). tsconfig × 2, shared/constants.js,
backend/types/ (express + tenant + employee), frontend/src/types/ (auth + api).
Remaining: opportunistic JSDoc on services/middleware when touched for other reasons.
```

**Step 3: Commit**

```bash
git add docs/architecture-audit.md
git commit -m "docs: mark Phase 19 TypeScript foundation as complete"
```

---

## Verification Checklist

After all tasks complete, confirm:

- [ ] `cd backend && npm run typecheck` → exits 0, zero errors
- [ ] `cd frontend && npm run typecheck` → exits 0, zero errors
- [ ] `node -e "require('./shared/constants')"` → no crash
- [ ] `backend/types/express.d.ts` exists and editor shows `req.tenantId` as `number | undefined`
- [ ] No `.js` files were renamed to `.ts`
- [ ] No existing test suites broken: `cd backend && npx jest tests/integration/pg-batch1-crud.test.js`
- [ ] App still boots normally: `cd backend && node index.js` (Ctrl+C after confirming startup)

---

## What's Left After This Plan (Opportunistic — no schedule)

These are done **only when a file is already open for another reason**:

1. Add `// @ts-check` to top of file + JSDoc on changed function in `services/email.js`
2. Add `// @ts-check` + JSDoc to `services/payment-gateway.js` when payment features are added
3. Add `// @ts-check` + JSDoc to `middleware/plan-limits.js` when subscription logic changes
4. Add `// @ts-check` + JSDoc to `services/fbr.js` when FBR features are extended
5. Frontend `api.js` — add JSDoc or convert opportunistically when a new API call is added
6. Route files — `// @ts-check` when a route is modified for a bug fix or feature

The rule: **never open a file just to add types. Types travel with feature work.**
