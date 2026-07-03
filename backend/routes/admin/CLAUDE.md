# Admin Routes — Claude Guide

All routes here are under `/api/admin/*` and mount **before** tenant middleware. There is no `deps.db` tenant proxy, no `req.company`, no `req.employee`. Almost every route requires both `requireAllowedIp` and `requireSuperAdmin`. Exceptions: `POST /api/admin/auth/login` (uses `requireAllowedIp` + `authLimiter` only — it's the route that mints the admin token), and `GET /api/announcements/active` (public, no auth at all).

## index.js — Orchestrator

Builds a shared `deps` object and registers the 8 domain modules in order: `auth.js`, `tenants.js`, `monitoring.js`, `billing.js`, `operations.js`, `compliance.js`, `messaging.js`, `system.js`. `deps` carries: `db`, `masterDb`, `jwt`, `jwtDefaults`, `tenantDbManager`, `requireAllowedIp`, `requireSuperAdmin`, `authLimiter`, `bcrypt`, `BCRYPT_ROUNDS`, `provision`, `PLAN_DEFAULTS`, `auditLog`, `logAdminAction`, `logSecurityEvent`. Calls `tenantDbManager.init(db)` before any route registers.

## helpers.js — Shared Utilities

- **IP allowlist**: `createRequireAllowedIp()` reads `ADMIN_ALLOWED_IPS` (comma-separated, CIDR supported, `/32` for single hosts). Empty/unset env var = allow all.
- **Auth middleware**: `createRequireSuperAdmin(verifyAccessToken)` verifies the Bearer token and requires `decoded.role === 'super_admin'`, then sets `req.admin = { id, email }`. Expired token → 401 `code: 'TOKEN_EXPIRED'`.
- **Logging helpers** (`createLoggers(db, masterDb)`):
  - `auditLog(tenantId, action, details, actor)` → `tenant_audit_log` (public schema, via `masterDb`)
  - `logAdminAction(email, action, targetType, targetId, details, ip)` → `admin_activity_log` (via `db`); failures swallowed
  - `logSecurityEvent(eventType, email, ip, userAgent, details)` → `admin_security_log`; failures swallowed

## auth.js

**`POST /api/admin/auth/login`** — looks up `super_admins` by lowercased email, bcrypt-compares password, signs a JWT with `{ tid:0, eid:0, rid:0, oid:null, aid, email, role:'super_admin', scope:'admin' }`. Calls `masterDb.init(db)` on every login (idempotent). Logs success/failure to `admin_security_log`.

## tenants.js — Tenant Lifecycle

Owns tenant CRUD, stats, feature flags, notes, setup tokens, migrations, PIN reset. Touches `tenants`, `tenant_audit_log`, `tenant_notes` (all public), plus per-tenant `feature_flags`, `company_profile`, `action_history`, `employees`, `roles`, `role_permissions`, `schema_version`.

Highlights:
- `POST /api/admin/tenants` — validates slug (`^[a-z0-9_]{3,40}$`) and PIN (4-8 digits) before calling `provision()`, then applies `PLAN_DEFAULTS` limits for the chosen plan. Returns `setup_url`.
- `DELETE /api/admin/tenants/:id` — soft-marks `status='deleted'` then hard `DROP SCHEMA IF EXISTS "tenant_{slug}" CASCADE`. Re-validates the slug against `/^[a-z0-9_]+$/` immediately before the DROP — never trust a value already in the DB for use in raw DDL.
- `GET /api/admin/tenants/:id/stats` — 14 queries fanned out in parallel against one tenant's schema (counts, revenue by period, last login/sale/shift, active employees 7d/30d, schema size via `pg_total_relation_size`).
- `POST /api/admin/tenants/:id/migrate` and `POST /api/admin/migrate-all` — both call `migrate()`/`MIGRATIONS` from `migrate-pg.js`, the same function Railway's boot sequence uses. `migrate-all` always migrates public schema first, then all active tenants sequentially; per-tenant errors are caught so one bad tenant doesn't abort the batch.
- `POST /api/admin/tenants/:id/reset-pin` — finds the tenant's first employee with the `all_access` permission (joins `employees` → `roles` → `role_permissions`) and bcrypt-hashes a new PIN onto it. Defaults to `"0000"` if none supplied.

**Gotcha — `buildTenantScopedDb()`**: a local helper in this file that wraps the raw pool and issues `SET search_path TO {schema}, public` on every query/transaction. This is separate from the tenant DB proxy (`tenant-db-proxy-pg.js`) used by normal tenant routes — it exists purely so migrations can run DDL inside one tenant's schema from admin context.

## monitoring.js — Global Stats & Infra

- `GET /api/admin/stats` — tenant counts by status/plan + 5 most recent tenants + 10 most recent audit rows. Single-schema query, no fanout.
- `GET /api/admin/attention` — iterates every active tenant checking employee/product/outlet usage vs. plan limits (flags >85%), dormancy (no login ≥14 days), and incomplete setup. `dead_tenants` = setup-pending tenants created >7 days ago.
- `GET/POST /api/admin/cleanup-preview` / `cleanup-run` — thin wrappers around `cleanupDeadTenants()` from `jobs/cleanup-dead-tenants.js` (dry-run vs. live).
- `GET /api/admin/revenue-stats` — MRR from `plan_pricing` × pro-plan active tenant count, plus a live fanout summing `sales.total` (not `total_amount`) across all active tenant schemas for the current month.
- `GET /api/admin/infra` — the expensive one. Queries `pg_stat_activity`, `pg_settings`, `pg_database_size`, `pg_statio_user_tables` (cache hit ratio), `pg_stat_user_tables` (dead tuples), per-schema sizes, and optionally `pg_stat_statements` (try/catch — silently skipped if the extension isn't installed). Cached in-memory for 5 minutes (`_infraCache` module variable); `?force=1` bypasses. Response carries `X-Infra-Cache: hit|miss`. Fires `alerting.recordDbPressure()` when active connections exceed 80% of `max_connections`.

## billing.js — Plan Pricing & Payments

Uses `masterDb` for everything here (`plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`), `tenantDbManager` only to look up a tenant's `company_profile.email` for notification emails.

- `POST /api/admin/tenants/:id/record-payment` — computes period length from `cycle` (30 or 365 days) plus a fixed 7-day grace window, updates `tenants` (plan/cycle/expiry/grace/payment_status/limits) and inserts into `payment_records`, then fires a non-blocking `billing_payment_recorded` email.
- `GET /api/admin/billing-attention` — three tenant lists: due soon (expires within 7 days), overdue (past expiry, still in grace), past grace. Plus a count of pending upgrade requests.
- `GET /api/admin/payment-intents/stuck` — `payment_intents` stuck in `'pending'` longer than `?hours=` (default 2).

## operations.js — Support Tickets, Impersonation, Dead Letters

**Support tickets** are cross-tenant fanout: iterate every active tenant via `tenantDbManager.getDb()`, query `support_tickets`, merge and re-sort by `created_at`. Tables missing on a given tenant are caught and skipped silently. The `/reply` route also inserts an in-app `notifications` row (type `support_reply`, link `/my-tickets`) — notification-insert failures are logged (not swallowed) but never fail the reply itself.

**Impersonation**: `POST /api/admin/impersonate/:tenantId` finds the tenant's first `role_id=1` employee, signs a 1-hour JWT with `impersonating: true`, a `realIdentity` block, and a `jti`. The `jti` is what makes hard-revocation possible — `tenant-auth.js` checks incoming tokens against `revoked_tokens` by `jti`, so without it the token would stay valid for the full hour regardless of calling `/end`. Session tracked in `impersonation_sessions` (masterDb). `POST /api/admin/impersonate/:sessionId/end` inserts the `jti` into the tenant's `revoked_tokens` table (best-effort — logged, not fatal) and marks the session ended.

**Dead letters**: `GET /api/admin/dead-letters` fans out over `shopify_webhook_events WHERE status IN ('dead_letter','failed')`. `GET /api/admin/webhooks/payment-dead-letters` reads the public-schema `payment_webhook_events` table directly (no fanout needed — it's cross-tenant by design).

## compliance.js — Tax Rates & FBR Health

`public.tax_rate_reference` is the shared HS-code/tax-rate table; CRUD here is straightforward. `tax_rate_suggestions` lives per-tenant (tenants can submit corrections) and is fanned out to build a review queue — approving a suggestion writes back into `public.tax_rate_reference`, but only for an allow-listed set of fields (`federal_gst`, `punjab_pra`, `sindh_srb`, `kpk_kpra`, `balochistan_bra`). Any route interpolating a tenant slug into a schema-qualified query (`tenant_${slug}.table`) validates it against `/^[a-z0-9_]{3,40}$/` first — this file builds those identifiers by string interpolation rather than parameterized queries, so the validation is load-bearing, not decorative.

`GET /api/admin/fbr-health` — fanout restricted to tenants with the `fbr_integration` feature flag on; returns pending/failed/posted counts, oldest pending timestamp, and average pending delay in seconds.

## messaging.js — Email Queue, Broadcast, Logs, Announcements

**Email queue reads `pgboss.job WHERE name='email'`** — not the legacy `public.email_queue` table, which nothing writes to anymore. State mapping: `created/retry/active` → pending, `completed` → sent, `failed/cancelled` → failed. Job IDs are UUID strings. Retry resets state to `created` and clears `retry_count`/`output`; send-now just brings `start_after` to `NOW()`. `DELETE /api/admin/email-queue/purge-deleted` **must stay registered before** the `:id` DELETE route, or Express will match `purge-deleted` as an `:id` param.

**Broadcast** (`POST /api/admin/email/broadcast`) iterates all active tenants, reads each `company_profile.email`, and calls `enqueueEmail()` per tenant. Logs a `broadcast_log` row (best-effort).

**Announcements**: `PUT /api/admin/announcements/:id` sets `ends_at = $4` unconditionally (not COALESCE) — passing `ends_at: undefined` in the body sets the column to NULL. `GET /api/announcements/active` is the one fully public route in this directory; it feeds the tenant-side `AnnouncementBanner.jsx`.

**Cross-tenant activity** (`GET /api/admin/tenant-activity`) divides the requested `limit` across the number of active tenants before querying each one's `action_history`, then merges and re-sorts — so a large tenant count can make the per-tenant slice quite small.

## system.js — Workers, Schemas, Backup

`GET /api/admin/worker-status` reads in-memory heartbeat globals (`global.__<name>WorkerStatus`) for every background worker, but heartbeats are wiped on every Railway redeploy. To avoid a scary "all workers stopped" dashboard right after a deploy, it also queries `pgboss.job MAX(completed_on)` per known queue (`PG_BOSS_QUEUES` map in this file) and uses whichever timestamp — in-memory or DB — is newer. Workers without a pg-boss queue (`booking_reminder`, `catalog_scheduler`) rely on the in-memory heartbeat alone. A worker is "running" if its last-poll time is within `pollIntervalMs * 2.5`.

`GET /api/admin/orphaned-schemas` reads a cached snapshot from `public.infra_cache` (key `orphaned_schemas`, populated hourly by a background worker); `?force=1` triggers a live scan, which was measured at up to ~104s in prod — avoid forcing without reason. `POST /api/admin/orphaned-schemas/cleanup` always does a live comparison of `information_schema.schemata` against the tenant registry and drops anything unmatched.

`POST /api/admin/backup` shells out to `pg_dump` (checks availability first) across all active tenant schemas + public, uploads the resulting dump to R2, and logs to `backup_log`. `POST /api/admin/backup/verify` takes a `filePath`, lists the schemas actually present in that dump, and diffs against the expected schema set.

## Cross-Cutting Conventions

- **DB access pattern**: `db` (direct pool) is used with schema-qualified queries like `tenant_{slug}.tablename` for cross-tenant fanout or superadmin-scoped work. `masterDb` is for public-schema-only tables (`plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`, `impersonation_sessions`). `tenantDbManager.getDb(tenantId)` returns a proxy scoped to one tenant's schema — prefer this over raw `tenant_{slug}.` interpolation when you only need one tenant.
- **Cross-tenant fanout is the dominant pattern** here (support tickets, dead letters, tax suggestions, FBR health, tenant activity) — always wrapped in a per-tenant try/catch so one tenant with a missing table or dropped schema doesn't break the whole response.
- **Not every mutation calls `logAdminAction()`** — notable gaps include the tax/compliance CRUD routes, `POST /api/admin/email-queue/:id/retry`, `PUT /api/admin/announcements/:id`, and `POST /api/admin/backup/verify`. Don't assume audit coverage is complete; check the specific route.
- **Tenant slug safety**: anywhere a slug is interpolated into raw SQL (schema-qualified table names, `DROP SCHEMA`), it is re-validated against a safe regex immediately before use — never trust that a DB-stored slug is still safe by the time it reaches a query string.
- **Frontend**: admin pages call `adminFetch()`, not the tenant-side `api.js`. Token lives in `adminAuthStore.js`, entirely separate from tenant auth storage.
