# Integration Tests — Claude Guide

- **56 files**, Jest + supertest, all require `DATABASE_URL`
- **pg-batch pattern** (preferred): `pg-batch1` through `pg-batch12` + `pg-tenant-isolation`. Each creates isolated Postgres schema via `createTestApp-pg.js`. Routes registered on-demand inside `describe` block
- **Legacy SQLite tests**: `auth.test.js`, `sales.test.js`, `shifts.test.js`, etc. — use SQLite `createTestApp`. **Do not run** unless explicitly asked. `smoke-gate.test.js` has 22/25 pre-existing failures
- **Coverage by batch**: batch1=CRUD, batch2=medium, batch3=complex, batch4=reports, batch5=tier4, batch6=shopify, batch7=order-service, batch8=middleware, batch9=audit-fixes, batch10=wave2, batch11=admin, batch12=billing
- **Standalone domain tests**: `pg-brands.test.js`, `pg-connection.test.js`, `pg-master-db.test.js`, `pg-schema.test.js`, `pg-tenant-db.test.js`
- **Run**: `npx jest backend/tests/integration/pg-batch1-crud.test.js` (single), or `npx jest backend/tests/integration/pg-batch` (all batches)
