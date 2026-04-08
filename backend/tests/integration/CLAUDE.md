# Integration Tests — Claude Guide

- **56 files**, Jest + supertest, all require `DATABASE_URL`
- **Three categories**:
  1. **pg-batch pattern** (12 files): `pg-batch1` through `pg-batch12`. Each creates isolated Postgres schema via `createTestApp-pg.js`. Routes registered on-demand inside `describe` block
  2. **Full-audit suite** (36 files): Domain-specific integration tests added in the full system audit. Files: `attendance`, `auditability`, `auth-jwt`, `auth`, `compliance`, `concurrency`, `context-enforcement`, `crud_employees`, `crud_inventory`, `crud_operations`, `crud_settings`, `customers`, `data-integrity`, `email`, `failure-handling`, `feature-flags`, `health`, `hr_approvals`, `inventory`, `negative-cases`, `po-credit-limit`, `printer`, `promotions`, `purchase-orders`, `rbac`, `reports_accuracy`, `reports_governance`, `returns-exchange`, `returns`, `saas-phase1`, `sales`, `security`, `shift-linkage`, `shift-report-attribution`, `shifts`, `supplier-payables`
  3. **pg-standalone** (7 files): `pg-brands`, `pg-connection`, `pg-master-db`, `pg-schema`, `pg-tenant-db`, `pg-test-app`, `pg-tenant-isolation`
- **Legacy**: `smoke-gate.test.js` has 22/25 pre-existing failures — do not run unless explicitly asked
- **Coverage by batch**: batch1=CRUD, batch2=medium, batch3=complex, batch4=reports, batch5=tier4, batch6=shopify, batch7=order-service, batch8=middleware, batch9=audit-fixes, batch10=wave2, batch11=admin, batch12=billing
- **Run**: `npx jest backend/tests/integration/pg-batch1-crud.test.js` (single), or `npx jest backend/tests/integration/pg-batch` (all batches), or `npx jest backend/tests/integration/sales.test.js` (single audit test)
