# Tests — Claude Guide

- **Two test frameworks**: Jest (integration) + Vitest (unit) — different runners, don't mix
- **Integration tests** (`integration/`): 64 files, Jest + supertest, require `DATABASE_URL`. Three categories:
  - **pg-batch\*.test.js** (19 files: 16 numbered + 3 phase batches): CommonJS, `describe` wraps all, routes registered on-demand via `require("../../routes/X")(app, deps)`
  - **Full-audit suite** (37 files): Domain-specific tests (auth, sales, returns, shifts, rbac, security, cod-settlements, etc.) — added during full system audit
  - **pg-standalone** (7 files): `pg-brands`, `pg-connection`, `pg-master-db`, `pg-schema`, `pg-tenant-db`, `pg-test-app`, `pg-tenant-isolation`
  - **Legacy**: `smoke-gate.test.js` — 22/25 pre-existing failures, **do not run** unless explicitly asked
- **Unit tests** (`unit/`): 10 files, Vitest with ESM imports, pure functions, no DB/network
- **Helpers** (`helpers/`): `createTestApp-pg.js` (isolated Postgres schema per test suite), `request.js` (supertest wrapper), `seedSchema-pg.js` (runs full DDL), `globalTeardown.js` (orphaned schema cleanup on crash), `vitest-setup.js` (loads .env for Vitest worker forks)
- **Running**: `npx jest backend/tests/integration/pg-batch*.test.js` (integration), `npx vitest run tests/unit/` (unit)
- **Isolation**: Each pg-batch test gets its own schema, `cleanup()` drops it. No shared state between files
