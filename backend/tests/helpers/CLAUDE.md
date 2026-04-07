# Test Helpers — Claude Guide

- **`createTestApp-pg.js`** — creates isolated Express app with fresh Postgres schema per test. Returns `{ app, db, deps, cleanup }`. `cleanup()` drops schema. Routes NOT pre-registered — each test calls `require("../../routes/X")(app, deps)` explicitly
- **`request.js`** — supertest wrapper. `makeRequest(app, employeeId)` returns agent with `x-employee-id` pre-set. Constants: `ADMIN_ID`, `MANAGER_ID`, `CASHIER_ID`
- **`seedSchema-pg.js`** — `seedSchema(client)` reads `schema-pg.sql` and runs full DDL against a Postgres client
