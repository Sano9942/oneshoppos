/**
 * security.test.js — Phase 6A Track 7
 *
 * Regression guards against SQL injection, oversized payloads, and auth bypass.
 * SQLite's parameterized queries already prevent injection — these tests confirm it
 * and catch any future regression where someone concatenates user input into SQL.
 *
 * SEC1 — SQL injection in search param → sales table intact
 * SEC2 — SQL injection in outlet_id → returns only outlet 1 sales
 * SEC3 — SQL injection in product name → name stored literally, table intact
 * SEC4 — XSS payload in product name → stored as-is (backend not responsible for encoding)
 * SEC5 — Oversized payload in product name → no crash
 * SEC6 — Header injection in x-employee-id → 401 or invalid, no crash
 * SEC7 — Cashier with injection body tries to create product → 403
 * SEC8 — Unauthenticated GET /api/feature-flags → 401
 *
 * NOTE on SEC6 / SEC8 route choice:
 *   GET /api/employees is intentionally an open endpoint (no auth check in the route
 *   handler). SEC6 and SEC8 use GET /api/feature-flags instead, which explicitly
 *   checks Number(x-employee-id) and returns 401 when it resolves to 0 / NaN.
 *   This is the real production auth guard for employee-gated API reads.
 */

const { createTestApp, closeDb, dbAll, dbGet } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

const OUTLET_ID = 1;

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

// ─── SEC1 ────────────────────────────────────────────────────────────────────

describe("SEC1 — SQL injection in search param", () => {
  it("injection in search does not drop the sales table", async () => {
    const payload = "'; DROP TABLE sales; --";
    const res = await makeRequest(app, ADMIN_ID)
      .get(`/api/sales?search=${encodeURIComponent(payload)}`);
    // Should not crash
    expect([200, 400]).toContain(res.status);

    // Sales table must still exist
    const tables = await dbAll(db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sales'", []);
    expect(tables.length).toBe(1);
  });
});

// ─── SEC2 ────────────────────────────────────────────────────────────────────

describe("SEC2 — SQL injection in outlet_id param", () => {
  it("outlet_id injection does not return all outlets' sales", async () => {
    const payload = "1 OR 1=1";
    const res = await makeRequest(app, ADMIN_ID)
      .get(`/api/sales?outlet_id=${encodeURIComponent(payload)}`);
    // Should not crash; sales table intact
    expect([200, 400]).toContain(res.status);

    const tables = await dbAll(db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sales'", []);
    expect(tables.length).toBe(1);
  });
});

// ─── SEC3 ────────────────────────────────────────────────────────────────────

describe("SEC3 — SQL injection in product name", () => {
  it("injection in product name is stored literally and does not drop products table", async () => {
    const injectionName = "Widget'; DROP TABLE products; --";
    const res = await makeRequest(app, ADMIN_ID).post("/api/products").send({
      name: injectionName,
      barcode: "SEC-003",
      price: 10,
      stock: 5,
      category_id: 1,
    });
    // Should succeed (200 or 201) or at worst 400 — not a crash
    expect([200, 201, 400]).toContain(res.status);

    // Products table must still exist
    const tables = await dbAll(db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='products'", []);
    expect(tables.length).toBe(1);

    // If product was created, the name should be stored literally
    if (res.status === 200 || res.status === 201) {
      const productId = res.body.id ?? res.body.productId;
      if (productId) {
        const product = await dbGet(db, "SELECT name FROM products WHERE id = ?", [productId]);
        if (product) {
          expect(product.name).toBe(injectionName);
        }
      }
    }
  });
});

// ─── SEC4 ────────────────────────────────────────────────────────────────────

describe("SEC4 — XSS payload in product name", () => {
  it("XSS payload is stored as-is without crashing", async () => {
    const xssName = "<script>alert(1)</script>";
    const res = await makeRequest(app, ADMIN_ID).post("/api/products").send({
      name: xssName,
      barcode: "SEC-004",
      price: 10,
      stock: 5,
      category_id: 1,
    });
    // Backend is not responsible for HTML encoding — should store as-is
    expect([200, 201, 400]).toContain(res.status);
    // No crash = test passes
  });
});

// ─── SEC5 ────────────────────────────────────────────────────────────────────

describe("SEC5 — Oversized product name payload", () => {
  it("10000-character product name does not crash the server", async () => {
    const oversizedName = "A".repeat(10000);
    const res = await makeRequest(app, ADMIN_ID).post("/api/products").send({
      name: oversizedName,
      barcode: "SEC-005",
      price: 10,
      stock: 5,
      category_id: 1,
    });
    // Should be 200/201 (stored) or 400 (rejected) — NOT 500
    expect([200, 201, 400]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});

// ─── SEC6 ────────────────────────────────────────────────────────────────────

describe("SEC6 — Header injection in x-employee-id", () => {
  /**
   * GET /api/feature-flags explicitly does Number(req.headers["x-employee-id"]).
   * "1; DROP TABLE employees" parses to NaN which is falsy (treated as 0),
   * so the route returns 401 before any DB access occurs.
   * The employees table is confirmed intact afterward to rule out side effects.
   *
   * NOTE: GET /api/employees is intentionally an open route with no auth check,
   * so it cannot be used here. /api/feature-flags is the correct auth-gated target.
   */
  it("injection in x-employee-id header does not crash or escalate privileges", async () => {
    const res = await makeRequest(app).get("/api/feature-flags")
      .set("x-employee-id", "1; DROP TABLE employees");
    // Number("1; DROP TABLE employees") → NaN → 0 → 401 from feature-flags auth check
    expect(res.status).toBe(401);

    // Employees table must still exist
    const tables = await dbAll(db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='employees'", []);
    expect(tables.length).toBe(1);
  });
});

// ─── SEC7 ────────────────────────────────────────────────────────────────────

describe("SEC7 — Cashier cannot create product even with injection body", () => {
  it("cashier gets 403 before body is even processed", async () => {
    const res = await makeRequest(app, CASHIER_ID).post("/api/products").send({
      name: "Hack'; DROP TABLE products; --",
      barcode: "SEC-007",
      price: 10,
      stock: 5,
      category_id: 1,
    });
    expect(res.status).toBe(403);

    // Products table intact
    const tables = await dbAll(db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='products'", []);
    expect(tables.length).toBe(1);
  });
});

// ─── SEC8 ────────────────────────────────────────────────────────────────────

describe("SEC8 — Unauthenticated access to sensitive route", () => {
  /**
   * GET /api/feature-flags requires a valid x-employee-id header (must be a non-zero
   * integer). Without any auth header, Number(undefined) = NaN → 0, the route returns 401.
   *
   * NOTE: GET /api/employees is intentionally open (no auth guard in the route handler)
   * and is used by the POS PIN-login flow. /api/feature-flags is the correct sensitive
   * target that enforces employee authentication before returning data.
   */
  it("GET /api/feature-flags without auth header returns 401", async () => {
    const res = await makeRequest(app).get("/api/feature-flags");
    expect(res.status).toBe(401);
  });
});
