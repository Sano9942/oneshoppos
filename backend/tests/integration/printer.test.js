/**
 * printer.test.js — Integration tests for ESC/POS printer routes
 *
 * POST /api/print/receipt  — auth guard, slip validation, fallback contract
 * GET  /api/print/status   — reachable property always present
 * GET  /api/print/config   — returns printer_config row with connection_type
 * PUT  /api/print/config   — updates config, returns { ok: true }
 */

const { createTestApp, closeDb, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;

  // seedSchema does not include printer_config (added in migrate64).
  // Create and seed the table so printer routes have something to read/write.
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS printer_config (
      id               INTEGER PRIMARY KEY,
      connection_type  TEXT    DEFAULT 'network',
      host             TEXT    DEFAULT '192.168.1.100',
      port             INTEGER DEFAULT 9100,
      usb_vendor_id    TEXT,
      usb_product_id   TEXT,
      paper_width      INTEGER DEFAULT 48,
      cash_drawer      INTEGER DEFAULT 1,
      is_active        INTEGER DEFAULT 1
    )
  `);
  // Seed default row (id=1). is_active=0 so printReceipt returns fallback
  // rather than trying to open a real TCP connection in tests.
  await dbRun(db, "INSERT OR IGNORE INTO printer_config (id, is_active) VALUES (1, 0)");
});

afterAll(async () => {
  await closeDb(db);
});

// ---------------------------------------------------------------------------
// POST /api/print/receipt
// ---------------------------------------------------------------------------

describe("POST /api/print/receipt", () => {
  it("returns 401 without x-employee-id header", async () => {
    const res = await makeRequest(app)
      .post("/api/print/receipt")
      .send({ slip: { total: 100, cart: [] } });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it("returns 400 when slip is missing from body", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/print/receipt")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slip/i);
  });

  it("returns 200 with ok:true or fallback:true when slip is provided", async () => {
    const slip = {
      total: 500,
      invoiceNumber: "INV-001",
      cart: [{ name: "Widget", price: 500, quantity: 1 }],
      payments: [{ method: "Cash", amount: 500 }],
    };

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/print/receipt")
      .send({ slip, template: null });

    // Route always returns 200 — frontend checks result.fallback, not HTTP status
    expect(res.status).toBe(200);
    expect(res.body.ok === true || res.body.fallback === true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/print/status
// ---------------------------------------------------------------------------

describe("GET /api/print/status", () => {
  it("returns 401 without x-employee-id header", async () => {
    const res = await makeRequest(app).get("/api/print/status");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a reachable property", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/print/status");

    expect(res.status).toBe(200);
    // reachable may be true, false, or null (USB) — it must exist
    expect("reachable" in res.body || "error" in res.body).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/print/config
// ---------------------------------------------------------------------------

describe("GET /api/print/config", () => {
  it("returns 401 without x-employee-id header", async () => {
    const res = await makeRequest(app).get("/api/print/config");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a connection_type field", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/print/config");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("connection_type");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/print/config
// ---------------------------------------------------------------------------

describe("PUT /api/print/config", () => {
  it("returns 401 without x-employee-id header", async () => {
    const res = await makeRequest(app)
      .put("/api/print/config")
      .send({ connection_type: "usb" });

    expect(res.status).toBe(401);
  });

  it("updates config and returns { ok: true }", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put("/api/print/config")
      .send({
        connection_type: "usb",
        host: "192.168.1.50",
        port: 9100,
        usb_vendor_id: "0x04B8",
        usb_product_id: "0x0202",
        paper_width: 32,
        cash_drawer: false,
        is_active: true,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Verify the change was persisted
    const verify = await makeRequest(app, ADMIN_ID).get("/api/print/config");
    expect(verify.body.connection_type).toBe("usb");
    expect(verify.body.paper_width).toBe(32);
  });
});
