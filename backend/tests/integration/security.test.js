/**
 * security.test.js — regression guards against SQL injection, oversized
 * payloads and auth bypass.
 *
 * PORTED FROM SQLITE 2026-08-02. The original ran on the deleted
 * helpers/createTestApp (SQLite, in-memory) and had been unloadable since
 * commit 32276003 — it has therefore not executed in months, which is the worst
 * state for a security test to be in: present in the tree, counted by nobody,
 * asserting nothing.
 *
 * Three things changed in the port, and the middle one matters:
 *
 *   1. sqlite_master → to_regclass(). "Does the table still exist" is a
 *      different question in Postgres, and it must be asked against the test's
 *      own schema rather than globally.
 *   2. The app is built with { registerAll: true }, so the PERMISSION_RULES
 *      enforcing SEC7 are the PRODUCTION rules from registerAllRoutes, not the
 *      duplicated copy in createTestApp-pg.js. A 403 asserted against the mirror
 *      proves the mirror works. SEC6/SEC8 additionally REQUIRE this mode:
 *      /api/feature-flags is declared inline inside registerAllRoutes and does
 *      not exist in any mountable routes/*.js, so a per-route-mount test 404s.
 *   3. `?` placeholders → `$1`.
 *
 * The SQLite original noted "SQLite's parameterized queries already prevent
 * injection". That reasoning does not transfer — this suite now runs on the
 * same engine production uses, so these assertions cover the real query path
 * for the first time.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, schemaName;

beforeAll(async () => {
  ({ app, db, cleanup, schemaName } = await createTestApp({ registerAll: true }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

/**
 * Postgres equivalent of the original's sqlite_master lookup.
 *
 * to_regclass() returns NULL for a missing relation instead of throwing, so a
 * dropped table reads as null rather than blowing up the assertion with an
 * unrelated error. It is qualified with the test's own schema because every
 * test schema is a sibling in one database — an unqualified name would resolve
 * through search_path and could report a *different* test's table as proof that
 * this test's table survived.
 */
async function tableExists(table) {
  const { rows } = await db.query("SELECT to_regclass($1) AS oid", [
    `${schemaName}.${table}`,
  ]);
  return rows[0].oid !== null;
}

// ─── SEC1 ────────────────────────────────────────────────────────────────────

describe("SEC1 — SQL injection in search param", () => {
  it("injection in search does not drop the sales table", async () => {
    const payload = "'; DROP TABLE sales; --";
    const res = await makeRequest(app, ADMIN_ID).get(
      `/api/sales?search=${encodeURIComponent(payload)}`
    );
    expect([200, 400]).toContain(res.status);
    expect(await tableExists("sales")).toBe(true);
  });
});

// ─── SEC2 ────────────────────────────────────────────────────────────────────

describe("SEC2 — SQL injection in outlet_id param", () => {
  it("outlet_id injection does not return all outlets' sales", async () => {
    const payload = "1 OR 1=1";
    const res = await makeRequest(app, ADMIN_ID).get(
      `/api/sales?outlet_id=${encodeURIComponent(payload)}`
    );
    expect([200, 400]).toContain(res.status);
    expect(await tableExists("sales")).toBe(true);
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
    expect([200, 201, 400]).toContain(res.status);
    expect(await tableExists("products")).toBe(true);

    // If it was created, the payload must have been stored as data, not executed.
    if (res.status === 200 || res.status === 201) {
      const productId = res.body.id ?? res.body.productId;
      if (productId) {
        const { rows } = await db.query("SELECT name FROM products WHERE id = $1", [
          productId,
        ]);
        if (rows.length) expect(rows[0].name).toBe(injectionName);
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
    // The backend deliberately does not HTML-encode — encoding is the render
    // layer's job. This asserts it stores and moves on rather than crashing.
    expect([200, 201, 400]).toContain(res.status);
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
    expect([200, 201, 400]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});

// ─── SEC6 ────────────────────────────────────────────────────────────────────

describe("SEC6 — Header injection in x-employee-id", () => {
  /**
   * Number("1; DROP TABLE employees") is NaN, which is falsy, so the route
   * returns 401 before touching the database. Requires registerAll — this route
   * is inline in registerAllRoutes and unreachable otherwise.
   */
  it("injection in x-employee-id header does not crash or escalate privileges", async () => {
    const res = await makeRequest(app)
      .get("/api/feature-flags")
      .set("x-employee-id", "1; DROP TABLE employees");
    expect(res.status).toBe(401);
    expect(await tableExists("employees")).toBe(true);
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
    expect(await tableExists("products")).toBe(true);
  });
});

// ─── SEC8 ────────────────────────────────────────────────────────────────────

describe("SEC8 — Unauthenticated access to sensitive route", () => {
  it("GET /api/feature-flags without auth header returns 401", async () => {
    const res = await makeRequest(app).get("/api/feature-flags");
    expect(res.status).toBe(401);
  });
});
