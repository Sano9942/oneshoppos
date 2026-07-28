# Subsystem Audit 01 — Backend Core (boot, middleware chain, multi-tenancy, auth primitives)

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins** — it reflects independent re-verification.
> Line numbers drift with every commit: **grep the named symbol, don't trust the number.**

Stack per `backend/package.json`: Express 5.2.1, `pg` 8.20, `pg-boss` 12.15, `@sentry/node` 10.46, `zod` 4.3.

---

## 1. Deploy entry

**`backend/railway.toml`**
- `builder = "DOCKERFILE"`, `dockerfilePath = "./Dockerfile"` (:2-3)
- `healthcheckPath = "/api/health"`, `healthcheckTimeout = 120` (:6-7)
- `restartPolicyType = "ON_FAILURE"`, `restartPolicyMaxRetries = 3` (:8-9)
- `[[volumes]] mount = "/data"` (:11-12) — legacy SQLite artifact; the Postgres path never writes there.

**`backend/Dockerfile`** — two-stage `node:22-alpine`; stage 2 installs `sqlite tzdata postgresql17-client` (:12, for `pg_dump`), `ENV NODE_ENV=production PORT=5000` (:17), `CMD ["sh", "start.sh"]` (:19).

**`backend/start.sh`** (25 lines, `set -e` :3)
1. `export TZ="${TZ:-Asia/Karachi}"` (:6)
2. If `$DATABASE_URL` set → `node migrate-pg.js` (:12) then `exec node index.js` (:14)
3. Else SQLite legacy branch (:17-24) — dead path

Because of `set -e`, **a migration failure aborts the deploy before the server starts**. Migrations run across *all* tenants sequentially inside the 120 s healthcheck budget.

---

## 2. `backend/index.js` — boot sequence (328 lines)

### 2.1 Pre-Express phase, in execution order

| # | Line(s) | What |
|---|---|---|
| 1 | 2-14 | IIFE: picks `.env.production` when `DB_TARGET === "production"`, else `.env`; prints green "LOCAL DB" / red "PRODUCTION DB" banner |
| 2 | 16-23 | `Sentry.init({ dsn, environment, tracesSampleRate: 0 })` — only when `SENTRY_DSN` set. No `setupExpressErrorHandler` |
| 3 | 24-63 | Module requires |
| 4 | 64 | `require("dotenv").config()` **a second time** (no path — CWD-relative) |
| 5 | 67 | `IS_MULTI_TENANT = process.env.MULTI_TENANT === "1"` |
| 6 | 69-78 | MT init: `createDbProxy()`, `tenantDbManager.init(db)` (:74), `masterDbPgBoot.init(db)` (:77) |
| 7 | 84 | `require("./boot/assert-secrets").assertProductionSecrets()` |
| 8 | 87-90 | `mtDeps` injected into `tenantAuth.init`, `featureFlags.init`, `outletContext.init` |
| 9 | 93-102 | `app.set("trust proxy", Number(TRUST_PROXY_HOPS \|\| 2))` in production — **2 hops** |
| 10 | 103-112 | `PORT`, `SHOPIFY_MAX_RETRY_ATTEMPTS`, uploads dirs |
| 11 | 114-118 | `mkdirSync` for the three uploads dirs |

⚠️ The comment at :80-84 claims the secret guard "runs before anything else so the deploy fails fast" — it actually runs at step 7, **after** the MT DB init at step 6.

### 2.2 Middleware registration order

| Order | Line | Middleware |
|---|---|---|
| 1 | 120-123 | `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })` |
| 2 | 124-129 | `cors({ origin: CORS_ORIGIN.split(",") \|\| "http://localhost:5173", credentials: true })` |
| 3 | 130-143 | `express.json({ limit: "10mb", verify })` — `verify` stores `req.rawBody` for `/api/integrations/shopify/webhooks/` and `/api/webhooks/*` |
| 4 | 145-150 | 4-arg error middleware: `entity.parse.failed` → 400 |
| 5 | 152 | `express.static(UPLOADS_DIR)` at `/uploads` |
| 6 | 160-184 | `GET /r2/*key` R2 proxy — **only when `R2_PUBLIC_URL` unset**. Prefix allowlist `["products/","company/","support/"]` (:159); else 404 |
| 7 | 185 | `compression()` |
| 8 | 186 | `cookieParser()` |
| 9 | 187 | `globalLimiter` |
| 10 | 188 | `requestId` |
| 11 | 196-197 | `registerAdminRoutes` — **admin mounts before all tenant middleware** |
| 12 | 199-247 | `registerAllRoutes(app, deps)` |
| 13 | 250-259 | Swagger at `/api-docs`, gated by `API_DOCS_KEY`: unset → 404; mismatch → 401 |
| 14 | 262-280 | Global error handler |

