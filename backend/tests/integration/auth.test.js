/**
 * auth.test.js — /api/auth/login, /api/auth/logout, /api/auth/me
 *
 * PORTED FROM SQLITE 2026-08-02 (see security.test.js for the full rationale).
 *
 * Uses { registerAll: true }: registerAllRoutes picks the auth middleware by
 * reading process.env.MULTI_TENANT at mount time, and the header-auth endpoints
 * asserted here are the single-tenant branch. Mounting routes/auth.js directly
 * would wire the routes but not the branch that selects them.
 *
 * Seed data these assertions depend on (createTestApp-pg.js seedData):
 *   1 Hassan       / 2580 / Administrator (all_access)
 *   2 Manager User / 2222 / Manager
 *   3 Cashier User / 3333 / Cashier
 *
 * Port changes: closeDb -> cleanup(); the unused dbRun import is dropped.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, cleanup;

beforeAll(async () => {
  ({ app, cleanup } = await createTestApp({ registerAll: true }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("POST /api/auth/login", () => {
  it("valid login returns employee + permissions", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: "2580" });

    expect(res.status).toBe(200);
    expect(res.body.employee).toBeDefined();
    expect(res.body.employee.id).toBe(ADMIN_ID);
    expect(res.body.employee.name).toBe("Hassan");
    expect(res.body.permissions).toContain("all_access");
  });

  it("wrong PIN returns 401", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: "9999" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("missing username returns 400", async () => {
    const res = await makeRequest(app).post("/api/auth/login").send({ pin: "2580" });

    expect(res.status).toBe(400);
    // The SQLite original asserted /required/i. That message came from the
    // route's own hand-rolled check; a missing username is now caught earlier by
    // the Zod validate() middleware, which answers "Invalid input: expected
    // string, received undefined". Same 400, different wording.
    //
    // The status is the contract, so the regex is widened rather than pinned to
    // whichever layer happens to reject first — but not dropped: it still fails
    // on a 500, an empty body, or a success message. (Missing PIN below still
    // reaches the route's own check, which is why it keeps the older wording.)
    expect(res.body.error).toMatch(/required|invalid/i);
  });

  it("missing PIN returns 400", async () => {
    const res = await makeRequest(app).post("/api/auth/login").send({ username: "Hassan" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("login is case-insensitive for username", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "hassan", pin: "2580" });

    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(ADMIN_ID);
  });

  it("manager login returns manager permissions", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Manager User", pin: "2222" });

    expect(res.status).toBe(200);
    expect(res.body.permissions).toContain("manage_inventory");
    expect(res.body.permissions).toContain("manage_orders");
    // The negative half matters as much as the positive: a Manager must not
    // pick up all_access, which is what a broken role join would produce.
    expect(res.body.permissions).not.toContain("all_access");
  });
});

describe("GET /api/auth/me", () => {
  it("valid x-employee-id returns employee", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(ADMIN_ID);
    expect(res.body.permissions).toContain("all_access");
  });

  it("no x-employee-id header returns 401", async () => {
    const res = await makeRequest(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("nonexistent employee ID returns 401", async () => {
    const res = await makeRequest(app, 99999).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("logout returns success", async () => {
    const res = await makeRequest(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
