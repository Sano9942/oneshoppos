# Tests — Claude Guide

- **Two test frameworks**: Jest (integration) + Vitest (unit) — different runners, don't mix
- **Integration tests** (`integration/`): 56 files, Jest + supertest, require `DATABASE_URL`. Two styles:
  - **pg-batch\*.test.js** (preferred): CommonJS, `describe` wraps all, routes registered on-demand via `require("../../routes/X")(app, deps)`
  - **Legacy** (auth.test.js, sales.test.js, etc.): SQLite-based, module-level `beforeAll`. **Do not run** unless explicitly asked
- **Unit tests** (`unit/`): 4 files, Vitest with ESM imports, pure functions, no DB/network
- **Helpers** (`helpers/`): `createTestApp-pg.js` (isolated Postgres schema per test suite), `request.js` (supertest wrapper), `seedSchema-pg.js` (runs full DDL)
- **Running**: `npx jest backend/tests/integration/pg-batch*.test.js` (integration), `npx vitest run tests/unit/` (unit)
- **Isolation**: Each pg-batch test gets its own schema, `cleanup()` drops it. No shared state between files