`deps.db = IS_MULTI_TENANT ? dbProxy : db` (:201) — the single switch making every route tenant-aware.

### 2.3 Chain continued in `routes/registerAllRoutes.js`

| Order | Line | Mount |
|---|---|---|
| a | 52 | inline `GET /api/health` (`?deep=true` → 503 when DB down) |
| b | 151-222 | Pre-tenant public mounts (webhooks, sandbox, receipts, gift-cards-public, storefront, public-*, portals) |
| c | 230 | `/api/setup` |
| d | 233 | `/api/country-packs` |
| e | **236** | `loadTenantAndPerms` (MT) / `loadEmployeePerms` (ST) |
| f | 239 | `resolveTenant` |
| g | 242-248 | tenant `/uploads` static |
| h | 250 | `loadCompanyProfile` |
| i | 256 | `resolveOutletContext()` |
| j | 262 | `resolveEffectiveRole` |
| k | 263 | `resolveContext` |
| l | 267 | `requireActiveSubscription` |
| m | 270 | `requireContextOutlet` |
| n | 273 | `requestId.enrichReqLog` |
| o | 274 | `ensureDefaultRolePermissions(db)` — **boot-time call, not middleware** |
| p | 282 | `enforceOutletAssignment()` |
| q | 284-302 | blanket `PERMISSION_RULES` middleware |
| r | 304-315 | restore guard → 503 on non-GET while restore in progress |
| s | 318+ | `/api/reports` telemetry wrapper |

### 2.4 Boot guards

1. **`assertProductionSecrets()`** (`index.js:84`) — see §3.1
2. **`ensureCriticalRoutesRegistered(app)`** (`index.js:283-311`) — requires four routes: `POST /api/products/bulk-import`, `bulk-delete`, `bulk-status`, `DELETE /api/integrations/shopify/import/products`. Scans only `layer.route` on top-level stack (:291-298) — **anything behind a sub-router is invisible**. Missing → throw (:307).

### 2.5 Server start / shutdown

```js
app.listen(PORT, …)   // 314-316 — return value NOT captured
startWorkers({…})     // 318-327
```

**There is no graceful shutdown.** Repo-wide grep for `SIGTERM|SIGINT|unhandledRejection|uncaughtException|server.close|db.end()` across `backend/**/*.js` returns only `migrate-pg.js:10171`, `seed-admin-pg.js`, `scripts/sqlite-to-pg.js:258`, `tenant-provisioner-pg.js:231`, and test files. `services/boss.js:46` defines `shutdownBoss()` with the comment "graceful stop (call on SIGTERM)" (:5) and **nothing calls it**.

---

## 3. `backend/boot/`

### 3.1 `assert-secrets.js` (127 lines)

Constants: `MIN_SECRET_LENGTH = 32` (:26), `MIN_DISTINCT_CHARS = 12` (:27), `WEAK_LITERALS` (:31-37).

`checkPortalSecret` (:53-74) flags: unset (early return), `=== JWT_SECRET`, length < 32, distinct chars < 12, weak literal.

`assertProductionSecrets(env)` (:84-118): **no-op unless `NODE_ENV === "production"`** (:85). Checks both portal secrets (:87-98) plus mutual distinctness (:103-110). Any problem → `throw new Error("Production boot aborted — insecure portal secret configuration…")`.

### 3.2 `workers.js` (600 lines) — `{ startAll, recordGate, markRegistered }`

**Gate registry** `global.__workerRegistry` (:16). `recordGate(key, envVar, {defaultOn, optOut, kind})` (:18-40) — three gate styles. Entry shape `{env_var, env_value, env_enabled, default_on, opt_out, kind, registered, register_error}`.

**`forEachActiveTenant`** (:48-74) — lazily requires `../master-db-pg` **inside the function body** (:59, avoids a require cycle); per-tenant try/catch (:64-69) so a failing tenant only `console.error`s.

