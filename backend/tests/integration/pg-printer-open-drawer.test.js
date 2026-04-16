const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("POST /api/print/open-drawer (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/printer")(app, deps);
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 30000);

  test("returns 401 without x-employee-id header", async () => {
    const res = await request(app).post("/api/print/open-drawer");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("returns 200 + { ok: false } when no printer config exists", async () => {
    // No printer_config seeded in test schema — openDrawer should return
    // ok:false with 'Printer not configured or inactive'.
    const res = await request(app)
      .post("/api/print/open-drawer")
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not configured|inactive/i);
  });

  test("returns 200 + { ok: false, error: 'Cash drawer not enabled ...' } when cash_drawer disabled", async () => {
    // Seed printer_config with is_active=true but cash_drawer=false.
    await db.query(
      `INSERT INTO printer_config (id, connection_type, host, port, paper_width, cash_drawer, is_active)
       VALUES (1, 'network', '192.168.1.100', 9100, 48, false, true)
       ON CONFLICT (id) DO UPDATE SET cash_drawer = EXCLUDED.cash_drawer, is_active = EXCLUDED.is_active`
    );

    const res = await request(app)
      .post("/api/print/open-drawer")
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/cash drawer not enabled/i);
  });
});
