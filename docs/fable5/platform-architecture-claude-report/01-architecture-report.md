# SanoPOS — Technical Architecture Report

**Repository:** `D:\newprojects\oneshoppos` · **Commit audited:** `3b84732d` (main, 2026-07-29)
**Report date:** 2026-07-29

**Method.** Source-code audit. Eight parallel read-only explorations of the actual source tree, cross-checked against live production (Supabase Postgres, Railway, Vercel, Sentry) using read-only SQL and unauthenticated HTTP probes. Project documentation and `CLAUDE.md` files were deliberately excluded as evidence — several findings below contradict them.

**Evidence grades.** Every claim is tied to a source file/line or a live check.
- **CONFIRMED (live)** — reproduced against production during this audit.
- **CONFIRMED (source)** — read directly in code; unambiguous.
- **REPORTED** — found by the audit sweep, not independently re-verified. High confidence; verify before acting.

---

## Table of contents

1. Executive summary
2. System context and deployment
3. Architecture at a glance
4. Backend core: boot, middleware chain, multi-tenancy
5. Data model
6. API surface
7. Services and background workers
8. Frontend
9. Business domains and critical write paths
10. Security posture
11. Testing, CI/CD, tooling
12. Consolidated risk register
13. Scaling analysis
14. Recommendations

---

## 1. Executive summary

SanoPOS is a multi-tenant, schema-per-tenant Point of Sale platform: Node.js/Express 5 + PostgreSQL 17 on the backend, React 19 + Vite 7 on the frontend, running as a single Railway container against Supabase Postgres, with the SPA on Vercel. It targets the Pakistani SMB market and implements retail, restaurant, wholesale/B2B distribution, clinic, salon, rentals, lodging, gym, repair, and photography as first-class vertical feature sets rather than configuration of a generic core.

**Scale of the artefact.** ~182,000 lines of backend JavaScript across 180 route files, 104 services, and 27 workers; ~119,000 lines of frontend across ~500 files; 327 `CREATE TABLE` statements; **1,344** registered Express endpoints; 137 sequential migrations. This is a large, genuinely feature-complete product.

**Scale of validated usage.** Across all 29 active production tenants: **59 sales, 81 products, 40 employees** in total. Only 5 tenants have ever recorded a sale; the busiest has 22. Email and tax-filing queues are empty. *(Live query, this audit.)*

That gap is the central fact about this system and should frame every judgement below. The engineering is ambitious and in several places unusually disciplined — the tenant-isolation mechanism, the drift-guard test culture, and the fail-closed security defaults are better than typical for a solo-developer product at this stage. But breadth has been built well ahead of the load that would validate it. Most risks below are **latent rather than currently biting**, and the correct reading of "no production incidents" is that production has not yet been asked to do much.

**Overall assessment.** Architecturally coherent, and in the areas that matter most for a POS handling money and stock, thoughtfully defended. The most serious issues are not exotic: an unauthenticated endpoint, a webhook that cannot be delivered, three parallel implementations of the most critical write path, no graceful shutdown, and a CI pipeline that gates almost nothing. All are fixable; none requires re-architecture.

### Findings that matter most

| # | Finding | Grade | Impact today |
|---|---|---|---|
| 1 | Shopify order webhook unreachable — mounts behind tenant auth, returns `AUTH_REQUIRED`; HMAC check never runs | **CONFIRMED (live)** | Zero — no tenant has an active Shopify connection. Breaks the first one who does. |
| 2 | `GET /api/feature-flags` authenticates on *presence* of an `x-employee-id` header; any value works, no JWT | **CONFIRMED (live)** | Unauthenticated disclosure of any tenant's feature config + tenant-existence oracle |
| 3 | Three independent stock-movement implementations; the POS sale path doesn't use the shared ledger extracted from it | **CONFIRMED (source)** | Correctness risk concentrated in the highest-value write |
| 4 | External payment-gateway HTTP call runs *inside* the sale DB transaction while row locks are held | REPORTED | Card can be charged while the sale rolls back |
| 5 | No graceful shutdown anywhere — no SIGTERM/SIGINT handler; `shutdownBoss()` defined, never called | **CONFIRMED (source)** | Every deploy hard-kills in-flight requests and mid-flight jobs |
| 6 | CI executes 5 test files of 334; 36 of 202 backend integration files cannot load (deleted helper) | REPORTED | Regression net far thinner than its size implies |
| 7 | `POST /api/sales` has no permission guard and no `PERMISSION_RULES` entry | **CONFIRMED (source)** | Any authenticated employee of any role can create a sale |
| 8 | Integration-credential encryption silently stores **plaintext** when the key env var is unset | REPORTED | No boot assertion covers `INTEGRATION_SECRET_KEY` |
| 9 | Supabase `max_connections` is **60**, not the ~200 assumed in project docs | **CONFIRMED (live)** | Real headroom materially lower than planned |
| 10 | Single-instance-only by construction: 8+ process-local caches, in-memory rate limiters | **CONFIRMED (source)** | Adding a second instance silently corrupts behaviour |
| 11 | Public schema carries the entire 326-table tenant DDL as empty shadow tables | **CONFIRMED (live)** | No data exposed (RLS on, 0 rows), but forces ~74 defensive guards in migrations |

---

## 2. System context and deployment

### 2.1 Topology (all verified live during this audit)

| Layer | Platform | Verified state |
|---|---|---|
| Frontend SPA | Vercel (`sanopos.com`) | READY on `3b84732d` — same commit as local main; HTTP 200 |
| Backend API | Railway, single container (`api.sanopos.com`) | Deep health 200; DB 38 ms, Resend 362 ms |
| Database | Supabase Postgres **17.6** | 577 MB; 26 connections; **`max_connections=60`**; session TZ UTC |
| Pooling | Supavisor, transaction mode | Confirmed in `pg_stat_activity` |
| Job queue | pg-boss (Postgres-backed) | All jobs `completed`; no failures, no backlog |
| Object storage | Cloudflare R2 | Configured; `R2_PUBLIC_URL` unset → backend `/r2` proxy serves objects |
| Email | Resend | Queue empty |
| Errors | Sentry | Backend 0 unresolved; frontend 1, last seen 2026-07-11 |

`backend/start.sh` sets `TZ`, runs the all-tenant migration, then execs the server. Because of `set -e`, a migration failure aborts the deploy before the server binds — a good property. The migration is sequential across all tenants and must complete inside Railway's 120 s healthcheck window (`railway.toml`) — see §13.

### 2.2 Tenancy model

Schema-per-tenant on one database. `public` holds the tenant registry and cross-tenant queues; each tenant gets `tenant_<slug>` with the full application DDL.

Live measurements:
- 36 registry rows; **29 active**
- 29 tenant schemas, **all at migration v137** — exactly matching the code head. No drift.
- 334 tables in `public`; **0 without RLS**
- 9,350 tenant tables (~322 each); 20,792 tenant indexes

Uniform v137 across every tenant is a genuinely good signal: the runner catches per-tenant failures without aborting the run, which *could* silently strand tenants, and it hasn't.

### 2.3 Development context

1,923 commits, 600 in the last 90 days, effectively a single developer, no unmerged branches at audit time. Velocity is high; history shows a disciplined pattern of named, dated remediation waves.

---

## 3. Architecture at a glance

```
Browser (React 19 SPA, Vercel)
  │  window.fetch globally monkey-patched by AuthProvider —
  │  injects Bearer token, x-employee-id, x-outlet-id, x-company-id;
  │  silent refresh on 401 TOKEN_EXPIRED; synthesises 503 when offline
  ▼
Vercel Edge Middleware (crawler-only OG previews; deny-list first)
  ▼
Railway container — Express 5, SINGLE INSTANCE
  │
  ├─ Pre-tenant mounts (no employee auth, no tenant DB proxy):
  │    /api/admin/*                    super-admin JWT + TOTP
  │    /api/webhooks/*                 signature-verified (except Daraz, deliberate)
  │    /api/portal/*                   customer JWT, scope "customer"
  │    /api/manufacturer-portal/*      manufacturer JWT, scope "manufacturer"
  │    /api/public/*, /api/storefront/*, /api/receipts/*, /api/setup/* …
  │
  ├─ ══════════ TENANT WALL ══════════
  │    loadTenantAndPerms → resolveTenant → loadCompanyProfile
  │    → resolveOutletContext → resolveEffectiveRole → resolveContext
  │    → requireActiveSubscription → enforceOutletAssignment
  │    → PERMISSION_RULES blanket middleware
  │
  └─ ~1,170 tenant endpoints
       guards: requirePerm / requireAnyPerm / requireFeature /
               requireMode / validate(zod) / requirePlanLimit
  ▼
AsyncLocalStorage tenant DB proxy ──► Supavisor (txn mode) ──► Postgres 17.6
  every query: BEGIN; SET LOCAL search_path TO tenant_<slug>, public; …; COMMIT
```