**`startAll(deps)` order** (:250-597):
1. `startSqliteBackup` only when `DATABASE_URL` unset (:255-257)
2. Three daily cleanups (:260-266): `cleanupSyncEvents` (30-day retention), `cleanupReportScheduleArtifacts` (45/60/30-day), `closeStaleAttendanceSessions` (tenant-TZ aware, :149-155)
3. `startShopifyWorker` (:188-217) — opt-out gate, **30 s** poll
4. `startReportScheduleWorker` (:219-248) — opt-out, **60 s**
5. Catalog scheduler (:275-300) — opt-in, 60 s
6. `PG_BOSS_GATES` array (:306-334) — 28 entries, bookkeeping only
7. `if (process.env.DATABASE_URL)` block (:338-596) — `getBoss().then(…)`, each worker via `tryRegister` (:342-352). 25 pg-boss workers
8. Booking reminders (:560-593) — a **`setInterval` poller inside the pg-boss block**, 5-minute interval

⚠️ `PG_BOSS_GATES` feeds the status registry; the real gates are the hand-written `if (String(process.env.X)…)` blocks below. Two hand-maintained lists that can drift.

---

## 4. `backend/db-pg.js` (67 lines)

```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
});                                                     // :15-21
```

- **Pool max 20**; no `idleTimeoutMillis`/`connectionTimeoutMillis`/`statement_timeout`
- **SSL in production is `rejectUnauthorized: false`** — encrypted but unauthenticated
- Deliberately does **not** load dotenv (:5-11)
- Exports: `query`, `getClient`, `transaction`, `end`, `pool`

---

## 5. Multi-tenant DB routing

### 5.1 `tenant-db-proxy-pg.js` (51 lines) — the live proxy
- `asyncStore = new AsyncLocalStorage()` (:10)
- `getCurrentDb()` (:16-22) **throws** `"No tenant DB in async context"` — fail-closed
- `PROXIED_METHODS = ["query","transaction","getClient"]` (:25)
- `createDbProxy()` (:31-48) resolves the DB at **call** time for proxied methods

### 5.2 `tenant-db-manager-pg.js` (129 lines)
- `_tenantCache` + **`CACHE_TTL_MS = 60_000`** (:16-19)
- `getDb(tenantId)` (:33-97): cache hit within 60 s, else `masterDbPg.getTenantById`. Status gates throw `"… is suspended"` / `"… is deleted"` (:50-51) — **these exact strings are what `resolveTenant` matches on**
- `query` (:57-73) and `transaction` (:75-89): `BEGIN` → `SET LOCAL search_path TO '<schema>', public` → work → `COMMIT`. The BEGIN wrapper exists so PgBouncer transaction-mode keeps SET and query on the same backend (:60-61)
- ⚠️ `getClient()` (:91-95): **session-level** `SET search_path` — no `LOCAL`, no transaction, no reset on release
- `closeDb`/`closeAll` are no-ops (:126-127)

### 5.3 `master-db-pg.js` (246 lines)
`MASTER_SCHEMA` (:5-142) creates idempotently: `tenants`, `super_admins`, `tenant_audit_log`, `schema_migrations`, `tenant_refresh_tokens`, `plan_pricing` (+ seeds), `payment_records`, `upgrade_requests`, `payment_intents`, `impersonation_sessions`.

`tenants` defaults (:11-23): `status='active'`, `plan='free'`, `timezone='UTC'`, `max_employees=3`, `max_outlets=1`, `max_products=100`, `payment_status='active'`.

`query()` (:223-238) always wraps in `BEGIN; SET LOCAL search_path TO public; …; COMMIT`. Docblock (:216-222) explains: under Supavisor transaction pooling an unwrapped `SET` can land on a different backend, producing phantom "not found" lookups. ⚠️ `createTenant()` (:170-198) performs **no slug validation** (currently zero callers).

### 5.4 `tenant-db-pg.js` (69 lines) — **dead code**
Older ALS design, session-level `SET search_path` (:60). Repo-wide grep returns **zero importers**.

