# Test Helpers — Claude Guide

- **5 files** — shared infrastructure for integration tests (Jest) and unit tests (Vitest)

---

## `createTestApp-pg.js`

Exports: `createTestApp(options?)`, `DEFAULT_FEATURE_FLAGS`, `PERMISSION_RULES`

**Usage**: `const { app, db, deps, runtimeState, cleanup, schemaName } = await createTestApp()`

Creates a fully wired Express app with an isolated Postgres schema (`test_<6-byte-hex>`). Each call creates a fresh schema, runs the full DDL, seeds fixtures, and returns a cleanup function that drops the schema.

**Options**:
- `options.seed = false` — skip fixture seeding (DDL only). Useful for tests that need a clean schema or custom seed data.

**Return shape**:
- `app` — Express app, routes NOT pre-registered. Each test calls `require('../../routes/X')(app, deps)` explicitly
- `db` — scoped db proxy (`query`, `transaction`, `getClient`) with `search_path` fixed to the test schema
- `deps` — full deps object (see below)
- `runtimeState` — `{ isRestoreInProgress: false }` — set to `true` to trigger the 503 restore-lock middleware in tests
- `cleanup()` — drops test schema and releases pool client; call in `afterAll`
- `schemaName` — the generated `test_<hex>` schema name (useful for raw pool queries in assertions)

**`db` proxy gotcha**: `getClient()` returns a Proxy where `release()` is a no-op. This prevents route code from releasing the dedicated test client back to the pool (which would break schema scoping). A test client is never truly released until `cleanup()` runs.

**Seeded fixtures** (created unless `seed: false`):

| Type | Seeded |
|------|--------|
| Company | id=1 "Test Company" |
| Outlets | id=1 "Main Store", id=2 "Branch Store" |
| Roles | 1=Administrator, 2=Manager, 3=Cashier |
| Admin perms | `all_access` |
| Manager perms | `manage_inventory`, `manage_orders`, `view_reports`, `manage_employees`, `pos_discount`, `void_sales`, `pos_park`, `pos_void` |
| Cashier perms | `view_reports`, `pos_discount`, `pos_park` |
| Employees | id=1 Hassan (Admin, PIN 2580), id=2 Manager User (PIN 2222), id=3 Cashier User (PIN 3333) |
| Products | 5 products (id=1–5, prices 100/200/500/50/75 PKR) |
| Outlet stock | Products 1–5 at outlet 1 (qty 50/30/20/100/80); products 1–2 at outlet 2 (qty 10/5) |
| Customer | id=1 "Test Customer", 100 loyalty points, 500.00 balance |
| Feature flags | All Wave-16 flags enabled; `reports_profit_layer` etc. disabled — matches `DEFAULT_FEATURE_FLAGS` |
| company_profile | id=1 "Test Store" via `ON CONFLICT DO UPDATE` |
| Sequences | Reset to max seeded id after inserts — prevents id conflicts on new inserts |

**Stubbed deps**:
- `requirePlanLimit` → always passes (noop middleware)
- `requireActiveSubscription` → always passes
- `loadCompanyProfile` → sets `req.company = { timezone: "UTC" }`
- `resolveContext` → sets `req.context = { companyId: null, outletId: null, scopeMode: null }`
- `requireContextOutlet` → always passes
- `authLimiter` / `webhookLimiter` → noop
- Shopify function stubs + ShopifyUtil stubs (verifyWebhookSignature always returns `true`, encrypt/decrypt are identity functions)
- `createNotification`, `notifyLowStockForSale`, `ensureDefaultRolePermissions` → noops

**Upload dirs**: `backend/uploads_test/products/` and `backend/uploads_test/company/` (created on demand; NOT `backend/uploads/`)

**`DEFAULT_FEATURE_FLAGS`** (also exported): the flag map used for seeding + the `requireFeature` stub. Import directly in tests that need to reference flag keys.

---

## `request.js`

Exports: `makeRequest(app, employeeId?)`, `ADMIN_ID` (1), `MANAGER_ID` (2), `CASHIER_ID` (3)

Supertest wrapper that auto-sets `x-employee-id` on every request:

```js
const req = makeRequest(app, ADMIN_ID);   // all requests as admin
const req = makeRequest(app);             // anonymous (bare supertest agent, no proxy)
await req.get('/api/products').expect(200);
```

Uses a Proxy over the supertest agent — the header is injected per HTTP-method call, not at agent construction time. Methods proxied: `get`, `post`, `put`, `delete`, `patch`.

---

## `seedSchema-pg.js`

Exports: `seedSchema(client)`

Reads `backend/schema-pg.sql` at module load time (sync `fs.readFileSync`) and runs the full DDL as a single `client.query()`. Called by `createTestApp` to initialize the test schema. Pass a raw `pg.PoolClient` (not the scoped db proxy).

---

## `globalTeardown.js`

Jest global teardown — wired via `jest.config.js → globalTeardown`. Drops any orphaned `test_*` schemas left behind by crashes, timeouts, or Ctrl+C.

- Creates its own single-connection pool (max 1, 5s timeout)
- Matches `schema_name LIKE 'test_%'` — drops everything with that prefix
- Per-schema failures are caught and logged as warnings (doesn't abort the rest)
- Exits cleanly even if the teardown itself errors (pool.end() in finally)

---

## `vitest-setup.js`

Runs once per Vitest worker fork before any test imports. Loads `backend/.env` so `DATABASE_URL` and other secrets are available to unit tests that import DB modules.

**"Decision II trap" note**: env vars deleted inside a test's `beforeAll` are safe if done *after* `createTestApp()` has run — all `require()` calls (and thus module-level env reads) happen during `createTestApp()`, before `beforeAll` body executes. Deleting an env var *before* `createTestApp()` or at module scope is unsafe.
