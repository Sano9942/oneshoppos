# Backend — Claude Guide

Node.js + Express (v5) + PostgreSQL. Single active database backend — Postgres via a `pg` connection pool (`db-pg.js`). Multi-tenant routing via an AsyncLocalStorage-backed proxy. Deployed on Railway; database is Supabase Postgres reached through its transaction pooler.

---

## Do Not Read These Files

- `backups/`, `archive/legacy/`, `tenants/`, `exports/`, `uploads_test/`, `uploads_tmp/`
- `schema.sql` — legacy SQLite DDL, superseded by `schema-pg.sql`
- `schema_dump.txt` — corrupted SQLite dump artifact
- `_endpoint_list.txt` — generated endpoint list, likely stale
- `BACKEND-AUDIT.md` — historical audit doc, may contradict current state

---

## Entry Point — `index.js`

Orchestrator, not a place to add domain logic. Key responsibilities:

- Loads environment variables before any other `require` (a production vs. local database banner prints at boot based on the connection string, so a misconfigured environment is loud rather than silent)
- Initializes error tracking when a DSN is configured (tracing is disabled — request timing is handled by the app's own request-id middleware, not by the tracer)
- Bootstraps the multi-tenant proxy (`tenant-db-proxy-pg.js`, `tenant-db-manager-pg.js`, `master-db-pg.js`) when multi-tenant mode is on
- Calls `init(deps)` on `tenant-auth.js`, `feature-flags.js`, and `outlet-context.js` to inject shared handles (`{ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore }`) into the middleware layer
- Sets a trust-proxy hop count in production — the platform sits a couple of proxy hops in front of the container, so IP-based rate limiting needs to read the real client IP from the forwarded-for header rather than the rotating internal router IP
- Registers all routes via `registerAllRoutes.js` (which itself contains inline health-check routes, feature-flag routes, middleware wiring, and outlet-assignment enforcement — not a pure orchestrator)
- Starts background workers via `boot/workers.js`
- Runs a boot-time assertion that crashes startup if a handful of critical routes are missing

### Middleware Chain (request lifecycle order)

```
1.  helmet               — security headers (CSP + COEP disabled)
2.  cors                 — configurable origin allowlist or localhost dev origin
3.  express.json(10mb)   — raw body captured for webhook paths (payment gateway + Shopify)
4.  malformed JSON → 400 — prevents an unhandled parse error from bubbling to error tracking
5.  /uploads static      — single-tenant static file serving
6.  /r2/*key proxy       — streams an R2 object when no public R2 URL is configured
7.  compression
8.  cookieParser
9.  globalLimiter        — rate limiter (skips POS burst paths)
10. requestId            — UUID per request (X-Request-Id header)

--- admin routes (routes/admin/) mount here — NO tenant context ---
--- webhook routes (routes/webhooks.js) mount here — NO auth by default; only the payment-gateway webhook is HMAC-verified; the marketplace-channel webhooks are rate-limited but not signature-verified ---
--- customer portal routes: dedicated rate limiters → customer auth middleware → handler ---
--- manufacturer portal routes: dedicated rate limiters → manufacturer auth middleware → handler ---

11. loadTenantAndPerms   — decode JWT, attach req.employee + req.employeePerms + req.tenantId
12. resolveTenant        — SET search_path, run the AsyncLocalStorage context, wire deps.db proxy
13. tenant /uploads      — serve tenant-specific uploaded files
14. loadCompanyProfile   — query company_profile → req.company (timezone, currency, tax config)
14b. resolveOutletContext — the sole interpreter of outlet context: validated x-outlet-id header
     → JWT outlet claim → none → req.outletContext. Malformed header → 400; foreign/inactive
     outlet → 403; unassigned non-admin employee → 403
14c. resolveEffectiveRole — per-outlet role override resolution: an employee's outlet assignment
     can carry a different role than their base role; this swaps req.employeePerms to that role's
     set while preserving req.baseEmployeePerms (assignment-scope checks key on base; capability
     checks key on effective)
15. resolveContext       — consumes req.outletContext (+ company/scope-mode headers) → req.context

--- all tenant routes mount here ---

16. requirePerm / requireAnyPerm  — per-route permission check
17. requireFeature / requireMode  — per-route feature flag / mode check
18. validate(schema)              — per-route Zod body validation
19. requirePlanLimit(resource)    — plan cap enforcement (POST only)
20. requireActiveSubscription     — blocks writes when payment_status = 'expired'
```

Customer portal and manufacturer portal routes are structurally separate chains — they never pass through `loadTenantAndPerms`/`resolveTenant`/`loadCompanyProfile`/`resolveContext`. Their handlers get `req.db` set directly by their own portal auth middleware, not the AsyncLocalStorage-proxied `deps.db`.

**Boot-time assertions:**
- A startup check verifies a handful of critical routes are registered (bulk product import, bulk product delete, bulk product status, the Shopify product-delete route) — crashes boot if any are missing
- An unset IP allowlist for the admin panel in production logs a loud security warning at boot

---

## Database

### `db-pg.js`
Postgres pool connecting via Supabase's transaction pooler. Exports: `query`, `transaction`, `getClient`, `end`, `pool`.
- Does NOT load environment variables itself — callers are responsible for that.
- SSL disabled outside production.
- Transaction-mode pooling does NOT preserve session-level features across queries: `LISTEN/NOTIFY`, prepared statements, `SET SESSION`, and cross-statement advisory locks won't work. The codebase doesn't rely on any of these today. Any future feature needing session-level Postgres must connect via a direct (non-pooled) port instead.
- Results are `{ rows, rowCount }` — access via `rows[0]`, `rows`, `rowCount`.

**Postgres query conventions:**
- Placeholders: `$1, $2` (not `?`)
- Booleans: `true`/`false` (not `1`/`0`)
- Case-insensitive search: `ILIKE`
- Date extraction: `col::date`
- String aggregation: `string_agg()`
- JSON aggregation: `json_agg(json_build_object(...))`
- `ROUND` requires a numeric cast: `ROUND(expr::numeric, 2)`
- NUMERIC columns come back as strings from `pg` — wrap with `Number()` before arithmetic
- Every non-aggregated SELECT column must appear in GROUP BY
- One reserved-word gotcha: the "read" column on notifications is named `is_read`

### `tenant-db-proxy-pg.js`
AsyncLocalStorage-based Proxy. Exports: `asyncStore`, `createDbProxy`, `getCurrentDb`. Proxies `query`, `transaction`, `getClient` — delegates to whichever tenant DB is in the current async context. `resolveTenant` middleware runs the request handler inside `asyncStore.run({ db: tenantDb }, ...)`, which is what makes `deps.db` route queries to the correct tenant schema for the rest of the request.

### `tenant-db-manager-pg.js`
Per-tenant DB manager with a short-lived cache and a per-query search-path reset. Exports: `init`, `getDb`, `healthCheck`, `clearCache`, `closeDb`, `closeAll`. Called by `resolveTenant` middleware to get a scoped DB handle.

### `tenant-db-pg.js`
An older AsyncLocalStorage proxy that checks out one pool client per request. Exports: `asyncStore`, `getProxy`, `getStore`, `runWithTenant`. Its proxy only has `query` + `transaction` — no `getClient`. Prefer `tenant-db-proxy-pg.js` for new code.

### `schema-pg.sql`
DDL source of truth. Grep for table names rather than reading the whole file.

### `migrate-pg.js`
Exports `{ migrate, MIGRATIONS }`. CLI: `node backend/migrate-pg.js` (no flags). Migrates the public schema first, then every active tenant schema in sequence. Each tenant tracks its own applied-migration version; a failure on one tenant is caught and logged without aborting the rest of the run. A brand-new tenant registry row needs its version table pre-populated with prior versions before its first run, or the migrator will try to re-apply everything from the beginning (idempotent, but slow).

### `master-db-pg.js`
Master tenant registry. Exports: `init`, `createTenant`, `getTenantBySlug`, `getTenantById`, `query`. Manages the public-schema tenant registry tables (tenants, super admins, audit log, payment/pricing tables, impersonation sessions, and related cross-tenant tables). `query()` always sets its search path to public.

---

## Middleware

All middleware lives in `backend/middleware/`. Chain order is documented above; see `middleware/CLAUDE.md` for the full per-file reference (portal auth, rate-limit key patterns, upload validation, outlet-context resolution).

### `tenant-auth.js`
Exports: `init(deps)`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveEffectiveRole`, `resolveContext`, `loadEmployeePerms`, `invalidateCompanyProfileCache`.

- **`loadTenantAndPerms`** — JWT auth. Sets `req.employee`, `req.employeePerms`, `req.tenantId`, `req.isImpersonating`. No auth header → sets empty perms and calls `next()` (does not reject outright — many routes rely on this fall-through and gate themselves). Token revocation is checked against a revocation table plus a per-employee revoke-before cursor. Permission load retries once on a transient DB failure; if both attempts fail, the request gets a 503 rather than a silent empty-perms fallback that could masquerade as a misleading 403.
- **`resolveTenant`** — no-op in single-tenant mode. In multi-tenant mode, resolves the tenant either from `req.tenantId` or from a `?tenant=<slug>` query param on an explicit allowlist of public paths (auth, kiosk PIN check-in, feature-flags, setup, health, the public currency lookup), then looks up the tenant's scoped DB and wires the AsyncLocalStorage context. Sets `req.tenantSlug`, `req.tenantDir`. Error codes distinguish tenant-not-found, tenant-suspended, and tenant-deleted, all returned as 403.
- **`loadCompanyProfile`** — reads the tenant's company profile row. Cached for a few minutes per tenant (stale-while-revalidate; the first load after a cold start awaits synchronously to avoid a race right after signup). Sets `req.company`. Blocks with 503 when setup isn't complete and the path isn't a setup or health route.
- **`resolveEffectiveRole`** — per-outlet role resolution. Mounts between the outlet-context resolver (which supplies the override role id for the resolved outlet) and `resolveContext` (the first consumer of effective perms). Always sets `req.baseEmployeePerms` for authenticated requests; when an override applies, swaps `req.employeePerms` to that role's set. No resolvable outlet, a null override, or an override equal to the base role all short-circuit to zero extra queries. The load retries once, then returns a 503 on repeated failure — a silent empty-perms fallback here would wrongly demote an overridden manager. **The invariant that makes this safe**: outlet *reach* is an identity decision keyed on base perms, while *capability* is keyed on effective perms — an override can grant capability at an outlet but can never widen which outlets a principal reaches.
- **`resolveContext`** — reads outlet/company/scope-mode headers. Sets `req.context`. When header enforcement is switched on, non-admin employees without a resolved outlet get a 428 (a short exemption list covers auth, context, feature-flags, attendance, roles, and outlets paths).

### `permissions.js`
Exports: `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, `DEFAULT_ROLE_PERMISSIONS`, `PERMISSION_RULES`, `ensureDefaultRolePermissions`.

- **`requirePerm(permission)`** — the blanket `all_access` permission bypasses everything. Returns 403 on failure.
- **`requireAnyPerm(permissions[])`** — passes if the employee has `all_access` or any one of the listed permissions.
- **`requireContextOutlet`** — backfills `req.query.outlet_id` from `req.context.outletId` if absent.
- **`DEFAULT_ROLE_PERMISSIONS`** — Administrator holds `all_access`. Manager holds a broad set spanning inventory, orders, all five reporting-view splits (sales/inventory/financial/hr/customer) plus finance and report-governance writes, employees, customers, POS discount/void/park, every vertical module's management permission (restaurant, KDS, bookings, projects, contracts, tickets, rentals, rooms, treatment plans), tips, void/comp override, gift cards, price override, credit-limit override, and field-sales management. Cashier holds sales-report viewing plus POS discount and park. A narrow Field Rep role holds only the execute-level field-sales permission (a rep-self surface split from the broader field-sales-management permission).
- **`PERMISSION_RULES`** — a declarative array of `{ methods, path: /regex/, anyPerms }`. **This is live middleware, not a reference table**: it is mounted as a blanket `app.use()` over every `/api/` request, before any route module. The first rule whose method and path regex match wins; no match falls through. It reads effective permissions (after `resolveEffectiveRole` has run) and does **not** replace each route's own guard — both apply, this one runs first. The trap: a rule keyed on a path prefix also catches self-scoped sub-endpoints beneath it, potentially 403-ing them before their own looser guard is consulted. Tightening a rule's permission requirement means auditing every sub-path under its regex.

### `feature-flags.js`
Exports: `init(deps)`, `DEFAULT_FEATURE_FLAGS`, `requireFeature`, `requireMode`, `getFeatureFlagsMap`, `getModesMap`, `invalidateFeatureFlagCache`, `invalidateModeCache`, `createNotification`, `notifyLowStockForSale`.

- **`requireFeature(flagKey)`** — 403 if the flag is off (deliberately 403, not 503 — "feature off" is a permission-style refusal, not a service outage). 500 on an unexpected DB error.
- **`requireMode(modeName)`** — 403 if the named mode is off or missing. **Fail-closed**: an empty tenant-modes map does not fall through to the feature-flags default — it refuses with a distinct error code deliberately different from the plain "mode not enabled" refusal, so operations can tell a seeding failure apart from a mode that's legitimately off. Every fully-provisioned tenant has a complete mode-row set; an empty map on a live tenant means a failed migration, an unseeded provisioning path, or a missing table, and all three now refuse by design rather than silently falling open.
- Flags are cached briefly per tenant in memory. The merged map layers the tenant's DB rows over `DEFAULT_FEATURE_FLAGS` (DB overrides the default). Degrades gracefully if the flags table is missing.
- Most default-flag entries are mode-gated (restaurant, appointments, rentals, rooms, treatment plans, wholesale field sales/secondary sales, and so on) and default `false` — flipped on by the setup wizard or a migration backfill for the matching preset, never globally.
- **Gotchas**: the tax-authority integration flag is not in the static default map at all (seeded directly in the DB by its own migration). The AI-insights flag is a soft check read directly in its route rather than enforced via `requireFeature`. Shopify routes are gated by an active-connection check, not a flag.

### `plan-limits.js`
Exports: `requirePlanLimit`, `requireActiveSubscription`, `PLAN_DEFAULTS`.

- **`requirePlanLimit(resource)`** — resource must be `"employees"`, `"outlets"`, or `"products"`. No-op in single-tenant mode. `0` or `null` in the DB means unlimited. Returns 403 at cap. A DB failure best-effort passes the request through rather than blocking on the check's own failure.
- **`requireActiveSubscription`** — no-op for read verbs, single-tenant mode, and auth/billing/support/setup/health/receipts paths, and for free-plan tenants entirely. An expired payment status returns 403 on writes. Uses a `.then()` chain internally rather than `await` — the outer function itself is synchronous.
- **Plan defaults**: a free tier capped at one outlet with limited employees/products; a paid tier with one default outlet and unlimited employees/products.
- **Subscription lifecycle**: trial → grace → expired (read-only), gated by these two middleware functions plus a background billing-lifecycle check job.

### `rate-limit.js`
Exports: `globalLimiter`, `authLimiter`, `webhookLimiter`, `reviewLimiter`, `publicBookingLimiter`, `publicRestaurantLimiter`, `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter`, `manufacturerPortalAuthLimiter`, `manufacturerPortalDataLimiter`, `pinValidateLimiter`. All return 429 with a `Retry-After` header and a JSON body. `globalLimiter` skips POS burst paths (sales, product search, barcode scan, orders). Portal limiters (customer + manufacturer) and the review/booking/restaurant limiters all key on a tenant query param or header rather than `req.tenantSlug`, since they sit on routes mounted before the tenant-resolution middleware runs.

### `validate.js`
Exports `{ validate }`. `validate(schema)` is a Zod middleware factory. On success it **replaces** `req.body` with the parsed result — downstream handlers must not assume the raw body shape survives. On a validation error: 400 with `{ error, details: [{ field, message }] }`, field being a dot-joined path.

### `upload-validation.js`
Exports `imageFileFilter`, `rasterImageFileFilter`, `clinicalDocFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, plus the allowlist constants. `imageFileFilter` allows SVG (only safe for uploads that get rasterized before being served back). `rasterImageFileFilter` excludes SVG (prevents same-origin XSS on anything served as-is, like support-ticket screenshots). `clinicalDocFileFilter` adds PDF and plain text, still no SVG. `verifyImageMagicBytes` catches a faked content-type after upload.

### `request-id.js`
Exports a default `requestId` and a named `requestId.enrichReqLog`. Wraps the shared Pino logger. UUID per request (honours an incoming request-id header). Sets the response header, `req.log`, `req.id`, `req._startTime`. `enrichReqLog` rebinds `req.log` with tenant/employee context after auth resolves — wire it after `loadTenantAndPerms`.

### `customer-auth.js` / `manufacturer-auth.js`
Two near-identical portal-auth modules, each with its own JWT secret and scope, separate from employee auth. Both delegate to `services/public-tenant-context.js:resolvePublicTenantDb()` for tenant routing (never `resolveTenant`), both cross-check the token's tenant claim against the resolved tenant, and both support a per-principal revocation cursor. They've drifted apart on TTL defaults and status-check details — if you fix a bug in one, check whether it applies to the other.

---

## Subdirectories

### `routes/`
All API route handlers. See `routes/CLAUDE.md` for the full table of route files, mounting order, and conventions.

Key conventions:
- Routes mounted before tenant middleware (no `req.employee`, no `deps.db` proxy): `admin/`, `webhooks.js`, `receipts.js`, `customer-portal/`, `manufacturer-portal/`, `storefront.js`, `public-restaurant.js`, `public-bookings.js`, `country-packs.js`, `gift-cards-public.js`, `public-reservations.js`, `sandbox.js`
- `deps.db` is the tenant DB proxy — always use it in route handlers, never `db` directly
- Transactions: `deps.db.transaction(async (client) => {...})` — the client inherits the tenant's search path
- Error conventions: success `res.json({...})`, client error `res.status(4xx).json({ error: "..." })`, server error `res.status(500).json({ error: err.message })`

### `services/`
Business logic, external API clients, infrastructure services. See `services/CLAUDE.md`.

Key services:
- `logger.js` — Pino singleton; always `require` this, never create another instance
- `boss.js` — the pg-boss singleton factory; always `getBoss()`, never construct the job-queue client directly
- `crypto.js` — AES-256-GCM for integration credentials; stored as `enc:v1:{iv}:{tag}:{ciphertext}`
- `email.js` — `sendEmail()` (immediate) and `enqueueEmail()` (queued, limited retries)
- `payment-gateway.js` — adapter pattern; `isEnabled()` checks for a live gateway API key, not just that a gateway name is configured
- `fbr.js` — tax-authority digital-invoicing client + payload builders + exponential backoff
- `stock-ledger.js` — `decrementStock`/`incrementStock`, the one shared "move on-hand stock" implementation every writer (POS sale, quotation-convert, transfers, supplier returns, PO receive, stock count) funnels through. Must run inside the caller's own transaction — takes a row lock, gates on availability, writes every relevant stock table when a variant is present. Batch/expiry handling delegates to `batch-stock.js` unless the caller opts out.
- `tax-snapshot.js` — `resolveTaxSnapshot()`, the one shared per-line tax cascade (outlet tax profile → product tax rate → legacy direct rate → category-inherited rate → zero) every sale writer applies, so the frozen per-line snapshot stays consistent regardless of entry point.
- `business-modules.js` — the module toggle engine behind `/api/business-modules`: atomic flag+mode transaction, a saved-flags snapshot on disable that restores exactly on re-enable, a dependency cascade that leaves dependents connected rather than cascading them off, platform-lock enforcement, first-mode-row drift backfill (writing a tenant's first mode row flips mode enforcement from fall-through to strict for every mode), an audit trail, and both middleware caches invalidated after every toggle. Also exports the lockdown middleware for the legacy flag-PUT route once a flag becomes module-managed.

See `services/CLAUDE.md` for the full service inventory (couriers/marketplace adapter subdirectories, domain services, gotchas).

### `tests/`
See `tests/CLAUDE.md` for the full test suite breakdown.

- Runner: **Vitest** (not Jest). One integration file uses Jest-style syntax but still runs fine under Vitest.
- Integration tests require a live database connection. Prefer a local `.env.test` Postgres instance to keep tests off the production-adjacent database.
- `smoke-gate.test.js` has pre-existing failures — do not run or investigate unless explicitly asked.
- Test isolation: the shared test-app factory creates a fresh randomly-named schema per test; `cleanup()` drops it.

### `workers/`
See `workers/CLAUDE.md` for the full per-worker reference (queues, poll cadence, heartbeat globals).

Background workers start from `boot/workers.js`, which mixes pg-boss jobs with `setInterval` pollers and some inline scheduling logic — not everything started there has a corresponding file in this directory (a few pollers live inline in `boot/workers.js` itself). Each pg-boss worker requires its own environment-variable toggle to run and exposes a heartbeat global read by the admin worker-status endpoint. pg-boss workers survive process restarts; `setInterval` pollers do not. Prefer the shared tenant job-context helper over raw schema-string interpolation for any new tenant-scoped worker.

Module-gated workers (a module toggle stops the corresponding background processing while preserving data, resuming automatically on re-enable): the rental-overdue, room-overdue-checkout, night-audit, treatment-plan, hold-expiry, KDS-snapshot, course-release, reservation-reminder, and channel-sync tenant handlers each check the relevant feature flag first and no-op when it's off; the booking-reminders worker does the same for appointments. The stale-reservation-expiry worker is deliberately NOT gated this way — expiring a reservation releases stock, and stopping the worker would strand reserved stock.

### `schemas/`
Zod validation schemas for all domains, one file per domain, consumed by `validate(schema)` middleware. See `schemas/CLAUDE.md` for the full file/export/importer table and conventions (permissive vs. strict parsing, exported enum constants, cross-field validation).

### `config/`
Static config-as-code modules with no DB access:
- `business-modules.js` — the Business Modules catalog. Every feature-flag key is classified into a bucketed card (flags, sub-toggles, mode, dependencies, permissions, impact queries, and — for cards with a real setup flow — a setup route and connected-check) or explicitly listed as unmanaged and left on the legacy flag-PUT path. A drift-guard unit test fails CI if a flag key is left unclassified. Exports `classifyFlag`, `cardManagedFlags`, `presetRecommendedModules`, `MODULE_STATES`.
- `permissions-catalog.js` — every registered permission string, grouped for the role editor. Exports `PERMISSIONS_CATALOG`, `isKnownPermission`. A drift-guard unit test scans every permission-guard call site in the codebase for a string not registered here.
- `mode-registry.js` — the tenant-modes registry (mode → feature flags mapping), used by preset seeding, admin mode CRUD, and the business-modules first-row backfill.
- `country-packs.js`, `industry-config.js`, `vertical-usage-sources.js` — signup tax packs, industry preset definitions, admin vertical-usage count sources.

### `boot/workers.js`
All worker startup, imported by `index.js`. Mixes pg-boss workers with `setInterval` pollers. Do not start workers anywhere else.

### `utils/`
- `tz.js` — `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` — converts a local `YYYY-MM-DD` to UTC boundaries. Use for every date-filter query. See the timezone section below.
- `r2.js` — Cloudflare R2 upload/download helpers
- `receiptEmail.js` — builds the customer receipt email HTML
- `digestEmail.js` — builds the daily digest email
- `backup-pg.js` — `pg_dump` to R2 for tenant self-export
- `resendEmail.js` — direct call to the transactional email provider (used by `alertEmail.js`)
- `alertEmail.js` — sends operational alerts

---

## Key Conventions

### Postgres only
Legacy SQLite code is deleted. `schema-pg.sql` is the DDL source of truth. All queries use `$1, $2` placeholders.

### Multi-tenant DB routing
`deps.db` in route handlers is a Proxy that delegates to the tenant's scoped DB via AsyncLocalStorage. `resolveTenant` middleware wires the async context before any route handler runs. Never use the plain pool directly in tenant route handlers.

### `deps.db` pattern
Routes receive a `deps` object containing `db` (the tenant proxy), plus references to middleware functions and external clients. Routes are factory functions: `module.exports = (app, deps) => { ... }`.

### Feature flags
Apply `requireFeature('flag_name')` as per-route middleware, sometimes combined with `requireMode('mode_name')` for vertical-specific gating. A new flag needs an entry in `DEFAULT_FEATURE_FLAGS`, a seed in `schema-pg.sql`, and a classification in the business-modules catalog — the catalog's drift-guard test fails otherwise. Call `invalidateFeatureFlagCache(tenantId)` after any admin flag change. The legacy flag-PUT route no longer accepts writes to module-managed flags — those go through the business-modules toggle endpoint so bucket rules, dependencies, mode sync, the flag snapshot, platform locks, and the audit trail all apply consistently.

### Permission guards
Most authenticated tenant GETs use `requirePerm` or `requireAnyPerm`. Public GETs exist by design (receipts, country-packs, public bookings/storefront). Some authenticated GETs rely on shared auth/session context rather than an explicit permission guard — the rule is not absolute.

### Workers — adding a new one
1. Create `workers/<name>-worker-boss.js` using the pg-boss pattern
2. Register startup in `boot/workers.js`
3. Add an environment-variable toggle for enabling it
4. Expose a heartbeat global
5. Add a slot to the admin worker-status endpoint

### Adding a new route
1. Create `routes/<domain>.js`
2. Add a Zod schema in `schemas/<domain>.js` if validating a request body
3. Register in `routes/registerAllRoutes.js` — most route files call their own registration function directly against `app`; a few use a prefix-mounted router style instead
4. Add any new permission strings to `middleware/permissions.js` and the permissions catalog

### Encryption
Integration credentials are stored as `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. Always call `decryptSecret()` before passing config to an adapter. Courier adapters receive pre-decrypted config — decryption happens in the route layer.

### Timezone
- ALL business timestamps are `TIMESTAMPTZ` (absolute instants): sales, returns, cash shifts, attendance sessions, GRN receipts, supplier payments, appointment start times, and so on. There are no "already local" timestamp columns.
- The sales timestamp column is named `timestamp`, not `created_at`.
- `req.company.timezone` (an IANA string) is set by `loadCompanyProfile` — the tenant's business timezone.
- **There are two independent timezones, neither of which is the tenant's**: the Node process timezone (affects `Date#toString`/`getHours`, not `toISOString()`) and the Postgres session timezone (what a bare `::date` cast, `date(col)`, or `CURRENT_DATE` evaluates in — UTC on the production database, often something else on local dev). Code relying on either gives different answers per environment.
- **Rules** (enforced by a repo-wide unit test that scans for the banned patterns):
  - JS "today": `tenantToday(req.company?.timezone)` from `utils/tz.js` — never `new Date().toISOString().slice(0,10)` (always UTC)
  - Date-range filters on a TIMESTAMPTZ column: `col >= toUtcStart(from, tz) AND col < toUtcEnd(to, tz)` — never `col::date >= $from`
  - SQL same-day comparison: `(col AT TIME ZONE $tz)::date = (NOW() AT TIME ZONE $tz)::date` (tenant timezone on both sides) — never `col::date = CURRENT_DATE`
  - Day bucketing in reports: `(col AT TIME ZONE '<validated tz>')::date`
  - Reading a plain `DATE` column back to a string: `pgDateToStr(row.col)` — the Postgres driver returns local-midnight JS `Date` objects for `DATE` columns, so `toISOString()` can shift the date by a day
  - Plain `DATE` columns (expense date, due date, expiry date, room booking dates) are timezone-free — compare them against `tenantToday(tz)`, not `CURRENT_DATE`
- **Local-database parity**: local development databases have their session timezone explicitly set to UTC to match the production database's session timezone. If a local database is ever recreated, re-apply that setting — otherwise a timezone bug can behave differently in local dev than in production and hide there. A CI check also runs the same guard on every push.

### Test runner
**Vitest** — not Jest. One integration file uses Jest syntax but still runs fine.

### Production
- Backend runs on Railway; database is Supabase Postgres reached through the transaction pooler
- `start.sh` — the platform entrypoint: sets the timezone, runs the migration CLI, then execs the server

---

## Pointers

- `routes/CLAUDE.md` — full route file table, mounting order, subdirectory summaries
- `services/CLAUDE.md` — full service inventory, adapter subdirectories, shared writers
- `middleware/CLAUDE.md` — per-middleware-file reference (this file only summarizes the chain)
- `schemas/CLAUDE.md` — Zod schema conventions and file/export table
- `workers/CLAUDE.md` — per-worker queue/cadence/heartbeat reference
- `tests/CLAUDE.md` — integration test groupings, unit test patterns, test-helper reference
- `utils/` has no sub-guide — the handful of files are summarized above
- `boot/CLAUDE.md` — worker startup sequencing detail beyond the summary above
- `shopify/CLAUDE.md` — the Shopify client/crypto/order-service/utils internals consumed by `routes/shopify/`