### 5.5 `tenant-provisioner-pg.js` (243 lines)
`provision(db, {slug, name, ownerEmail, timezone, pin})` (:50-186):
1. `validateSlug` → **`/^[a-z0-9_]{3,40}$/`** (:190) — hyphens rejected
2. `pin` must match `/^\d{4,8}$/` (:53)
3. `safeSlug = slug.replace(/-/g,"_")` (:56)
4. `setupToken = crypto.randomBytes(32).toString("hex")` (:59); `bcrypt.hash(pin, 10)`
5. `CREATE SCHEMA IF NOT EXISTS` **outside** any transaction (:62-67) — deliberate; orphans recoverable via admin endpoint
6. Transaction #1 (:85-155): full `schema-pg.sql`, then **seed `schema_version` with every `MIGRATIONS[].version`** in one insert (:95-101), roles/permissions/employee/outlet/company_profile (`setup_token_expires_at = NOW() + 48h`)/default tax
7. Transaction #2 (:158-173): `SET LOCAL search_path = 'public'`, insert `tenants` + audit row
8. Catch (:176-182): best-effort `ROLLBACK` + `DROP SCHEMA … CASCADE`

---

## 6. `backend/jwt-auth.js` (88 lines)

```js
defaults = {
  accessExpiresIn:  JWT_EXPIRES_IN         || "24h",
  refreshExpiresIn: JWT_REFRESH_EXPIRES_IN || "7d",
};   // :10-13
```

| Function | Line | Payload | TTL |
|---|---|---|---|
| `signAccessToken` | 21-27 | `{tid, eid, rid, oid, scope: "full", jti: randomUUID()}` | 24 h |
| `signRefreshToken` | 36-47 | `{tid, eid, type:"refresh"}` — **no `jti`** | 7 d |
| `verifyAccessToken` | 56-58 | `jwt.verify(token, secret)` — **no `algorithms` option** | — |
| `verifyRefreshToken` | 67-69 | same | — |
| `hashToken` | 76-78 | sha256 hex | — |

### Portal token primitives

| | `customer-auth.js` | `manufacturer-auth.js` |
|---|---|---|
| Secret env | `CUSTOMER_PORTAL_JWT_SECRET` (:23) | `MANUFACTURER_PORTAL_JWT_SECRET` (:26) |
| Access TTL | **`"30m"`** (:18) | **`"15m"`** (:21) |
| Refresh TTL | `"30d"` | `"30d"` |
| Principal claim | `cid` | `mid` |
| Scope | `"customer"` | `"manufacturer"` |
| Prod posture | throws if unset (:33-35) | throws if unset (:35-37) |
| Dev fallback | `JWT_SECRET \|\| "dev-insecure-secret"` + warn | same |

---

## 7. `backend/migrate-pg.js` (10,178 lines)

- `MIGRATIONS` at :29-9996 — `{version, description, up}`
- **v1 applies the whole `schema-pg.sql`** (:31-37)
- **Head: v137** (:9973)

**`migrate(db)`** (:10019-10060): creates `schema_version` (:10021-10026); `currentVersion` = `ORDER BY version DESC LIMIT 1` (:10029-10032) — **MAX, not set membership**; `pending = MIGRATIONS.filter(m => m.version > currentVersion)`; each in its own transaction, stamping version in the same transaction (:10047-10053).

**`makeScopedDb`** (:10067-10104) — `BEGIN` → `SET LOCAL search_path TO ${schema}, public` → work → `COMMIT`.

**`migrateAllTenants(db)`** (:10110-10165):
1. `migrate(publicDb)` (:10116-10119)
2. **Unconditional RLS sweep** `enableRlsOnPublicTables` (:10127-10131), try/catch logs only
3. `SELECT id, slug FROM tenants WHERE status='active'` (:10139-10141)
4. Per tenant `migrate(scopedDb)` in a **try/catch that only `console.error`s** (:10147-10156)

### Last five migrations

| v | Line | What |
|---|---|---|
| 133 | 9720 | Field Rep split — pristine roles convert `manage_field_sales`→`execute_field_sales`; customized grandfather |
| 134 | ~9760 | `view_reports` → five `view_*_reports` splits; pristine Cashier goes sales-only, others grandfather to all |
| 135 | 9876 | Full `tenant_modes` materialization — a row per registry mode per tenant, retiring the empty→enforcing trap |
| 136 | 9921 | `tenant_business_modules.default_outlet_enabled` + `outlet_business_modules` table |
| **137** | **9973** | `employee_outlets.role_id INTEGER NULL REFERENCES roles(id) ON DELETE SET NULL` |

---

## 8. `backend/middleware/` — per file

