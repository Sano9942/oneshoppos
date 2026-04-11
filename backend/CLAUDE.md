# Backend — Claude Guide

## DO NOT READ These Files

### Stale Directories (skip)
- `backups/`, `archive/legacy/`, `tenants/`, `exports/`, `uploads_test/`, `uploads_tmp/`

> **Note:** All SQLite infrastructure files (db.js, master-db.js, tenant-db-manager.js, etc.), 74 SQLite migration files (migrate1.js–migrate74.js), and one-off scripts (cleanup-public-schema.js, reset-production.js) were deleted in the Phase 5 audit cleanup (commit `3227600`). The codebase is Postgres-only. Schema source of truth: `schema-pg.sql`.

## Where to Look Instead

| Need | Read This |
|------|-----------|
| Database connection / queries | `db-pg.js` |
| Full table schema (DDL) | `schema-pg.sql` |
| Postgres migrations | `migrate-pg.js` |
| Multi-tenant DB routing | `tenant-db-proxy-pg.js` + `tenant-db-manager-pg.js` |
| Master tenant registry | `master-db-pg.js` |
| Tenant provisioning | `tenant-provisioner-pg.js` |
| Super-admin seeding | `seed-admin-pg.js` |
| JWT auth utilities | `jwt-auth.js` |
| OpenAPI/Swagger spec | `swagger.js` — `swagger-jsdoc` config; served at `/api-docs` via `swagger-ui-express` |
| Plan limit enforcement | `middleware/plan-limits.js` |
| Server entry + middleware | `index.js` |
| Route registration | `routes/registerAllRoutes.js` (orchestrator only — no route logic here) |
| Route logic for a domain | `routes/<domain>.js` (e.g., `routes/sales.js`, `routes/products.js`) |
| Super-admin + infra monitoring | `routes/admin/` (10 files: auth, tenants, monitoring, billing, operations, compliance, messaging, system, helpers, index) — infra, tax rates, FBR health, activity/security logs, revenue stats, worker status, orphaned schemas, tenant notes, announcements, broadcast log, support ticket replies, backup trigger |
| Report endpoints | `routes/reports/` (14 files, modular) |
| Shopify integration | `routes/shopify/` (9 files) + `shopify/` (3 files) |
| Integrations hub | `routes/integrations/` (hub, credentials, daraz, facebook, whatsapp, google-merchant) |
| Marketplace clients | `services/marketplace/` (base, daraz, meta-commerce, whatsapp, google-merchant) |
| Courier adapters | `services/couriers/` (13 adapters: leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex) |
| Generalized crypto | `services/crypto.js` — AES-256-GCM for all integration secrets |
| Tier4 features | `routes/tier4/` (7 files) |
| Timezone utilities | `utils/tz.js` |
| Receipt email builder | `utils/receiptEmail.js` |
| Postgres backup/restore | `utils/backup-pg.js` |
| Category tree logic | `category-tree.js` — includes `resolveInheritedField()` for tax/HS inheritance |
| Printer service | `services/printer.js` |
| Structured logging | `services/logger.js` (Pino) |
| Alert system | `services/alerting.js` (error spikes, DB pressure) |
| Request ID middleware | `middleware/request-id.js` (UUID + Pino per-request) |
| Alert emails | `utils/alertEmail.js` (Resend-based) |
| Support tickets | `routes/support.js` |
| Billing routes | `routes/billing.js` — status, pricing, checkout, payment history, upgrade requests |
| Payment gateway | `services/payment-gateway.js` — adapter (xPay impl, extensible to Stripe/JazzCash) |
| Payment webhooks | `routes/webhooks.js` — mounted before tenant middleware, no auth |
| Subscription enforcement | `middleware/plan-limits.js` — `requireActiveSubscription` + `requirePlanLimit` |
| Dead tenant cleanup | `jobs/cleanup-dead-tenants.js` (removes tenants with no setup after 7 days, inline via `CLEANUP_WORKER_ENABLED=1`) |
| FBR Digital Invoicing | `services/fbr.js` (API client + payload builders), `routes/fbr.js` (config/dashboard/retry), `routes/tax-lookup.js` (HS code search) |
| FBR background worker | `workers/fbr-worker.js` (legacy inline), `workers/fbr-worker-boss.js` (pg-boss backed) |
| pg-boss job queue | `services/boss.js` — shared pg-boss instance factory |
| Upload validation | `middleware/upload-validation.js` — centralized MIME + extension whitelist |
| Rate limiting | `middleware/rate-limit.js` — global, auth endpoint, webhook limiters |
| JWT auth + tenant resolution | `middleware/tenant-auth.js` — loadTenantAndPerms, resolveTenant, loadCompanyProfile, resolveContext |
| Permissions | `middleware/permissions.js` — requirePerm, requireAnyPerm, PERMISSION_RULES |
| Feature flags | `middleware/feature-flags.js` — requireFeature, flag cache, notification helpers |
| Input validation | `middleware/validate.js` + `schemas/` — Zod schemas for auth, billing, employees, products, sales, returns, customers, purchase-orders, inventory, orders, admin, integrations |
| Worker startup | `boot/workers.js` — all worker init (email, FBR, cleanup, Shopify, scheduled tasks) |
| Shopify crypto | `shopify/crypto.js` — secret encrypt/decrypt + event logging |
| Tax rate seed data | `scripts/seed-tax-rates.js` (one-time, ~96 HS codes with Urdu descriptions) |

