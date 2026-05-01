# Backend — Claude Guide

Node.js + Express v5 + PostgreSQL. Single active DB (Postgres). Multi-tenant routing via AsyncLocalStorage proxy. Deployed on Railway.

---

## DO NOT READ These Files

- `backups/`, `archive/legacy/`, `tenants/`, `exports/`, `uploads_test/`, `uploads_tmp/`
- `schema.sql` — SQLite legacy DDL. Superseded by `schema-pg.sql`
- `schema_dump.txt` — corrupted SQLite dump artifact
- `_endpoint_list.txt` — generated endpoint list, likely stale
- `BACKEND-AUDIT.md` — historical audit doc, may contradict current state

---

## Entry Point — `index.js`

~293-line orchestrator. Key responsibilities:
- Loads dotenv (line 1, before any `require`) — `db-pg.js` does NOT load dotenv itself
- Initialises Sentry if `SENTRY_DSN` is set
- Bootstraps multi-tenant proxy when `MULTI_TENANT=1`
- Calls `tenantAuth.init(mtDeps)` and `featureFlags.init(mtDeps)` to inject shared deps
- Registers all routes via `registerAllRoutes.js`
- Starts workers via `boot/workers.js`
- Calls `ensureCriticalRoutesRegistered()` — crashes boot if 4 routes are missing

**Middleware chain (request lifecycle order):**

```
1.  helmet               — security headers (CSP + COEP disabled)
2.  cors                 — CORS_ORIGIN CSV or localhost:5173
3.  express.json(10mb)   — rawBody captured for /api/webhooks/* and Shopify webhooks
4.  malformed JSON → 400 — prevents Sentry bubble on entity.parse.failed
5.  /uploads static      — single-tenant static file serving
6.  /r2/*key proxy       — streams R2 object (when R2_PUBLIC_URL not set)
7.  compression
8.  cookieParser
9.  globalLimiter        — 600/min default (skips POS burst paths)
10. requestId            — UUID per request (X-Request-Id header)

--- admin routes (routes/admin/) mount here — NO tenant context ---
--- webhook routes (routes/webhooks.js) mount here — NO auth, signature-verified ---

11. loadTenantAndPerms   — decode JWT, attach req.employee + req.employeePerms + req.tenantId
12. resolveTenant        — SET search_path, run asyncStore, wire deps.db proxy
13. tenant /uploads      — serve tenant-specific uploaded files
14. loadCompanyProfile   — query company_profile → req.company (timezone, currency, FBR config)
15. resolveContext       — read x-outlet-id / x-scope-mode headers → req.context

--- all tenant routes mount here ---

16. requirePerm / requireAnyPerm  — per-route permission check
17. requireFeature / requireMode  — per-route feature flag / mode check
18. validate(schema)              — per-route Zod body validation
19. requirePlanLimit(resource)    — plan cap enforcement (POST only)
20. requireActiveSubscription     — blocks writes when payment_status = 'expired'
```

**Boot-time assertions:**
- `ensureCriticalRoutesRegistered()` verifies: `POST /api/products/bulk-import`, `POST /api/products/bulk-delete`, `POST /api/products/bulk-status`, `DELETE /api/integrations/shopify/import/products`
- `ADMIN_ALLOWED_IPS` unset in prod → logs `[SECURITY]` error at boot

---

## Database

### `db-pg.js`
Direct Postgres pool (size: 20). Exports: `query`, `transaction`, `getClient`, `end`, `pool`.
- Does NOT load dotenv — callers are responsible
- SSL disabled in non-prod
- Results: `{ rows, rowCount }` — access via `rows[0]`, `rows`, `rowCount`

**Postgres query conventions:**
- Placeholders: `$1, $2` (not `?`)
- Booleans: `true`/`false` (not `1`/`0`)
- Case-insensitive search: `ILIKE`
- Date extraction: `col::date`
- String agg: `string_agg()` — not `GROUP_CONCAT`
- JSON agg: `json_agg(json_build_object(...))`
- ROUND requires numeric cast: `ROUND(expr::numeric, 2)`
- NUMERIC columns return strings from pg — wrap with `Number()` before arithmetic
- All non-aggregated SELECT columns must appear in GROUP BY
- Reserved word: `read` column is named `is_read` in the notifications table

### `tenant-db-proxy-pg.js`
AsyncLocalStorage-based Proxy. Exports: `asyncStore`, `createDbProxy`, `getCurrentDb`.
- Proxies `query`, `transaction`, `getClient` — delegates to whichever tenant DB is in the ALS context
- `resolveTenant` middleware runs `asyncStore.run({ db: tenantDb }, () => next())` to wire context
- This is what makes `deps.db` route queries to the correct tenant schema