### 8.1 `tenant-auth.js` (550 lines)
`_companyCache` **5 min** (:14-15); `_contextFlagCache` **30 s** (:18-19).

`PUBLIC_TENANT_PARAM_PATHS` (:28-36) — the only paths where `?tenant=` attaches scope without a JWT: `/api/auth/`, `/api/attendance/pin-`, `/api/feature-flags`, `/api/setup/`, `/api/health`, `/api/company-profile/currency$`, `/api/billing/pricing$`.

**`loadEmployeePerms`** (:55-81) — ST path. Reads `x-employee-id`, range-checks, loads perms. **No cryptographic authentication whatsoever.**

**`loadTenantAndPerms`** (:83-242):
1. No Bearer → empty perms, `next()` (:84-88) — fall-through by design
2. `verifyAccessToken` (:92)
3. **Scope gate** (:109-111) — explicit non-`"full"` scope → 401 `INVALID_TOKEN_SCOPE`, *before* any `req` assignment
4. Sets `req.tenantId`, `req.employee`, `req.isImpersonating` (:113-118)
5. Revocation (:135-169) — `revoked_tokens` jti, `impersonation_sessions.revoked_at`, `tokens_revoked_before` vs `iat`. ⚠️ All inside **one try/catch that swallows everything** (:167-169)
6. Permission load with one retry (:176-209) → **503 `PERM_LOAD_FAILED`** on repeated failure
7. **DB-fresh `role_id` overwrites the token's `rid`** (:220-222)

**`resolveTenant`** (:244-301) — `?tenant=` only on the allowlist (:248-263); unresolved `/api/` → 401 `AUTH_REQUIRED` (:273-275); `asyncStore.run({db: tenantDb}, () => next())` (:290); catch maps `"is suspended"`/`"is deleted"` → 403 (:291-300).

**`loadCompanyProfile`** (:303-351) — cold start awaits inline with a `_placeholder` profile (`timezone: "UTC"`) that **survives a DB error** (:314-325); warm+stale → fire-and-forget refresh; 503 `SETUP_REQUIRED` when incomplete (:339-348).

**`resolveEffectiveRole`** (:371-421) — always sets `req.baseEmployeePerms`; override falsy or equal to base → zero extra queries (:382-383); one retry then 503. Invariant documented at :353-369.

**`resolveContext`** (:423-473) — 428 `CONTEXT_REQUIRED` for non-admins without an outlet when enforcement is on. ⚠️ Flag refresh is fire-and-forget and starts `{enforced:false, loaded:false}` (:445-456), so the first request each 30 s window skips enforcement.

### 8.2 `outlet-context.js` (251 lines)
`_outletCache` **60 s** (:29-30). `_loadOutletsMap` excludes inactive outlets (:49-61). `_getAssignment` falls back on PG error `42703` for pre-v137 schemas (:77-94).

`resolveRequestedOutlet` (:110-146) — malformed → 400; not in active map → **403 same code as malformed** (no existence leak, :121-123); no assignment → 403 `OUTLET_NOT_ASSIGNED`; stale `jwtOid` degrades silently to none (:135-144).

`resolveOutletContext()` (:154-184) — `skipAssignment` from `all_access` / `execute_field_sales`, computed from **base** perms since `resolveEffectiveRole` runs after (:164-174).

`enforceOutletAssignment()` (:194-235) — reads **`req.baseEmployeePerms || req.employeePerms`** (:205), base-first by design; skips `/api/attendance/pin-` (kiosk).

### 8.3 `permissions.js` (374 lines)
- `requirePerm` (:5-15) — `all_access` bypasses; 403 otherwise
- `DEFAULT_ROLE_PERMISSIONS` (:37-105): Administrator `["all_access"]`; Manager 30 perms; Cashier `["view_sales_reports","pos_discount","pos_park"]` (:95); Field Rep `["execute_field_sales"]` (:104)
- `ensureDefaultRolePermissions(db)` (:107-124) — try/catch that only `console.error`s (:121-123)
- **`PERMISSION_RULES`** (:126-364) — 26 rules. Mechanics live in `registerAllRoutes.js:284-302`: blanket `app.use`, first-match-wins, **no match falls through**. Reads **effective** perms. The `/api/attendance` rule needs a negative lookahead to exempt `my-status` (:152) or the POS shift gate breaks

