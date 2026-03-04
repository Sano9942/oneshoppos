/**
 * auth.test.js — Integration tests for /api/auth/login, /api/auth/logout, /api/auth/me
 */

const { createTestApp, closeDb, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
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
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ pin: "2580" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("missing PIN returns 400", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan" });

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