## Efficiency Rules

- **Read only the specific route file needed** — never read the whole `routes/` directory. If adding a sales feature, read `routes/sales.js` only
- **Grep schema-pg.sql** — it's ~600 lines. Grep for the specific table name (`CREATE TABLE orders`) instead of reading the whole file
- **Don't read registerAllRoutes.js** — route mounting is documented in the root CLAUDE.md. Skip it for all domain-level tasks
- **Don't read index.js** — middleware order is documented in root CLAUDE.md. Only read it if the task is explicitly about server boot or middleware config
- **One reference route** — when adding a new route file, read ONE similar existing route as a pattern reference, not multiple
- **Grep before read** — use Grep to find the exact function/query/column before opening any file

## Database is Postgres

- All queries use `await db.query(sql, [params])` with `$1, $2` placeholders
- Results: `{ rows, rowCount }` — access data via `rows[0]`, `rows`, `rowCount`
- Transactions: `await db.transaction(async (client) => { ... })`
- Raw pool access: `db.pool`, dedicated client: `await db.getClient()`
- Booleans: use `true`/`false` (not `1`/`0`)
- Case-insensitive search: use `ILIKE` (not `LIKE`)
- Date extraction: use `col::date` (not `date(col)`)
- String aggregation: use `string_agg()` (not `GROUP_CONCAT`)
- JSON aggregation: use `json_agg(json_build_object(...))` (not `json_group_array`)
- ROUND requires numeric cast: `ROUND(expr::numeric, 2)`
- All non-aggregated SELECT columns MUST appear in GROUP BY

## Test Suites

### Postgres Integration Tests (64 files — primary) + unit tests
- Location: `tests/integration/` (64 files): 19 pg-batch files (16 numbered + 3 phase batches), 37 full-audit domain tests, 7 pg-standalone, 1 legacy smoke-gate
- Unit tests: `tests/unit/` (10 files — middleware, services, tz, utils + routes-admin-worker-status, routes-orders-transactions, services-booking-reminders, services-catalog-scheduler, workers-email-worker-boss, workers-tenant-job-context)
- Unit test runner: `vitest` with `@vitest/coverage-v8` (see `vitest.config.js`)
- Factory: `tests/helpers/createTestApp-pg.js` (isolated schema per test)
- Schema: `tests/helpers/seedSchema-pg.js`
- Run: `npx jest tests/integration/pg-batch1-crud.test.js` (requires `DATABASE_URL`)

### Production E2E Tests (24 specs, ~290 tests — full system audit)
- Location: `frontend/tests/*.spec.js` (24 self-contained Playwright specs)
- Config: `frontend/playwright.config.js` (single config, production target)
- Target: `https://sanopos.com` (tenant `packagesmall`)
- Run: `cd frontend && npx playwright test tests/auth.spec.js`
- Global setup: `global-setup.js` logs in once, saves `auth.json` + `token.json`
- Helpers: `helpers/auth.js` (credentials), `helpers/api.js` (REST), `helpers/nav.js` (navigation)
- Includes 3 onboarding specs (`onboard-free`, `onboard-starter`, `onboard-pro`) — create real test tenants, delete from `/admin` after each run
- **Key gotcha**: clock-in uses `/api/attendance/pin-checkin?tenant=${slug}` (NOT `/clock-in`) — writes `attendance_sessions` which POS checkout validates

