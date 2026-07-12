/**
 * PLAN-V2 Step 4 (D4b) — view_reports split posture + S5 verification.
 *
 * Exercises the ratified data-class split against the real HTTP + guard stack:
 *  - pristine Cashier (seeded view_sales_reports only) reaches sales reports,
 *    403s financial / inventory / HR reports and team attendance;
 *  - Manager (all five splits) reaches every class;
 *  - a custom inventory-only role reaches inventory reports, 403s financial;
 *  - S5: a sales-only token's GET /api/products (+ scan) strips cost fields
 *    while POS reads still work; a cost-class token still sees cost.
 */
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("PLAN-V2 Step 4 — report-perm split + S5 (Postgres)", () => {
  let app, db, deps, cleanup;
  let invViewerId; // custom role: view_inventory_reports only

  const get = (path, empId) =>
    request(app).get(path).set("x-employee-id", String(empId));

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/products")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/reports")(app, deps);

    // Custom role holding ONLY the inventory split — models a grandfathered /
    // purpose-built role that should reach inventory reports but nothing else.
    const { rows: [role] } = await db.query(
      "INSERT INTO roles (name) VALUES ('Inv Viewer S4') RETURNING id"
    );
    await db.query(
      "INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'view_inventory_reports')",
      [role.id]
    );
    const { rows: [emp] } = await db.query(
      "INSERT INTO employees (name, pin_code, role_id) VALUES ('Inv Viewer S4', '9191', $1) RETURNING id",
      [role.id]
    );
    invViewerId = emp.id;
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const ADMIN = 1, MANAGER = 2, CASHIER = 3;

  describe("pristine Cashier (view_sales_reports only)", () => {
    it("reaches sales-class reports", async () => {
      expect((await get("/api/reports/sales-summary", CASHIER)).status).toBe(200);
    });
    it("403s financial-class reports", async () => {
      expect((await get("/api/reports/settlement-overview", CASHIER)).status).toBe(403);
    });
    it("403s inventory-class reports", async () => {
      expect((await get("/api/reports/on-hand", CASHIER)).status).toBe(403);
    });
    it("403s HR-class reports", async () => {
      expect((await get("/api/reports/labor-performance", CASHIER)).status).toBe(403);
    });
    it("403s team attendance (§8 #3)", async () => {
      expect((await get("/api/attendance", CASHIER)).status).toBe(403);
    });
    it("STILL reaches self attendance my-status (POS shift gate must not break)", async () => {
      // Self-scoped: drives useShiftGate → isReadyForCheckout. A 403 here
      // would brick POS checkout for every Cashier. Exempt from the HR gate.
      expect((await get("/api/attendance/my-status?outlet_id=1", CASHIER)).status).toBe(200);
    });
  });

  describe("Manager (all five splits)", () => {
    it("reaches sales, financial, inventory and HR reports", async () => {
      expect((await get("/api/reports/sales-summary", MANAGER)).status).toBe(200);
      expect((await get("/api/reports/settlement-overview", MANAGER)).status).toBe(200);
      expect((await get("/api/reports/on-hand", MANAGER)).status).toBe(200);
      expect((await get("/api/reports/labor-performance", MANAGER)).status).toBe(200);
    });
    it("reaches team attendance", async () => {
      expect((await get("/api/attendance", MANAGER)).status).toBe(200);
    });
  });

  describe("custom inventory-only role (grandfather-shaped)", () => {
    it("reaches inventory reports", async () => {
      expect((await get("/api/reports/on-hand", invViewerId)).status).toBe(200);
    });
    it("403s financial and sales reports", async () => {
      expect((await get("/api/reports/settlement-overview", invViewerId)).status).toBe(403);
      expect((await get("/api/reports/sales-summary", invViewerId)).status).toBe(403);
    });
  });

  describe("S5 — cost-field stripping on product reads", () => {
    it("strips cost_price for a sales-only Cashier on GET /api/products", async () => {
      const res = await get("/api/products", CASHIER);
      expect(res.status).toBe(200);
      expect(res.body.products.length).toBeGreaterThan(0);
      for (const p of res.body.products) {
        expect(p).not.toHaveProperty("cost_price");
      }
    });
    it("keeps cost_price for a Manager (holds view_financial_reports)", async () => {
      const res = await get("/api/products", MANAGER);
      expect(res.status).toBe(200);
      expect(res.body.products.some((p) => p.cost_price !== undefined)).toBe(true);
    });
    it("POS scan still returns the product for a Cashier, cost stripped", async () => {
      const res = await get("/api/products/scan/PROD-001", CASHIER);
      expect(res.status).toBe(200);
      expect(res.body.product).toBeTruthy();
      expect(res.body.product).not.toHaveProperty("cost_price");
      // Price (the POS-relevant field) is still present.
      expect(res.body.product.price).toBeDefined();
    });
    it("POS search still returns products for a Cashier, cost stripped", async () => {
      const res = await get("/api/products/search?query=Widget", CASHIER);
      expect(res.status).toBe(200);
      expect(res.body.products.length).toBeGreaterThan(0);
      for (const p of res.body.products) {
        expect(p).not.toHaveProperty("cost_price");
      }
    });
  });
});
