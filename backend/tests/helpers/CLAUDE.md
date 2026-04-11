# Test Helpers — Claude Guide

- **`createTestApp-pg.js`** — creates isolated Express app with fresh Postgres schema per test. Returns `{ app, db, deps, cleanup }`. `cleanup()` drops schema. Routes NOT pre-registered — each test calls `require("../../routes/X")(app, deps)` explicitly
- **`request.js`** — supertest wrapper. `makeRequest(app, employeeId)` returns agent with `x-employee-id` pre-set. Constants: `ADMIN_ID`, `MANAGER_ID`, `CASHIER_ID`
- **`seedSchema-pg.js`** — `seedSchema(client)` reads `schema-pg.sql` and runs full DDL against a Postgres client
- **`globalTeardown.js`** — Jest global teardown. Drops any orphaned `test_*` schemas that per-file `afterAll` cleanup missed (crash, timeout, Ctrl+C). Wired via `jest.config.js → globalTeardown`
- **`vitest-setup.js`** — Vitest setup file. Loads `backend/.env` once per worker fork so `DATABASE_URL` and other secrets are available to unit tests that import DB modules. Run before any test imports