### 8.4 `feature-flags.js` (653 lines)
`DEFAULT_FEATURE_FLAGS` (:24-210) — 100+ keys; `fbr_integration` **absent entirely**; `ai_insights` defaults true but its route reads the DB row directly.

Caches: `_featureFlagCache` **60 s** (:213-214), `_modeCache` **60 s** (:455-456).

`_getBundle` (:230-299) — one 60 s fill, three queries (merged flags, outlet overrides, module defaults). `_outletResolved` (:310-315) = **`override ?? default_outlet_enabled ?? true`**.

`requireFeature` (:425-452) — flag off → **403** (deliberately not 503). `requireMode` (:535-587) — **fail-closed**: empty map → 403 `MODES_NOT_SEEDED` (:547-554), deliberately distinct from plain "mode off".

### 8.5 `plan-limits.js` (139 lines)
`PLAN_DEFAULTS` (:16-19): free `{outlets:1, employees:3, products:100}`; pro `{outlets:1, employees:0, products:0}` (0 = unlimited).

`requirePlanLimit(resource)` (:50-93) — throws at registration for unknown resource; `current >= limit` → 403 `PLAN_LIMIT_REACHED`. ⚠️ **Any thrown error → `next()`** (:87-91).

`requireActiveSubscription` (:100-136) — **synchronous body running a `.then()` chain** (:121-135). Free plan never blocked (:124); `expired` → 403 (:126-132); lookup failure → `next()`.

### 8.6 `rate-limit.js` (277 lines)

| Limiter | Window | Max | Key |
|---|---|---|---|
| `globalLimiter` | 60 s | 600 | `tenantKey:ip`, skips POS burst paths |
| `authLimiter` | 15 min | 20 | `store_code:ip` |
| `webhookLimiter` | 60 s | 120 | IP |
| `reviewLimiter` | 15 min | 5 | tenant:ip |
| `publicBookingLimiter` | 15 min | 10 | tenant:ip |
| `publicRestaurantLimiter` | 60 s | 60 | tenant:ip |
| `memberKioskLimiter` | 60 s | 30 | tenant:ip |
| `customerPortalAuthLimiter` | 15 min | 10 | slug:ip |
| `customerPortalOtpLimiter` | 15 min | 5 | email:ip |
| `customerPortalDataLimiter` | 60 s | 120 | customerId |
| `manufacturerPortalAuthLimiter` | 15 min | 5 | slug:ip |
| `manufacturerPortalDataLimiter` | 60 s | 60 | manufacturerId |
| `pinValidateLimiter` | 15 min | 20 | tenant:ip |
| `adminTotpLimiter` | 15 min | 5 | ip |

`isPosBurstPath` (:41-48): `/api/sales`, `/api/products/search`, `/api/products/scan/`, `/api/orders`. In-source rationale: a 4-digit PIN space is brute-forceable inside the 600/min global cap in ~17 min; 20/15 min pushes it to ~5 years (:231-234).

### 8.7 `validate.js` (29 lines)
`validate(schema)` **replaces `req.body`** with the parsed result (:10). ZodError → 400 with `{error, details:[{field, message}]}`.

### 8.8 `upload-validation.js` (215 lines)
`ALLOWED_IMAGE_MIMES` includes **svg+xml**; `ALLOWED_RASTER_*` excludes it (:31-36) — rationale at :27-30 references incident **P31** (support-upload XSS → session takeover). ⚠️ Extension check is `if (ext && !allowedExts.has(ext))`, so **a file with no extension passes**. `verifyImageMagicBytes` (:171-178) catches faked content types (**P32**).

### 8.9 `request-id.js` (98 lines)
`pino-http` around the shared logger. `SLOW_REQUEST_MS = 2000`. `warn` on ≥400 **or** >2000 ms. Serializers deliberately minimal — **no bodies logged**. `enrichReqLog` rebinds after auth.

### 8.10 `customer-auth.js` / `manufacturer-auth.js`
Both: Bearer → verify → scope check → reject refresh-as-access → `resolvePublicTenantDb` (**never `resolveTenant`**) → **cross-tenant check** `payload.tid !== tenant.id` → 401 (:128-130) → revocation cursor → set `req.db` **directly** (:149-152). Manufacturer adds a status gate absent from the customer variant (:145-150): `suspended` → 403, non-active → 401.

---

## 9. Notable risks / oddities

