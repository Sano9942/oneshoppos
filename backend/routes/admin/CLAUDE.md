# Admin Routes — Claude Guide

All routes in this directory are under `/api/admin/*` and are mounted **before** tenant middleware. There is no `deps.db` tenant proxy, no `req.company`, and no `req.employee`. Most routes require both `requireAllowedIp` and `requireSuperAdmin`. The two exceptions are: `POST /api/admin/auth/login`, which uses `requireAllowedIp` and `authLimiter` but NOT `requireSuperAdmin` (it is the route that creates the admin token); and `GET /api/announcements/active`, which is public/no-auth.

## index.js — Orchestrator

Initializes shared deps and registers all 8 domain modules in order. The `deps` object passed to every module contains: `db`, `masterDb`, `jwt`, `jwtDefaults`, `tenantDbManager`, `requireAllowedIp`, `requireSuperAdmin`, `authLimiter`, `bcrypt`, `BCRYPT_ROUNDS`, `provision`, `PLAN_DEFAULTS`, `auditLog`, `logAdminAction`, `logSecurityEvent`.

`tenantDbManager.init(db)` is called here before any routes register.

## helpers.js — Shared Utilities

**IP allowlist**: `createRequireAllowedIp()` reads `ADMIN_ALLOWED_IPS` env var (comma-separated, CIDR supported). If env var is empty/unset, all IPs pass. `ipInCidr()` handles `/32` single-host entries too.

**Auth middleware**: `createRequireSuperAdmin(verifyAccessToken)` verifies Bearer token, checks `decoded.role === 'super_admin'`, sets `req.admin = { id, email }`. Returns `401` with `code: 'TOKEN_EXPIRED'` on expired tokens.

**Logging helpers** (returned by `createLoggers(db, masterDb)`):
- `auditLog(tenantId, action, details, actor)` → inserts into `tenant_audit_log` (public schema via masterDb)
- `logAdminAction(email, action, targetType, targetId, details, ip)` → inserts into `admin_activity_log` (public schema via db); failures are swallowed (non-critical)
- `logSecurityEvent(eventType, email, ip, userAgent, details)` → inserts into `admin_security_log`; failures swallowed

## auth.js — Login

**`POST /api/admin/auth/login`** — `requireAllowedIp` + `authLimiter`. Looks up `super_admins` table by lowercase email. bcrypt-compares password. Signs JWT with `{ tid:0, eid:0, rid:0, oid:null, aid, email, role:'super_admin', scope:'admin' }`. Calls `masterDb.init(db)` on every login (idempotent). Logs success/failure to `admin_security_log`.

## tenants.js — Tenant CRUD

Tables: `tenants`, `tenant_audit_log`, `tenant_notes`, `feature_flags` (per-tenant schema), `company_profile` (per-tenant), `action_history` (per-tenant), `employees` (per-tenant), `roles` (per-tenant), `role_permissions` (per-tenant), `schema_version` (per-tenant).