### `tenant-db-manager-pg.js`
Per-tenant DB manager. Exports: `init`, `getDb`, `healthCheck`, `clearCache`, `closeDb`, `closeAll`.
- 60-second tenant cache; resets `search_path` on every query
- Called by `resolveTenant` middleware to get a scoped DB handle

### `tenant-db-pg.js`
Older ALS proxy (checks out one pool client per request via `runWithTenant`). Exports: `asyncStore`, `getProxy`, `getStore`, `runWithTenant`. Proxy only has `query` + `transaction` — no `getClient`. Use `tenant-db-proxy-pg.js` for new code.

### `schema-pg.sql`
DDL source of truth (~3,788 lines, 244 tables). Grep for table names rather than reading the full file.

### `migrate-pg.js`
Exports: `{ migrate, MIGRATIONS }`. CLI: `node backend/migrate-pg.js` (no flags).
- Migrates public schema first, then all `status='active'` tenant schemas sequentially
- Each tenant has its own `schema_version` table
- Per-tenant failures are caught and logged — one failure does not abort the run
- Existing tenants need `schema_version` pre-populated or migrate will attempt to re-apply v1
- Current version: 49

### `master-db-pg.js`
Master tenant registry. Exports: `init`, `createTenant`, `getTenantBySlug`, `getTenantById`, `query`.
- Manages 10 public tables: `tenants`, `super_admins`, `tenant_audit_log`, `schema_migrations`, `tenant_refresh_tokens`, `plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`, `impersonation_sessions`
- `query()` always sets `search_path` to public

---

## Middleware

All middleware in `backend/middleware/`. Chain order documented above.

### `tenant-auth.js`
Exports: `init(deps)`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveContext`, `loadEmployeePerms`, `invalidateCompanyProfileCache`

Requires `init({ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore })` at boot.

- **`loadTenantAndPerms`** — JWT auth. Sets `req.employee`, `req.employeePerms`, `req.tenantId`, `req.tokenScope`, `req.isImpersonating`. No auth header → sets empty perms and calls `next()` (does not reject). Kiosk scope restricts to attendance/auth paths. Token revocation checked against `revoked_tokens` table + `employees.tokens_revoked_before`. Permission load retries once on transient DB failure; both failures → 503 instead of silent empty-perms.
- **`resolveTenant`** — No-op in ST mode. In MT: resolves tenant, calls `tenantDbManager.getDb()`, runs `asyncStore.run(...)` to wire `deps.db`. Sets `req.tenantSlug`, `req.tenantDir`. Error codes: `TENANT_NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_DELETED` (all 403).
- **`loadCompanyProfile`** — Reads `company_profile WHERE id = 1`. 5-minute cache per tenant (stale-while-revalidate). Sets `req.company`. Blocks with 503 `SETUP_REQUIRED` if `setup_complete` is falsy and path is not `/api/setup*` or `/api/health*`.
- **`resolveContext`** — Reads `x-outlet-id`, `x-company-id`, `x-scope-mode` headers. Sets `req.context`. When `context_header_enforced` flag is on, non-admin employees without `x-outlet-id` get 428 `CONTEXT_REQUIRED` (exempt: auth, context, feature-flags, attendance, roles, outlets paths).

### `permissions.js`
Exports: `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, `DEFAULT_ROLE_PERMISSIONS`, `PERMISSION_RULES`, `ensureDefaultRolePermissions`

- **`requirePerm(permission)`** — `all_access` bypasses everything. Returns 403 on failure.
- **`requireAnyPerm(permissions[])`** — passes if employee has `all_access` OR any one listed.
- **`requireContextOutlet`** — backfills `req.query.outlet_id` from `req.context.outletId` if absent.
- **`DEFAULT_ROLE_PERMISSIONS`**: Administrator = `all_access`; Manager = 21 permissions (manage_inventory, manage_orders, view_reports, manage_employees, pos_discount, void_sales, pos_park, pos_void, manage_restaurant, manage_kds, manage_bookings, manage_projects, manage_contracts, manage_tickets, manage_rentals, manage_rooms, manage_treatment_plans, manage_tips, override_void_comp, manage_gift_cards, override_price); Cashier = view_reports, pos_discount, pos_park.
- **`PERMISSION_RULES`** — declarative array covering common route-level guards; consumed by test helpers and route registration.

