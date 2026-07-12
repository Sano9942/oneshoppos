const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 1 — Core CRUD routes (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    // Register all Batch 1 routes
    require("../../routes/taxes")(app, deps);
    require("../../routes/suppliers")(app, deps);
    require("../../routes/receipt-templates")(app, deps);
    require("../../routes/parked-sales")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/roles")(app, deps);
    require("../../routes/customer-display")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ─── TAXES ─────────────────────────────────

  describe("taxes", () => {
    it("GET /api/taxes returns seeded taxes", async () => {
      const res = await request(app).get("/api/taxes").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.taxes.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/taxes creates a tax", async () => {
      const res = await request(app)
        .post("/api/taxes")
        .set("x-employee-id", "1")
        .send({ name: "Sales Tax 5%", rate: 5, is_default: false });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
    });

    it("PUT /api/taxes/:id updates a tax", async () => {
      const { rows } = await db.query("SELECT id FROM taxes WHERE name = $1", ["Sales Tax 5%"]);
      const res = await request(app)
        .put(`/api/taxes/${rows[0].id}`)
        .set("x-employee-id", "1")
        .send({ name: "Sales Tax 7%", rate: 7 });
      expect(res.status).toBe(200);
    });

    it("DELETE /api/taxes/:id deletes a tax", async () => {
      const { rows } = await db.query("SELECT id FROM taxes WHERE name = $1", ["Sales Tax 7%"]);
      const res = await request(app)
        .delete(`/api/taxes/${rows[0].id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("DELETE /api/taxes/9999 returns 404", async () => {
      const res = await request(app).delete("/api/taxes/9999").set("x-employee-id", "1");
      expect(res.status).toBe(404);
    });
  });

  // ─── SUPPLIERS ─────────────────────────────

  describe("suppliers", () => {
    it("GET /api/suppliers returns seeded suppliers", async () => {
      const res = await request(app).get("/api/suppliers").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.suppliers.length).toBe(2);
    });

    it("POST /api/suppliers creates a supplier", async () => {
      const res = await request(app)
        .post("/api/suppliers")
        .set("x-employee-id", "1")
        .send({ name: "Supplier C", contact_person: "Bob", phone: "555-1234" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.name).toBe("Supplier C");
    });

    it("PUT /api/suppliers/:id updates a supplier", async () => {
      const { rows } = await db.query("SELECT id FROM suppliers WHERE name = $1", ["Supplier C"]);
      const res = await request(app)
        .put(`/api/suppliers/${rows[0].id}`)
        .set("x-employee-id", "1")
        .send({ name: "Supplier C Updated" });
      expect(res.status).toBe(200);
    });

    it("DELETE /api/suppliers/:id deletes a supplier", async () => {
      const { rows } = await db.query("SELECT id FROM suppliers WHERE name = $1", ["Supplier C Updated"]);
      const res = await request(app)
        .delete(`/api/suppliers/${rows[0].id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── RECEIPT TEMPLATES ─────────────────────

  describe("receipt-templates", () => {
    it("GET /api/receipt-templates returns list", async () => {
      const res = await request(app).get("/api/receipt-templates").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.templates)).toBe(true);
    });

    it("POST /api/receipt-templates creates a template", async () => {
      const res = await request(app)
        .post("/api/receipt-templates")
        .set("x-employee-id", "1")
        .send({ name: "Test Template", header_text: "Welcome", footer_text: "Thanks", is_active: true });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
    });

    it("GET /api/receipt-templates/active returns the active template", async () => {
      const res = await request(app).get("/api/receipt-templates/active").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.template.name).toBe("Test Template");
    });

    it("DELETE /api/receipt-templates/:id deletes", async () => {
      const { rows } = await db.query("SELECT id FROM receipt_templates WHERE name = $1", ["Test Template"]);
      const res = await request(app)
        .delete(`/api/receipt-templates/${rows[0].id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── ACTION HISTORY ────────────────────────

  describe("action-history", () => {
    it("POST /api/action-history logs an action", async () => {
      const res = await request(app)
        .post("/api/action-history")
        .set("x-employee-id", "1")
        .send({ user_name: "Test", action_type: "test_action", description: "Testing" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
    });

    it("GET /api/action-history returns logged actions", async () => {
      const res = await request(app).get("/api/action-history").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── PARKED SALES ──────────────────────────

  describe("parked-sales", () => {
    let parkedId;

    it("POST /api/parked-sales parks a sale", async () => {
      const res = await request(app)
        .post("/api/parked-sales")
        .set("x-employee-id", "1")
        .send({
          employee_id: 1,
          outlet_id: 1,
          label: "Test Park",
          items: [
            { product_id: 1, product_name: "Widget A", quantity: 2, price: 100 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      parkedId = res.body.id;
    });

    it("GET /api/parked-sales lists parked sales", async () => {
      const res = await request(app).get("/api/parked-sales").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.parkedSales.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/parked-sales/:id returns sale with items", async () => {
      const res = await request(app)
        .get(`/api/parked-sales/${parkedId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.parkedSale.label).toBe("Test Park");
      expect(res.body.items.length).toBe(1);
    });

    it("DELETE /api/parked-sales/:id removes", async () => {
      const res = await request(app)
        .delete(`/api/parked-sales/${parkedId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("POST /api/parked-sales rejects empty cart", async () => {
      const res = await request(app)
        .post("/api/parked-sales")
        .set("x-employee-id", "1")
        .send({ items: [] });
      expect(res.status).toBe(400);
    });
  });

  // ─── SHIFTS ────────────────────────────────

  describe("shifts", () => {
    let shiftId;

    it("POST /api/shifts/open opens a shift", async () => {
      const res = await request(app)
        .post("/api/shifts/open")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, employee_id: 1, opening_float: 5000 });
      expect(res.status).toBe(200);
      expect(res.body.shift_id).toBeGreaterThan(0);
      shiftId = res.body.shift_id;
    });

    it("POST /api/shifts/open blocks duplicate open shift", async () => {
      const res = await request(app)
        .post("/api/shifts/open")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, employee_id: 1, opening_float: 5000 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("already open");
    });

    it("GET /api/shifts/active returns the open shift", async () => {
      const res = await request(app)
        .get("/api/shifts/active?outlet_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.shift).not.toBeNull();
      expect(res.body.shift.id).toBe(shiftId);
    });

    it("GET /api/shifts lists shifts", async () => {
      const res = await request(app).get("/api/shifts").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.shifts.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/shifts/:id/close closes the shift", async () => {
      const res = await request(app)
        .post(`/api/shifts/${shiftId}/close`)
        .set("x-employee-id", "1")
        .send({ closing_cash: 5000 });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("closed");
      expect(res.body.expected_cash).toBeDefined();
    });

    it("GET /api/variance-reasons returns static list", async () => {
      const res = await request(app).get("/api/variance-reasons").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.reasons.length).toBeGreaterThan(0);
    });
  });

  // ─── ROLES ─────────────────────────────────

  describe("roles", () => {
    it("GET /api/roles returns seeded roles", async () => {
      const res = await request(app).get("/api/roles").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.roles.length).toBe(3);
    });

    it("POST /api/roles creates a role", async () => {
      const res = await request(app)
        .post("/api/roles")
        .set("x-employee-id", "1")
        .send({ name: "Supervisor", description: "Supervisory role" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
    });

    it("PUT /api/roles/:id/permissions sets permissions", async () => {
      const { rows } = await db.query("SELECT id FROM roles WHERE name = $1", ["Supervisor"]);
      const res = await request(app)
        .put(`/api/roles/${rows[0].id}/permissions`)
        .set("x-employee-id", "1")
        .send({ permissions: ["view_sales_reports", "manage_inventory"] });
      expect(res.status).toBe(200);
    });

    it("GET /api/roles/:id/permissions returns permissions", async () => {
      const { rows } = await db.query("SELECT id FROM roles WHERE name = $1", ["Supervisor"]);
      const res = await request(app)
        .get(`/api/roles/${rows[0].id}/permissions`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.permissions).toContain("view_sales_reports");
      expect(res.body.permissions).toContain("manage_inventory");
    });

    it("DELETE /api/roles/:id deletes custom role", async () => {
      const { rows } = await db.query("SELECT id FROM roles WHERE name = $1", ["Supervisor"]);
      const res = await request(app)
        .delete(`/api/roles/${rows[0].id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("DELETE /api/roles/1 blocks deleting default role", async () => {
      const res = await request(app).delete("/api/roles/1").set("x-employee-id", "1");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("default");
    });
  });

  // ─── CUSTOMER DISPLAY ─────────────────────

  describe("customer-display", () => {
    it("POST /api/pos/customer-display pushes cart state", async () => {
      const res = await request(app)
        .post("/api/pos/customer-display")
        .set("x-employee-id", "1")
        .send({
          shift_id: 999,
          items: [{ name: "Widget", qty: 1, price: 100, total: 100 }],
          subtotal: 100,
          tax: 17,
          total: 117,
          status: "active",
        });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("GET /api/pos/customer-display polls cart state", async () => {
      const res = await request(app)
        .get("/api/pos/customer-display?shift_id=999")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(117);
      expect(res.body.items.length).toBe(1);
    });

    it("GET /api/pos/customer-display returns idle for unknown shift", async () => {
      const res = await request(app)
        .get("/api/pos/customer-display?shift_id=0")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("idle");
    });
  });
});
