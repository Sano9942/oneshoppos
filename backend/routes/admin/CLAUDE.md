# Admin Routes — Claude Guide

All routes here are under `/api/admin/*` and mount **before** tenant middleware — no `deps.db` tenant proxy, no `req.company`, no `req.employee`. Confirmed by reading every file: DB access is either the raw pool (`db`, imported from `../../db-pg`, schema-qualified for cross-tenant work) or `masterDb` (`../../master-db-pg`, public-schema tables) or `tenantDbManager.getDb(tenantId)` (a proxy scoped to one tenant's schema). Almost every route requires both `requireAllowedIp` and `requireSuperAdmin`. Exceptions: `POST /api/admin/auth/login` (password step — `requireAllowedIp` + `authLimiter` only), `POST /api/admin/auth/totp` (second 2FA step — verifies a short-lived `pending_token` instead of a real session), `POST /api/admin/auth/refresh` (reads the refresh cookie, not a Bearer token), and `GET /api/announcements/active` (fully public, no auth at all).

## index.js — Orchestrator

Builds one shared `deps` object and registers 8 domain modules in order: `auth.js`, `tenants.js`, `monitoring.js`, `billing.js`, `operations.js`, `compliance.js`, `messaging.js`, `system.js`. `deps` carries: `db`, `masterDb`, `jwt`, `jwtDefaults`, `tenantDbManager`, `requireAllowedIp`, `requireSuperAdmin`, `authLimiter`, `bcrypt`, `BCRYPT_ROUNDS`, `provision`, `PLAN_DEFAULTS`, `auditLog`, `logAdminAction`, `logSecurityEvent`. Calls `tenantDbManager.init(db)` before any route registers.

## helpers.js — Shared Utilities

- **IP allowlist**: `createRequireAllowedIp()` reads `ADMIN_ALLOWED_IPS` (comma-separated, CIDR supported, e.g. `/32` for a single host). Empty/unset env var = allow all (no-op middleware).
- **Auth middleware**: `createRequireSuperAdmin(verifyAccessToken)` verifies the Bearer token and requires `decoded.role === 'super_admin'`, then sets `req.admin = { id, email, sid }` (`sid` = the refresh session's `jti`, used to identify "current session" in the sessions UI). Expired token → 401 `code: 'TOKEN_EXPIRED'`.
- **Logging helpers** (`createLoggers(db, masterDb)`):
  - `auditLog(tenantId, action, details, actor)` → `tenant_audit_log` (public schema, via `masterDb`)
  - `logAdminAction(email, action, targetType, targetId, details, ip)` → `admin_activity_log` (via `db`); failures swallowed — never blocks the calling route
  - `logSecurityEvent(eventType, email, ip, userAgent, details)` → `admin_security_log`; failures swallowed

## auth.js — Login, 2FA, Sessions

Two-step login when 2FA is enrolled: `POST /api/admin/auth/login` checks email+bcrypt password against `super_admins`; if `totp_enabled_at` is set it returns `{ totp_required: true, pending_token }` (a 5-minute JWT scoped `admin_totp_pending` — accepted only by the `/totp` route, rejected everywhere else because `requireSuperAdmin` requires `role === 'super_admin'`) instead of a real session. `POST /api/admin/auth/totp` exchanges `{ pending_token, code }` (TOTP or a single-use recovery code) for a real session. Recovery codes are burned on use (array element removed from `super_admins.recovery_codes`, stored as bcrypt-style hashes).

Enrollment (all require an existing session via `requireSuperAdmin`): `POST /totp/setup` generates a secret + QR (persists the secret with `totp_enabled_at` still NULL — not live until verified), `POST /totp/verify` confirms the first code, sets `totp_enabled_at = NOW()`, and returns one-time plaintext recovery codes, `POST /totp/disable` requires a current code (TOTP or recovery) to turn 2FA off, `GET /totp/status` returns `{ enabled, enabled_at, recovery_codes_remaining }`.

Session model: access tokens are short-lived (`ADMIN_ACCESS_TTL`, default 1h) paired with a rotating refresh token (`ADMIN_REFRESH_TTL`, default 7d) stored **hashed** (SHA-256) in `public.admin_sessions`, set as an httpOnly cookie (`adminRefreshToken`, path-scoped to `/api/admin/auth`). `POST /api/admin/auth/refresh` rotates the token: on a valid unused refresh token it inserts a new session row and revokes the old one; presenting an **already-revoked** token (reuse — someone stole an old cookie) revokes the *entire* session family for that admin and forces full re-login. `POST /api/admin/auth/logout` revokes only the current session (`req.admin.sid`). `GET /api/admin/auth/sessions` lists this admin's live (non-revoked, non-expired) sessions; `POST /api/admin/auth/sessions/revoke-others` kills every session except the caller's.

Anomaly detection: `services/admin-login-alert.js` (`isNewLoginIp` / `alertNewLoginIp`) checks/records login IPs and fires a non-blocking alert email on a new IP, on both the password-only and TOTP success paths. Every login attempt (success, failure, TOTP challenge/success/failure, 2FA enable/disable) is logged to `admin_security_log`.

## tenants.js — Tenant Lifecycle

Owns tenant CRUD, stats, feature-usage/vertical-usage analytics, feature flags, modes, flag-drift + preset repair, notes, setup tokens, migrations, PIN reset, and a prefix-scoped "test fleet" bulk view/delete. Touches `tenants`, `tenant_audit_log`, `tenant_notes` (all public), plus per-tenant `feature_flags`, `tenant_modes`, `company_profile`, `action_history`, `employees`, `roles`, `role_permissions`, `schema_version`.

Highlights:
- `POST /api/admin/tenants` — validates slug (`^[a-z0-9_]{3,40}$`) and PIN (4-8 digits), calls `provision()`, applies `PLAN_DEFAULTS` limits for the chosen plan, records a `signup` lifecycle event (`services/lifecycle-events.js`). Returns `setup_url`.
- `GET /api/admin/tenants` — lists all non-deleted tenants; for each active one, fans out `MAX(action_history login)`, this-month revenue, `company_profile.setup_complete/industry_type`, and `tenant_modes` in parallel try/catches (a missing `tenant_modes` table on a pre-v31 schema doesn't wipe the rest of the enrichment).
- `DELETE /api/admin/tenants/:id` — soft-marks `status='deleted'` then hard `DROP SCHEMA IF EXISTS "tenant_{slug}" CASCADE`. Re-validates the slug against `/^[a-z0-9_]+$/` immediately before the DROP — never trust a value already in the DB for use in raw DDL.
- `GET/POST /api/admin/test-fleet*` — same-slug-prefix (default `golv_`) view + guarded bulk delete for throwaway test tenants. Bulk delete requires `confirm` to exactly equal the prefix, caps at 100 tenants, and re-validates each slug individually before dropping its schema (same pattern as the single-tenant DELETE).
- `POST /api/admin/tenants/:id/reapply-preset` and `GET /api/admin/tenants/:id/flag-drift` — repair tooling for feature-flag/mode drift against `services/preset-apply.js:expectedFlagsForPreset()`/`applyPreset()`. `flag-drift` computes `missing` (expected by the tenant's industry preset + outlet-count bundles, but OFF) and `extra` (ON but not expected and not a default-true platform flag — informational only, usually a legitimate manual opt-in).
- `GET/PUT /api/admin/tenants/:id/modes` — per-tenant `tenant_modes` CRUD against `config/mode-registry.js:VALID_MODES`; toggling a mode also cascades its registry-mapped feature flags (`getFeatureFlagsForModes`) and invalidates both the mode cache and feature-flag cache.
- `GET /api/admin/tenants/:id/stats` — ~14 queries fanned out in parallel against one tenant's schema (counts, revenue by period, last login/sale/shift, active employees 7d/30d, schema size via `pg_total_relation_size`). "Today" revenue is computed in the tenant's own `company_profile.timezone` (`(timestamp AT TIME ZONE $tz)::date = (NOW() AT TIME ZONE $tz)::date`) — never a bare `::date`, which would split the day at the wrong hour since `timestamp` is TIMESTAMPTZ and the DB session TZ is UTC on prod.
- `GET /api/admin/tenants/:id/vertical-usage` — per-mode adoption counts driven by `config/vertical-usage-sources.js:VERTICAL_USAGE_SOURCES`, one count query per domain table, each individually try/caught so a missing table on an older schema just omits that row instead of failing the whole response.
- `POST /api/admin/tenants/:id/migrate` and `POST /api/admin/migrate-all` — both call `migrate()`/`MIGRATIONS` from `migrate-pg.js`, the same function Railway's boot sequence uses. `migrate-all` always migrates public schema first, then all active tenants sequentially; per-tenant errors are caught so one bad tenant doesn't abort the batch.
- `POST /api/admin/tenants/:id/reset-pin` — finds the tenant's first employee with the `all_access` permission (joins `employees` → `roles` → `role_permissions`) and bcrypt-hashes a new PIN onto it. Defaults to `"0000"` if none supplied.

**Gotcha — `buildTenantScopedDb()`**: a local helper in this file that wraps the raw pool and issues `SET search_path TO {schema}, public` on every query/transaction. This is separate from the tenant DB proxy (`tenant-db-proxy-pg.js`) used by normal tenant routes — it exists purely so migrations can run DDL inside one tenant's schema from admin context.

## monitoring.js — Global Stats & Infra

- `GET /api/admin/stats` — tenant counts by status/plan + 5 most recent tenants + 10 most recent audit rows. Single-schema query, no fanout.
- `GET /api/admin/attention` — iterates every active tenant checking employee/product/outlet usage vs. plan limits (flags >85%), dormancy (no login ≥14 days), and incomplete setup. `dead_tenants` = setup-pending tenants created >7 days ago.
- `GET/POST /api/admin/cleanup-preview` / `cleanup-run` — thin wrappers around `cleanupDeadTenants()` from `jobs/cleanup-dead-tenants.js` (dry-run vs. live).
- `GET /api/admin/revenue-stats` — MRR from `plan_pricing` × active pro-plan tenant count, plus a live fanout summing `sales.total` (not `total_amount`) across all active tenant schemas for the current month.
- `GET /api/admin/infra` — the expensive one. Queries `pg_stat_activity`, `pg_settings`, `pg_database_size`, `pg_statio_user_tables` (cache hit ratio), `pg_stat_user_tables` (dead tuples), per-schema sizes, and optionally `pg_stat_statements` (try/catch — silently skipped if the extension isn't installed). Cached in a module-level variable (`_infraCache`) for 5 minutes; `?force=1` bypasses. Response carries `X-Infra-Cache: hit|miss`. Fires `alerting.recordDbPressure()` when active connections exceed 80% of `max_connections`.

## billing.js — Plan Pricing, Payments, Trial Lifecycle

Uses `masterDb` for everything here (`plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`), `tenantDbManager` only to look up a tenant's `company_profile.email` for notification emails. Every plan/lifecycle mutation calls `services/lifecycle-events.js:recordLifecycleEvent()` in addition to `auditLog`/`logAdminAction`.

- `POST /api/admin/tenants/bulk-lifecycle` — batch tool for managing trial fleets (e.g. the `golv_*` test tenants). `action: "extend_trial"` pushes `trial_ends_at` forward from `GREATEST(current trial end, now)` and resets `payment_status='trial'`/`grace_ends_at=NULL`; `action: "expire_now"` sets `payment_status='expired'` (`requireActiveSubscription` middleware then blocks writes on the tenant's next request — free-plan tenants stay usable by design since that middleware no-ops for them). Capped at 100 tenant IDs per call.
- `POST /api/admin/tenants/:id/record-payment` — computes period length from `cycle` (30 or 365 days) plus a fixed 7-day grace window, updates `tenants` (plan/cycle/expiry/grace/payment_status/limits) and inserts into `payment_records`, then fires a non-blocking `billing_payment_recorded` email.
- `GET /api/admin/payments` — paginated global payment history (`limit`/`offset`, max 200), joined to tenant slug/name.
- `GET /api/admin/billing-attention` — three tenant lists: due soon (expires within 7 days), overdue (past expiry, still in grace), past grace. Plus a count of pending upgrade requests.
- `GET /api/admin/payment-intents/stuck` — `payment_intents` stuck in `'pending'` longer than `?hours=` (default 2). Feeds `AdminStuckPayments.jsx`.
- `PUT /api/admin/upgrade-requests/:id` — approve/dismiss; approval also records a `plan_changed` lifecycle event.

## operations.js — Support Tickets, Impersonation, Dead Letters

**Support tickets** are cross-tenant fanout: iterate every active tenant via `tenantDbManager.getDb()`, query `support_tickets`, merge and re-sort by `created_at`. Tables missing on a given tenant are caught and skipped silently. The `/reply` route also inserts an in-app `notifications` row (type `support_reply`, link `/my-tickets`) — notification-insert failures are logged via `req.log?.error` (not swallowed) but never fail the reply itself.

**Impersonation**: `POST /api/admin/impersonate/:tenantId` finds the tenant's first `role_id=1` employee, signs a 1-hour JWT with `impersonating: true`, a `realIdentity` block, and a `jti`. The `jti` is what makes hard-revocation possible — `tenant-auth.js` checks incoming tokens against `revoked_tokens` by `jti`, so without it the token would stay valid for the full hour regardless of calling `/end`. Session tracked in `impersonation_sessions` (masterDb, columns include `token_jti`, `revoked_at`). `POST /api/admin/impersonate/:sessionId/end` inserts the `jti` into the tenant's `revoked_tokens` table (best-effort — logged, not fatal) and marks the session ended+revoked. `GET /api/admin/impersonation-sessions` lists recent/active sessions (`?active=1` filters to non-ended, non-revoked, within the 1h TTL) for audit + a revoke UI.

**Dead letters** — four independent fanout queues, all cross-tenant, all try/catch-per-tenant:
- `GET /api/admin/dead-letters` + `POST .../retry` — `shopify_webhook_events WHERE status IN ('dead_letter','failed')`.
- `GET /api/admin/dead-letters/aggregator` + `POST .../dismiss` — `external_sync_events WHERE status='dead_letter'` (V03 delivery-aggregator/foodpanda/Careem order injection). Deliberately no admin-side retry — dismiss just marks `'failed'` for the 30-day cleanup sweep to reap; re-injection must go through the webhook path with its idempotency key.
- `GET /api/admin/dead-letters/channel-sync` + `PUT .../:id` — `channel_sync_dead_letters WHERE status='open'` (V10 lodging OTA iCal conflicts); resolve/dismiss.
- `GET /api/admin/webhooks/payment-dead-letters` — reads the public-schema `payment_webhook_events` table directly (no fanout needed — cross-tenant by design), last 7 days.

## compliance.js — Tax Rates & FBR Health

`public.tax_rate_reference` is the shared HS-code/tax-rate table; CRUD here is straightforward. `tax_rate_suggestions` lives per-tenant (tenants can submit corrections) and is fanned out to build a review queue — approving a suggestion writes back into `public.tax_rate_reference`, but only for an allow-listed set of fields (`federal_gst`, `punjab_pra`, `sindh_srb`, `kpk_kpra`, `balochistan_bra`). Any route interpolating a tenant slug into a schema-qualified query (`tenant_${slug}.table`) validates it against `/^[a-z0-9_]{3,40}$/` first — this file builds those identifiers by string interpolation rather than parameterized queries, so the validation is load-bearing, not decorative.

`GET /api/admin/fbr-health` — fanout restricted to tenants with the `fbr_integration` feature flag on; returns pending/failed/posted counts, oldest pending timestamp, and average pending delay in seconds.

## messaging.js — Email Queue, Broadcast, Logs, Announcements

**Email queue reads `pgboss.job WHERE name='email'`** — not the legacy `public.email_queue` table, which nothing writes to anymore (pg-boss is the durable queue since `enqueueEmail()` was routed through tenant context). State mapping: `created/retry/active` → pending, `completed` → sent, `failed/cancelled` → failed. Job IDs are UUID strings. Retry resets state to `created` and clears `retry_count`/`output`/timestamps; send-now just brings `start_after` to `NOW()`. `DELETE /api/admin/email-queue/purge-deleted` **must stay registered before** the `:id` DELETE route, or Express will match `purge-deleted` as an `:id` param.

**Broadcast** (`POST /api/admin/email/broadcast`) iterates all active tenants, reads each `company_profile.email`, and calls `enqueueEmail()` per tenant. Logs a `broadcast_log` row (best-effort) and a `tenant_audit_log` entry with `tenant_id: null` (platform-wide action, not scoped to one tenant).

**Announcements**: supports optional audience targeting via `audience_plan`/`audience_industry` (comma-separated lists; NULL/empty/"all" = everyone). `PUT /api/admin/announcements/:id` only overwrites the audience columns when the key is **actually present** in the request body (`has("audience_plan")` check) — a partial PUT like `{ active: false }` must not silently wipe existing targeting; `ends_at` is set unconditionally (not COALESCE), so omitting it in a body that includes other fields will null it out. `GET /api/announcements/active` is the one fully public route in this directory; it feeds the tenant-side `AnnouncementBanner.jsx`. It accepts an optional `?tenant=<slug>` to resolve the caller's plan + industry (60s in-memory cache, `_audienceCache`) and filter targeted announcements accordingly — without a slug, only untargeted announcements are shown, since a targeted banner's applicability can't be confirmed pre-login.

**Cross-tenant activity** (`GET /api/admin/tenant-activity`) divides the requested `limit` across the number of active tenants before querying each one's `action_history`, then merges and re-sorts — so a large tenant count can make the per-tenant slice quite small.

## system.js — Workers, Feature Adoption, Schemas, Backup

`GET /api/admin/worker-status` reads in-memory heartbeat globals (`global.__<name>WorkerStatus`) for every background worker, but heartbeats are wiped on every Railway redeploy. To avoid a scary "all workers stopped" dashboard right after a deploy, it also queries `pgboss.job MAX(completed_on)` per known queue (the `PG_BOSS_QUEUES` map in this file, ~30 entries) and uses whichever timestamp — in-memory or DB — is newer; a worker is "running" if its last-poll time is within `pollIntervalMs * 2.5`. Real queue depth is likewise read from `pgboss.job COUNT(*) WHERE state IN ('created','retry','active')` rather than trusting the in-memory `queueDepth` field (which resets to 0 on redeploy). Workers without a pg-boss queue (`booking_reminder`, `catalog_scheduler`, `shopify_sync`, `report_schedule` — all `setInterval` pollers) are mapped to `null` and rely on the in-memory heartbeat alone. `marketplace_sync` is reported specially as always "manual" — there is no background auto-sync implemented for it, and the route says so explicitly rather than showing it as a stopped worker. The `global.__workerRegistry` boot-time map (from `boot/workers.js`) additionally drives an `alert` field per worker: `env_var_missing` (code gate exists, Railway env var never set), `register_failed`, or `enabled_but_stopped`.

`GET /api/admin/adoption` — feature-adoption matrix across all tenants, read from `public.infra_cache` (key `feature_adoption`, populated every 6h by `workers/adoption-snapshot-worker-boss.js`); `?force=1` runs `runSnapshot(db)` live (full cross-tenant fanout).

`GET /api/admin/orphaned-schemas` reads a cached snapshot from `public.infra_cache` (key `orphaned_schemas`, populated hourly by `workers/orphan-schema-scan-worker-boss.js`); `?force=1` triggers `runScan(db)` live, which was measured at up to ~104s in prod — avoid forcing without reason. `POST /api/admin/orphaned-schemas/cleanup` always does a live comparison of `information_schema.schemata` against the tenant registry and drops anything unmatched (no cache involved — this one always runs live since it's a mutating action).

`POST /api/admin/backup` shells out to `pg_dump` (checks availability first via `isPgDumpAvailable()`) across all active tenant schemas + public, uploads the resulting dump to R2, and logs to `backup_log`. `POST /api/admin/backup/verify` takes a `filePath`, lists the schemas actually present in that dump, and diffs against the expected schema set. `GET /api/admin/backup-history` returns `[]` on error rather than a 500 (backup history is non-critical dashboard chrome).

## Cross-Cutting Conventions

- **DB access pattern**: `db` (direct pool) is used with schema-qualified queries like `tenant_{slug}.tablename` for cross-tenant fanout or superadmin-scoped work. `masterDb` is for public-schema-only tables (`plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`, `impersonation_sessions`, `admin_sessions`, `super_admins`). `tenantDbManager.getDb(tenantId)` returns a proxy scoped to one tenant's schema — prefer this over raw `tenant_{slug}.` interpolation when you only need one tenant.
- **Cross-tenant fanout is the dominant pattern** here (support tickets, all four dead-letter queues, tax suggestions, FBR health, tenant activity, tenant list enrichment, attention dashboard) — always wrapped in a per-tenant try/catch so one tenant with a missing table or dropped schema doesn't break the whole response.
- **Not every mutation calls `logAdminAction()`** — notable gaps include the tax/compliance CRUD routes, `PUT /api/admin/announcements/:id`, and `POST /api/admin/backup/verify` (this one actually does log — re-check before assuming; verify per-route rather than trusting this list blindly). Don't assume audit coverage is complete.
- **Tenant slug safety**: anywhere a slug is interpolated into raw SQL (schema-qualified table names, `DROP SCHEMA`), it is re-validated against a safe regex immediately before use — never trust that a DB-stored slug is still safe by the time it reaches a query string.
- **Lifecycle events**: tenant creation, suspend/activate/delete, payment recording, upgrade approval, and bulk-lifecycle actions all call `services/lifecycle-events.js:recordLifecycleEvent()` in addition to the audit/action logs — check this file when tracing a tenant's full history rather than only `tenant_audit_log`.
- **Frontend**: admin pages call `adminFetch()`, not the tenant-side `api.js`. Token lives in `adminAuthStore.js`, entirely separate from tenant auth storage.