### `feature-flags.js`
Exports: `init(deps)`, `DEFAULT_FEATURE_FLAGS`, `requireFeature`, `requireMode`, `getFeatureFlagsMap`, `getModesMap`, `invalidateFeatureFlagCache`, `invalidateModeCache`, `createNotification`, `notifyLowStockForSale`

Requires `init({ db, IS_MULTI_TENANT, tenantDbManager, dbProxy })` at boot.

- **`requireFeature(flagKey)`** — 403 if flag is off. 500 on DB error.
- **`requireMode(modeName)`** — 403 if mode row is absent. Falls through if modes table is empty (pre-migration).
- Flags: 60s cache per tenant. Merges `DEFAULT_FEATURE_FLAGS` with DB rows. Gracefully degrades if `feature_flags` table is missing.
- **Gotchas**: `fbr_integration` is NOT in `DEFAULT_FEATURE_FLAGS` (DB-seeded by migration v9). `ai_insights` is a soft check in the route, not enforced via `requireFeature`. Shopify routes are gated by connection check, not a flag.

### `plan-limits.js`
Exports: `requirePlanLimit`, `requireActiveSubscription`, `PLAN_DEFAULTS`

- **`requirePlanLimit(resource)`** — resource must be `"employees"`, `"outlets"`, or `"products"`. No-op in ST mode. `0` or `null` in DB = unlimited. Returns 403 `{ code: "PLAN_LIMIT_REACHED" }` at cap. DB failure → best-effort, calls `next()`.
- **`requireActiveSubscription`** — no-op for: GET/OPTIONS/HEAD, ST mode, auth/billing/support/setup/health/receipts paths, free plan tenants. `payment_status = 'expired'` → 403 `{ code: "SUBSCRIPTION_EXPIRED" }`. Uses `.then()` not `await` — outer function is synchronous.
- **Plan defaults**: Free = 1 outlet / 3 employees / 100 products; Pro = 1 outlet / unlimited employees / unlimited products.
- **Subscription lifecycle**: Trial (45 days) → Grace (7 days) → Expired (read-only).

### `rate-limit.js`
Exports: `globalLimiter`, `authLimiter`, `webhookLimiter`, `reviewLimiter`, `publicBookingLimiter`, `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter`

All return 429 with `Retry-After` header and `{ error, retry_after_seconds }`. `globalLimiter` skips POS burst paths (`/api/sales`, `/api/products/search`, `/api/products/scan/`, `/api/orders`). Portal limiters key on `?tenant=` / `x-tenant-slug` header (no `req.tenantSlug` at that point).

### `validate.js`
Exports: `{ validate }`

- `validate(schema)` — Zod middleware factory. On success, replaces `req.body` with parsed result. On `ZodError`: 400 `{ error, details: [{ field, message }] }`. Field is dot-joined path (e.g. `"items.0.price"`).