The single most important architectural decision is the AsyncLocalStorage tenant DB proxy (§4.2). It is what makes schema-per-tenant safe under a transaction pooler, and it is implemented correctly.

---

## 4. Backend core: boot, middleware chain, multi-tenancy

### 4.1 Boot sequence (`backend/index.js`, 328 lines)

1. **Env + banner** (`:2-14`) — loads `.env.production` when `DB_TARGET=production`, else `.env`; prints a green LOCAL / red PRODUCTION banner derived from `DATABASE_URL`. A misconfigured environment is loud, not silent.
2. **Sentry** (`:16-23`) — only when `SENTRY_DSN` set. `tracesSampleRate: 0` (errors only).
3. **Multi-tenant init** (`:69-78`) — builds the DB proxy, `tenantDbManager.init(db)`, `masterDbPgBoot.init(db)`.
4. **Production secret guard** (`:84`) — `assertProductionSecrets()`.
5. **Dependency injection** (`:87-90`) into tenant-auth, feature-flags, outlet-context.
6. **`trust proxy = 2`** in production (`:93-102`) so rate limiting reads the real client IP.
7. Middleware registration, route registration, boot guards, `app.listen`, `startWorkers`.

**Boot guards.** Two exist:
- `assertProductionSecrets()` (`boot/assert-secrets.js`) — in production only, kills boot unless both portal JWT secrets are set, ≥32 chars, ≥12 distinct chars, not known placeholders, differ from `JWT_SECRET` and from each other. This is a genuinely good fail-closed control.
- `ensureCriticalRoutesRegistered()` (`index.js:283-311`) — crashes boot if four named routes are missing.

**Two boot-order defects** (REPORTED):
- The comment at `:80-84` claims the secret guard "runs before anything else so the deploy fails fast" — it actually runs *after* the multi-tenant DB init at `:74-77`.
- `masterDbPgBoot.init(db)` at `:77` is an `async` function called with **no `await` and no `.catch()`** — a floating promise whose rejection has no handler and, under Node 22 defaults, terminates the process at an arbitrary later tick.

### 4.2 Multi-tenancy: how isolation actually works

This is the system's best-engineered subsystem.

**The proxy** (`tenant-db-proxy-pg.js`, 51 lines). `deps.db` handed to every route is a `Proxy` over an `AsyncLocalStorage` store. `getCurrentDb()` **throws** if no tenant context exists (`:16-22`) — fail-closed, with no default-schema fallback. `resolveTenant` runs the request inside `asyncStore.run({ db: tenantDb }, () => next())`, which is the single line that makes every downstream query tenant-correct.

**The search_path discipline** (`tenant-db-manager-pg.js:57-89`). Every `query` and `transaction` is wrapped:

```sql
BEGIN;  SET LOCAL search_path TO 'tenant_<slug>', public;  …;  COMMIT;
```

`SET LOCAL` inside an explicit transaction pins the search_path to one backend under Supavisor transaction pooling and auto-reverts at COMMIT, so a released connection cannot carry tenant scope into another request. `master-db-pg.js:216-238` does the mirror-image for public and documents the exact production symptom (phantom "not found" lookups) that motivated it. This is correct and non-obvious — it is the right solution to a real, subtle problem.

