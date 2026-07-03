# Backend audit coverage ledger

Audit date: 2026-07-03 (Asia/Karachi). Mode: read-only source review plus non-DB unit tests. Production mutation, staging, commits, and application/config edits were not performed. Existing working-tree changes were preserved.

## Scope covered

| Area | Evidence reviewed | Status |
|---|---|---|
| Request/auth/tenant chain | `routes/registerAllRoutes.js:51-255`, `middleware/tenant-auth.js:33-275`, `middleware/permissions.js:5-220`, `middleware/plan-limits.js:45-130`, `middleware/validate.js` | Covered; pre-tenant public routes and post-tenant middleware boundaries mapped |
| Tenant DB routing | `tenant-db-proxy-pg.js`, `tenant-db-manager-pg.js:29-99`, `db-pg.js:28-62`, `master-db-pg.js:147-241`, `routes/import.js` get-client call sites | Covered; query, transaction, and checked-out-client behavior traced |
| Admin boundary | `routes/admin/index.js:28-60`, `routes/admin/helpers.js:31-105`, all `routes/admin/*.js` route declarations | Covered; 72 admin route declarations and their IP/JWT middleware spot-checked |
| Public/setup/auth flows | `routes/setup.js:33-180`, `routes/auth.js:669-780`, portal auth modules via targeted searches | Covered for setup disclosure and password-reset control flow |
| Payment/webhooks | `routes/webhooks.js:92-205, 458-590`, `services/payment-gateway.js`, `services/messaging.js:10-61` | Covered; signature, idempotency, tenant resolution, and write sinks traced |
| Schema/migrations | `schema-pg.sql` targeted DDL searches; `migrate-pg.js:29-7142, 7144-7321`; `master-db-pg.js` master DDL | Static parity covered; live catalog parity environment-deferred |
| Workers/integrations | `boot/workers.js:244-310`, `workers/fbr-worker-boss.js:14-171`, `services/fbr.js:137-201`, webhook integrations | Covered for registration, durable enqueue, tenant scope, retry behavior |
| Tests | `backend/package.json`; unit suite; targeted middleware/tenant/worker tests; relevant integration test inventory | Covered; results in `test-evidence.md` |

## Quantitative inventory

- 420 files under backend route/middleware/worker/schema/test search scope.
- 975 static `app.get/post/put/patch/delete` declarations under `backend/routes` (inventory signal, not a claim that every declaration was manually line-reviewed).
- 94 migration objects, unique versions 1-98; intentional/non-contiguous gaps 40-43; no duplicate version values found.
- Static DDL extraction: 288 unique tables in `schema-pg.sql`; 205 in migration bodies. Five migration-only tables (`impersonation_sessions`, `payment_intents`, `payment_records`, `plan_pricing`, `upgrade_requests`) are public/master tables also created by `master-db-pg.js`, not tenant-schema drift.

## Deferred

- PostgreSQL-backed integration suites and live `information_schema`/constraint/index parity: local PostgreSQL unavailable. This is an environment deferral, not an application defect.
- External FBR/xPay/Meta/WhatsApp calls: no production or third-party mutations were attempted.
- Archived/legacy SQLite material and generated historical audit documents were excluded from active-code conclusions.