1. **No graceful shutdown at all.** No signal handlers anywhere; `shutdownBoss()` has zero callers; `app.listen` return value not captured. Railway's `ON_FAILURE` restart means every redeploy hard-kills in-flight requests and pg-boss jobs.
2. **`ensureDefaultRolePermissions` is a permanent silent no-op in MT mode.** Called at boot with `db = dbProxy`, which throws outside a request's ALS context; the rejection is swallowed by its own try/catch. The claim that it "re-seeds at every boot" holds only in single-tenant mode.
3. **Tenant-keyed rate limiters bypassable by rotating a client header.** `extractTenantKey` prefers `x-tenant-slug`; `authLimiter` prefers `req.body.store_code`; portal limiters key on `?tenant=`. Never validated against a real tenant.
4. **`getClient()` sets session-level `search_path` with no reset** (:91-95), unlike `query`/`transaction`.
5. **`search_path` built by string interpolation** in `tenant-db-manager-pg.js:63,79,93`, `tenant-db-pg.js:60`, `migrate-pg.js:10074,10089` (the last **unquoted**). Sole defense is the provisioner's slug regex — but `master-db-pg.js:170 createTenant()` performs no validation (latent; zero callers).
6. **Tenant status changes lag up to 60 s** — suspension evaluated off the cached row.
7. **Revocation block swallows every error** (:135-169) — a transient pool timeout silently skips revocation for a 24 h token. Contrast the permission load below it, deliberately hardened to 503.
8. **`loadEmployeePerms` trusts `x-employee-id` outright** — single-tenant mode has no auth boundary.
9. **Global error handler leaks `err.message` verbatim** on 500s (:279).
10. **`/uploads` and `/r2/*key` mount before `globalLimiter` and `requestId`** — unrate-limited, no request id, no structured log.
11. **`assertProductionSecrets()` doesn't run first** despite its comment; worse, `masterDbPgBoot.init(db)` (:77) is `async` called **without `await` or `.catch()`** — a floating promise that terminates the process at an arbitrary later tick under Node 22.
12. **`ensureCriticalRoutesRegistered` only inspects top-level layers** — a route moved behind a sub-router would false-positive.
13. **`migrate()` versions off `MAX(version)`**, not set membership. A skipped/failed intermediate is never revisited; `migrateAllTenants` catches per-tenant failures and only logs, so a tenant can fall permanently behind while the deploy reports success.
14. **The every-boot RLS sweep covers `public` only** — tenant schemas get no equivalent. Since the backend connects as `postgres` (bypassrls), RLS is purely a PostgREST/anon defense.
15. **`resolveContext` enforcement is intermittently fail-open by design** (:445-458).
16. **`loadCompanyProfile` swallows DB errors into a `timezone:"UTC"` placeholder** (:317-325), propagating into every timezone-sensitive report bucket.
17. **CORS falls back to `localhost:5173`** when `CORS_ORIGIN` is unset, in production too; `helmet` runs with CSP disabled.
18. **No JWT algorithm pinning** at any of the four `jwt.verify` sites. Safe today by library default for string secrets; one config change from not being.
19. **`signRefreshToken` mints no `jti`** while `signAccessToken` does — refresh revocation must key on the SHA-256 hash row.
20. **`/api-docs` compares the key with `!==`** (non-constant-time).
21. **`tenant-db-pg.js` is dead code** (69 lines, zero importers); `master-db-pg.js createTenant()` likewise has no callers.
22. **`requireActiveSubscription` is a sync function running an async check** — works today, but any refactor adding `return next()` after the `.then()` would double-call `next`.
23. **`PERMISSION_RULES` is prefix-regex + first-match-wins + runs ahead of every route.** The `my-status` lookahead is a scar from this. Any tightening requires enumerating every sub-path.
24. **Eight in-process caches with no cross-instance invalidation**: `_companyCache` (5 min), `_contextFlagCache` (30 s), `_outletCache` (60 s), `_featureFlagCache` (60 s), `_modeCache` (60 s), `_tenantCache` (60 s). `LISTEN/NOTIFY` is unavailable on the pooler, so the obvious fix needs Redis. **Single-instance-only architecture; nothing fails loudly if a second instance is added.**
25. **`start.sh` runs the full all-tenant migration before the server binds**, inside a 120 s healthcheck. Cost is linear in tenant count with no parallelism.