### Legacy (do not use)
- SQLite tests (`tests/integration/*.test.js`) — do not modify or run unless explicitly asked

## Common Gotchas

### Timezone architecture
- All business-critical timestamps (`sales`, `returns`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`) stored as **UTC** via `CURRENT_TIMESTAMP`
- `attendance_sessions` and `employee_attendance` store **local time** — intentional, do NOT change their write paths
- `utils/tz.js` provides `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` — converts local `YYYY-MM-DD` to UTC boundary strings
- `req.company.timezone` (IANA string) set by `loadCompanyProfile` middleware — use it in all date filter queries
- **CRITICAL**: `session_start` and `check_in` are already local — use `date(col)` with NO modifier. `date(col,'localtime')` double-converts and breaks UTC+ timezones

### Auth on GET routes (Apr 1 2026)
- **ALL data-returning GET endpoints now require auth** — `requirePerm` or `requireAnyPerm` on every GET across sales, returns, customers, products, POs, GRN, inventory, employees
- Permission mapping: sales/returns/customers → `view_reports`, products → `view_reports`+`manage_inventory`, POs/GRN → `manage_orders`+`view_reports`, transfers/adjustments → `manage_inventory`+`view_reports`, employees → `all_access`
- When adding new GET routes, **always add auth middleware** — no unprotected data endpoints

### Stock check — FOR UPDATE (Apr 1 2026)
- `POST /api/sales` stock validation runs INSIDE `db.transaction()` with `SELECT ... FOR UPDATE` row locks
- Prevents TOCTOU race condition (two concurrent sales overselling)
- If stock insufficient, throws with `statusCode: 400` — caught by outer try/catch
- Void handler restores both `outlet_stock` AND `product_variants.stock`

### Sales table schema
- The sale timestamp column is named `timestamp`, NOT `created_at` — using `created_at` silently returns undefined

### reports_accuracy.test.js
- Uses Jest syntax (`describe`, `beforeEach`, `afterEach`) — run with `npx jest`

### PO credit limit
- `POST /api/purchase-orders` warns (but allows) when credit supplier exceeds `credit_limit` — response includes `{ warning: "..." }`
- `running_balance` counts only invoiced/received POs, not draft POs

### Postgres-Specific Gotchas
- **Boolean columns are strict**: `is_active`, `is_primary`, `is_default`, `voided`, `show_barcode`, `show_logo` — MUST use `= true`/`= false`, never `= 1`/`= 0`
- **NUMERIC returns strings**: Always wrap with `Number()` before arithmetic (e.g. gift card `remaining_value`)
- **Reserved words**: `read` → `is_read` (in notifications table)
- **HAVING clause**: Postgres does not allow column aliases in HAVING — must repeat the full expression
- **FK constraints on bulk delete**: Must explicitly delete from referencing tables before deleting from parent tables

### Infrastructure Monitoring Endpoint
- `GET /api/admin/infra` — gated by `requireAllowedIp` + `requireSuperAdmin`
- Queries: `pg_stat_activity` (connections), `pg_database_size` (DB size), `pg_statio_user_tables` (cache hit ratio), `pg_stat_user_tables` (dead tuples/vacuum), schema sizes, active slow queries (>1s)
- Optional: `pg_stat_statements` (historical slow queries) — try/catch, skipped if extension unavailable

### Boot Guard (index.js)
- `index.js` is now Postgres-only (~230-line orchestrator). SQLite fallback removed.
- `require("dotenv").config(...)` must remain line 1 so `DATABASE_URL` is set before any require

### Worker Heartbeat Pattern
- Email, FBR, cleanup, and marketplace sync workers expose `global.__emailWorkerStatus`, `__fbrWorkerStatus`, `__cleanupWorkerStatus`, `__marketplaceSyncWorkerStatus`
- Each object: `{ lastPollAt, processedToday, queueDepth }`
- `queueDepth` is now a real `SELECT COUNT(*)` from the queue table — no longer always 0
- `GET /api/admin/worker-status` reads these globals to determine running/stopped state
- Workers are pg-boss backed — jobs survive server crashes and don't block the HTTP event loop

## Common Patterns (checklists — don't re-research these)

### Adding a new API route
1. Create route handler in `routes/<domain>.js`
2. Add Zod schema in `schemas/<domain>.js` (if validating request body)
3. Register in `routes/registerAllRoutes.js` — one `app.use('/api/<prefix>', require('./routes/<domain>')(deps))` line
4. Add permission string to `middleware/permissions.js` if introducing a new permission
5. Add permission rule to `middleware/permissions.js` PERMISSION_RULES array if needed
6. Update `DOMAIN-MAP.md` with the new domain entry

### Adding a new feature-flagged route
1. Follow "Adding a new API route" steps 1–6
2. Add `requireFeature('<flag_name>')` middleware to the route
3. Add the flag key to `middleware/feature-flags.js` DEFAULT_FEATURE_FLAGS if new
4. Seed the flag in `schema-pg.sql` DEFAULT_FEATURE_FLAGS and in migration
5. Frontend: check flag via `useFeatureFlags()` hook and redirect if off

### Adding a new admin route
1. Create module in `routes/admin/<module>.js`
2. Register in `routes/admin/index.js` (or registerAllRoutes.js admin section)
3. Guard with `requireSuperAdmin` — these mount BEFORE tenant middleware
4. Log mutations to `admin_activity_log` via `logAdminActivity()`

### Adding a new worker
1. Create worker in `workers/<name>-worker-boss.js` (use pg-boss pattern)
2. Register startup in `boot/workers.js`
3. Add env var toggle: `<NAME>_WORKER_ENABLED=1`
4. Expose heartbeat global: `global.__<name>WorkerStatus`
5. Add to `GET /api/admin/worker-status` in `routes/admin/monitoring.js`

## Middleware Chain (request lifecycle order)

```
1. requestId            — UUID per request (X-Request-Id header)
2. rateLimiter          — global rate limit (600/min default)
3. Sentry requestHandler — error tracking context

--- admin routes (routes/admin/) mount here — NO tenant context ---
--- webhook routes (routes/webhooks.js) mount here — NO auth, signature-verified ---

4. loadTenantAndPerms   — decode JWT, look up tenant, attach req.employee + req.permissions
5. resolveTenant        — SET search_path to tenant schema, attach deps.db proxy
6. tenant /uploads      — serve tenant-specific uploaded files
7. loadCompanyProfile   — cache company_profile row → req.company (currency, timezone, FBR config)
8. resolveContext       — attach req.context (outlet, employee context from headers)

--- all tenant routes mount here ---

9. requirePerm / requireAnyPerm  — per-route permission check
10. requireFeature               — per-route feature flag check
11. validate(schema)             — per-route Zod request body validation
12. requirePlanLimit(resource)    — per-route plan cap check (POST only)
13. requireActiveSubscription    — blocks all writes if payment_status = 'expired'
```

## Feature Flags Registry

| Flag | Routes | Frontend |
|------|--------|----------|
| `fbr_integration` | `routes/fbr.js` | FBRSettingsRedesign, FBRDashboardRedesign |
| `ai_insights` | `routes/insights-ai.js` | AIChatPanel (dashboard) |
| `accounting_core` | `routes/tier4/accounting.js` | ChartOfAccounts, JournalEntries, CreditDebitNotes, PostdatedCheques |
| `backup_restore` | backup endpoints | BackupRestoreRedesign |
| `supplier_payables` | `routes/grn.js` | SupplierPayablesRedesign |
| `approvals` | `routes/tier4/approvals.js` | ApprovalsRedesign |
| `notifications` | `routes/tier4/notifications.js` | NotificationsRedesign |
| `crm_quotations` | `routes/tier4/crm.js` | CRMRedesign, QuotationsRedesign |
| `advanced_hr` | `routes/tier4/hr.js` | HRManagementRedesign |
| `multi_company` | (future) | — |
| `e_invoicing_export` | `routes/reports/fbr-export.js` | FBRExportTab |
| `reports_profit_layer` | `routes/reports/sales.js`, `analytics.js` | ReportsSalesDetail |
| `reports_inventory_health_plus` | `routes/reports/inventory.js` | ReportsInventoryHealth |
| `reports_exceptions` | `routes/reports/analytics.js` | ReportsAnalytics |
| `reports_scheduled_exports` | `routes/reports/governance.js` | ReportsGovernance |
| `marketplace_integrations` | `routes/integrations/*` | IntegrationsHubRedesign |
| `phase2_draft_orders` | `routes/draft-orders.js` | (feature-gated in POS) |
| `phase2_pos_approvals` | `routes/approval-policies.js` | POSApprovalModal |
| `phase2_smart_collections` | `routes/smart-collections.js` | SmartCollectionsRedesign |
| `phase2_commissions` | `routes/commissions.js` | CommissionPlansRedesign, ReportsCommissions |
| `phase2_item_suggestions` | `routes/item-suggestions.js` | (POS affinity suggestions) |
| `phase2_outlet_pricing` | `routes/price-list-assignments.js` | PriceListsRedesign |
| `phase2_outlet_tax` | `routes/outlet-tax-profiles.js` | OutletTaxProfilesRedesign |
| `phase2_outlet_visibility` | `routes/outlet-visibility.js` | (per-product visibility) |
| `phase2_pos_layouts` | `routes/pos-layouts.js` | POSLayoutsRedesign |
| `phase2_report_builder` | `routes/report-builder.js` | ReportBuilderRedesign |
| `phase2_returns_policy` | `routes/return-policies.js` | ReturnPoliciesRedesign |
| `phase2_scheduled_changes` | `routes/scheduled-changes.js` | ScheduledChangesRedesign |
| `phase2_scheduling` | `routes/schedules.js` | SchedulingRedesign |
| `phase3_subscription_billing` | `routes/subscriptions.js` | SubscriptionsRedesign |
| `phase4_restaurant` | `routes/restaurant.js` | RestaurantFloorRedesign, RestaurantChecksRedesign |
| `phase4_restaurant_kds` | `routes/kds.js` | KDSRedesign |
| `phase4_restaurant_qr` | `routes/public-restaurant.js` | (QR menu) |
| `phase4_restaurant_preauth` | `routes/restaurant.js` | (card preauth tabs) |
| `phase4_appointments` | `routes/bookings.js` | AppointmentsRedesign, AppointmentsCalendarRedesign, AppointmentServicesRedesign |
| `phase4_appointments_waitlists` | `routes/bookings.js` | (waitlists) |
| `phase4_appointments_classes` | `routes/bookings.js` | (class sessions) |
| `phase4_google_calendar_sync` | `routes/bookings.js` | (Google Calendar sync) |
| `phase4_service_projects` | `routes/projects.js` | ProjectsRedesign |
| `phase4_service_contracts` | `routes/contracts.js` | ContractsRedesign |
| `phase4_contract_ai` | `routes/contracts.js` | (AI contract analysis) |
| `phase5_shipping_automation` | `routes/fulfillment.js` | FulfillmentRedesign |
| `phase5_cod_reconciliation` | `routes/fulfillment.js` | CODSettlementsRedesign |
| `phase5_payment_gateways` | `routes/webhooks.js` | (multi-gateway) |
| `phase5_sms_providers` | `services/sms.js` | (SMS adapters) |
| `customer_invoicing` | `routes/customer-invoices.js` | CustomerInvoicesRedesign |
| `customer_messaging` | `routes/messaging.js` | MessagingInboxRedesign |
| `marketing_campaigns` | `routes/marketing.js` | MarketingCampaignsRedesign |
| `payment_links` | `routes/customer-invoices.js` | (payment link on invoices) |
| `subscription_billing` | `routes/subscriptions.js` | SubscriptionsRedesign |
| `subscription_autocharge` | `routes/subscriptions.js` | (auto-charge renewals) |
| `sms_campaigns` | `routes/marketing.js` | (SMS campaign sends) |
| `context_selection_required` | context middleware | ContextSelect page |
| `context_header_enforced` | context middleware | — |
| `kiosk_context_locked` | kiosk context | KioskRedesign |
| `ui_redesign_enabled` | — | Global redesign toggle |
| `ui_redesign_inventory` | — | Inventory page redesign |
| `ui_redesign_orders` | — | Orders page redesign |
| `ui_redesign_pos` | — | POS page redesign |
| `ui_redesign_reports` | — | Reports page redesign |
| `ui_redesign_admin` | — | Admin page redesign |
| `ui_redesign_customers` | — | Customers page redesign |
| `ui_redesign_sales_history` | — | Sales History page redesign |
| `ui_redesign_cash_management` | — | Cash Management page redesign |
| `ui_redesign_returns` | — | Returns page redesign |
| `ui_redesign_categories` | — | Categories page redesign |
| `ui_redesign_brands` | — | Brands page redesign |
| `ui_redesign_taxes` | — | Taxes page redesign |
| `ui_redesign_attribute_sets` | — | Attribute Sets page redesign |
| `ui_redesign_stock_adjustments` | — | Stock Adjustments page redesign |
| `ui_redesign_transfers` | — | Transfers page redesign |
| `ui_redesign_returned_stock` | — | Returned Stock page redesign |
| `ui_redesign_suppliers` | — | Suppliers page redesign |
| `ui_redesign_purchase_orders` | — | Purchase Orders page redesign |
| `ui_redesign_supplier_payables` | — | Supplier Payables page redesign |
| `ui_redesign_promotions` | — | Promotions page redesign |
| `ui_redesign_expenses` | — | Expenses page redesign |
| `reports_enhanced_filters` | `routes/reports/*` | Enhanced report filter UI |

> **Notes**: `fbr_integration` is DB-seeded in `migrate-pg.js` v9 + `schema-pg.sql`, not in `DEFAULT_FEATURE_FLAGS`. `ai_insights` is a soft DB check in `routes/insights-ai.js`, not enforced via `requireFeature()`. The `shopify_integration` flag was removed — Shopify routes are gated by the connection check in `routes/shopify/*`, not a feature flag.

### Plan Limits

| Plan | Outlets | Employees | Products |
|------|---------|-----------|----------|
| Free | 1 | 3 | 100 |
| Pro | unlimited | unlimited | unlimited |

- Enforced by `requirePlanLimit(resource)` on POST routes
- `requireActiveSubscription()` blocks all writes when `payment_status = 'expired'`
- Trial: 45 days → Grace: 7 days → Expired (read-only)

## Environment Variables

### Core
- `DATABASE_URL` — Postgres connection string (required)
- `JWT_SECRET` — JWT signing key (required)
- `JWT_REFRESH_SECRET` — Refresh token signing key (required)
- `JWT_EXPIRES_IN` — Access token TTL (default: "24h")
- `JWT_REFRESH_EXPIRES_IN` — Refresh token TTL (default: "7d")
- `PORT` — HTTP listen port (default: 5000, Railway overrides to 8080)
- `NODE_ENV` — "development" or "production"
- `CORS_ORIGIN` — Allowed origins CSV
- `MULTI_TENANT` — "1" enables multi-tenant mode
- `SELF_SERVICE_SIGNUP` — "1" enables public signup
- `DATA_DIR` — Local data directory (default: backend/)
- `LOG_LEVEL` — Pino log level (default: "info")
- `FRONTEND_URL` — Frontend base URL for email links
- `APP_PUBLIC_BASE_URL` — Shopify health check base URL

### Email
- `RESEND_API_KEY` — Resend API key for system emails
- `RESEND_FROM_EMAIL` — Sender address (default: "SanoPOS <noreply@sanopos.com>")
- `EMAIL_WORKER_ENABLED` — "1" enables email queue processing

### Monitoring
- `SENTRY_DSN` — Sentry error tracking
- `ALERT_EMAIL` — Receives error spike / DB pressure alerts
- `API_DOCS_KEY` — Auth key for /api-docs endpoint

### Workers
- `FBR_WORKER_ENABLED` — "1" enables FBR invoice worker
- `FBR_WORKER_PORT` — FBR worker HTTP port (default: 8081)
- `CLEANUP_WORKER_ENABLED` — "1" enables dead tenant cleanup (24h cycle)
- `SHOPIFY_SYNC_WORKER_DISABLED` — "1" disables Shopify sync polling
- `REPORT_SCHEDULE_WORKER_DISABLED` — "1" disables scheduled report generation
- `REPORT_RUNS_RETENTION_DAYS` — Days to keep old report runs (default: 45)
- `REPORT_DELIVERY_RETENTION_DAYS` — Days to keep deliveries (default: 60)
- `REPORT_EXPORT_FILES_RETENTION_DAYS` — Days to keep export files (default: 30)
- `MARKETPLACE_SYNC_WORKER_ENABLED` — "1" enables marketplace sync worker
- `RESERVATION_WORKER_ENABLED` — "1" enables inventory reservation expiry worker (5-min cron)
- `BOOKING_REMINDER_WORKER_ENABLED` — "1" enables appointment reminder worker (Phase 4)
- `SCHEDULED_CATALOG_WORKER_ENABLED` — "1" enables scheduled catalog changes worker (Phase 2)

### Payments
- `PAYMENT_GATEWAY` — Active processor: "manual" (default), "xpay", "stripe"
- `XPAY_API_KEY` — xPay merchant API key
- `XPAY_WEBHOOK_SECRET` — xPay HMAC verification secret

### AI
- `ANTHROPIC_API_KEY` — Claude API key for AI insights

### Cloud Storage (R2)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_URL`

### Shopify
- `SHOPIFY_SECRET_KEY` — Webhook signature verification
- `SHOPIFY_MAX_RETRY_ATTEMPTS` — Inventory sync retries (default: 5)

### Integrations
- `INTEGRATION_SECRET_KEY` — AES-256-GCM key for integration credential encryption (falls back to SHOPIFY_SECRET_KEY)
- `META_WEBHOOK_VERIFY_TOKEN` — Meta/Facebook webhook verification token
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — WhatsApp webhook verification token

### Rate Limiting
- `RATE_LIMIT_WINDOW_MS` — Sliding window (default: 60000ms)
- `RATE_LIMIT_GLOBAL_MAX` — Global limit (default: 600/window)
- `RATE_LIMIT_AUTH_MAX` — Auth endpoint limit (default: 20/window)
- `RATE_LIMIT_WEBHOOK_MAX` — Webhook limit (default: 120/window)

### Admin
- `ADMIN_ALLOWED_IPS` — Comma-separated IPs for /api/admin (empty = all blocked in prod)

## Error Conventions

- **Success**: `res.json({ ... })` or `res.status(201).json({ ... })`
- **Client error**: `res.status(4xx).json({ error: "Human-readable message" })`
- **Validation error**: `validate(schema)` middleware returns `400` with `{ error: "...", details: [...] }` automatically
- **Auth failures**: `401` (no/expired token), `403` (insufficient permissions or feature not enabled)
- **Not found**: `res.status(404).json({ error: "X not found" })`
- **Never throw raw strings** — always `{ error: string }`
- **Transaction errors**: Use `try/catch` inside `db.transaction()`, re-throw with statusCode for custom HTTP codes

## Production Environment

- **Database**: Supabase Postgres (production is Postgres-only)
- **Mode**: `MULTI_TENANT=1` on Railway, `VITE_MULTI_TENANT=1` on Vercel
- **Boot**: `index.js` line 5 loads `db-pg` (Postgres)
- **Frontend**: Vercel at `sanopos.com` (custom domain; `sanopos.vercel.app` fallback still active)
- **Backend**: Railway at `api.sanopos.com` (custom domain; `oneshoppos-production.up.railway.app` fallback still active)
- **Railway env vars**: `MULTI_TENANT=1`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN=https://sanopos.com,https://www.sanopos.com,https://sanopos.vercel.app`, `TZ=Asia/Karachi`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL=SanoPOS <noreply@sanopos.com>`, `SENTRY_DSN`, `ALERT_EMAIL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `FBR_WORKER_ENABLED=1`, `EMAIL_WORKER_ENABLED=1`, `CLEANUP_WORKER_ENABLED=1`
- **Payment gateway env vars** (optional, set when xPay account ready): `PAYMENT_GATEWAY=xpay`, `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET`. Without these, system uses manual admin payments only.
- **Railway gotchas**: `PORT` env var is overridden by Railway (binds to 8080); this is fine
- To seed super-admin: `railway run node backend/seed-admin-pg.js --email <email> --password <password> --name <name>`
- To provision tenant: use super-admin dashboard at `/admin` or `railway run node backend/tenant-provisioner-pg.js --slug <slug> --name <name> --pin <pin>`
