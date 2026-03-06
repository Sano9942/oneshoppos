/**
 * auth-jwt.test.js — Integration tests for JWT auth (Phase 2)
 *
 * Tests bcrypt PIN verification, employee PIN hashing, and JWT token operations.
 */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createTestApp, closeDb, dbRun, dbGet } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

const TEST_JWT_SECRET = "test-jwt-secret-that-is-at-least-64-characters-long-for-security-purposes-here";
const TEST_REFRESH_SECRET = "test-refresh-secret-that-is-at-least-64-characters-long-for-security-purposes";

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

describe("bcrypt PIN verification", () => {
  it("login succeeds with correct PIN after bcrypt migration", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: "2580" });

    expect(res.status).toBe(200);
    expect(res.body.employee).toBeDefined();
    expect(res.body.employee.name).toBe("Hassan");
  });

  it("login fails with wrong PIN", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: "9999" });

    expect(res.status).toBe(401);
  });

  it("login fails with non-existent username", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "NonExistent", pin: "2580" });

    expect(res.status).toBe(401);
  });

  it("login returns permissions", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: "2580" });

    expect(res.status).toBe(200);
    expect(res.body.permissions).toContain("all_access");
  });
});

describe("employee PIN hashing on create/update", () => {
  it("creating an employee hashes the PIN", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/employees")
      .send({ name: "JWTTestEmp", pin_code: "7777", role_id: 3 });

    expect(res.status).toBe(200);
    const emp = await dbGet(db, "SELECT pin_hash FROM employees WHERE id = ?", [res.body.id]);
    expect(emp.pin_hash).toBeTruthy();
    expect(emp.pin_hash.startsWith("$2")).toBe(true); // bcrypt prefix
  });

  it("updating an employee PIN re-hashes it", async () => {
    // Create first
    const create = await makeRequest(app, ADMIN_ID)
      .post("/api/employees")
      .send({ name: "JWTUpdateEmp", pin_code: "8888", role_id: 3 });
    const empId = create.body.id;

    // Update PIN
    await makeRequest(app, ADMIN_ID)
      .put(`/api/employees/${empId}`)
      .send({ pin_code: "9999" });

    const emp = await dbGet(db, "SELECT pin_hash FROM employees WHERE id = ?", [empId]);
    expect(emp.pin_hash).toBeTruthy();

    // Verify new PIN works
    const valid = await bcrypt.compare("9999", emp.pin_hash);
    expect(valid).toBe(true);

    // Verify old PIN doesn't work
    const invalid = await bcrypt.compare("8888", emp.pin_hash);
    expect(invalid).toBe(false);
  });
});

describe("POST /api/employees/validate-pin (bcrypt)", () => {
  it("validates PIN using bcrypt hash", async () => {
    const res = await makeRequest(app)
      .post("/api/employees/validate-pin")
      .send({ pin_code: "2580" }); // Hassan's PIN

    expect(res.status).toBe(200);
    expect(res.body.employee.name).toBe("Hassan");
  });

  it("rejects wrong PIN", async () => {
    const res = await makeRequest(app)
      .post("/api/employees/validate-pin")
      .send({ pin_code: "0000" });

    expect(res.status).toBe(401);
  });

  it("returns 400 for missing PIN", async () => {
    const res = await makeRequest(app)
      .post("/api/employees/validate-pin")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("JWT token operations (unit-level)", () => {
  const { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require("../../jwt-auth");

  it("signs and verifies an access token", () => {
    const token = signAccessToken({ tid: 1, eid: 42, rid: 1, oid: 3 }, TEST_JWT_SECRET);
    const decoded = verifyAccessToken(token, TEST_JWT_SECRET);
    expect(decoded.tid).toBe(1);
    expect(decoded.eid).toBe(42);
    expect(decoded.rid).toBe(1);
    expect(decoded.oid).toBe(3);
    expect(decoded.scope).toBe("full");
  });

  it("signs and verifies a refresh token", () => {
    const { token, hash, expiresAt } = signRefreshToken({ tid: 1, eid: 42 }, TEST_REFRESH_SECRET);
    const decoded = verifyRefreshToken(token, TEST_REFRESH_SECRET);
    expect(decoded.tid).toBe(1);
    expect(decoded.eid).toBe(42);
    expect(decoded.type).toBe("refresh");
    expect(hash).toBeTruthy();
    expect(expiresAt).toBeTruthy();
  });

  it("rejects token with wrong secret", () => {
    const token = signAccessToken({ tid: 1, eid: 42, rid: 1, oid: null }, TEST_JWT_SECRET);
    expect(() => verifyAccessToken(token, "wrong-secret")).toThrow();
  });

  it("hashToken produces consistent SHA-256 hex", () => {
    const h1 = hashToken("test-token");
    const h2 = hashToken("test-token");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });
});
