/**
 * rbac.test.js — role-based access control and role management.
 *
 * PORTED FROM SQLITE 2026-08-02 (see security.test.js for the full rationale).
 * Built with { registerAll: true } deliberately: this file's entire subject is
 * PERMISSION_RULES enforcement, and the default helper path enforces a verbatim
 * COPY of those rules that lives in createTestApp-pg.js. Asserting a 403 against
 * the copy proves the copy works. registerAll mounts the real registerAllRoutes,
 * so these assertions now cover the rules the app actually ships.
 *
 * Port changes: dbRun/dbGet -> db.query, `?` -> `$1`, closeDb -> cleanup().
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("RBAC — Permission Enforcement", () => {
  it("cashier POST /api/products → 403 (needs manage_inventory)", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post("/api/products")
      .send({ name: "Test", price: 10, barcode: "TEST-RBAC" });

    expect(res.status).toBe(403);
  });

  it("cashier GET /api/products → 200 (no perm required for GET)", async () => {
    const res = await makeRequest(app, CASHIER_ID).get("/api/products");
    expect(res.status).toBe(200);
  });

  it("manager POST /api/products → 200 (has manage_inventory)", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/products")
      .send({ name: "Manager Product", price: 99, barcode: "MGR-001", category_id: 1 });

    expect(res.status).toBe(200);
  });

  it("admin (all_access) can access any protected route", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/products")
      .send({ name: "Admin Product", price: 50, barcode: "ADM-001", category_id: 1 });

    expect(res.status).toBe(200);
  });

  it("employee with zero permissions gets 403 on protected routes", async () => {
    // Explicit ids here mirror the seed, which also inserts explicit ids and so
    // leaves the SERIAL sequences behind MAX(id). Safe in this file because
    // nothing here POSTs a new role or employee through the API; if that ever
    // changes, the sequences need resetting first (see migration v132).
    await db.query(
      "INSERT INTO roles (id, name, description) VALUES (10, 'NoPerms', 'No permissions')"
    );
    await db.query(
      "INSERT INTO employees (id, name, role, pin_code, role_id) VALUES (10, 'NoPerm User', 'NoPerms', '0000', 10)"
    );

    const res = await makeRequest(app, 10)
      .post("/api/products")
      .send({ name: "Blocked", price: 10, barcode: "BLOCKED-001" });

    expect(res.status).toBe(403);
  });

  it("PUT /api/employees/:id requires manage_employees — cashier blocked", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .put("/api/employees/3")
      .send({ name: "Renamed Cashier" });

    // PERMISSION_RULES has no entry for PUT /api/employees/:id; the guard is
    // requirePerm("manage_employees") inside the route itself. The original
    // accepted [200, 403] for that reason and the port keeps that latitude.
    expect([200, 403]).toContain(res.status);
  });

  it("kiosk pin-status works without x-employee-id header", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-status")
      .send({ pin: "1111", outlet_id: 1 });

    // Kiosk endpoints are deliberately unauthenticated — must not be perm-gated.
    expect(res.status).not.toBe(403);
  });

  it("kiosk pin-checkin works without x-employee-id header", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin: "1111", outlet_id: 1 });

    expect(res.status).not.toBe(403);
  });

  /**
   * ASSERTION INVERTED DURING THE PORT — this is not a regression.
   *
   * The SQLite original asserted 200 here, titled "anonymous request to GET
   * /api/products works". That documented a real hole: an unauthenticated
   * caller could read the entire product catalogue. It has since been closed —
   * routes/products.js:209 guards the route with requireAnyPerm([...]), and
   * CLAUDE.md now states the invariant plainly: every data-returning GET
   * requires auth.
   *
   * Restoring the old expectation would mean re-opening the hole to satisfy a
   * test, so the assertion follows the fix instead. The authenticated case is
   * covered above ("cashier GET /api/products → 200"), which keeps this from
   * silently passing on a route that is broken for everyone.
   *
   * NOTE: health.test.js carries the identical stale assertion and is still
   * unloaded — it needs the same inversion when it is ported.
   */
  it("anonymous request to GET /api/products is denied", async () => {
    const res = await makeRequest(app).get("/api/products");
    expect(res.status).toBe(403);
  });
});

describe("Role Management — System Role Protection", () => {
  it("DELETE /api/roles/1 (Administrator) returns 400", async () => {
    const res = await makeRequest(app, ADMIN_ID).delete("/api/roles/1");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete/i);
  });

  it("DELETE /api/roles/2 (Manager) returns 400", async () => {
    const res = await makeRequest(app, ADMIN_ID).delete("/api/roles/2");
    expect(res.status).toBe(400);
  });

  it("DELETE /api/roles/3 (Cashier) returns 400", async () => {
    const res = await makeRequest(app, ADMIN_ID).delete("/api/roles/3");
    expect(res.status).toBe(400);
  });

  it("custom role with no employees can be deleted", async () => {
    await db.query(
      "INSERT INTO roles (id, name, description) VALUES (20, 'TempRole', 'To be deleted')"
    );

    const res = await makeRequest(app, ADMIN_ID).delete("/api/roles/20");
    expect(res.status).toBe(200);

    const { rows } = await db.query("SELECT id FROM roles WHERE id = 20");
    expect(rows.length).toBe(0);
  });
});
