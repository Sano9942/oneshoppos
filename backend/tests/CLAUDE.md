# Tests — Claude Guide

- **Two test frameworks**: Jest (integration) + Vitest (unit) — different runners, don't mix
- **Integration tests** (`integration/`): 74 files, Jest + supertest, require `DATABASE_URL`. Three categories:
  - **pg-batch\*.test.js** (19 files: 16 numbered + 3 phase batches): CommonJS, `describe` wraps all, routes registered on-demand via `require("../../routes/X")(app, deps)`
  - **Full-audit suite** (39 files): Domain-specific tests (auth, sales, returns, shifts, rbac, security, cod-settlements, etc.) — added during full system audit
  - **pg-standalone** (15 files): `pg-brands`, `pg-connection`, `pg-master-db`, `pg-schema`, `pg-tenant-db`, `pg-test-app`, `pg-tenant-isolation`, `pg-customer-portal`, `pg-portal-appointments`, `pg-preset-engine`, `pg-rental-contracts`, `pg-room-bookings`, `pg-sandbox-payment`, `pg-treatment-plan-deposit`, `pg-treatment-plans`
  - **Legacy**: `smoke-gate.test.js` — 22/25 pre-existing failures, **do not run** unless explicitly asked
- **Unit tests** (`unit/`): 20 files, Vitest with ESM imports, pure functions, no DB/network
- **Helpers** (`helpers/`): 5 files — `createTestApp-pg.js` (isolated Postgres schema per test suite), `request.js` (supertest wrapper), `seedSchema-pg.js` (runs full DDL), `globalTeardown.js` (orphaned `test_%` schema cleanup on crash — per-schema failures don't abort the rest), `vitest-setup.js` (loads `backend/.env` for Vitest worker forks so `DATABASE_URL` is available)
- **Running**: `npx jest backend/tests/integration/pg-batch*.test.js` (integration), `npx vitest run backend/tests/unit/` (unit — run from repo root)
- **Isolation**: Each pg-batch test gets its own schema, `cleanup()` drops it. No shared state between files
- **"Decision II trap"**: env vars deleted inside a test's `beforeAll` are safe only *after* `createTestApp()` has run. Deleting an env var *before* `createTestApp()` or at module scope breaks module-level env reads
