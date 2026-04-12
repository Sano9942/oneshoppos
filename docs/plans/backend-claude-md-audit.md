# Backend CLAUDE.md Deep Audit Plan

**Goal**: For each backend folder, read every line of every JS file, then update the CLAUDE.md to fix
wrong claims and add missing information.

**Why**: The middleware/ audit revealed the docs cover ~30-40% of what the code actually does.
Wrong export counts, missing security behavior, hidden helpers, undocumented gotchas. Every folder
likely has the same gaps.

**Protocol per session**:
1. You say "Let's do folder X"
2. Read every JS file in that folder line by line
3. Read the current CLAUDE.md
4. Report: ✅ correct · ❌ wrong/misleading · 🔍 missing
5. Confirm with you before writing
6. Update the CLAUDE.md
7. Mark done below

**What to look for** (based on middleware/ findings):
- Wrong counts ("exports 5" when it's 6)
- Missing exports — functions that exist but aren't documented
- Security-relevant behavior — error codes, token checks, scope restrictions
- Gotchas — async patterns, silent failures, best-effort fallbacks
- Hidden helpers — things living in unexpected files
- Undocumented env vars and configuration knobs

---

## Group 1 — Small, self-contained (1–3 files each)

| # | Folder | Approx Files | Status |
|---|--------|-------------|--------|
| 1 | `backend/types/` | 3 TS declaration files | [x] |
| 2 | `backend/boot/` | 1 file — workers.js | [x] |
| 3 | `backend/jobs/` | 1 file — cleanup-dead-tenants.js | [x] |
| 4 | `backend/scripts/` | ~4 one-off scripts | [x] |
| 5 | `backend/shopify/` | ~3 files (crypto, events, utils) | [x] |
| 6 | `backend/utils/` | ~7 files (tz, r2, receiptEmail, etc.) | [x] |

---

## Group 2 — Medium complexity (4–10 files each)

| # | Folder | Approx Files | Status |
|---|--------|-------------|--------|
| 7 | `backend/schemas/` | 23 Zod schema files | [x] |
| 8 | `backend/workers/` | 8 worker files | [x] |
| 9 | `backend/services/couriers/` | base + 13 adapters | [x] |
| 10 | `backend/services/marketplace/` | base + 4 clients | [x] |
| 11 | `backend/tests/helpers/` | 4 helper files | [x] |
| 12 | `backend/tests/unit/` | 10 unit test files | [x] |

---

## Group 3 — Large (10+ files, read carefully)

| # | Folder | Approx Files | Notes |Status |
|---|--------|-------------|-------|--------|
| 13 | `backend/tests/integration/` | 64 test files | Read index + key files, not all 64 | [x] |
| 14 | `backend/routes/admin/` | 10 files | [x] | [x] |
| 15 | `backend/routes/reports/` | 14 files | [x] | [x] |
| 16 | `backend/routes/shopify/` | 9 files | [x] | [x] |
| 17 | `backend/routes/tier4/` | 7 files | [x] | [x] |
| 18 | `backend/routes/integrations/` | 7 files | [x] | [x] |
| 19 | `backend/services/` | 31 service files | Biggest folder | [x] |
| 20 | `backend/routes/` | ~28 domain route files | Top-level CLAUDE.md | [x] |

---

## Group 4 — Backend root JS files + master CLAUDE.md

Read every root-level JS file in `backend/` (13 files), update `backend/CLAUDE.md` "Where to Look Instead" table with accurate exports/gotchas, then do the master file pass.

**Files to read** (skip `jest.config.js` 4 lines and `vitest.config.js` 31 lines — already covered in Test Suites section):

| # | File | Lines | Current doc coverage | Status |
|---|------|-------|---------------------|--------|
| 21 | `backend/index.js` | ~293 | Middleware chain documented in root CLAUDE.md — but never verified against actual code | [x] |
| 22 | `backend/db-pg.js` | 67 | Just a pointer — no pool size, no exports documented | [x] |
| 23 | `backend/jwt-auth.js` | 87 | "JWT sign/verify utilities" — no export names | [x] |
| 24 | `backend/category-tree.js` | 223 | "includes resolveInheritedField()" — no full exports list | [x] |
| 25 | `backend/tenant-db-proxy-pg.js` | 50 | "primary" — no exports documented | [x] |
| 26 | `backend/tenant-db-manager-pg.js` | 123 | Bundled one-liner with proxy/pg — no distinction | [x] |
| 27 | `backend/tenant-db-pg.js` | 69 | "older ALS-based proxy" — no gotchas | [x] |
| 28 | `backend/tenant-multer.js` | 77 | 3 factory names — no storage paths or limits | [x] |
| 29 | `backend/tenant-provisioner-pg.js` | 197 | CLI command only — no exports or provisioning steps | [x] |
| 30 | `backend/master-db-pg.js` | 222 | "Master tenant registry" — no exports, no table list | [x] |
| 31 | `backend/migrate-pg.js` | 2893 | Pointer only — no CLI flags, no tenant migration gotcha (skip migration SQL bodies, focus on runner logic) | [x] |
| 32 | `backend/seed-admin-pg.js` | 68 | CLI command only — no flags or behavior | [x] |
| 33 | `backend/swagger.js` | 104 | "swagger-jsdoc config" — no route coverage or auth documented | [x] |

**Protocol**: Read each file, update `backend/CLAUDE.md` "Where to Look Instead" inline as we go. No separate pass needed — changes land immediately.

---

## Progress Log

Update this section as each folder is completed.

| Date | Folder | Key findings |
|------|--------|-------------|
| 2026-04-12 | `backend/middleware/` | Wrong export count (5→6), missing token revocation, missing invalidateFeatureFlagCache, notification helpers in wrong file, async gotcha in requireActiveSubscription, POS burst paths unnamed |
| 2026-04-12 | `backend/types/` | Missing Employee fields (joining_date, department), missing Tenant fields (schema_name, created_at), missing TenantPlan.features[] |
| 2026-04-12 | `backend/boot/` | Misleading pg-boss note (they ARE wired in startAll), missing opt-in vs opt-out toggle distinction, missing SQLite backup worker, missing report artifact retention env vars |
| 2026-04-12 | `backend/jobs/` | Added audit log column gotcha (actor not performed_by) |
| 2026-04-12 | `backend/scripts/` | Wrong conflict strategy: ON CONFLICT DO UPDATE → DO NOTHING (different semantics) |
| 2026-04-12 | `backend/shopify/` | Added SKU leading-zero gotcha, stock policy separate-transaction note, PKR default currency, future skew tolerance on webhook timestamp |
| 2026-04-12 | `backend/utils/` | Added deleteFromR2 no-op gotcha, restoreSchema exit-code-1 behavior, MAX_BACKUP_SIZE not enforced, show_barcode unused in receiptEmail, alertEmail vs resendEmail throw-vs-silent distinction clarified |
| 2026-04-12 | `backend/schemas/` | Added VoidSaleSchema, MarkCompleteSchema, CHANGE_TYPES + DB-CHECK-sync gotcha, superRefine note, batch invoice schema, all Wave-16 enums and sub-schemas (commissions rules, restaurant shapes/split-types/course/tab, smart-collection field/operator enums, contract status+sign, customer-invoice batch+reminder+payment-type, subscriptions auto_charge, marketing scheduleCampaign, messaging enums, project/milestone status enums, bookings public vs internal schema distinction) |
| 2026-04-12 | `backend/workers/` | Fixed: FBR worker does NOT use withTenantContext (raw schema interpolation). Fixed lifecycle check is 7 steps not described. Added: marketplace worker is a stub (no actual API calls), singletonKey deduplication on schedules, campaign-email at-least-once delivery gotcha, tenant-job-context slug regex rejects hyphens, db proxy missing .pool/.getClient(), FBR standalone health endpoint + SIGTERM drain, legacy worker deduplication difference, FBR exponential vs fixed backoff difference |
| 2026-04-12 | `backend/services/couriers/` | Added full auth-pattern table per adapter, cancel support matrix, config_json extra fields (TCS cost_center, PostEx address codes, DHL/FedEx account_number), COD service-type string per adapter, api_base_url override support, bykea/pakpost 501 throw pattern + ghost-row prevention rationale, DHL/FedEx no-token-caching gotcha, Trax sonic.pk URL note, PakPost tracking_url field |
| 2026-04-12 | `backend/services/marketplace/` | Fixed: WhatsApp is not a marketplace (no-op base methods), error handling does NOT log to external_sync_events. Added: config_json required fields per client, Daraz N+1 order-fetch pattern, Meta FB_PROCESSING-only state filter + cents-to-dollars normalization + source detection, WhatsApp extra send methods (sendTemplate/sendTextMessage/sendOrderConfirmation/sendTrackingUpdate), GoogleMerchant.checkFeedStatus() + pushInventory-as-upsert + pullOrders always empty, hardcoded PK/PKR/en in GMC, Graph API v19.0 hardcoded, Daraz Lazada Open Platform signature scheme |
| 2026-04-12 | `backend/tests/helpers/` | Plan said 4 files — actually 5 (vitest-setup.js). Fixed return shape (runtimeState + schemaName missing). Added: seeded fixture table (employees/products/outlets/customer/flags), seed:false option, getClient no-op release gotcha, runtimeState restore-lock usage, upload dir is uploads_test not uploads, DEFAULT_FEATURE_FLAGS + PERMISSION_RULES also exported, vitest Decision-II-trap note, globalTeardown test_% pattern |
| 2026-04-12 | `backend/tests/unit/` | middleware.test.js covers 8 modules not 3 (added requirePlanLimit/requireActiveSubscription/requireFeature/imageFileFilter/safeExtension/ALLOWED_IMAGE_MIMES). services.test.js covers 4 modules not 1 (added payment-gateway/fbr/email). utils.test.js covers 3 modules not 1 (added receiptEmail/digestEmail). Added: BACKOFF_DELAYS exported const, TEMPLATES 15-key list, worker-status response shape (last_poll_ago_seconds/processed_today/queue_depth), booking-reminders SMS pre-existing bug (skips send but marks sent), catalog-scheduler non-throwing contract + allowlist security note, CJS require.cache injection pattern, vi.hoisted ESM mock pattern |
| 2026-04-13 | `backend/tests/integration/` | Already accurate — no changes needed. Both pg-batch13 files (catalog-scheduler + restaurant) already documented. All counts correct (64 total = 19 pg-batch + 37 full-audit + 7 pg-standalone + 1 smoke-gate) |
| 2026-04-13 | `backend/routes/admin/` | No changes needed — all 10 files correct |
| 2026-04-13 | `backend/routes/reports/` | Fixed date params (most use date_from/date_to, not from/to; analytics uses period1_from/period1_to). Added custom_report_definitions to governance tables list. Feature flags ARE enforced in analytics/inventory/governance/sales — previous agent finding was wrong |
| 2026-04-13 | `backend/routes/shopify/` | Fixed permission claim (view_reports also allowed on reconciliation GET). Added shopify/utils.js vs crypto.js distinction. Added customer mapping (shopify_customer_map + mapping endpoints). Added external_sync_events + shopify_sync_runs tables. Added approvals feature flag on reconciliation fix. Documented only one webhook route implemented. Added import extras (DELETE + POST inventory) |
| 2026-04-13 | `backend/routes/tier4/` | Fixed logo upload method (PUT→POST). Added approvals.js GET /approvals + reconciliation approve endpoint. Added crm.js send/delete/convert endpoints. Added hr.js leave balance + schedule conflict check. Added notifications.js count endpoint + no requirePerm gotcha |
| 2026-04-13 | `backend/routes/integrations/` | Fixed permission table (connect/disconnect need all_access; pull-orders need manage_orders). Fixed hub response shape (channels/couriers/payment_providers/sms_providers/shopify/woocommerce). Added mapping tables per provider. Clarified POST /test is stub (checks DB only). Expanded auth table |
| 2026-04-13 | `backend/services/` | 9 wrong export names fixed (restaurant-checks/floor wrong function names). Added maskSecret to crypto.js. Fixed boss.js 24h archive→7d delete two-stage pattern. Added fbr.js buildCreditNote/buildDebitNote/validateConnection exports. Fixed printer.js (4 exports not 2, correct timeout values). Fixed projects.js table name (project_activities not project_activity_log + project_files). Fixed restaurant-floor.js (openTableSession/updateTableSession not createTableSession/closeTableSession). Fixed booking-reminders.js SMS-silently-succeeds bug. Added sms.js concrete adapters. Many missing gotchas added (subscriptions singletonKey, reservation TTL+deadlock sort, storefront-cart upsert+7d expiry, enqueueEmail db-param ignored, payment-gateway isEnabled nuance, phase4-polling SQL injection gotcha) |
| 2026-04-13 | `backend/routes/` | Fixed opening claim (6 files mounted before tenant middleware, not after). Added backup_restore/e_invoicing_export/supplier_payables to feature flag list. Added public-context route files (storefront/public-restaurant/public-bookings use resolvePublicTenantDb) |
| 2026-04-13 | Group 4 — all 13 root JS files | Middleware chain: corrected order (globalLimiter before requestId, added helmet/cors/compression/cookieParser/R2-proxy/JSON-body-handler). db-pg.js: added pool=20, exports (pool+end), dotenv-isolation gotcha, SSL behavior. jwt-auth.js: all 6 exports, jti/scope/SHA-256-hash-on-refresh-token. category-tree.js: 17 exports (was just resolveInheritedField), enrichCategories shape, wouldCreateCycle. tenant-db-proxy-pg.js: 3 exports + PROXIED_METHODS. tenant-db-manager-pg.js: 6 exports, 60s cache, 3-round-trip-per-query gotcha. tenant-db-pg.js: runWithTenant single-client pattern, getProxy has no getClient. tenant-multer.js: storage paths, no-size-limit gotcha. tenant-provisioner-pg.js: provision+validateSlug exports, 6-step flow, DROP-on-failure, setupToken, slug regex. master-db-pg.js: 5 exports, 10 tables, plan_pricing seeds. migrate-pg.js: { migrate, MIGRATIONS } exports, sequential not parallel, per-tenant failure isolation, schema_version bootstrap. seed-admin-pg.js: 3 flags, 8-char min, idempotent. swagger.js: API_DOCS_KEY 404/401 behavior, 4 schemas, 8 tags, Bearer auth. Boot assertions: ensureCriticalRoutesRegistered (4 routes) + ADMIN_ALLOWED_IPS warning. |