### `upload-validation.js`
Exports: `imageFileFilter`, `rasterImageFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, `ALLOWED_IMAGE_MIMES`, `ALLOWED_IMAGE_EXTS`

- `imageFileFilter` — multer fileFilter, checks mimetype + extension, allows SVG.
- `rasterImageFileFilter` — stricter, excludes SVG (prevents XSS on same-origin serving). Use for support screenshots.
- `verifyImageMagicBytes` — catches faked Content-Type after upload (e.g. exe renamed to jpg).

### `request-id.js`
Exports: default `requestId`, named `requestId.enrichReqLog`

- Wraps `pino-http`. UUID per request (honours `X-Request-Id` header). Sets `X-Request-Id` response header, `req.log`, `req.id`, `req._startTime`.
- `enrichReqLog` — wire after `loadTenantAndPerms` to rebind `req.log` with `{ tenantSlug, employeeId }`.
- Log levels: error for 5xx/thrown, warn for 4xx/>2000ms, info otherwise.

### `customer-auth.js`
Customer portal auth (separate JWT secret from employee auth). Exports: `loadCustomerAuth(deps)`, `signCustomerTokens`, `verifyCustomerToken`, `hashRefreshToken`, `getSecret`.

- Portal routes use: `customerPortalAuthLimiter` → `loadCustomerAuth(deps)` → handler (never sets `req.employee`)
- Token scope must be `"customer"` — rejects staff tokens
- Cross-tenant replay guard: `payload.tid` must match resolved tenant
- Per-customer revocation via `customers.portal_tokens_revoked_before`
- Env vars: `CUSTOMER_PORTAL_JWT_SECRET` (falls back to `JWT_SECRET`), `CUSTOMER_PORTAL_ACCESS_TTL` (default `"30m"`), `CUSTOMER_PORTAL_REFRESH_TTL` (default `"30d"`)

---

## Subdirectories

### `routes/`
All API route handlers. See `routes/CLAUDE.md` for the full table of route files, mounting order, and conventions.

Key conventions:
- Routes mounted before tenant middleware (no `req.employee`, no `deps.db` proxy): `admin/`, `webhooks.js`, `receipts.js`, `customer-portal/`, `storefront.js`, `public-restaurant.js`, `public-bookings.js`, `country-packs.js`, `gift-cards-public.js`, `public-reservations.js`, `sandbox.js`
- `deps.db` is the tenant DB proxy — always use it in route handlers (never `db` directly)
- Transactions: `deps.db.transaction(async (client) => {...})` — client inherits `search_path`
- Error conventions: success `res.json({...})`, client error `res.status(4xx).json({ error: "..." })`, server error `res.status(500).json({ error: err.message })`

### `services/`
Business logic, external API clients, infrastructure services. See `services/CLAUDE.md`.

Key services:
- `logger.js` — Pino singleton; always `require` this, never create another instance
- `boss.js` — pg-boss singleton; always use `getBoss()`, never `new PgBoss()`
- `crypto.js` — AES-256-GCM for integration credentials; stored as `enc:v1:{iv}:{tag}:{ciphertext}`
- `email.js` — `sendEmail()` (immediate) and `enqueueEmail()` (pg-boss, 3 retries)
- `payment-gateway.js` — adapter pattern; `isEnabled()` checks `XPAY_API_KEY`, not just `PAYMENT_GATEWAY`
- `fbr.js` — FBR API client + payload builders + exponential backoff (60s → 5m → 15m → 1h → 4h)

### `tests/`
See `tests/CLAUDE.md` for full test file list and helper API.

- Runner: **Vitest** (not Jest). `reports_accuracy.test.js` is the lone exception — uses Jest syntax
- Integration tests require `DATABASE_URL`. Prefer `backend/.env.test` (local Postgres) to keep tests off production
- `smoke-gate.test.js` has pre-existing failures — do not run or investigate
- Test isolation: `createTestApp-pg.js` creates a fresh `test_<hex>` schema per test; `cleanup()` drops it

### `workers/`
All background workers use pg-boss. Each requires an env var to enable. Workers survive server crashes; jobs do not block the HTTP event loop.

| Worker file | Env var to enable | Schedule |
|---|---|---|
| `email-worker-boss.js` | `EMAIL_WORKER_ENABLED=1` | continuous |
| `fbr-worker-boss.js` | `FBR_WORKER_ENABLED=1` | continuous |
| `cleanup-worker-boss.js` | `CLEANUP_WORKER_ENABLED=1` | 24h |
| `marketplace-sync-worker-boss.js` | `MARKETPLACE_SYNC_WORKER_ENABLED=1` | 10 min (orders), 6h (feed) |
| `rental-overdue-worker-boss.js` | `RENTAL_OVERDUE_WORKER_ENABLED=1` | daily 8 AM UTC |
| `room-overdue-checkout-worker-boss.js` | `ROOM_OVERDUE_WORKER_ENABLED=1` | daily 11 AM UTC |
| `subscription-grace-worker-boss.js` | `SUBSCRIPTION_GRACE_WORKER_ENABLED=1` | hourly |
| `treatment-plan-worker-boss.js` | `TREATMENT_PLAN_WORKER_ENABLED=1` | daily 9 AM UTC |

Each worker exposes `global.__<name>WorkerStatus = { lastPollAt, processedToday, queueDepth }`. `GET /api/admin/worker-status` (in `routes/admin/system.js`) reads these globals. `queueDepth` is a real `SELECT COUNT(*)`.

### `schemas/`
Zod validation schemas for all domains. Imported by `validate(schema)` middleware. One file per domain (auth, billing, employees, products, sales, returns, customers, purchase-orders, inventory, orders, admin, integrations, bookings, commissions, contracts, customer-invoices, marketing, messaging, projects, restaurant, scheduled-changes, smart-collections, subscriptions, customer-portal, rentals, rooms, service-tickets, treatment-plans).

### `boot/workers.js`
All worker startup. Imported by `index.js`. Registers pg-boss workers, scheduled jobs, Shopify sync polling, report schedule worker. Do not start workers elsewhere.

### `utils/`
- `tz.js` — `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` — converts local `YYYY-MM-DD` to UTC boundaries. Use for all date filter queries. See timezone gotcha below.
- `r2.js` — Cloudflare R2 upload/download helpers
- `receiptEmail.js` — `buildReceiptEmailHtml()` for customer receipt emails
- `digestEmail.js` — daily digest email builder
- `backup-pg.js` — `pg_dump` to R2 for tenant self-export
- `resendEmail.js` — direct Resend API call (used by alertEmail.js)
- `alertEmail.js` — sends ops alerts via Resend

---

## Key Conventions

### Postgres only
SQLite code is deleted. `schema-pg.sql` is the DDL source of truth. All queries use `$1, $2` placeholders.

### Multi-tenant DB routing
`deps.db` in route handlers is a Proxy that delegates to the tenant's scoped DB via AsyncLocalStorage. `resolveTenant` middleware wires the ALS context before any route handler runs. Never use `db` (the pool) directly in tenant route handlers.

### `deps.db` pattern
Routes receive a `deps` object containing `db` (the tenant proxy), plus references to middleware functions and external clients. Routes are factory functions: `module.exports = (app, deps) => { ... }`.

### Feature flags
Apply `requireFeature('flag_name')` as per-route middleware. New flags must be added to `DEFAULT_FEATURE_FLAGS` in `middleware/feature-flags.js` AND seeded in `schema-pg.sql`. Use `invalidateFeatureFlagCache(tenantId)` after admin flag changes.

### Permission guards
All data-returning GET endpoints require auth — `requirePerm` or `requireAnyPerm` on every GET. No unprotected data endpoints.

### Workers — adding a new one
1. Create `workers/<name>-worker-boss.js` using the pg-boss pattern
2. Register startup in `boot/workers.js`
3. Add env var toggle: `<NAME>_WORKER_ENABLED=1`
4. Expose `global.__<name>WorkerStatus`
5. Add slot to `GET /api/admin/worker-status` in `routes/admin/system.js`

### Adding a new route
1. Create `routes/<domain>.js`
2. Add Zod schema in `schemas/<domain>.js` (if validating request body)
3. Register in `routes/registerAllRoutes.js` — one `app.use('/api/<prefix>', require('./routes/<domain>')(deps))` line
4. Add permissions to `middleware/permissions.js` if introducing new permission strings

### Encryption
Integration credentials stored as `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. Always call `decryptSecret()` before passing config to adapters. Courier adapters receive pre-decrypted config — decryption happens in the route layer.

