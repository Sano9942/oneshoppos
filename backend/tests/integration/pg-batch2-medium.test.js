const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 2 — Medium complexity routes (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    // Register all Batch 2 routes
    require("../../routes/customers")(app, deps);
    require("../../routes/employees")(app, deps);
    require("../../routes/categories")(app, deps);
    require("../../routes/promotions")(app, deps);
    require("../../routes/attribute-sets")(app, deps);
    require("../../routes/returns")(app, deps);
    require("../../routes/inventory")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ─── CUSTOMERS ────────────────────────────────

  describe("customers", () => {
    let customerId;

    it("GET /api/customers returns seeded customers", async () => {
      const res = await request(app).get("/api/customers").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.customers.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/customers creates a customer", async () => {
      const res = await request(app)
        .post("/api/customers")
        .set("x-employee-id", "1")
        .send({ name: "Test Customer", mobile: "555-1111", email: "test@example.com" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.name).toBe("Test Customer");
      customerId = res.body.id;
    });

    it("PUT /api/customers/:id updates a customer", async () => {
      const res = await request(app)
        .put(`/api/customers/${customerId}`)
        .set("x-employee-id", "1")
        .send({ name: "Updated Customer", mobile: "555-2222" });
      expect(res.status).toBe(200);
    });

    it("PUT /api/customers/:id/points updates points", async () => {
      const res = await request(app)
        .put(`/api/customers/${customerId}/points`)
        .set("x-employee-id", "1")
        .send({ points: 100 });
      expect(res.status).toBe(200);
    });

    it("GET /api/customers/:id/wallet returns wallet", async () => {
      const res = await request(app)
        .get(`/api/customers/${customerId}/wallet`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.balance).toBeDefined();
      expect(Array.isArray(res.body.ledger)).toBe(true);
    });

    it("POST /api/customers/:id/wallet/topup tops up wallet", async () => {
      const res = await request(app)
        .post(`/api/customers/${customerId}/wallet/topup`)
        .set("x-employee-id", "1")
        .send({ amount: 500, note: "Test top-up" });
      expect(res.status).toBe(200);
      expect(Number(res.body.balance)).toBe(500);
    });

    it("GET /api/customers?search= filters by name", async () => {
      const res = await request(app)
        .get("/api/customers?search=Updated")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.customers.some(c => c.name === "Updated Customer")).toBe(true);
    });

    it("DELETE /api/customers/:id archives (soft delete)", async () => {
      const res = await request(app)
        .delete(`/api/customers/${customerId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      // Verify hidden from listings
      const listRes = await request(app).get("/api/customers").set("x-employee-id", "1");
      expect(listRes.body.customers.some(c => c.id === customerId)).toBe(false);
    });
  });

  // ─── EMPLOYEES ────────────────────────────────

  describe("employees", () => {
    it("GET /api/employees returns seeded employees", async () => {
      const res = await request(app).get("/api/employees").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.employees.length).toBeGreaterThanOrEqual(3);
    });

    it("POST /api/employees creates an employee", async () => {
      const res = await request(app)
        .post("/api/employees")
        .set("x-employee-id", "1")
        .send({ name: "New Employee", role_id: 3, pin_code: "9999" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
    });

    it("POST /api/employees/validate-pin validates correct PIN", async () => {
      const res = await request(app)
        .post("/api/employees/validate-pin")
        .set("x-employee-id", "1")
        .send({ pin_code: "9999" });
      expect(res.status).toBe(200);
      expect(res.body.employee.name).toBe("New Employee");
    });

    it("POST /api/employees/validate-pin rejects wrong PIN", async () => {
      const res = await request(app)
        .post("/api/employees/validate-pin")
        .set("x-employee-id", "1")
        .send({ pin_code: "0000" });
      expect(res.status).toBe(401);
    });

    it("PUT /api/employees/:id updates an employee", async () => {
      const { rows } = await db.query("SELECT id FROM employees WHERE name = $1", ["New Employee"]);
      const res = await request(app)
        .put(`/api/employees/${rows[0].id}`)
        .set("x-employee-id", "1")
        .send({ name: "Updated Employee" });
      expect(res.status).toBe(200);
    });

    it("DELETE /api/employees/:id archives (soft delete)", async () => {
      const { rows } = await db.query("SELECT id FROM employees WHERE name = $1", ["Updated Employee"]);
      const res = await request(app)
        .delete(`/api/employees/${rows[0].id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("DELETE /api/employees/:id blocks self-delete", async () => {
      const res = await request(app)
        .delete("/api/employees/1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("your own");
    });
  });

  // ─── CATEGORIES ───────────────────────────────

  describe("categories", () => {
    let catId;

    it("GET /api/categories returns seeded categories", async () => {
      const res = await request(app).get("/api/categories").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.categories.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/categories creates a category", async () => {
      const res = await request(app)
        .post("/api/categories")
        .set("x-employee-id", "1")
        .send({ name: "Test Category", description: "A test" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      catId = res.body.id;
    });

    it("PUT /api/categories/:id updates a category", async () => {
      const res = await request(app)
        .put(`/api/categories/${catId}`)
        .set("x-employee-id", "1")
        .send({ name: "Updated Category" });
      expect(res.status).toBe(200);
    });

    it("POST /api/categories rejects duplicate sibling name", async () => {
      const res = await request(app)
        .post("/api/categories")
        .set("x-employee-id", "1")
        .send({ name: "Updated Category" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("sibling");
    });

    it("DELETE /api/categories/:id deletes a category", async () => {
      const res = await request(app)
        .delete(`/api/categories/${catId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("DELETE /api/categories blocks delete with products", async () => {
      // General category (id=1) has products assigned
      const res = await request(app)
        .delete("/api/categories/1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("products");
    });
  });

  // ─── PROMOTIONS ───────────────────────────────

  describe("promotions", () => {
    let promoId;

    it("GET /api/promotions returns empty list initially", async () => {
      const res = await request(app).get("/api/promotions").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.promotions)).toBe(true);
    });

    it("POST /api/promotions creates a promotion", async () => {
      const res = await request(app)
        .post("/api/promotions")
        .set("x-employee-id", "1")
        .send({ name: "10% Off", type: "percent", value: 10 });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      promoId = res.body.id;
    });

    it("PUT /api/promotions/:id updates a promotion", async () => {
      const res = await request(app)
        .put(`/api/promotions/${promoId}`)
        .set("x-employee-id", "1")
        .send({ name: "20% Off", type: "percent", value: 20 });
      expect(res.status).toBe(200);
    });

    it("POST /api/promotions/quote evaluates cart", async () => {
      const res = await request(app)
        .post("/api/promotions/quote")
        .set("x-employee-id", "1")
        .send({
          items: [{ product_id: 1, quantity: 2, price: 100 }],
          order_total: 200,
        });
      expect(res.status).toBe(200);
      expect(res.body.total_promotion_discount).toBe(40); // 20% of 200
    });

    it("DELETE /api/promotions/:id deletes a promotion", async () => {
      const res = await request(app)
        .delete(`/api/promotions/${promoId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── ATTRIBUTE SETS ───────────────────────────

  describe("attribute-sets", () => {
    let setId;

    it("POST /api/attribute-sets creates a set with attributes and options", async () => {
      const res = await request(app)
        .post("/api/attribute-sets")
        .set("x-employee-id", "1")
        .send({
          name: "Color & Size",
          description: "Variants",
          attributes: [
            { name: "Color", options: ["Red", "Blue"] },
            { name: "Size", options: [{ value: "S" }, { value: "M" }] },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      setId = res.body.id;
    });

    it("GET /api/attribute-sets returns nested structure", async () => {
      const res = await request(app).get("/api/attribute-sets").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      const set = res.body.attributeSets.find(s => s.id === setId);
      expect(set).toBeDefined();
      expect(set.attributes.length).toBe(2);
      expect(set.attributes[0].options.length).toBe(2);
    });

    it("PUT /api/attribute-sets/:id replaces attributes", async () => {
      const res = await request(app)
        .put(`/api/attribute-sets/${setId}`)
        .set("x-employee-id", "1")
        .send({
          name: "Color Only",
          description: "Just colors",
          attributes: [{ name: "Color", options: ["Green", "Yellow", "Purple"] }],
        });
      expect(res.status).toBe(200);

      // Verify replacement
      const getRes = await request(app).get("/api/attribute-sets").set("x-employee-id", "1");
      const set = getRes.body.attributeSets.find(s => s.id === setId);
      expect(set.attributes.length).toBe(1);
      expect(set.attributes[0].options.length).toBe(3);
    });

    it("DELETE /api/attribute-sets/:id deletes", async () => {
      const res = await request(app)
        .delete(`/api/attribute-sets/${setId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── RETURNS ──────────────────────────────────

  describe("returns", () => {
    let saleId;

    beforeAll(async () => {
      // Create a sale to return against
      // First open a shift
      await db.query(
        "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status) VALUES ($1, $2, $3, 'open')",
        [1, 1, 5000],
      );
      // Create a sale with items
      const { rows: saleRows } = await db.query(
        "INSERT INTO sales (outlet_id, employee_id, total_amount, payment_method, voided) VALUES ($1, $2, $3, $4, false) RETURNING id",
        [1, 1, 200, "Cash"],
      );
      saleId = saleRows[0].id;
      await db.query(
        "INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES ($1, $2, $3, $4)",
        [saleId, 1, 2, 100],
      );
    });

    it("POST /api/returns creates a return", async () => {
      const res = await request(app)
        .post("/api/returns")
        .set("x-employee-id", "1")
        .send({
          original_sale_id: saleId,
          outlet_id: 1,
          employee_id: 1,
          total_refund: 100,
          refund_method: "Cash",
          reason: "Defective",
          items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
    });

    it("POST /api/returns rejects empty items", async () => {
      const res = await request(app)
        .post("/api/returns")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, items: [] });
      expect(res.status).toBe(400);
    });

    it("POST /api/returns rejects excess return quantity", async () => {
      const res = await request(app)
        .post("/api/returns")
        .set("x-employee-id", "1")
        .send({
          original_sale_id: saleId,
          outlet_id: 1,
          total_refund: 500,
          refund_method: "Cash",
          items: [{ product_id: 1, quantity: 99, refund_price: 100 }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("exceeds");
    });

    it("GET /api/returns lists returns", async () => {
      const res = await request(app).get("/api/returns").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.returns.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/returns/:id returns detail with items", async () => {
      const { rows } = await db.query("SELECT id FROM returns LIMIT 1");
      const res = await request(app)
        .get(`/api/returns/${rows[0].id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.returnData).toBeDefined();
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── INVENTORY TRANSFERS ─────────────────────

  describe("inventory transfers", () => {
    beforeAll(async () => {
      // Ensure stock in outlet 1 for product 1
      await db.query(
        `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = $3`,
        [1, 1, 100],
      );
    });

    it("POST /api/transfers creates a transfer", async () => {
      const res = await request(app)
        .post("/api/transfers")
        .set("x-employee-id", "1")
        .send({
          product_id: 1,
          from_outlet_id: 1,
          to_outlet_id: 2,
          quantity: 10,
          employee_id: 1,
        });
      expect(res.status).toBe(200);
    });

    it("POST /api/transfers rejects insufficient stock", async () => {
      const res = await request(app)
        .post("/api/transfers")
        .set("x-employee-id", "1")
        .send({
          product_id: 1,
          from_outlet_id: 1,
          to_outlet_id: 2,
          quantity: 99999,
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Insufficient");
    });

    it("POST /api/transfers rejects same outlet", async () => {
      const res = await request(app)
        .post("/api/transfers")
        .set("x-employee-id", "1")
        .send({
          product_id: 1,
          from_outlet_id: 1,
          to_outlet_id: 1,
          quantity: 5,
        });
      expect(res.status).toBe(400);
    });

    it("GET /api/transfers lists transfers", async () => {
      const res = await request(app).get("/api/transfers").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.transfers.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/transfers/:id/reverse reverses a transfer", async () => {
      const { rows } = await db.query("SELECT id FROM inventory_transfers WHERE reversed = false LIMIT 1");
      const res = await request(app)
        .post(`/api/transfers/${rows[0].id}/reverse`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("POST /api/transfers/:id/reverse rejects double reversal", async () => {
      const { rows } = await db.query("SELECT id FROM inventory_transfers WHERE reversed = true LIMIT 1");
      const res = await request(app)
        .post(`/api/transfers/${rows[0].id}/reverse`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("already");
    });
  });

  // ─── STOCK ADJUSTMENTS ────────────────────────

  describe("stock adjustments", () => {
    let adjId;

    it("POST /api/adjustments creates an adjustment", async () => {
      const res = await request(app)
        .post("/api/adjustments")
        .set("x-employee-id", "1")
        .send({
          product_id: 1,
          outlet_id: 1,
          employee_id: 1,
          quantity_change: 25,
          reason: "Recount",
        });
      expect(res.status).toBe(200);
    });

    it("GET /api/adjustments lists adjustments", async () => {
      const res = await request(app).get("/api/adjustments").set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      adjId = res.body[0].id;
    });

    it("PUT /api/adjustments/:id updates reason/notes", async () => {
      const res = await request(app)
        .put(`/api/adjustments/${adjId}`)
        .set("x-employee-id", "1")
        .send({ reason: "Updated reason", notes: "Some notes" });
      expect(res.status).toBe(200);
    });

    it("DELETE /api/adjustments/:id deletes and reverses stock", async () => {
      const res = await request(app)
        .delete(`/api/adjustments/${adjId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("POST /api/adjustments rejects missing fields", async () => {
      const res = await request(app)
        .post("/api/adjustments")
        .set("x-employee-id", "1")
        .send({ product_id: 1 });
      expect(res.status).toBe(400);
    });
  });
});
