/**
 * auth-jwt.test.js — bcrypt PIN verification, PIN hashing on create/update,
 * and the jwt-auth sign/verify helpers.
 *
 * PORTED FROM SQLITE 2026-08-02 (see security.test.js for the full rationale).
 *
 * Port changes: dbGet -> db.query, `?` -> `$1`, closeDb -> cleanup(),
 * registerAll for the auth/employees routes, and the unused `jwt` and `dbRun`
 * imports dropped.
 */
const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

const TEST_JWT_SECRET = "test-jwt-secret-that-is-at-least-64-characters-long-for-security-purposes-here";
const TEST_REFRESH_SECRET = "test-refresh-secret-that-is-at-least-64-characters-long-for-security-purposes";

let app, db, cleanup;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
});

// NOTE for future ports: the seed inserts employees with explicit ids (1, 2, 3),
// which is exactly the shape that left SERIAL sequences behind MAX(id) and broke
// the first API insert on wizard-seeded tenants (migration v132). It does NOT
// bite here — createTestApp-pg.js:386 already setval()s every seeded table after
// seeding. A setval guard added to this file was verified redundant by removing
// it and re-running: still 13/13. Don't re-add one on suspicion.

afterAll(async () => {
  if (cleanup) await cleanup();
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
    const { rows } = await db.query("SELECT pin_hash FROM employees WHERE id = $1", [
      res.body.id,
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].pin_hash).toBeTruthy();
    expect(rows[0].pin_hash.startsWith("$2")).toBe(true); // bcrypt prefix
  });

  it("updating an employee PIN re-hashes it", async () => {
    const create = await makeRequest(app, ADMIN_ID)
      .post("/api/employees")
      .send({ name: "JWTUpdateEmp", pin_code: "8888", role_id: 3 });
    const empId = create.body.id;

    await makeRequest(app, ADMIN_ID)
      .put(`/api/employees/${empId}`)
      .send({ pin_code: "9999" });

    const { rows } = await db.query("SELECT pin_hash FROM employees WHERE id = $1", [empId]);
    expect(rows.length).toBe(1);
    const pinHash = rows[0].pin_hash;
    expect(pinHash).toBeTruthy();

    // Both directions matter: asserting only that the new PIN verifies would
    // still pass if the update appended a second credential without retiring
    // the old one.
    expect(await bcrypt.compare("9999", pinHash)).toBe(true);
    expect(await bcrypt.compare("8888", pinHash)).toBe(false);
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
    const res = await makeRequest(app).post("/api/employees/validate-pin").send({});

    expect(res.status).toBe(400);
  });
});

describe("JWT token operations (unit-level)", () => {
  const {
    signAccessToken,
    verifyAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    hashToken,
  } = require("../../jwt-auth");

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