### Timezone
- Business-critical timestamps (`sales`, `returns`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`) stored as UTC via `CURRENT_TIMESTAMP`
- `attendance_sessions` and `employee_attendance` store local time — do NOT change their write paths
- `sales.timestamp` is the column name — NOT `created_at`
- `req.company.timezone` (IANA string) set by `loadCompanyProfile` — use in all date filter queries
- `session_start` and `check_in` are already local — use `date(col)` with no modifier; `date(col,'localtime')` double-converts and breaks UTC+ timezones

### Test runner
**Vitest** — not Jest. Check `backend/package.json` to confirm. Exception: `reports_accuracy.test.js` uses Jest syntax.

### Production
- Backend: Railway at `api.sanopos.com` (`oneshoppos-production.up.railway.app` fallback)
- Database: Supabase Postgres (`MULTI_TENANT=1` on Railway)
- Railway `PORT` is overridden to 8080 — this is expected
- `start.sh` — Railway entrypoint: sets `TZ`, runs `migrate-pg.js`, then `exec node index.js`

---

## Environment Variables (quick reference)

### Required
`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`

### Common optional
`MULTI_TENANT`, `PORT` (default 5000), `NODE_ENV`, `CORS_ORIGIN`, `LOG_LEVEL`, `FRONTEND_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_WORKER_ENABLED`, `SENTRY_DSN`, `ALERT_EMAIL`, `FBR_WORKER_ENABLED`, `CLEANUP_WORKER_ENABLED`, `MARKETPLACE_SYNC_WORKER_ENABLED`, `PAYMENT_GATEWAY`, `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `SHOPIFY_SECRET_KEY`, `INTEGRATION_SECRET_KEY`, `ADMIN_ALLOWED_IPS`, `SELF_SERVICE_SIGNUP`, `CUSTOMER_PORTAL_JWT_SECRET`

See existing `backend/CLAUDE.md` environment variable section for the full list with defaults.
