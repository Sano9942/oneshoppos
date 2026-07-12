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

Orchestrator. Key responsibilities:
- Loads `.env` (`.env.production` if `DB_TARGET=production`) before any other require — logs a loud green/red console banner distinguishing local vs. production DB by inspecting `DATABASE_URL`
- Initialises Sentry if `SENTRY_DSN` is set (`tracesSampleRate: 0` — request timing is handled by the app's own `request-id.js`, not Sentry tracing)
- Bootstraps the multi-tenant proxy (`tenant-db-proxy-pg.js`, `tenant-db-manager-pg.js`, `master-db-pg.js`) when `MULTI_TENANT=1`
- Calls `tenantAuth.init(mtDeps)` and `featureFlags.init(mtDeps)` to inject shared deps (`{ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore }`) into the middleware modules
- Sets `app.set("trust proxy", ...)` in production — Railway sits ~2 proxy hops in front of the container, so IP-based rate limiting needs `TRUST_PROXY_HOPS` (default 2) to read the real client IP from `X-Forwarded-For` instead of the rotating internal router IP
- Registers all routes via `registerAllRoutes.js` (contains inline health check routes, feature-flag routes, middleware wiring, outlet-assignment enforcement, and restore guard — not a pure orchestrator)
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
9.  globalLimiter        — rate-limited (skips POS burst paths)
10. requestId            — UUID per request (X-Request-Id header)

--- admin routes (routes/admin/) mount here — NO tenant context ---
--- webhook routes (routes/webhooks.js) mount here — NO auth; only /api/webhooks/xpay is HMAC-verified; Meta, WhatsApp, Daraz POST handlers are rate-limited but not signature-verified ---
--- customer portal routes: customerPortalAuthLimiter/customerPortalOtpLimiter/customerPortalDataLimiter → loadCustomerAuth(deps) → handler ---
--- manufacturer portal routes: manufacturerPortalAuthLimiter/manufacturerPortalDataLimiter → loadManufacturerAuth(deps) → handler ---

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

Customer portal and manufacturer portal routes are structurally separate chains — they never pass through `loadTenantAndPerms`/`resolveTenant`/`loadCompanyProfile`/`resolveContext`. Their handlers get `req.db` set directly by the portal auth middleware, not the ALS-proxied `deps.db`.

**Boot-time assertions:**
- `ensureCriticalRoutesRegistered()` verifies: `POST /api/products/bulk-import`, `POST /api/products/bulk-delete`, `POST /api/products/bulk-status`, `DELETE /api/integrations/shopify/import/products`
- `ADMIN_ALLOWED_IPS` unset in prod → logs `[SECURITY]` error at boot

---

## Database

### `db-pg.js`
Postgres pool connecting via Supabase **Transaction Pooler** (Supavisor, port 6543 in `DATABASE_URL`). Exports: `query`, `transaction`, `getClient`, `end`, `pool`.
- Does NOT load dotenv — callers are responsible
- SSL disabled in non-prod
- Transaction-mode pooling does NOT preserve session-level features across queries: `LISTEN/NOTIFY`, prepared statements, `SET SESSION`, and cross-statement advisory locks won't work. Codebase doesn't use any today. Any future feature needing session-level Postgres must connect via direct port `5432`, not the pooler.
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
- Short-lived tenant cache; resets `search_path` on every query
- Called by `resolveTenant` middleware to get a scoped DB handle

### `tenant-db-pg.js`
Older ALS proxy (checks out one pool client per request via `runWithTenant`). Exports: `asyncStore`, `getProxy`, `getStore`, `runWithTenant`. Proxy only has `query` + `transaction` — no `getClient`. Use `tenant-db-proxy-pg.js` for new code.

### `schema-pg.sql`
DDL source of truth. Grep for table names rather than reading the full file.

### `migrate-pg.js`
Exports: `{ migrate, MIGRATIONS }`. CLI: `node backend/migrate-pg.js` (no flags).
- Migrates public schema first, then all `status='active'` tenant schemas sequentially
- Each tenant has its own `schema_version` table
- Per-tenant failures are caught and logged — one failure does not abort the run
- Existing tenants need `schema_version` pre-populated or migrate will attempt to re-apply v1

### `master-db-pg.js`
Master tenant registry. Exports: `init`, `createTenant`, `getTenantBySlug`, `getTenantById`, `query`.
- Manages the public-schema tenant registry tables: `tenants`, `super_admins`, `tenant_audit_log`, `schema_migrations`, `tenant_refresh_tokens`, `plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`, `impersonation_sessions`
- `query()` always sets `search_path` to public

---

## Middleware

All middleware in `backend/middleware/`. Chain order documented above; see `middleware/CLAUDE.md` for the full per-file reference (portal auth, rate-limit key patterns, upload validation).

### `tenant-auth.js`
Exports: `init(deps)`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveContext`, `loadEmployeePerms`, `invalidateCompanyProfileCache`

Requires `init({ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore })` at boot.

- **`loadTenantAndPerms`** — JWT auth. Sets `req.employee`, `req.employeePerms`, `req.tenantId`, `req.isImpersonating`. No auth header → sets empty perms and calls `next()` (does not reject). Token revocation checked against `revoked_tokens` table + `employees.tokens_revoked_before`. Permission load retries once on transient DB failure; both failures → 503 instead of silent empty-perms. (The `kiosk` token scope + its path restriction were retired 2026-07-12 with the unused `/api/auth/kiosk-login` endpoint — all employee tokens are now full-scope.)
- **`resolveTenant`** — No-op in ST mode. In MT: resolves tenant either from `req.tenantId` or from `?tenant=<slug>` on an explicit allowlist of public paths (`PUBLIC_TENANT_PARAM_PATHS` — auth, kiosk pin-checkin, feature-flags, setup, health, `company-profile/currency`), calls `tenantDbManager.getDb()`, runs `asyncStore.run(...)` to wire `deps.db`. Sets `req.tenantSlug`, `req.tenantDir`. Error codes: `TENANT_NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_DELETED` (all 403).
- **`loadCompanyProfile`** — Reads `company_profile WHERE id = 1`. 5-minute cache per tenant (stale-while-revalidate; cold start awaits synchronously to avoid a post-signup race). Sets `req.company`. Blocks with 503 `SETUP_REQUIRED` if `setup_complete` is falsy and path is not `/api/setup*` or `/api/health*`.
- **`resolveContext`** — Reads `x-outlet-id`, `x-company-id`, `x-scope-mode` headers. Sets `req.context`. When `context_header_enforced` flag is on, non-admin employees without `x-outlet-id` get 428 `CONTEXT_REQUIRED` (exempt: auth, context, feature-flags, attendance, roles, outlets paths).

### `permissions.js`
Exports: `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, `DEFAULT_ROLE_PERMISSIONS`, `PERMISSION_RULES`, `ensureDefaultRolePermissions`

- **`requirePerm(permission)`** — `all_access` bypasses everything. Returns 403 on failure.
- **`requireAnyPerm(permissions[])`** — passes if employee has `all_access` OR any one listed.
- **`requireContextOutlet`** — backfills `req.query.outlet_id` from `req.context.outletId` if absent.
- **`DEFAULT_ROLE_PERMISSIONS`**: Administrator = `all_access`; Manager = a broad permission set covering inventory, orders, the five `view_*_reports` splits + `manage_finance`/`manage_reports`, employees, customers, POS discount/void/park, restaurant/KDS/bookings/projects/contracts/tickets/rentals/rooms/treatment-plans management, tips, void/comp override, gift cards, price override, credit-limit override, and field-sales management; Cashier = `view_sales_reports`, pos_discount, pos_park (the D4 split retired `view_reports`; migration v134 also grants `view_customer_reports` to pristine Cashiers on appointments-mode tenants); "Field Rep" = `execute_field_sales` only (rep-self surfaces; PLAN-V2 Step 2 split from `manage_field_sales`, migration v133).
- **`PERMISSION_RULES`** — declarative array covering common route-level guards; consumed by test helpers and route registration, not auto-applied.

### `feature-flags.js`
Exports: `init(deps)`, `DEFAULT_FEATURE_FLAGS`, `requireFeature`, `requireMode`, `getFeatureFlagsMap`, `getModesMap`, `invalidateFeatureFlagCache`, `invalidateModeCache`, `createNotification`, `notifyLowStockForSale`

Requires `init({ db, IS_MULTI_TENANT, tenantDbManager, dbProxy })` at boot.

- **`requireFeature(flagKey)`** — 403 if flag is off (deliberately 403 not 503 — "feature off" is a permission-style refusal, not a service outage). 500 on unexpected DB error.
- **`requireMode(modeName)`** — 403 if the named mode is off/missing. If the `tenant_modes` map is empty it still falls through (feature flags become the sole gate) BUT now emits a Sentry warning + `logger.warn` via `reportEmptyModes()` first (PLAN-V2 Step 5 D5 "warn-and-pass" posture, `NODE_ENV=test`-gated). Post-migration-v135 every live tenant has a full mode-row set, so an empty map means a failed migration/unseeded path — expected 0 occurrences. Queued follow-up: flip to hard fail-closed next release once prod Sentry reads zero warns.
- Flags: short in-memory cache per tenant. Merges `DEFAULT_FEATURE_FLAGS` with DB rows (DB overrides default). Gracefully degrades if `feature_flags` table is missing.
- Most `DEFAULT_FEATURE_FLAGS` entries are mode-gated (restaurant, appointments, rentals, rooms, treatment plans, wholesale field sales/secondary sales, etc.) and default `false` — flipped on by the setup wizard or a migration backfill for the matching preset, never globally.
- **Gotchas**: `fbr_integration` is NOT in `DEFAULT_FEATURE_FLAGS` (DB-seeded by a dedicated migration). `ai_insights` is a soft check in the route, not enforced via `requireFeature`. Shopify routes are gated by connection check, not a flag.

### `plan-limits.js`
Exports: `requirePlanLimit`, `requireActiveSubscription`, `PLAN_DEFAULTS`

- **`requirePlanLimit(resource)`** — resource must be `"employees"`, `"outlets"`, or `"products"`. No-op in ST mode. `0` or `null` in DB = unlimited. Returns 403 `{ code: "PLAN_LIMIT_REACHED" }` at cap. DB failure → best-effort, calls `next()`.
- **`requireActiveSubscription`** — no-op for: GET/OPTIONS/HEAD, ST mode, auth/billing/support/setup/health/receipts paths, free plan tenants. `payment_status = 'expired'` → 403 `{ code: "SUBSCRIPTION_EXPIRED" }`. Uses `.then()` not `await` — outer function is synchronous.
- **Plan defaults**: Free = 1 outlet / limited employees / limited products; Pro = 1 outlet / unlimited employees / unlimited products.
- **Subscription lifecycle**: Trial → Grace → Expired (read-only), gated by these two middleware functions plus the email worker's hourly billing-lifecycle-check job.

### `rate-limit.js`
Exports: `globalLimiter`, `authLimiter`, `webhookLimiter`, `reviewLimiter`, `publicBookingLimiter`, `publicRestaurantLimiter`, `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter`, `manufacturerPortalAuthLimiter`, `manufacturerPortalDataLimiter`, `pinValidateLimiter`

All return 429 with `Retry-After` header and `{ error, retry_after_seconds }`. `globalLimiter` skips POS burst paths (`/api/sales`, `/api/products/search`, `/api/products/scan/`, `/api/orders`). Portal limiters (customer + manufacturer) and the review/booking/restaurant limiters key on `?tenant=` query param or `x-tenant-slug` header — they sit on routes mounted before `loadTenantAndPerms`/`resolveTenant`, so `req.tenantSlug` isn't set yet.

### `validate.js`
Exports: `{ validate }`

- `validate(schema)` — Zod middleware factory. On success, **replaces** `req.body` with the parsed result — downstream handlers must not assume the raw body shape. On `ZodError`: 400 `{ error, details: [{ field, message }] }`. Field is dot-joined path (e.g. `"items.0.price"`).

### `upload-validation.js`
Exports: `imageFileFilter`, `rasterImageFileFilter`, `clinicalDocFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, `ALLOWED_IMAGE_MIMES`, `ALLOWED_IMAGE_EXTS`, plus raster/clinical variants

- `imageFileFilter` — multer fileFilter, checks mimetype + extension, allows SVG (only for uploads rasterized before being served back).
- `rasterImageFileFilter` — stricter, excludes SVG (prevents same-origin XSS). Use for anything served as-is (support ticket screenshots).
- `clinicalDocFileFilter` — raster images + PDF + plain text, no SVG (clinical document uploads).
- `verifyImageMagicBytes` — catches faked Content-Type after upload (e.g. an .exe renamed to .jpg with a spoofed image MIME).

### `request-id.js`
Exports: default `requestId`, named `requestId.enrichReqLog`

- Wraps `pino-http`. UUID per request (honours `X-Request-Id` header). Sets `X-Request-Id` response header, `req.log`, `req.id`, `req._startTime`.
- `enrichReqLog` — wire after `loadTenantAndPerms` to rebind `req.log` with `{ tenantSlug, employeeId }`.
- Log levels: error for 5xx/thrown, warn for 4xx/slow requests, info otherwise.

### `customer-auth.js` / `manufacturer-auth.js`
Two near-identical portal-auth modules, each with its own JWT secret/scope, separate from employee auth. Both delegate to `services/public-tenant-context.js:resolvePublicTenantDb()` for tenant routing (never `resolveTenant`), both cross-check the token's `tid` against the resolved tenant, and both support a per-principal revocation cursor. They've drifted apart on TTL defaults and status-check details — if you fix a bug in one, check whether it applies to the other.
- `customer-auth.js` — scope `"customer"`, env `CUSTOMER_PORTAL_JWT_SECRET` (falls back to `JWT_SECRET`).
- `manufacturer-auth.js` — scope `"manufacturer"`, env `MANUFACTURER_PORTAL_JWT_SECRET` (falls back to `JWT_SECRET`), additionally checks partner `status` (suspended/active).

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
- `stock-ledger.js` — `decrementStock`/`incrementStock`, the one shared "move on-hand stock" implementation (POS sale, quotation-convert, transfers, supplier returns, PO receive, stock count all funnel through it). Must run inside the caller's `deps.db.transaction(...)` — takes `FOR UPDATE`, gates on availability, writes all three stock tables when a variant is present. Batch/FEFO handling delegates to `batch-stock.js` unless the caller passes `manageBatch:false`.
- `tax-snapshot.js` — `resolveTaxSnapshot()`, the one shared v83 per-line tax cascade (outlet tax profile → product tax_id → legacy gst → category-inherited → 0) every sale writer applies so the frozen per-line snapshot on `sale_items` is consistent regardless of entry point.
- `business-modules.js` — the module toggle engine behind `/api/business-modules`: atomic flag+mode transaction, `saved_flags` snapshot on disable / exact restore on re-enable (snapshot cleared once consumed; repeated disable keeps the existing snapshot), transitive `depends_on` cascade (Bucket C dependents are left connected, never cascaded off), platform-lock enforcement (`public.platform_module_locks` — blocks self-ENABLE only), first-mode-row drift backfill (writing the first `tenant_modes` row flips `requireMode` from fall-through to enforcing for every mode), `action_history` audit rows, both middleware caches invalidated post-toggle. Also exports `rejectCatalogManagedFlagWrites` — the lockdown middleware on the legacy `PUT /api/feature-flags/:key` (module primary/bundle flags 409 `MANAGED_BY_BUSINESS_MODULES`; sub_toggles + Bucket D keys pass through).

See `services/CLAUDE.md` for the full service inventory (couriers/marketplace adapter subdirectories, domain services, gotchas).

### `tests/`
See `tests/CLAUDE.md` for the full test suite breakdown.

- Runner: **Vitest** (not Jest). `reports_accuracy.test.js` is the lone exception — uses Jest syntax but still runs under `npx vitest`
- Integration tests require `DATABASE_URL`. Prefer `backend/.env.test` (local Postgres) to keep tests off production
- `smoke-gate.test.js` has pre-existing failures — do not run or investigate unless explicitly asked
- Test isolation: `createTestApp-pg.js` creates a fresh `test_<hex>` schema per test; `cleanup()` drops it

### `workers/`
See `workers/CLAUDE.md` for the full per-worker reference (queues, cron schedule, heartbeat globals).

Background workers are started from `boot/workers.js`, which mixes pg-boss jobs with `setInterval` pollers and some inline cron logic — not everything in `boot/workers.js` has a corresponding file in this directory (Shopify sync poll, report-schedule poll, catalog scheduler, booking reminders live inline in `boot/workers.js`). Each pg-boss worker requires its own env var to enable and exposes `global.__<name>WorkerStatus = { lastPollAt, processedToday, queueDepth }`, read by `GET /api/admin/worker-status` (`routes/admin/system.js`). pg-boss workers survive server crashes; `setInterval` pollers do not. Prefer `workers/tenant-job-context.js:withTenantContext()` over raw schema-string interpolation for new tenant-scoped workers — the FBR worker is the one deliberate legacy exception.

Module-gated workers (Business Modules rule: disabling a module stops its background processing; data is preserved and processing resumes on re-enable): the rental-overdue, room-overdue-checkout, night-audit, treatment-plan, hold-expiry, KDS-snapshot, course-release, reservation-reminder, and channel-sync tenant handlers each check the relevant tenant `feature_flags` row first and no-op when it's off (pattern: `abc-worker-boss.js`; `booking-reminders.js` does the same for appointments). `reservation-worker-boss.js` (stale inventory reservations) is deliberately NOT gated — expiring a reservation releases stock, and stopping it would strand reserved stock.

### `schemas/`
Zod validation schemas for all domains, one file per domain, consumed by `validate(schema)` middleware. See `schemas/CLAUDE.md` for the full file/export/importer table and conventions (`.passthrough()` vs `.strict()`, exported enum constants, `superRefine` for cross-field validation).

### `config/`
Static config-as-code modules (no DB access):
- `business-modules.js` — the Business Modules catalog. Every `DEFAULT_FEATURE_FLAGS` key is classified into a bucket A/B/C card (`BUSINESS_MODULES`: flags, sub_toggles, mode, depends_on, permissions, impact_queries, Bucket C setup_route/connected_check) or listed in `UNMANAGED_FLAGS` (Bucket D — stays writable via the legacy PUT). Exports `classifyFlag`, `cardManagedFlags`, `presetRecommendedModules`, `MODULE_STATES`. `tests/unit/business-modules-catalog.test.js` is a bidirectional drift guard — an unclassified flag key fails CI.
- `permissions-catalog.js` — every registered permission string (39 after the PLAN-V2 governance slice — delegation perms `manage_integrations`/`manage_roles`/`manage_outlet_modules`, `execute_field_sales`, and the `view_reports`→5 `view_*_reports` splits + `manage_finance`/`manage_reports`), grouped for the role editor; exports `PERMISSIONS_CATALOG`, `isKnownPermission`. `tests/unit/permissions-catalog.test.js` scans all `requirePerm`/`requireAnyPerm` call sites for drift.
- `mode-registry.js` — `tenant_modes` registry (mode → feature flags), used by preset seeding, admin mode CRUD, and the business-modules first-row backfill.
- `country-packs.js`, `industry-config.js`, `vertical-usage-sources.js` — signup tax packs, industry preset definitions, admin vertical-usage count sources.

### `boot/workers.js`
All worker startup. Imported by `index.js`. Mixes pg-boss workers with setInterval pollers (e.g. Shopify sync polling, report schedule worker). Do not start workers elsewhere.

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
Apply `requireFeature('flag_name')` as per-route middleware, sometimes combined with `requireMode('mode_name')` for vertical-specific gating. New flags must be added to `DEFAULT_FEATURE_FLAGS` in `middleware/feature-flags.js` AND seeded in `schema-pg.sql` — AND classified in `config/business-modules.js` (card flag, sub_toggle, or `UNMANAGED_FLAGS`); the catalog unit test fails otherwise. Use `invalidateFeatureFlagCache(tenantId)` after admin flag changes. `PUT /api/feature-flags/:key` no longer accepts module primary/bundle flags (409 `MANAGED_BY_BUSINESS_MODULES`) — module state changes go through `POST /api/business-modules/:key/toggle` so bucket rules, dependencies, mode sync, saved_flags, locks, and audit all apply.

### Permission guards
Most authenticated tenant GETs use `requirePerm` or `requireAnyPerm`. Public GETs exist by design (e.g. receipts, country-packs, public bookings/storefront). Some authenticated GETs rely on shared auth/session context rather than an explicit permission guard — the rule is not absolute.

### Workers — adding a new one
1. Create `workers/<name>-worker-boss.js` using the pg-boss pattern
2. Register startup in `boot/workers.js`
3. Add env var toggle: `<NAME>_WORKER_ENABLED=1`
4. Expose `global.__<name>WorkerStatus`
5. Add slot to `GET /api/admin/worker-status` in `routes/admin/system.js`

### Adding a new route
1. Create `routes/<domain>.js`
2. Add Zod schema in `schemas/<domain>.js` (if validating request body)
3. Register in `routes/registerAllRoutes.js` — most route files use `require('./routes/<domain>')(app, deps)` and register their own paths directly; only a few use the `app.use('/api/<prefix>', ...)` mount style
4. Add permissions to `middleware/permissions.js` if introducing new permission strings

### Encryption
Integration credentials stored as `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. Always call `decryptSecret()` before passing config to adapters. Courier adapters receive pre-decrypted config — decryption happens in the route layer.

### Timezone
- ALL business timestamps are `TIMESTAMPTZ` (absolute instants): `sales.timestamp`, `returns`, `cash_shifts`, `attendance_sessions.session_start`, `employee_attendance.check_in`, `grn.received_at`, `supplier_payments.paid_at`, appointments `start_at`, etc. There are NO "already local" timestamp columns — the old claim that `session_start`/`check_in` were local was wrong and caused the 2026-07 date-boundary bug class.
- `sales.timestamp` is the column name — NOT `created_at`
- `req.company.timezone` (IANA string) set by `loadCompanyProfile` — the tenant's business timezone
- **There are TWO independent timezones neither of which is the tenant's**: the Node process TZ (Railway `TZ=Asia/Karachi` — affects `Date#toString`/`getHours`, NOT `toISOString()`) and the Postgres SESSION TZ (UTC on Supabase prod, often Asia/Karachi on local dev — what a bare `::date`, `date(col)`, or `CURRENT_DATE` evaluates in). Code relying on either gives different answers per environment.
- **Rules** (enforced by `tests/unit/tz-date-boundary-guard.test.js`):
  - JS "today": `tenantToday(req.company?.timezone)` from `utils/tz.js` — NEVER `new Date().toISOString().slice(0,10)` (always UTC)
  - Date-range filters on TIMESTAMPTZ: `col >= toUtcStart(from, tz) AND col < toUtcEnd(to, tz)` — never `col::date >= $from`
  - SQL same-day compare: `(col AT TIME ZONE $tz)::date = (NOW() AT TIME ZONE $tz)::date` (tenant tz on BOTH sides) — never `col::date = CURRENT_DATE`
  - Day bucketing in reports: `(col AT TIME ZONE '<validated tz>')::date` (see `routes/reports/dashboard.js`)
  - Reading a plain `DATE` column back to a string: `pgDateToStr(row.col)` — node-postgres returns local-midnight JS Dates, so `toISOString()` shifts a day east of UTC
  - Plain `DATE` columns (`expense_date`, `due_date`, `expiry_date`, room booking dates…) are timezone-free — compare them against a `tenantToday(tz)` parameter, not `CURRENT_DATE`
- **Local-DB parity**: the local `sanopos_dev` and `sanopos_test` databases have `ALTER DATABASE … SET timezone = 'UTC'` applied so local sessions match Supabase prod. If you recreate a local DB, re-apply it — otherwise timezone bugs behave differently in dev than in prod and hide. A GitHub Actions check (`.github/workflows/tz-guard.yml`) also runs the guard on every push/PR.

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
`MULTI_TENANT`, `PORT` (default 5000), `NODE_ENV`, `CORS_ORIGIN`, `LOG_LEVEL`, `FRONTEND_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_WORKER_ENABLED`, `SENTRY_DSN`, `ALERT_EMAIL`, `FBR_WORKER_ENABLED`, `CLEANUP_WORKER_ENABLED`, `MARKETPLACE_SYNC_WORKER_ENABLED`, `PAYMENT_GATEWAY`, `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `SHOPIFY_SECRET_KEY`, `INTEGRATION_SECRET_KEY`, `ADMIN_ALLOWED_IPS`, `SELF_SERVICE_SIGNUP`, `CUSTOMER_PORTAL_JWT_SECRET`, `MANUFACTURER_PORTAL_JWT_SECRET`, `TRUST_PROXY_HOPS`

See individual worker/middleware sections above and their linked sub-guides for feature-specific env vars (per-worker enable flags, portal TTLs, rate-limit overrides).
