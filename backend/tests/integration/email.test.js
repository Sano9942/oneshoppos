/**
 * email.test.js — Integration tests for email routes
 *
 * GET  /api/email/config       — auth guard, returns row with masked password
 * PUT  /api/email/config       — saves config
 * POST /api/email/test         — 503 when not configured
 * POST /api/email/send-receipt — auth, validation, 503 when not configured, 404 on bad saleId
 */

const { createTestApp, closeDb, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;

  // email_config table is added in migrate65 — not in seedSchema, create it here
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS email_config (
      id          INTEGER PRIMARY KEY,
      smtp_host   TEXT    DEFAULT 'smtp.gmail.com',
      smtp_port   INTEGER DEFAULT 587,
      smtp_user   TEXT,
      smtp_pass   TEXT,
      from_name   TEXT    DEFAULT 'SanoPOS',
      enabled     INTEGER DEFAULT 0
    )
  `);
  await dbRun(db, "INSERT OR IGNORE INTO email_config (id) VALUES (1)");
});

afterAll(async () => {
  await closeDb(db);
});

// ---------------------------------------------------------------------------
// GET /api/email/config
// ---------------------------------------------------------------------------
describe("GET /api/email/config", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app).get("/api/email/config");
    expect(res.status).toBe(401);
  });

  it("returns config row with masked password", async () => {
    await dbRun(db, "UPDATE email_config SET smtp_pass = 'secret123' WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID).get("/api/email/config");
    expect(res.status).toBe(200);
    expect(res.body.smtp_host).toBe("smtp.gmail.com");
    expect(res.body.smtp_pass).toBe("*****");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/email/config
// ---------------------------------------------------------------------------
describe("PUT /api/email/config", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app).put("/api/email/config").send({});
    expect(res.status).toBe(401);
  });

  it("saves config and returns { ok: true }", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put("/api/email/config")
      .send({ smtp_host: "smtp.outlook.com", smtp_port: 587, smtp_user: "test@outlook.com", enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const check = await makeRequest(app, ADMIN_ID).get("/api/email/config");
    expect(check.body.smtp_host).toBe("smtp.outlook.com");
    expect(check.body.smtp_user).toBe("test@outlook.com");
    expect(check.body.enabled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/email/test
// ---------------------------------------------------------------------------
describe("POST /api/email/test", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app).post("/api/email/test");
    expect(res.status).toBe(401);
  });

  it("returns 503 when email not configured (enabled=0)", async () => {
    await dbRun(db, "UPDATE email_config SET enabled = 0, smtp_pass = NULL WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID).post("/api/email/test");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/email/send-receipt
// ---------------------------------------------------------------------------
describe("POST /api/email/send-receipt", () => {
  it("returns 401 without x-employee-id", async () => {
    const res = await makeRequest(app)
      .post("/api/email/send-receipt")
      .send({ saleId: 1, toEmail: "test@example.com" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when toEmail is missing", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("returns 400 when toEmail is invalid format", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 1, toEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when saleId is missing", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ toEmail: "test@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/saleId/i);
  });

  it("returns 503 when email not configured", async () => {
    await dbRun(db, "UPDATE email_config SET enabled = 0 WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 1, toEmail: "test@example.com" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("returns 404 when saleId does not exist (email configured)", async () => {
    // Enable email with a fake password so it passes config check
    await dbRun(db, "UPDATE email_config SET enabled = 1, smtp_user = 'x@x.com', smtp_pass = 'fake' WHERE id = 1");
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/email/send-receipt")
      .send({ saleId: 999999, toEmail: "customer@example.com" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
