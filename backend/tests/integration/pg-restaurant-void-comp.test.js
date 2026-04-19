/**
 * pg-restaurant-void-comp.test.js — Phase 2-R Wave B / 2-R.2
 *
 * Void + comp workflow with manager PIN override and reason codes.
 *   1. Valid PIN + comp reason writes a sale_item_adjustments row.
 *   2. Wrong PIN returns 401.
 *   3. Impersonation mode blocks override (403).
 *   4. GET /adjustments?sale_id returns the audit trail with manager name.
 */

// Force single-tenant mode BEFORE requires so public-tenant-context
// skips master-db lookup.
delete process.env.MULTI_TENANT;

const request = require("supertest");
const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { MIGRATIONS } = require("../../migrate-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 300000 });

describe("Phase 2-R.2 — Void + comp with manager PIN", () => {
  let app, db, deps, cleanup, schemaName;
  let impersonating = false;
  let saleId, saleItemId;

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    // Apply v59 schema (sale_item_adjustments, void_reason_codes) onto the
    // isolated test schema. schema-pg.sql was seeded up through v58.
    const v59 = MIGRATIONS.find((m) => m.version === 59);
    await v59.up(await db.getClient());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    // Inject req.employee + req.isImpersonating for audit logging.
    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      req.isImpersonating = impersonating;
      next();
    });

    require("../../routes/restaurant/void-comp")(app, deps);

    // Flip restaurant mode + void/comp flag on.
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = true`
    );
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_restaurant_void_comp', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    featureFlags.invalidateFeatureFlagCache();
    featureFlags.invalidateModeCache();

    // Grant Manager role the override_void_comp perm so verifyManagerPin
    // accepts the manager's PIN (role_id=2 = Manager seeded in fixtures).
    await db.query(
      `INSERT INTO role_permissions (role_id, permission)
       VALUES (2, 'override_void_comp')
       ON CONFLICT DO NOTHING`
    );

    // Manager User (id=2) has plaintext PIN '2222' from fixtures — give them
    // a hashed PIN to exercise the bcrypt branch of verifyManagerPin.
    const managerHash = await bcrypt.hash("4242", 10);
    await db.query(
      `UPDATE employees SET pin_hash = $1, pin_code = NULL WHERE id = 2`,
      [managerHash]
    );

    // Seed a completed sale with two items so we have real ids to adjust.
    const { rows: [sale] } = await db.query(
      `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id)
       VALUES (500, 'cash', 1, 1) RETURNING id`
    );
    saleId = sale.id;
    const { rows: [item1] } = await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale)
       VALUES ($1, 1, 1, 200) RETURNING id`,
      [saleId]
    );
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale)
       VALUES ($1, 2, 1, 300)`,
      [saleId]
    );
    saleItemId = item1.id;
  });

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  it("comps an item with valid manager PIN (201 + adjustment row)", async () => {
    const res = await request(app)
      .post(`/api/restaurant/sale-items/${saleItemId}/adjust`)
      .set("x-employee-id", "1") // admin creates it (all_access bypasses manage_restaurant)
      .set("x-tenant-schema", schemaName)
      .send({
        adjustment_type: "comp",
        reason_code: "vip_comp",
        reason_note: "VIP guest",
        amount: 200,
        manager_pin: "4242",
      });
    expect(res.status).toBe(201);
    expect(res.body.adjustment.adjustment_type).toBe("comp");
    expect(res.body.adjustment.reason_code).toBe("vip_comp");
    expect(Number(res.body.adjustment.amount)).toBe(200);
    expect(res.body.adjustment.manager_employee_id).toBe(2);
    expect(res.body.adjustment.created_by_employee_id).toBe(1);
    expect(Number(res.body.adjustment_totals.comp)).toBe(200);
  });

  it("refuses wrong manager PIN with 401", async () => {
    const res = await request(app)
      .post(`/api/restaurant/sale-items/${saleItemId}/adjust`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({
        adjustment_type: "void",
        reason_code: "spilled",
        amount: 100,
        manager_pin: "9999",
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid pin/i);
  });

  it("blocks override in impersonation mode with 403", async () => {
    impersonating = true;
    try {
      const res = await request(app)
        .post(`/api/restaurant/sale-items/${saleItemId}/adjust`)
        .set("x-employee-id", "1")
        .set("x-tenant-schema", schemaName)
        .send({
          adjustment_type: "comp",
          reason_code: "vip_comp",
          amount: 100,
          manager_pin: "4242",
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/impersonation/i);
    } finally {
      impersonating = false;
    }
  });

  it("rejects a reason incompatible with the adjustment type", async () => {
    // 'spilled' is a void-only reason — should fail as comp
    const res = await request(app)
      .post(`/api/restaurant/sale-items/${saleItemId}/adjust`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({
        adjustment_type: "comp",
        reason_code: "spilled",
        amount: 100,
        manager_pin: "4242",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be used/i);
  });

  it("GET /api/restaurant/adjustments returns audit trail with manager name", async () => {
    const res = await request(app)
      .get(`/api/restaurant/adjustments?sale_id=${saleId}`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const first = res.body[0];
    expect(first.manager_name).toBe("Manager User");
    expect(first.reason_code).toBe("vip_comp");
    expect(first.reason_label).toBe("VIP / manager comp");
  });

  it("GET /api/restaurant/void-reasons lists active reason codes", async () => {
    const res = await request(app)
      .get("/api/restaurant/void-reasons?adjustment_type=void")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const codes = res.body.map((r) => r.code);
    expect(codes).toContain("spilled");
    expect(codes).toContain("wrong_order");
    // vip_comp is comp-only — filter should exclude it
    expect(codes).not.toContain("vip_comp");
  });
});