**One weak spot** (REPORTED): `getDb().getClient()` (`tenant-db-manager-pg.js:91-95`) issues a **session-level** `SET search_path` outside any transaction, with no reset on release. The failure mode is fail-safe (wrong path → `public`, where tenant tables don't exist → error) rather than cross-tenant reads, but it is fragile and inconsistent with the other two methods.

**Provisioning** (`tenant-provisioner-pg.js`). Slug regex `^[a-z0-9_]{3,40}$`; `CREATE SCHEMA` deliberately outside a transaction (documented: PgBouncer doesn't roll it back cleanly; orphans surfaced via an admin endpoint); then one transaction applying the full DDL and seeding roles/outlet/admin/company profile; then a second transaction inserting the registry row. Crucially it **stamps every migration version as applied** so new tenants never replay v1..v137.

**Dead code:** `tenant-db-pg.js` (69 lines) is a second, older ALS implementation with **zero importers**. Adopting it would reintroduce the session-level search_path leak.

### 4.3 The middleware chain

Order is fixed across `index.js` then `registerAllRoutes.js`:

| # | Middleware | Note |
|---|---|---|
| 1 | `helmet` | **CSP and COEP disabled** |
| 2 | `cors` | `CORS_ORIGIN` CSV; falls back to `localhost:5173` even in production |
| 3 | `express.json({limit:"10mb"})` | `verify` captures `req.rawBody` for webhook paths |
| 4 | malformed-JSON handler | 400 instead of a Sentry bubble |
| 5–6 | `/uploads` static, `/r2/*key` proxy | **mounted before rate limiting and request-id** |
| 7–10 | compression, cookieParser, `globalLimiter`, `requestId` | |
| — | **admin, webhooks, portals, public routes mount here** | pre-tenant |
| 11–15 | `loadTenantAndPerms` → `resolveTenant` → `loadCompanyProfile` → `resolveOutletContext` → `resolveEffectiveRole` → `resolveContext` | the tenant wall |
| 16+ | `requireActiveSubscription`, `enforceOutletAssignment`, `PERMISSION_RULES` | |

**Notable behaviours:**

- **Scope gate** (`tenant-auth.js:109-111`) — any token with an explicit non-`"full"` scope is rejected 401 `INVALID_TOKEN_SCOPE` *before* `req.tenantId` is set. This is what stops a portal token (which shares `JWT_SECRET` when its dedicated secret is unset) from attaching tenant DB context. Well-placed.
- **Permission loads fail closed** — one retry, then **503 `PERM_LOAD_FAILED`** rather than a silent empty-perms fallback that would masquerade as a 403. Deliberate and correct.
- **Outlet context** (`outlet-context.js`) — the single validated interpreter of `x-outlet-id`. Malformed → 400; foreign/inactive outlet → 403 with the *same* code as malformed input (no existence leak); unassigned non-admin → 403. Stale JWT `oid` degrades silently to "none" rather than rejecting.
- **The reach-vs-capability invariant** — outlet *reach* keys on `req.baseEmployeePerms`, *capability* on effective perms. An outlet-level role override can grant capability at an outlet but can never widen which outlets a principal reaches. This is a subtle, correct piece of authorization design, and it's enforced in code (`outlet-context.js:100-108, 205`), not just documented.

**`PERMISSION_RULES` is live middleware, not a reference table.** It is mounted as a blanket `app.use` over every `/api/` request (`registerAllRoutes.js:284-302`), first-match-wins, **no match falls through** — an allowlist of guarded prefixes, not deny-by-default. The prefix-regex trap is real and already scarred the code: `permissions.js:152` needs a negative lookahead to stop the `/api/attendance` rule from 403-ing the self-scoped `my-status` endpoint that the POS shift gate polls.

### 4.4 Defects in the core (REPORTED unless noted)

1. **No graceful shutdown** — **CONFIRMED (source)**. No `SIGTERM`/`SIGINT`/`uncaughtException`/`unhandledRejection` handler anywhere in `backend/**` (excluding tests/archive). `services/boss.js:46` defines `shutdownBoss()` with the comment "call on SIGTERM" and it is called only from a test stub. The `app.listen` return value is never captured, so `server.close()` is impossible. Every redeploy hard-kills in-flight requests and pg-boss jobs mid-execution.
2. **`ensureDefaultRolePermissions` is a permanent silent no-op in multi-tenant mode.** It is called once at boot with `db` = the ALS proxy, which throws outside a request context; the rejection is swallowed by the function's own try/catch. The claim that it "re-seeds at every boot" holds only in single-tenant mode.
3. **Tenant-keyed rate limiters are bypassable.** `extractTenantKey` prefers the client-supplied `x-tenant-slug` header; `authLimiter` prefers `req.body.store_code`; portal limiters key on `?tenant=`/header. Rotating that value yields a fresh bucket per value — including on `authLimiter` (20/15 min) and the OTP limiter (which also keys on an attacker-supplied email). The value is never validated against a real tenant.
4. **Tenant status changes lag up to 60 s** — suspension/deletion is evaluated against a 60-second-cached tenant row.
5. **Revocation checks swallow every error** (`tenant-auth.js:167-169`) — one try/catch treats "table missing" and "query failed" identically, so a transient pool timeout silently skips revocation for a 24-hour token.
6. **`loadEmployeePerms` (single-tenant path) trusts `x-employee-id` outright** — range check, then loads that employee's permissions with no authentication. Single-tenant mode has no auth boundary. (Not the live configuration; `MULTI_TENANT=1` everywhere.)
7. **Global error handler returns `err.message` verbatim on 500s** — SQL errors and file paths can reach clients.
8. **`/uploads` and `/r2/*` mount before the rate limiter and request-id** — unthrottled, and producing no structured log line.

---

## 5. Data model

### 5.1 Shape

| Metric | Value |
|---|---|
| `CREATE TABLE` statements | **327** (326 unique — `return_reasons` is declared twice, identically) |
| `CREATE INDEX` / `CREATE UNIQUE INDEX` | 287 / 24 |
| Partial indexes | 67 non-unique + 17 unique |
| FK clauses (`REFERENCES`) | 651 (155 `ON DELETE CASCADE`, 21 `SET NULL`, 1 `RESTRICT`) |
| `CHECK` constraints | 171 |
| JSONB columns | 68 |
| **Triggers / stored functions / views** | **0 / 0 / 0** |
| Generated columns | 1 |
| `EXCLUDE USING gist` | 1 (appointment overlap) |

`schema-pg.sql` (5,926 lines) is a hand-maintained, fully idempotent DDL script — not a generated dump. Migration v1 simply executes it wholesale.

**The defining architectural choice: zero triggers, zero stored procedures, zero views.** Every derived value is maintained by application code. That includes `products.stock` vs `outlet_stock.quantity` vs `variant_outlet_stock.quantity` (three representations of the same number, `INTEGER` vs `NUMERIC(10,3)`), `customers.total_spend`, `customers.loyalty_points` vs the `loyalty_transactions` ledger, and `customer_invoices.balance_due` vs `total_amount − amount_paid`. Any write path that bypasses the blessed route drifts these silently, with no database-level backstop. This is a coherent choice — it keeps logic in one language and one test suite — but it places the entire integrity burden on §9's write paths.

### 5.2 Domain grouping (326 tables)

Core POS/sales 37 · Products & inventory 44 · Purchasing/supplier 10 · Customers/CRM/loyalty/marketing 30 · HR/org 20 · Finance/accounting/AR/compliance 23 · Restaurant 19 · Wholesale/field sales 11 · Verticals 56 (booking/salon/gym 16, service/projects/repair 14, rentals 8, lodging 12, clinical 20) · Integrations/omnichannel/shipping 33 · Platform/admin/reporting/flags 26.

### 5.3 Migrations

- **133 migration entries**, head **v137**. Versions **40–43 do not exist**, with no comment explaining removal.
- Version table is `schema_version` (not the decoy `schema_migrations`, which is declared in `master-db-pg.js` and never read or written).
- Current version = `MAX(version)`, and pending = `version > current`. **Not gap-safe forward**: a migration merged with a number below the current head would be silently skipped forever on already-migrated tenants — no error, no warning. A `NOT IN (SELECT version FROM schema_version)` set-difference would be strictly safer and the table is already keyed on `version`.
- Each migration runs in its own transaction, stamping its version in the same transaction.
- Per-tenant failures are **caught, logged, and skipped** — a partially-migrated fleet is a normal steady state whose only signal is a log line. (Today, verified clean: all 29 at v137.)
- **One every-deploy idempotent sweep**: `enableRlsOnPublicTables()` — enables RLS on any public table lacking it. Verified working: 0 of 334 public tables lack RLS. Because the backend connects as `postgres` (`rolbypassrls`), this exclusively blocks Supabase's PostgREST anon role; it is not an app-level isolation control.

### 5.4 The public-schema shadow (CONFIRMED live)

`migrateAllTenants()` runs the same `MIGRATIONS` array — including v1, which executes the entire `schema-pg.sql` — against `public` **first**. The result is that the public schema contains the full tenant DDL.

Verified live: `public.sales`, `public.customers`, `public.products`, and `public.company_profile` all exist, all with **0 rows**, and public is itself stamped v137.

Consequences:
- No data is exposed today (tables empty, RLS enabled on all 334).
- But it forces defensive programming throughout: the migration file carries **74 `information_schema` guards and 77 `current_schema()` checks** to make the public pass a no-op. Migration v131's own comment documents a real incident — a stray `public.company_profile` observed on a dev database.
- Tables like `email_queue`, `fbr_invoices`, and `admin_activity_log` are declared unqualified, so they exist in *every* tenant schema *and* public, with application code relying on search_path to hit the intended copy.

### 5.5 Notable data-model observations

- **`customers` is the most overloaded table in the schema** — retail loyalty, wholesale credit terms, clinical PHI (blood group, allergies, medical notes), gym membership, and field-sales geocoding in one row.
- **`customers.balance` is a documented footgun.** The DDL comment warns it is wallet credit, *not* AR exposure, noting it "stays 0 even for a customer at 160% credit utilisation." AR truth is `SUM(customer_invoices.balance_due)`. A comment is the only enforcement.
- **Text where types exist:** `promotions.starts_at`/`ends_at` are `TEXT` (promotion windows compared as strings); `employees.joining_date` is `TEXT`; `company_profile.cash_denominations` is a JSON array stored as `TEXT` while neighbouring columns are proper `JSONB`.
- **`sale_payments` is the thinnest table in the sales path** — 5 columns, **no `created_at`**, no cascade on `sale_id`, no CHECK on amount sign, no enum on `payment_method`. For a split-tender table in a POS, the missing per-tender timestamp limits forensic reconstruction.
- **No `CHECK (quantity >= 0)` on `outlet_stock`** — negative stock is representable (and, per §9, deliberately reachable via the aggregator path).
- **Three places a role can be asserted:** `employees.role TEXT` (legacy), `employees.role_id`, and now `employee_outlets.role_id` (v137). Resolution order exists only in application code.
- **`email_queue` is dead-but-still-created schema** — replaced by pg-boss, yet still created in every tenant schema and public. Conversely, the real queue's `pgboss.*` schema appears in **no repo DDL** — it is created implicitly by the library, so schema knowledge for the live job queue lives entirely outside the repository.
- **The appointment overlap `EXCLUDE` constraint can silently not exist** — both `CREATE EXTENSION btree_gist` and the `ADD CONSTRAINT` are wrapped in exception-swallowing `DO` blocks. Where it's absent, double-booking protection reduces to the advisory lock alone.
- **Two sequence-repair migrations (v91, v132)** exist for the same bug class: explicit-id seeding never advances `nextval()`, so the first natural insert collides. v132's description notes this surfaced to users as "Role name already exists."

### 5.6 Two sources of DDL truth

`schema-pg.sql` (bootstrap) and `MIGRATIONS` (upgrade path) must stay hand-synchronised, and provisioning bakes that assumption in by stamping all 133 versions as applied on a fresh tenant. **Any column a migration adds but the schema file omits produces a tenant that believes it is at v137 while missing that column — and nothing will ever re-apply it.** No automated drift check for this was found. Given the drift-guard test culture elsewhere in this repo (§11), this is a conspicuous gap.

---

## 6. API surface

### 6.1 Census

| Metric | Value |
|---|---|
| Route files | 180 |
| Registered endpoints | **1,344** |
| `requirePerm` calls | 372 across 113 files |
| `requireFeature` | 225 across 86 files |
| `validate(` (Zod) | 243 across **62** files |
| `requireAnyPerm` | 150 across 52 files |
| `requireMode` | 39 across 27 files |
| **`requirePlanLimit`** | **3 call sites total** |

Endpoints by area: top-level 913 · reports 104 · admin 99 · tier4 89 · customer-portal 49 · shopify 33 · restaurant 27 · integrations 20 · manufacturer-portal 10.

### 6.2 Pre-tenant mounts

Twenty route groups mount before the tenant wall and therefore have no employee auth and no tenant DB proxy: super-admin, webhooks, both portals, storefront, receipts, gift-card lookup, setup, country-packs, member kiosk, and eight `public-*` files. Each resolves its tenant manually via `resolvePublicTenantDb()`. This split is deliberate and correctly implemented — with the exception noted immediately below.

### 6.3 The Shopify webhook defect — CONFIRMED (live)

`POST /api/integrations/shopify/webhooks/orders-create` is registered **after** the tenant wall. `resolveTenant` returns 401 `AUTH_REQUIRED` for any `/api/` path lacking `req.tenantId` and not on the public allowlist. Shopify sends no `Authorization` header and no `?tenant=` parameter.

Verified against production:

```
POST /api/integrations/shopify/webhooks/orders-create
  → 401 {"error":"Authentication required","code":"AUTH_REQUIRED"}

POST /api/webhooks/xpay            (control — correctly pre-tenant)
  → 400 {"error":"Invalid signature"}
```

The control case proves the method: a reachable webhook rejects on *signature*, not auth. The Shopify endpoint's carefully-written HMAC verification, shop-domain match, and replay-window guard **never execute**. Every other inbound webhook mounts pre-tenant; this one alone does not.

**Blast radius today: zero.** All 29 tenant schemas have the `shopify_connections` table but **0 active connections** (live query). This breaks the first merchant who connects Shopify.

### 6.4 The feature-flags endpoint — CONFIRMED (live)

`GET /api/feature-flags` treats the *presence* of an `x-employee-id` header as authentication — the value is never checked. The path is also on the pre-auth `?tenant=` allowlist. Verified:

```
GET /api/feature-flags?tenant=livetestauto   -H 'x-employee-id: 1'   → 200  (full flag config)
GET /api/feature-flags?tenant=livetestauto                            → 401
GET /api/feature-flags?tenant=<nonexistent>  -H 'x-employee-id: 1'   → 500
```

Two issues: unauthenticated disclosure of any tenant's feature posture, and a tenant-existence oracle via distinguishable responses (200 vs 500). The 500 also indicates an unhandled error path. Severity is moderate — flag names are not secrets — but it is an unauthenticated window into tenant configuration and existence.

### 6.5 Authorization gaps

- **`POST /api/sales` has no permission guard** — CONFIRMED (source). Only `validate(CreateSaleSchema)`; no `PERMISSION_RULES` entry covers it (verified by grep). Any employee with any role can create a sale. Defensible for a POS — every cashier rings sales — but it should be an explicit decision, and today it is indistinguishable from an oversight.
- **`GET/POST /api/products/:id/reviews`** are ungated inside an otherwise strictly-guarded file where every neighbouring route requires `manage_inventory`.
- **Four post-tenant files have no role guards at all**: `customer-display.js`, `tax-lookup.js` (including a `/suggest` endpoint that writes), `support.js` (file upload), and `billing.js` reads.
- **`requirePlanLimit` appears 3 times across 1,344 endpoints** — plan-cap enforcement is far sparser than the middleware's existence implies. Notably, `POST /api/outlets` appears not to carry it.
- **Zod coverage is 62 of 180 route files.** The standout gap is `tier4/accounting.js`: **19 unvalidated writes** covering journal entries, credit/debit notes, and chart of accounts. Every one of the 52 schema files in `backend/schemas/` is imported somewhere — there are no orphans; the gap is entirely in the other direction.

### 6.6 Structural oddities

- **`tier4/` mounts prefix-less** — 89 endpoints across seven `/api/*` prefixes, all absolute paths inside sub-routers. Grepping the index for a mount path finds nothing; paths are discoverable only by reading each leaf.
- **`approvals` is double-owned** — both `approval-policies.js` and `tier4/approvals.js` register under `/api/approvals`; tier4 mounts first and wins any collision. Not exhaustively diffed.
- **`/api/price-lists` CRUD lives in `products.js`, not `price-lists.js`** — the latter has 1 endpoint and loses any collision. Editing it expecting authority means editing dead code.
- **`rooms.js` registers 51 endpoints across 7 prefixes**, including `/api/reports/*` routes that bypass the reports directory and its permission map entirely.
- **`sandbox.js` mounts conditionally** on `PAYMENT_GATEWAY=sandbox` with zero auth on 4 endpoints, including one that can synthesise payment-confirmation events. The env gate is the only thing between that and production.

---

## 7. Services and background workers

### 7.1 Services layer

79 root service files plus `couriers/` (16), `marketplace/` (7), `import/mappers/` (3).

**The well-built ones:**
- **`stock-ledger.js`** — the intended single "move on-hand stock" implementation. Takes `SELECT … FOR UPDATE`, gates on availability with a typed `insufficient_stock` error, writes all three stock tables for variants, delegates FEFO batch handling. Correct — but see §9.1 for who *doesn't* call it.
- **`tax-snapshot.js`** — one shared per-line tax cascade (outlet profile → product tax_id → legacy rate → category-inherited → 0) applied by every sale writer, so the frozen per-line snapshot stays consistent across entry points.
- **`business-modules.js`** — the module toggle engine. Atomic flag+mode writes, a `saved_flags` snapshot on disable that restores exactly on re-enable, dependency cascade, platform-lock enforcement, audit trail, and both caches invalidated. Notably it handles the "first mode row flips enforcement strict for all modes" trap by backfilling drifted modes before the first row lands. This is careful work.
- **`outlet-copy.js`** — `COPY_SPECS` is simultaneously an allowlist and a column-classification contract, drift-tested so a new migration column can't be silently dropped. The deliberate *non*-copies (tax profiles, menu schedules, checklist tables) each carry a reason: copying them would silently mis-charge tax or falsely mark a new outlet "set up."
- **`credit.js`** — authoritative credit gate under `FOR UPDATE` on the customer row, summing AR under that lock so concurrent writers serialise.
- **`geo.js`** — returns `null` for non-finite coordinates with an explicit contract that `null` means "check impossible," never "pass."

**Weak spots:**
- **`crypto.js` degrades to plaintext silently.** With no `INTEGRATION_SECRET_KEY`/`SHOPIFY_SECRET_KEY`, `encryptSecret` **returns the plaintext unchanged** and every courier/marketplace/Shopify credential is written unencrypted — no error, no log. `boot/assert-secrets.js` covers only the two portal JWT secrets, not this. Also, any string that isn't 64-hex or 32-byte-base64 is SHA-256'd into a key, so a one-character secret produces a structurally valid AES-256 key.
- **`payment-gateway.js` calls `timingSafeEqual` without a length guard** (two sites). Node throws `RangeError` on mismatched buffer lengths, so a wrong-length signature header produces a **500 rather than a 400**. Both `shopify/utils.js` and `aggregator-orders.js` do this correctly — the payment layer is the outlier, and it's the one handling money.
- **`manager-pin.js` is O(n) bcrypt per attempt** — loads every non-deleted employee's PIN material and bcrypt-compares in a loop. It also retains a plaintext `pin_code` fallback with non-constant-time `===` comparison. The cost scales with headcount. (It does correctly hard-refuse self-approval under impersonation, which is a good control.)
- **`phase4-polling.js` interpolates a table name into SQL** with no allowlist, unlike `catalog-scheduler.js` which validates against a field registry. Only a comment protects it.
- **`alerting.js`** defines a `backup_failed` threshold with **no function that records it**, and two of its three recorders never reset their window counters after firing, relying entirely on cooldown.

### 7.2 Workers

26 pg-boss workers plus 8 `setInterval` pollers. Each pg-boss worker is gated by its own `*_WORKER_ENABLED` env var, exposes a heartbeat global read by the admin worker-status endpoint, and registers through a per-worker try/catch so one failure never blocks the rest. All ~25 worker flags are set in production (verified via Railway).

Live queue state is healthy — every worker shows only `completed` jobs, no failures or backlog. Volume leaders: `course-release-sweep` 10,279 jobs, `expire-reservations` 2,250, `channel-sync-poll` 1,061.

**Observations:**
- **`course-release-sweep` runs `* * * * *`** — one job per minute, per instance, fanning out over every active tenant, to release held restaurant courses. The header concedes the design wanted 30 s and pg-boss can't go below a minute. At 10,279 completed jobs it is by far the heaviest scheduled workload, for a feature with negligible current usage.
- **Billing lifecycle transitions live inside the email worker.** Trial → grace → expired is driven by the hourly `billing-lifecycle-check` cron registered in `email-worker-boss.js`. Disabling `EMAIL_WORKER_ENABLED` would silently also stop all subscription state transitions. That coupling is not obvious from either name.
- **`marketplace-sync-worker-boss.js` schedules nothing** — it is an honest stub that unschedules legacy crons and reports `mode:"manual"`. `MARKETPLACE_SYNC_WORKER_ENABLED=1` is a no-op. Correct and well-documented, but any claim of background marketplace sync is wrong.
- **`processedToday` never resets** — no worker resets the counter, so the admin dashboard's "processed today" is actually monotonic-since-process-start, resetting only on deploy.
- **Two competing tenant-scoping patterns in workers**: six workers use the correct `withTenantContext()` helper (validated slug, guaranteed reset-and-release in `finally`); four use raw `tenant_${slug}.` string interpolation.
- **Worker registration is a non-awaited `.then()` chain** — `startAll` returns before any pg-boss worker is live.
- **`PG_BOSS_GATES` is bookkeeping only** — the array feeds the status registry, but the real gates are hand-written `if` blocks below it. The two lists are maintained by hand and can drift, which would show a worker as "env-enabled" while it never registers.

### 7.3 Shopify integration

Token storage is correct: `access_token` and `webhook_secret` stored encrypted, decrypted via an injected function that keeps the module crypto-free. The GraphQL client handles Shopify's throttle-on-HTTP-200 signal with bounded recursive retry, and distinguishes empty body / unparseable JSON / wrong content-type with previews.

**But `shopify/order-service.js` writes stock via a direct `outlet_stock` upsert** — no `FOR UPDATE`, no availability gate, no `variant_outlet_stock` or `product_variants.stock` write, no batch ledger. This is the third stock-movement implementation (§9.1).

---

## 8. Frontend

### 8.1 Stack and build

React 19.2, Vite 7.3, Tailwind **v4 CSS-first** (no `tailwind.config.js`; configuration lives in `src/index.css` + `src/ui/tokens.css`), React Router 7.13, Sentry 10.46, Recharts, `idb`, `jsbarcode`, `qrcode`.

Manual chunking is deliberately minimal — only `recharts`, `xlsx`, and `reports`; everything else splits via `lazy()` (118 lazy imports in the app routes alone).

**Vercel Edge Middleware** (`middleware.js`, 283 lines) serves crawler-only OG previews with a **deny-list first** (`/receipt`, `/portal`, `/gift-card`, `/pay` are never previewed — a deliberate privacy split), an allow-list of 10 public route families, slug validation, per-isolate caches with a 10-minute TTL, and fail-closed behaviour with diagnostic `x-og-mw` headers. This is thoughtful.

**Service worker** caches `/assets/*` **cache-first with no revalidation** and no size bound; `STATIC_CACHE` only purges when its version constant is manually bumped. An `API_CACHE` is created, exempted from purge, and deleted on logout — but **nothing ever writes to it** (dead code).

### 8.2 Provider hierarchy and the fetch patch

```
StrictMode → ErrorBoundary → CurrencyProvider → ToastProvider → AuthProvider → PresetProvider → App
```

**The most invasive mechanism in the frontend is `AuthProvider`'s global `window.fetch` monkey-patch.** It matches any URL containing `/api/`, then: blocks offline writes by synthesising a fake **503** response with an `X-Offline-Mode` header; bypasses public auth endpoints; injects `x-employee-id`, `Authorization`, `x-company-id`, `x-outlet-id`, `x-scope-mode`; performs silent refresh on `401 TOKEN_EXPIRED` and replays the original request once; stashes failed request IDs on a global; and flips subscription state on `403 SUBSCRIPTION_EXPIRED`. It leaks `window._nativeFetch` as an escape hatch.

Refresh is coalesced through a module-level promise lock, and uses the *native* fetch to avoid recursing into the patch — both correct details.

**Consequence:** anything that mounts before `AuthProvider`'s effect commits sees unpatched fetch. `PresetContext` works around this with a macrotask yield **plus** a 600 ms retry on 401. That timing is load-bearing: if it fails, the tenant silently stays on the default `general_retail` preset, which changes POS behaviour for clinic and restaurant tenants. This is a race that is worked around rather than eliminated.

### 8.3 Gating model

Three orthogonal gates converge in the sidebar filter: `hasPerm` (AuthProvider) ∧ `flags[requiredFlag]` (useFeatureFlags) ∧ `hasMode` (PresetContext). `nav-config.js` defines 21 groups / 122 items; 110 carry `requiredPerm`, 76 `requiredFlag`, 35 `requiredMode`.

**Two fail-open behaviours interact badly:**
- `RequireContext` passes through unconditionally when `context_selection_required` is false — and `useFeatureFlags` fails *closed* to `false`. So a backend outage that makes flags unfetchable **skips context enforcement entirely** for every app route.
- `hasMode()` returns `true` before `presetLoaded`, and `presetLoaded` flips true even on bootstrap **failure**. A failed bootstrap leaves every `requiredMode` nav gate open against an empty preset.

Neither is a privilege escalation (the server re-resolves everything), but both make the UI's gating unreliable exactly when the backend is unhealthy.

**Two divergent feature-flag readers:** `useFeatureFlags` prefers the outlet-aware `effective` field; `POSContext` builds its own map from `enabled` only. A flag disabled at one outlet but on company-wide will hide the sidebar entry yet leave the POS feature live.

### 8.4 POS architecture

`POSRedesign.jsx` is composition plus a status bar (29 modals mounted at that level). `POSContext.jsx` (1,272 lines) composes **8 domain hooks**: `useShiftGate`, `useCart`, `useReceipt`, `useCustomerDisplay`, `useLoyaltyWallet`, `useFolioCharging`, `useOfflineQueue`, `useCheckout` (640 lines).

Genuinely good pieces:
- **`cartMath.js`** — pure, React-free, per-line `effectiveTaxRate` so mixed-rate carts work in both inclusive and exclusive modes. Unit-tested three ways.
- **Offline queue** — IndexedDB via `idb`, keyed on `idempotency_key`, with typed rows (`sale`/`return`/`check_in`/`field_order`), a 50-row cap, one-time localStorage migration, and sync that treats server-reported duplicates as success.
- **`completeSale` uses `api.raw`** rather than `api.post` specifically so it can branch on status: 401 → park payload and prompt re-auth; 400 `insufficient_stock` → offer backorder; 403 `CREDIT_LIMIT_EXCEEDED` → manager-PIN retry; `TypeError`/offline → queue.
- **Web Serial scale integration** with a settle-on-3-consecutive-stable-reads algorithm and a graceful "type the weight" fallback.
- **Receipt printing** tries hardware first and *arms a retry prompt* rather than silently falling back to a browser popup.

### 8.5 Frontend defects

- **`api.js` spread order drops `Content-Type`** — `{ headers: {...}, ...options }` means `options.headers` **overwrites** rather than merges. `api.upload` relies on this deliberately, but any future JSON POST through `raw`/`get` with a custom header silently sends without a content type.
- **`typecheck` is theater** — `tsconfig` has `checkJs: false` and `strict: false`; `src/types/` holds 2 `.ts` files against ~500 `.js/.jsx`. `tsc --noEmit` validates roughly **55 lines out of ~118,500**. Both type files are imported nowhere and have already drifted from the runtime shapes they describe.
- **`primitives.jsx` has no `variant` prop**, yet `ErrorBoundary.jsx` passes `variant="secondary"` — forwarded to the DOM as an invalid attribute, rendering the default tone. Nothing catches this class of error.
- **Route/nav permission drift is manual** — the same permission is encoded in `appRoutes.jsx` and `nav-config.js`, with in-source comments recording past cases where nav hid an item that stayed reachable by direct URL. No test ties the two tables together.
- **`/customer-display` is completely unauthenticated** and receives POSTed cart data — a deliberate second-screen design, but the one route with no guard reading live sale data.
- **Tokens are in localStorage** for all four scopes (standard SPA trade-off; mitigated by short TTLs, jti revocation, and httpOnly rotating refresh cookies). Zero `dangerouslySetInnerHTML` in the entire frontend.
- **`X-Frame-Options: DENY` on `/(.*)`** blocks the public storefront and booking pages from ever being embedded in a merchant's site — a hard constraint on an ostensibly embeddable surface.

---

## 9. Business domains and critical write paths

### 9.1 The POS sale write path — and the three-ledger problem

`POST /api/sales` is the system's most important write. Its pre-transaction gates are extensive and, in several places, genuinely well-designed:

- **Server price authority (H1)** — re-resolves every line server-side and rejects if the client subtotal is >1% below server pricing.
- **Manual-discount laundering guard** — when a cashier lacks `pos_discount`, the server re-runs `evaluatePromotions` rather than trusting client-sent `applied_promotions`.
- **Refund caps (H5)** on returns — per-line refund ≤ sold price, header total ≤ sold value of returned lines.
- **Concurrent-return serialisation** — the original sale is locked `FOR UPDATE` and remaining quantity recomputed from prior returns.
- Open-shift and clock-in requirements, serial validation, MOQ for field orders, credit pre-flight with manager-PIN override writing an audit row.

Inside the transaction: per-line `FOR UPDATE` stock locks, frozen per-line tax snapshot, loyalty under `FOR UPDATE OF c` with server-side tier multiplication and redemption capped at live balance, gift cards and wallet re-checked under lock.

**The problem: there are three independent stock-movement implementations.**

| Implementation | Locking | Availability gate | Tables written | Batch ledger |
|---|---|---|---|---|
| `services/stock-ledger.js` | `FOR UPDATE` | Yes (typed error) | All 3 | Yes (FEFO) |
| Inline in `routes/sales.js` | `FOR UPDATE` | Yes | All 3 | Yes |
| `shopify/order-service.js` | **None** | **None** | `outlet_stock` only | **No** |

`stock-ledger.js`'s own header states it was *extracted from* the sale path — but the sale path was never migrated onto it. Two hand-synchronised copies of the same invariant now exist, plus a third, much weaker one in the Shopify order service. `stock-ledger.js` also has **no runtime assertion** that it is running inside a transaction; the "must be called inside the caller's transaction" contract is comment-only.

This is the single highest-value correctness risk in the codebase. It is not currently causing damage (59 sales, 0 Shopify connections), but it is exactly the kind of divergence that produces irreproducible stock discrepancies under real load.

### 9.2 Other write-path observations

- **External gateway call inside the DB transaction** — card capture executes while row locks are held. If the gateway succeeds and a later in-transaction step throws, the transaction rolls back but **the charge stands**, with no compensation logic visible at the call site. This is the classic dual-write hazard and it is worth fixing before real card volume.
- **Invoice number assigned post-commit** — a sale can commit and then fail invoice finalisation, returning a 500 with a NULL `invoice_number` until retried. The year is also taken from server time, not tenant timezone.
- **Offline replay loosens controls** — a sale with an `idempotency_key` bypasses the clock-in check and attaches to the most recent *closed* shift when none is open.
- **`points_earned` base is client-supplied** — the server applies the tier multiplier and floors redemption at live balance, but never recomputes the earn base from the sale total.
- **Aggregator settlement can drive stock negative by design** (the order is already paid on the platform). Reports consuming `outlet_stock` must tolerate negatives.
- **Batch ledger drift never blocks a sale by contract** — a correct product decision, with a `/api/batches/drift` endpoint to observe the consequence.

### 9.3 Concurrency control across verticals

The verticals are, on the whole, better-defended than the POS path:

- **Rooms** — `pg_advisory_xact_lock(hashtext(current_schema() || ':room_type:' || id))`. Transaction-scoped (pooler-safe) and schema-namespaced (tenant-safe). Correct on both axes.
- **Bookings** — per-employee and per-resource advisory locks, plus a GiST `EXCLUDE` constraint as a DB backstop (which, per §5.5, may silently not exist).
- **Rentals** — availability re-checked *inside* the `FOR UPDATE` lock, not before it.
- **Classes** — `FOR UPDATE` on `class_sessions` serialises booking and cancellation.
- **Packages** — sold and redeemed *inside* the sale transaction, so rollback un-issues them.

### 9.4 Wholesale, restaurant, integrations

**Wholesale** is the most differentiated part of the product: two-phase credit gating (friendly pre-flight, authoritative `FOR UPDATE` re-check), geofenced field-rep check-in that *flags* rather than blocks out-of-fence visits, idempotent offline check-in keyed on `client_uuid`, slab/tier promotions with a frozen audit snapshot, and a manufacturer portal whose only exposed customer attribute is `city`. That PII boundary is deliberate and correctly enforced.

**Restaurant** implements check splitting four ways, course firing/holding, and KDS routing with a least-loaded strategy that provisionally increments an in-transaction load snapshot so a batch doesn't dogpile one station — and groups tickets one-per-(station, course) to fix an earlier N² screen fanout.

**FBR digital invoicing** (Pakistani tax authority) enqueues to pg-boss with exponential backoff `[60, 300, 900, 3600, 14400]` seconds, refuses to enqueue when credentials are missing, and abandons rows explicitly rather than retrying forever. Invoice dates use tenant timezone after a documented off-by-one-day bug.

**Webhook verification** is per-provider and mostly fail-closed: xpay (HMAC hex), Meta/WhatsApp (hex HMAC, refuses when secret unset, closes the `undefined === undefined` verify-token bypass), aggregators (base64 HMAC + replay window, per-tenant secret), Shopify (base64 HMAC + length-guarded compare + replay window — but unreachable, §6.3). **Daraz is deliberately unverified**, documented in a 20-line comment pending its unpublished signing contract; its single-active-integration fallback routing becomes dangerous the moment a second tenant connects.

---

## 10. Security posture

### 10.1 Strengths (all source-verified)

- **Fail-closed production boot guard** for portal secrets with length, distinct-character, and placeholder checks, plus mutual-distinctness.
- **Scope gate before tenant context attaches** — prevents portal tokens from reaching tenant routes.
- **Refresh rotation with reuse detection** — presenting a revoked refresh token revokes the entire family for that employee+tenant. Implemented on both the tenant and admin planes.
- **`SET LOCAL`-in-transaction search_path isolation** with a throwing, never-defaulting tenant proxy.
- **`?tenant=` lockdown** to an explicit path allowlist.
- **Consistent bcrypt (10 rounds)**; refresh tokens SHA-256 hashed at rest; admin recovery codes bcrypt-hashed and single-use.
- **Per-request permission loads** with 503-not-empty-perms failure posture; no permission cache, so revocation is effective on the next request.
- **Outlet-context validation** with no-existence-leak error codes and the base-vs-effective perms invariant.
- **Constant-time HMAC comparison** across Shopify/Meta/aggregator webhooks, fail-closed when a secret is unset.
- **SVG-aware upload filters** born from a documented prior XSS incident, plus magic-byte verification against faked content types.
- **TOTP-gated admin panel** with rate-limited verification, session listing, and security-event logging.
- **Every-deploy RLS sweep** on the public schema — verified effective (0 of 334 tables uncovered).
- **Zero `dangerouslySetInnerHTML`** in the frontend.

### 10.2 Gaps

| Sev | Finding | Evidence |
|---|---|---|
| **Med** | `GET /api/feature-flags` unauthenticated (header-presence only) + tenant-existence oracle | CONFIRMED live (§6.4) |
| **Med** | Credential encryption silently stores plaintext when key env var unset; no boot assertion | `services/crypto.js` |
| **Med** | Daraz webhook accepts unsigned payloads; single-active-integration fallback routing | `routes/webhooks.js` (documented deferral) |
| **Med** | Legacy plaintext PIN fallback with non-constant-time `===` on kiosk and manager-override paths | `routes/attendance.js`, `services/manager-pin.js` |
| **Med** | Tenant-keyed rate limiters bypassable via client-controlled `x-tenant-slug` / `store_code` / `?tenant=` | `middleware/rate-limit.js` |
| Low-Med | Kiosk PIN check-in and public gift-card lookup have no dedicated limiter (global only) | `routes/attendance.js`, `gift-cards-public.js` |
| Low-Med | Helmet CSP disabled; API also serves `/uploads` static | `index.js` |
| Low | Revocation checks silently skipped on *any* DB error | `tenant-auth.js:167-169` |
| Low | No account lockout (rate limiters only); admin tokens share `JWT_SECRET` (scope-string separation, not key separation) | `routes/admin/auth.js` |
| Low | `getClient()` session-level `SET search_path` without a transaction | `tenant-db-manager-pg.js:91-95` |
| Low | `cleanup-dead-tenants.js` interpolates a stored slug into `DROP SCHEMA` without re-validation | `jobs/cleanup-dead-tenants.js` |
| Low | Turnstile/CAPTCHA is env-conditional — silently absent if the secret is unset | `routes/auth.js` |
| Info | Admin TOTP secrets stored plaintext (standard TOTP trade-off; recovery codes are hashed) | migration v125 |

**SQL injection:** a repo-wide sweep found **no user-input string concatenation into SQL**. Every template-literal interpolation is either a regex-validated schema name, an in-code table/column registry, or a code-chosen clause fragment with parameterised values. The two exceptions worth watching are `phase4-polling.js` (unvalidated table name, comment-protected) and the cleanup job's `DROP SCHEMA`.

**Overall posture:** deliberately layered and mostly fail-closed, with strong tenant-isolation and token-lifecycle mechanics. Residual risk concentrates in (a) env-conditional controls that degrade *silently* when a variable is unset, (b) the deliberately-unverified Daraz webhook, and (c) legacy plaintext-PIN read paths.

---

## 11. Testing, CI/CD, tooling

### 11.1 Inventory

| Metric | Value |
|---|---|
| Total test files | **334** (255 backend, 79 frontend) |
| Backend integration | 202 |
| Backend unit | 53 |
| Frontend unit (Vitest) | 25 |
| Playwright specs / tests | 54 files / **443 tests** |
| CI workflows | **2** |
| **Test files executed by CI** | **5** |

### 11.2 The gap between apparent and actual coverage

This is the weakest area of the system, and the gap is large.

1. **36 of 202 backend integration files cannot load.** They `require("../helpers/createTestApp")` — a file that no longer exists (deleted in a Phase 5 SQLite cleanup commit; only `createTestApp-pg.js` remains, with a different export shape). The affected set is essentially the entire original suite covering **the highest-value paths in the product**: sales, returns, RBAC, security, shifts, attendance, auth, concurrency, data-integrity, promotions, purchase orders. `npm run test:smoke` targets one of these files, so its "pre-existing failures" are a `MODULE_NOT_FOUND` at collection time, not flaky assertions.
2. **Two more files call `jest.mock()` / `jest.requireActual()` at module top level** while the runner is Vitest with `globals: true` (which exposes `vi`, not `jest`) — `ReferenceError` at collection. A `jest.config.js` exists but `jest` is not installed, so the configured `globalTeardown` (orphan test-schema cleanup) never runs; a manual script was written to replace it.
3. **CI gates four things**, all fast and DB-free: an ESLint baseline ratchet, a design-token drift test, two ESLint rule suites, and a timezone-boundary source scan. **Not gated:** all 202 integration tests, 51 of 53 backend unit tests, 24 of 25 frontend unit tests, `tsc --noEmit`, and `vite build`. A PR that breaks every integration test and fails typecheck merges green.
4. **`npm test` in the frontend would sweep up Playwright specs** — the Vitest block has no `include`/`exclude`, so its default pattern matches all 54 `.spec.js` files. Only `test:unit` is safe.
5. **Playwright targets production directly** (`https://sanopos.com` / `api.sanopos.com`) with live credentials committed in plaintext in `tests/helpers/auth.js`. Onboarding specs provision real production tenants with no automated cleanup.
6. **Known-skipped:** all 9 tests in the wholesale credit-limit suite are `it.skip` — hard/warn block modes, manager-PIN override, and credit reversal on refund have **zero live coverage**, despite being the most financially sensitive wholesale logic.
7. **Backend has no linter at all** — no ESLint config, no dependency. The ratchet, custom rules, and CI lint gate cover only `frontend/src`. The larger and more security-sensitive half has no static analysis.
8. **Coverage instrumentation excludes `routes/**` and `workers/**`** — reported coverage is structurally incapable of describing the API surface.
9. **Seven dead npm scripts** point at two files that don't exist.

### 11.3 What is genuinely good here

The **drift-guard culture** is the standout, and it is unusual for a project this size:

- **ESLint baseline ratchet** keyed on `(file, rule)` pairs, not a global total — so "fixed one in A, added one in B" still fails. Rules sitting at zero become free hard gates; `sano/no-raw-palette-color` is at 0 and therefore now blocks any new stock-palette colour.
- **Two custom ESLint rules** with RuleTester suites. `no-raw-palette-color` keys on a genuinely clever structural distinction: chrome colour is written inline in `className`, whereas data-encoding colour (status maps, chart series, dental-chart codes) is indirected through a lookup map — so data maps are out of reach *by construction*, not by allowlist.
- **Eight distinct drift guards**: permissions-catalog, business-modules catalog, feature-flag consumer, outlet-header single-reader, outlet reach invariant, frontend-coverage baseline, design-token drift, and the timezone-boundary scan. Several use the same "fail on NEW, never on totals" principle.
- **Test isolation** is well-engineered: a randomly-named schema per test, and `cleanup()` drops tables in batches of 40 before `DROP SCHEMA CASCADE` because ~244 tables each taking an `AccessExclusiveLock` exceeds `max_locks_per_transaction`.

The engineering instinct here is clearly present. It has simply not been pointed at the test suite's own health.

---

## 12. Consolidated risk register

Ordered by a blend of severity and likelihood, with today's actual exposure noted separately from latent exposure.

| # | Risk | Grade | Exposure today | Latent exposure |
|---|---|---|---|---|
| 1 | Three stock-movement implementations; POS path off the shared ledger | CONFIRMED (src) | Low (59 sales) | **High** — irreproducible stock drift under load |
| 2 | Gateway HTTP call inside the sale transaction | REPORTED | Low | **High** — charge succeeds, sale rolls back |
| 3 | Shopify webhook unreachable | CONFIRMED (live) | **None** (0 connections) | High — breaks first Shopify merchant |
| 4 | No graceful shutdown | CONFIRMED (src) | Moderate — every deploy | High under real traffic |
| 5 | CI gates 5 of 334 test files; 36 integration files won't load | REPORTED | **High now** — no regression net | High |
| 6 | Single-instance-only (8+ process-local caches, in-memory limiters) | CONFIRMED (src) | None (1 instance) | **Blocking** — silently wrong at 2 instances |
| 7 | `max_connections=60` vs assumed ~200 | CONFIRMED (live) | Low (26 in use) | High at tenant growth |
| 8 | `/api/feature-flags` unauthenticated + existence oracle | CONFIRMED (live) | Moderate | Moderate |
| 9 | Credential encryption silently plaintext without key | REPORTED | Unknown — **verify** | High |
| 10 | `POST /api/sales` has no permission guard | CONFIRMED (src) | Low | Moderate |
| 11 | Two DDL sources of truth with no drift check | REPORTED | Low (all at v137) | High — silent missing columns |
| 12 | `MAX(version)` migration versioning not gap-safe forward | CONFIRMED (src) | None | Moderate — branch merges |
| 13 | Migration runtime inside 120 s healthcheck, sequential per tenant | CONFIRMED (src) | Low (29 tenants) | High at ~100+ tenants |
| 14 | Frontend fail-open gates (`RequireContext`, `hasMode`) | CONFIRMED (src) | Low | Moderate |
| 15 | Zod gap: 19 unvalidated accounting writes | REPORTED | Low | Moderate |
| 16 | Wholesale credit-limit tests all skipped | REPORTED | Moderate | High |
| 17 | Public schema carries full tenant DDL | CONFIRMED (live) | None (empty, RLS on) | Low — but forces 74 guards |
| 18 | Daraz webhook unsigned | REPORTED | None (no integrations) | Moderate |
| 19 | Rate limiters bypassable via client headers | CONFIRMED (src) | Moderate | Moderate |
| 20 | Billing transitions hidden inside the email worker | REPORTED | Low | Moderate |

---

## 13. Scaling analysis

### 13.1 The hard blocker: single-instance architecture

The system **cannot run more than one instance** without silent behavioural corruption. This is not a performance limit; it is a correctness limit, and nothing in the code fails loudly if a second instance is added.

Process-local state that a second instance would neither see nor be told about:

| State | TTL | Failure at 2+ instances |
|---|---|---|
| Company profile cache | 5 min | Currency/timezone/tax changes lag; timezone drift mis-buckets reports |
| Feature-flag cache | 60 s | A module toggle applies on one instance, lags on others |
| Mode cache | 60 s | Same, but `requireMode` is fail-closed → 403s rather than fall-through |
| Outlet cache | 60 s | A new outlet resolves on one instance, 403s on another |
| Tenant row cache | 60 s | Suspension lags |
| Context-flag cache | 30 s | Enforcement flips per instance |
| Menu-schedule cache | 60 s | QR diners see different menus concurrently |
| Customer-display cart | none | Display blank unless POS write and poll hit the same instance |
| Alerting windows | none | Error-spike alerts need N× the errors to fire |
| Rate limiters | none | Effective limits multiply by N |

Every `invalidate*` function is in-process only. The sharp edge is **invalidation, not the TTLs**: a module toggle would appear to work, then appear to revert, depending on which instance answered — the worst kind of bug to diagnose. And the obvious fix is unavailable: `LISTEN/NOTIFY` doesn't work on the transaction pooler, so cross-instance invalidation needs Redis or a dedicated non-pooled connection.

### 13.2 Database capacity — revised downward

**`max_connections` is 60**, not the ~200 assumed in project documentation. Current usage is 26. The app pool is hardcoded at 20, plus pg-boss's own direct connections (it needs `LISTEN`, so it bypasses the pooler) and Supavisor overhead.

Because Supavisor transaction-mode pooling means an app connection only holds a real backend for the duration of a query, the effective ceiling is still reasonably high — but it is materially lower than planned, and any capacity projection derived from a ~200 figure should be recomputed.

Storage is not a near-term constraint: 577 MB against an 8 GB Pro allowance, though 9,350 tables and 20,792 indexes for 29 tenants means ~322 tables and ~717 indexes **per tenant** — catalog bloat that grows linearly and will affect `pg_dump`, introspection queries, and migration time long before it affects storage.

### 13.3 Deploy-time scaling

`start.sh` runs migrations for **all tenants sequentially** before the server binds, inside Railway's 120-second healthcheck window. At 29 tenants this is fine. The cost is linear with tenant count and there is no parallelism, so tenant growth eventually turns a routine deploy into a healthcheck failure — with no early warning signal.

### 13.4 What scaling would require, in order

1. Externalise cache invalidation (Redis) and rate-limit state — the precondition for any second instance.
2. Move the migration run out of the boot path (a separate release phase or job).
3. Recompute connection budget against the real 60-connection ceiling.
4. Add a graceful shutdown handler so instances can be cycled without dropping work.

---

## 14. Recommendations

Ordered by value-per-effort. Nothing here requires re-architecture.

### Immediate (days, low risk)

1. **Move the Shopify webhook mount before the tenant wall.** One-line relocation alongside the other webhook routes. Add an integration test asserting it returns 401 *invalid signature*, not `AUTH_REQUIRED` — that distinction is the whole bug.
2. **Fix `GET /api/feature-flags` authentication.** Require a real JWT, or move it fully behind the tenant wall. Return 404 (not 500) for unknown tenants to close the existence oracle.
3. **Add a boot assertion for `INTEGRATION_SECRET_KEY`,** mirroring the portal-secret guard, and make `encryptSecret` throw rather than silently store plaintext. Then audit existing `integration_settings` rows for unprefixed (plaintext) values.
4. **Add a graceful shutdown handler** — capture the server handle, handle SIGTERM/SIGINT, call `server.close()` and the already-written `shutdownBoss()`.
5. **Add `{ algorithms: ['HS256'] }`** to all four `jwt.verify` call sites. Currently safe by library default; one config change from not being.
6. **Length-guard the two `timingSafeEqual` calls** in `payment-gateway.js` so a malformed signature returns 400, not 500.

### Short term (weeks)

7. **Restore the 36 broken integration test files.** They cover sales, returns, RBAC, and security — the highest-value paths in the product. Either port them to `createTestApp-pg` or delete them explicitly; leaving them in-tree makes the suite look four times healthier than it is.
8. **Put the integration suite in CI**, even nightly against a throwaway Postgres, using the existing baseline-diff approach (fail on new/changed failures, not totals) so it can go green immediately.
9. **Unskip the wholesale credit-limit tests** — this is the most financially sensitive untested logic in the system.
10. **Migrate `routes/sales.js` onto `services/stock-ledger.js`**, and add a runtime assertion that the ledger is running inside a transaction. Then bring `shopify/order-service.js` onto it too. Collapsing three implementations to one is the single highest-value correctness change available.
11. **Move the gateway capture outside the sale transaction** — authorise before opening the transaction, capture after commit, with a reconciliation path for the gap.
12. **Add a schema-vs-migrations drift test.** Provision a fresh schema from `schema-pg.sql`, provision another by replaying all migrations, and diff `information_schema`. This fits the existing drift-guard culture exactly and closes the most dangerous silent failure in the data layer.
13. **Add Zod validation to `tier4/accounting.js`** (19 unvalidated writes to journal entries and chart of accounts).
14. **Decide explicitly about `POST /api/sales`** — either add `requirePerm("pos_sell")` or add a comment recording that open access is intentional.

### Medium term (months, before scale)

15. **Externalise cache invalidation and rate-limit state to Redis.** This is the gate on horizontal scaling; treat "add a second instance" as blocked on it.
16. **Move migrations out of the boot path.**
17. **Add a linter to the backend.** It is the larger, more security-sensitive half and currently has no static analysis at all.
18. **Switch migration versioning to a set-difference** (`NOT IN (SELECT version …)`) — a small change that removes a whole class of silent-skip failure.
19. **Stop the public schema receiving the full tenant DDL** — split the bootstrap so public gets only registry tables. This retires ~74 defensive guards and removes a permanent source of confusion.
20. **Reconcile documentation with reality.** Several project docs are contradicted by source: `max_connections` (~200 vs 60), background marketplace sync (stub), and the stock-ledger consolidation (incomplete). The docs are otherwise unusually good; these specific claims are actively misleading.

---

## Appendix A — Verification log

Live checks performed during this audit (all read-only):

| Check | Result |
|---|---|
| Tenant registry | 36 rows, 29 active |
| Tenant schema versions | All 29 at v137; public also v137 |
| Public schema RLS | 334 tables, 0 without RLS |
| Public shadow tables | `sales`/`customers`/`products`/`company_profile` present, 0 rows each |
| Tenant catalog size | 9,350 tables, 20,792 indexes |
| DB | Postgres 17.6, 577 MB, 26 connections, `max_connections=60`, TZ UTC |
| Pooler | Supavisor confirmed in `pg_stat_activity` |
| Backend health | 200; deep: DB 38 ms, Resend 362 ms |
| Frontend | 200; Vercel READY on `3b84732d` |
| Shopify webhook | `401 AUTH_REQUIRED` (unreachable) |
| xpay webhook (control) | `400 Invalid signature` (reachable) |
| Feature-flags, forged header | **200** with full config |
| Feature-flags, no header | 401 |
| Feature-flags, unknown tenant | 500 (existence oracle) |
| Active Shopify connections | 0 across all 29 tenants |
| pg-boss queue | All `completed`; no failures or backlog |
| Email / FBR queues | Empty |
| Production usage | 59 sales, 81 products, 40 employees; 5 tenants with any sale |
| Sentry | Backend 0 unresolved; frontend 1 (2026-07-11) |
| Railway env | ~25 worker flags set; `META_APP_SECRET` unset; `R2_PUBLIC_URL` unset |
| Repo | 1,923 commits; 600 in 90 days; no unmerged branches |

## Appendix B — Method and limitations

Eight parallel read-only agents audited: backend core/boot/middleware; API route surface; services and workers; data model and migrations; frontend; security posture; testing/CI/tooling; and business domain features. Each was instructed to cite file and line, to treat documentation as non-evidence, and to state explicitly what it could not verify.

Findings marked **CONFIRMED (live)** were reproduced by the author of this report against production. Findings marked **CONFIRMED (source)** were re-read directly. The remainder are marked **REPORTED**.

**Limitations.** No code was executed beyond read-only HTTP probes and SQL. The test suite was not run. Dynamic behaviour under concurrency was not load-tested. A small number of cross-file claims (the `approvals` route collision; the precise third `requirePlanLimit` call site) were noted as unverified by the sweep and remain so. Business logic was assessed for structural correctness, not for domain-rule accuracy against Pakistani tax or labour regulation.