**Routes:**
- `GET /api/admin/tenants` — lists all non-deleted tenants. For active tenants, concurrently fetches `last_login`, `revenue_this_month`, and `setup_complete` from each tenant schema. Schema-missing errors are caught per-tenant (silently returns nulls).
- `POST /api/admin/tenants` — validates `CreateTenantSchema` (Zod). Slug regex: `^[a-z0-9_]{3,40}$`. PIN: 4-8 digits. Calls `provision()`, then updates plan limits, then sends `auditLog` + `logAdminAction`. Returns `setup_url`.
- `GET /api/admin/tenants/:id` — includes last 20 rows from `tenant_audit_log`.
- `PUT /api/admin/tenants/:id` — COALESCE update; when `plan` changes, applies `PLAN_DEFAULTS` limits and fires `billing_plan_changed` email (non-blocking `.catch`).
- `POST /api/admin/tenants/:id/suspend` — sets `status='suspended'`, `suspended_at=NOW()`.
- `POST /api/admin/tenants/:id/activate` — sets `status='active'`, clears `suspended_at`. Refuses if `status='deleted'`.
- `DELETE /api/admin/tenants/:id` — marks `status='deleted'`, then `DROP SCHEMA IF EXISTS "tenant_{slug}" CASCADE`. Validates slug is safe (`/^[a-z0-9_]+$/`) before DROP.
- `GET /api/admin/tenants/:id/stats` — 14 parallel queries into the tenant schema: employee/product/outlet counts, sales counts/revenue (today/week/month), last_login, last_sale, last_shift, active employees 7d/30d, schema size in MB.
- `GET /api/admin/tenants/:id/feature-usage` — queries `action_history` for all-time and last-30-days action type counts + top 5 users.
- `GET /api/admin/tenants/:id/setup-token` — reads `company_profile.setup_token`. Returns `{ setup_complete: true, setup_token: null }` if already complete.
- `POST /api/admin/tenants/:id/regenerate-setup-token` — generates new 32-byte hex token, sets 48h expiry, sets `setup_complete=false`.
- `GET /api/admin/plan-defaults` — returns `PLAN_DEFAULTS` object (no DB query).
- `GET /api/admin/tenants/:id/feature-flags` — merges DB rows with `DEFAULT_FEATURE_FLAGS` defaults; returns sorted by key.
- `PUT /api/admin/tenants/:id/feature-flags` — upserts by `key`, calls `invalidateFeatureFlagCache(tenant.id)` after.
- `GET /api/admin/tenants/:id/notes` — reads `tenant_notes` (public schema).
- `POST /api/admin/tenants/:id/notes` — inserts to `tenant_notes`.
- `DELETE /api/admin/tenants/:id/notes/:noteId` — deletes from `tenant_notes`.
- `POST /api/admin/tenants/:id/migrate` — runs `migrate-pg.js` against a single tenant schema using `buildTenantScopedDb()`. Reads `schema_version` before/after to report applied versions. Idempotent.
- `POST /api/admin/migrate-all` — migrates public schema first, then all `status='active'` tenants sequentially. Per-tenant errors are caught (one failed tenant doesn't abort others). Response: `{ public, results, migrated, skipped, errors }`.
- `POST /api/admin/tenants/:id/reset-pin` — finds first `all_access` employee via role_permissions, bcrypt-hashes new PIN, updates `employees.pin_hash`. Defaults to "0000" if no PIN provided.

**Gotcha**: `buildTenantScopedDb()` creates a wrapper that sets `search_path TO {schema}, public` on every query/transaction — same pattern as `migrate-pg.js`. This is local to this file; it's not the tenant proxy used by normal routes.

## monitoring.js — Global Stats & Infrastructure

**`GET /api/admin/stats`** — tenant counts by status/plan, 5 most recent tenants, 10 most recent audit log entries. Single-DB queries (no per-tenant fanout).

**`GET /api/admin/attention`** — iterates every active tenant; for each checks employees/products/outlets vs limits (flags at >85%), last login (flags dormant at ≥14 days), setup_complete. Returns `{ approaching_limits, dormant, setup_pending, dead_tenants }`. Dead tenants = `setup_pending` entries created >7 days ago.

**`GET /api/admin/cleanup-preview`** — calls `cleanupDeadTenants({ dryRun: true })` from `jobs/cleanup-dead-tenants.js`.

**`POST /api/admin/cleanup-run`** — calls `cleanupDeadTenants({ dryRun: false })`.

**`GET /api/admin/revenue-stats`** — computes MRR from `plan_pricing` + count of pro active tenants. Then iterates all active tenants to sum `sales.total` for current month. Gotcha: column is `total` not `total_amount` in this query.

**`GET /api/admin/infra`** — cached 5 min in `_infraCache` module variable (bypassed with `?force=1`). Response header `X-Infra-Cache: hit|miss`. Queries: `pg_stat_activity` (connections by state), `pg_settings` (max_connections), `pg_database_size`, active slow queries (>1s from `pg_stat_activity`), `pg_statio_user_tables` (cache hit ratio), `pg_stat_user_tables` (dead tuples/vacuum), schema sizes. Optional: `pg_stat_statements` historical slow queries — try/catch, skipped if extension not enabled. Triggers `alerting.recordDbPressure()` when connections >80% of max.

## billing.js — Plan Pricing & Payments

Uses `masterDb` for `plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`. Uses `db` for per-tenant data access.

**Routes:**
- `GET /api/admin/plan-pricing` — reads `plan_pricing` ordered by plan, cycle.
- `PUT /api/admin/plan-pricing/:id` — partial update (`price` and/or `is_active`), uses dynamic param building.
- `POST /api/admin/tenants/:id/record-payment` — requires `plan`, `cycle`, `amount`. Computes period (30 or 365 days) + 7-day grace. Updates `tenants` (plan, billing_cycle, plan_expires_at, grace_ends_at, payment_status='active', plan limits). Inserts to `payment_records`. Fires `billing_payment_recorded` email (non-blocking). All via `masterDb`.
- `GET /api/admin/tenants/:id/payments` — reads `payment_records` for tenant.
- `GET /api/admin/upgrade-requests` — pending requests joined with tenant info.
- `PUT /api/admin/upgrade-requests/:id` — sets status to `'approved'` or `'dismissed'`, records `resolved_at` + `resolved_by`.
- `GET /api/admin/billing-attention` — three lists: due soon (expires in 7 days), overdue (past expiry, in grace), past grace. Plus count of pending upgrade requests.
- `GET /api/admin/payment-intents/stuck` — finds `payment_intents` in `'pending'` state older than threshold hours (default 2). Accepts `?hours=N`. Joins with `tenants`.

## operations.js — Support Tickets, Impersonation, Dead Letters

**Support tickets** (cross-tenant fanout — iterates all active tenants via `tenantDbManager`):
- `GET /api/admin/support-tickets` — accepts `?status=` and `?limit=` (max 200). Reads `support_tickets` from each tenant schema, merges and sorts by `created_at`.
- `PUT /api/admin/support-tickets/:tenantId/:ticketId` — updates status (`open|acknowledged|resolved`). On resolved: fires `support_resolved` email if employee has email.
- `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply` — sets `admin_reply`, `replied_at`, `status='acknowledged'`. Creates in-app notification in `notifications` table (type `support_reply`, link `/my-tickets`). Notification failure is logged but doesn't fail the reply.
- `DELETE /api/admin/support-tickets/:tenantId/:ticketId`

**Impersonation:**
- `POST /api/admin/impersonate/:tenantId` — finds first employee with `role_id=1`, signs a 1h JWT with `{ tid, eid, rid:1, scope:'full', impersonating:true, realIdentity:{id,name,email} }`. Records session in `impersonation_sessions` (masterDb). Logs audit.
- `POST /api/admin/impersonate/:sessionId/end` — sets `ended_at` in `impersonation_sessions`.

**Dead letters** (Shopify webhook events):
- `GET /api/admin/dead-letters` — cross-tenant fanout on `shopify_webhook_events WHERE status IN ('dead_letter','failed')`.
- `POST /api/admin/dead-letters/:tenantId/:id/retry` — resets `status='pending'` on the event.

**Payment webhook dead letters**:
- `GET /api/admin/webhooks/payment-dead-letters` — reads public schema `payment_webhook_events` last 7 days (masterDb).

## compliance.js — Tax Rates & FBR Health

Tables: `public.tax_rate_reference`, `tenant_{slug}.tax_rate_suggestions`, `tenant_{slug}.feature_flags`, `tenant_{slug}.fbr_invoices`.

**Routes:**
- `GET /api/admin/tax-rates` — all rows from `public.tax_rate_reference` ordered by hs_code.
- `POST /api/admin/tax-rates` — validates `CreateTaxRateSchema`. Requires `hs_code` + `description_en`. Tax rate columns default to 0.
- `PUT /api/admin/tax-rates/:id` — COALESCE update on all columns, sets `last_updated = CURRENT_DATE`.
- `DELETE /api/admin/tax-rates/:id`
- `GET /api/admin/tax-rate-suggestions` — cross-tenant fanout on `tax_rate_suggestions WHERE status='pending'`.
- `PUT /api/admin/tax-rate-suggestions/:id` — body requires `status` (`approved|rejected`) + `tenant_slug`. On approved: if `field_name` is in the allowed list (`federal_gst`, `punjab_pra`, `sindh_srb`, `kpk_kpra`, `balochistan_bra`), updates `public.tax_rate_reference`. Tenant slug validated against `/^[a-z0-9_]{3,40}$/` before using in query.
- `GET /api/admin/fbr-health` — cross-tenant: only tenants with `fbr_integration` flag enabled. Returns pending/failed/posted counts + oldest pending + avg delay in seconds.

## messaging.js — Email Queue, Broadcast, Logs, Announcements

**Email queue** (reads from `pgboss.job` — NOT `public.email_queue` which is legacy):
- `GET /api/admin/email-queue` — accepts `?status=pending|sent|failed`, `?limit=` (max 500). Joins with `tenants`. Returns emails array + `{ pending, sent, failed }` counts.
- `POST /api/admin/email-queue/:id/retry` — resets pgboss job state to `'created'`, clears `retry_count`, `output`, timestamps.
- `POST /api/admin/email-queue/:id/send-now` — sets `start_after=NOW()` for pending jobs (immediate pickup).
- `DELETE /api/admin/email-queue/purge-deleted` — **must be registered before `:id` route** (Express route ordering). Deletes non-completed jobs for deleted tenants.
- `DELETE /api/admin/email-queue/:id` — only deletes non-completed jobs.

**Broadcast:**
- `POST /api/admin/email/broadcast` — type must be `'downtime'` or `'announcement'`. Iterates active tenants, reads `company_profile.email`, calls `enqueueEmail()` for each. Logs to `broadcast_log`. Returns `{ ok, enqueued }`.
- `GET /api/admin/broadcast-history` — reads `broadcast_log` last 50.

**Logs:**
- `GET /api/admin/activity-log` — from `admin_activity_log`; accepts `?action=`, `?limit=`, `?offset=`. Returns `{ entries, total }`.
- `GET /api/admin/security-log` — from `admin_security_log`; accepts `?event_type=`, `?limit=`, `?offset=`.
- `GET /api/admin/tenant-activity` — cross-tenant fanout on `action_history`; distributes limit across tenants (`limit / tenants.length`), merges and re-sorts.

**Announcements:**
- `GET /api/admin/announcements` — all, last 50, requires auth.
- `POST /api/admin/announcements` — validates `CreateAnnouncementSchema`. Type: `info|warning|maintenance`.
- `PUT /api/admin/announcements/:id` — partial update; `ends_at = $4` is always set (not COALESCE) — passing `ends_at: undefined` sets it to NULL.
- `DELETE /api/admin/announcements/:id`
- **`GET /api/announcements/active`** — public, no auth. Returns active announcements where `starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())`. Used by tenant dashboard `AnnouncementBanner.jsx`.

## system.js — Workers, Schemas, Backup

**`GET /api/admin/worker-status`** — reads global heartbeat variables and returns structured status for 19 workers:
`email`, `fbr`, `cleanup`, `reservation`, `marketplace_sync`, `booking_reminder`, `rental_overdue`, `room_overdue`, `treatment_plan`, `course_release`, `kds_snapshot`, `reservation_reminder`, `abc`, `hold_expiry`, `anomaly`, `retail_digest`, `shift_auto_close`, `subscription_grace`, `catalog_scheduler`.

`workerInfo(status, pollIntervalMs)` considers a worker "running" if `lastPollAgo < pollIntervalMs * 2.5`.

**`GET /api/admin/orphaned-schemas`** — reads from `public.infra_cache WHERE cache_key='orphaned_schemas'` (populated by `orphan-schema-scan-worker-boss`). Falls back to live `runScan()` only when cache missing or `?force=1`. Response header `X-Infra-Cache: hit|miss`. The live scan was historically slow (up to 104s in prod) — avoid forcing without reason.

**`POST /api/admin/orphaned-schemas/cleanup`** — live scan: compares `information_schema.schemata` LIKE `'tenant_%'` against known slugs, DROPs schemas not in registry. Logs dropped list to `admin_activity_log`.

**Backup:**
- `POST /api/admin/backup` — checks `pg_dump` availability, gathers all active tenant slugs, runs `backupAllSchemas()` from `utils/backup-pg.js`, uploads to R2 as `backups/full-backup-{timestamp}.dump`. Logs to `backup_log` table.
- `POST /api/admin/backup/verify` — requires `filePath` in body. Calls `listSchemasInBackup(filePath)`, compares against expected schemas (public + all active tenants).
- `GET /api/admin/backup-history` — reads `backup_log` last 20. Returns `[]` on error (no 500).

## Cross-Cutting Concerns

- **DB access pattern**: `db` (direct pool) for queries that set schema prefix like `tenant_{slug}.tablename`. `masterDb` for public-schema-only tables (`plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`, `impersonation_sessions`). `tenantDbManager.getDb(tenantId)` for tenant-scoped queries using the proxy pattern.
- **Most mutations** call `logAdminAction()`, but some do not — including tax/compliance mutations in `compliance.js`, `POST /api/admin/email-queue/:id/retry`, `PUT /api/admin/announcements/:id`, and `POST /api/admin/backup/verify`. Major lifecycle events also call `auditLog()`.
- **Frontend**: admin pages use `adminFetch()` (not `api.js`). Token stored in `adminAuthStore.js` (separate from tenant token).
- **Tenant slug safety**: any route doing `DROP SCHEMA` or dynamic SQL with the slug validates it against `/^[a-z0-9_]+$/` before use.
