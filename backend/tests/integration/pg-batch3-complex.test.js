const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 3 — Complex routes (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Register Batch 1+2 routes that Batch 3 depends on
    require("../../routes/taxes")(app, deps);
    require("../../routes/suppliers")(app, deps);
    require("../../routes/categories")(app, deps);
    require("../../routes/customers")(app, deps);
    require("../../routes/employees")(app, deps);
    require("../../routes/roles")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/returns")(app, deps);
    require("../../routes/inventory")(app, deps);

    // Register Batch 3 routes
    require("../../routes/auth")(app, deps);
    const createSetupRouter = require("../../routes/setup");
    app.use("/api/setup", createSetupRouter(deps.db));
    require("../../routes/grn")(app, deps);
    require("../../routes/purchase-orders")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/products")(app, deps);
    require("../../routes/orders")(app, deps);
    require("../../routes/barcode-expenses")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ─── AUTH ─────────────────────────────────────────────

  describe("auth", () => {
    it("POST /api/auth/login succeeds with valid credentials", async () => {
      // F3b part 3a (2026-10-01): sign-in needs a password; a PIN alone never signs in.
      await db.query("UPDATE employees SET password_hash = $1 WHERE id = 1", [await require("bcryptjs").hash("hassan-pass-1", 4)]);
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "Hassan", password: "hassan-pass-1" });
      expect(res.status).toBe(200);
      expect(res.body.employee).toBeDefined();
      expect(res.body.employee.name).toBe("Hassan");
      expect(res.body.permissions).toContain("all_access");
    });

    it("POST /api/auth/login fails with a wrong password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "Hassan", password: "9999" });
      expect(res.status).toBe(401);
    });

    it("POST /api/auth/login fails with missing fields", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "Hassan" });
      expect(res.status).toBe(400);
    });

    it("GET /api/context/bootstrap returns outlets and companies", async () => {
      const res = await request(app)
        .get("/api/context/bootstrap")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.outlets).toBeDefined();
      expect(res.body.companies).toBeDefined();
      expect(res.body.outlets.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/auth/me returns employee info", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.employee).toBeDefined();
      expect(res.body.employee.id).toBe(1);
    });
  });

  // ─── SETUP ────────────────────────────────────────────

  describe("setup", () => {
    it("GET /api/setup/status returns setup_complete", async () => {
      const res = await request(app).get("/api/setup/status");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("setup_complete");
    });

    it("POST /api/setup/complete rejects missing token", async () => {
      const res = await request(app)
        .post("/api/setup/complete")
        .send({ company_name: "Test", admin_name: "Admin", admin_pin: "1234" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/token/i);
    });

    it("POST /api/setup/complete rejects invalid token", async () => {
      const res = await request(app)
        .post("/api/setup/complete")
        .send({ token: "wrong-token", company_name: "Test", admin_name: "Admin", admin_pin: "1234" });
      // Either 403 (invalid token) or 403 (already complete) depending on seed state
      expect([403]).toContain(res.status);
    });
  });

  // ─── PURCHASE ORDERS ──────────────────────────────────

  describe("purchase-orders", () => {
    let poId;

    it("POST /api/purchase-orders creates a PO", async () => {
      const res = await request(app)
        .post("/api/purchase-orders")
        .set("x-employee-id", "1")
        .send({
          supplier_id: 1,
          total_cost: 1100,
          items: [
            { product_id: 1, quantity: 10, cost_price: 50 },
            { product_id: 2, quantity: 5, cost_price: 120 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      poId = res.body.id;
    });

    it("GET /api/purchase-orders lists POs", async () => {
      const res = await request(app)
        .get("/api/purchase-orders")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.purchaseOrders.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/purchase-orders/:id returns PO details", async () => {
      const res = await request(app)
        .get(`/api/purchase-orders/${poId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.purchaseOrder).toBeDefined();
      expect(res.body.items.length).toBe(2);
    });

    it("PUT /api/purchase-orders/:id updates a draft PO", async () => {
      const res = await request(app)
        .put(`/api/purchase-orders/${poId}`)
        .set("x-employee-id", "1")
        .send({
          supplier_id: 1,
          total_cost: 900,
          items: [{ product_id: 1, quantity: 20, cost_price: 45 }],
        });
      expect(res.status).toBe(200);
    });

    it("POST /api/purchase-orders/:id/approve approves a PO", async () => {
      const res = await request(app)
        .post(`/api/purchase-orders/${poId}/approve`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("Approved");
    });

    it("DELETE /api/purchase-orders/:id deletes approved PO (only Received blocked)", async () => {
      const res = await request(app)
        .delete(`/api/purchase-orders/${poId}`)
        .set("x-employee-id", "1");
      // Approved POs can be deleted; only "Received" is blocked
      expect(res.status).toBe(200);
    });
  });

  // ─── PO TEMPLATES ─────────────────────────────────────

  describe("po-templates", () => {
    let templateId;

    it("POST /api/po-templates creates a template", async () => {
      const res = await request(app)
        .post("/api/po-templates")
        .set("x-employee-id", "1")
        .send({
          name: "Weekly Restock",
          supplier_id: 1,
          items: [{ product_id: 1, quantity: 50, unit_cost: 50 }],
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      templateId = res.body.id;
    });

    it("GET /api/po-templates lists templates", async () => {
      const res = await request(app)
        .get("/api/po-templates")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.templates.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/po-templates/:id/use creates a PO from template", async () => {
      const res = await request(app)
        .post(`/api/po-templates/${templateId}/use`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
    });

    it("DELETE /api/po-templates/:id deletes a template", async () => {
      const res = await request(app)
        .delete(`/api/po-templates/${templateId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── GRN ──────────────────────────────────────────────

  describe("grn", () => {
    it("GET /api/grn returns empty list initially", async () => {
      const res = await request(app)
        .get("/api/grn")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.grns || res.body)).toBe(true);
    });
  });

  // ─── ATTENDANCE ───────────────────────────────────────

  describe("attendance", () => {
    it("GET /api/attendance returns records", async () => {
      const res = await request(app)
        .get("/api/attendance")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.records || res.body)).toBe(true);
    });

    it("GET /api/attendance/sessions returns sessions", async () => {
      const res = await request(app)
        .get("/api/attendance/sessions")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sessions || res.body)).toBe(true);
    });

    it("POST /api/attendance/pin-status returns employee status", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-status")
        .send({ pin_code: "2580", outlet_id: 1 });
      expect(res.status).toBe(200);
      expect(res.body.employee).toBeDefined();
      expect(res.body.employee.name).toBe("Hassan");
    });

    it("POST /api/attendance/pin-status rejects wrong PIN", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-status")
        .send({ pin_code: "9999", outlet_id: 1 });
      expect(res.status).toBe(401);
    });

    it("POST /api/attendance/pin-checkin checks in an employee", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: "2580", outlet_id: 1 });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/welcome/i);
    });

    it("POST /api/attendance/pin-checkout checks out an employee", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-checkout")
        .send({ pin_code: "2580", outlet_id: 1 });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/goodbye/i);
    });
  });

  // ─── SALES ────────────────────────────────────────────

  describe("sales", () => {
    let saleId;
    let shiftId;

    beforeAll(async () => {
      // Create a shift so sales can go through
      const shiftRes = await request(app)
        .post("/api/shifts/open")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, opening_float: 500, denominations: {} });
      shiftId = shiftRes.body.shiftId || shiftRes.body.id;

      // Check in employee for attendance gate
      await request(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: "2580", outlet_id: 1 });
    });

    it("POST /api/sales creates a sale", async () => {
      const res = await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1,
          employee_id: 1,
          cartItems: [
            { id: 1, name: "Widget A", price: 100, quantity: 2, cost_price: 50, tax: 0 },
          ],
          payments: [{ method: "cash", amount: 200 }],
          idempotency_key: "test-sale-" + Date.now(),
        });
      expect(res.status).toBe(200);
      expect(res.body.saleId).toBeGreaterThan(0);
      saleId = res.body.saleId;
    });

    it("POST /api/sales deducts stock", async () => {
      const { rows: [stock] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
      );
      // Started with 50, sold 2
      expect(stock.quantity).toBe(48);
    });

    it("POST /api/sales rejects duplicate idempotency_key", async () => {
      const key = "test-dup-" + Date.now();
      await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1, employee_id: 1,
          cartItems: [{ id: 2, name: "Widget B", price: 100, quantity: 1, cost_price: 60, tax: 0 }],
          payments: [{ method: "cash", amount: 100 }],
          idempotency_key: key,
        });
      const res = await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1, employee_id: 1,
          cartItems: [{ id: 2, name: "Widget B", price: 100, quantity: 1, cost_price: 60, tax: 0 }],
          payments: [{ method: "cash", amount: 100 }],
          idempotency_key: key,
        });
      expect(res.status).toBe(200);
      expect(res.body.duplicate).toBe(true);
    });

    it("GET /api/sales lists sales", async () => {
      const res = await request(app)
        .get("/api/sales")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.sales.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/sales/:id returns sale details", async () => {
      const res = await request(app)
        .get(`/api/sales/${saleId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.sale).toBeDefined();
      expect(res.body.items.length).toBe(1);
    });
  });

  // ─── PRODUCTS ─────────────────────────────────────────

  describe("products", () => {
    let newProductId;

    it("GET /api/products lists seeded products", async () => {
      const res = await request(app)
        .get("/api/products")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.products.length).toBeGreaterThanOrEqual(5);
    });

    it("GET /api/products/:id returns a specific product", async () => {
      const res = await request(app)
        .get("/api/products/1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.product).toBeDefined();
      expect(res.body.product.name).toBe("Widget A");
    });

    it("GET /api/products/search searches by name", async () => {
      const res = await request(app)
        .get("/api/products/search?query=Widget")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.products.length).toBeGreaterThanOrEqual(2);
    });

    it("GET /api/products/scan/:barcode finds by barcode", async () => {
      const res = await request(app)
        .get("/api/products/scan/PROD-001")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.product).toBeDefined();
      expect(res.body.product.name).toBe("Widget A");
    });

    it("POST /api/products creates a new product", async () => {
      const res = await request(app)
        .post("/api/products")
        .set("x-employee-id", "1")
        .send({
          name: "New Product",
          barcode: "NEW-001",
          price: 150,
          cost_price: 90,
          stock: 25,
          category_id: 1,
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      newProductId = res.body.id;
    });

    it("PUT /api/products/:id updates a product", async () => {
      const res = await request(app)
        .put(`/api/products/${newProductId}`)
        .set("x-employee-id", "1")
        .send({ name: "Updated Product", price: 175 });
      expect(res.status).toBe(200);
    });

    it("PUT /api/products/:id logs price change", async () => {
      // Change price to trigger audit log
      await request(app)
        .put(`/api/products/${newProductId}`)
        .set("x-employee-id", "1")
        .send({ price: 200 });
      const { rows } = await db.query(
        "SELECT * FROM action_history WHERE action_type = 'price_change'"
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("DELETE /api/products/:id soft-deletes a product", async () => {
      const res = await request(app)
        .delete(`/api/products/${newProductId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      // Verify soft delete
      const { rows: [prod] } = await db.query(
        "SELECT deleted_at FROM products WHERE id = $1", [newProductId]
      );
      expect(prod.deleted_at).not.toBeNull();
    });

    it("GET /api/products/:id/stock returns outlet stock", async () => {
      const res = await request(app)
        .get("/api/products/1/stock")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.stock || res.body)).toBe(true);
    });
  });

  // ─── ORDERS ───────────────────────────────────────────

  describe("orders", () => {
    let orderId;

    it("POST /api/orders creates an order", async () => {
      const res = await request(app)
        .post("/api/orders")
        .set("x-employee-id", "1")
        .send({
          external_order_id: "WEB-" + Date.now(),
          external_order_number: "#1001",
          customer_name: "Web Customer",
          customer_email: "web@example.com",
          source: "website",
          outlet_id: 1,
          total: 300,
          currency: "USD",
          items: [
            { product_id: 1, quantity: 1, price: 100, name: "Widget A" },
            { product_id: 2, quantity: 1, price: 200, name: "Widget B" },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      orderId = res.body.id;
    });

    it("GET /api/orders lists orders", async () => {
      const res = await request(app)
        .get("/api/orders")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.orders || res.body)).toBe(true);
    });

    it("GET /api/orders/:id returns order details", async () => {
      const res = await request(app)
        .get(`/api/orders/${orderId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.order).toBeDefined();
    });
  });

  // ─── BARCODE TEMPLATES ────────────────────────────────

  describe("barcode-templates", () => {
    it("GET /api/barcode-templates returns list", async () => {
      const res = await request(app)
        .get("/api/barcode-templates")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.templates || res.body)).toBe(true);
    });
  });

  // ─── EXPENSES ─────────────────────────────────────────

  describe("expenses", () => {
    let expenseCategoryId;
    let expenseId;

    it("GET /api/expense-categories returns list", async () => {
      const res = await request(app)
        .get("/api/expense-categories")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("POST /api/expense-categories creates a category (via direct db)", async () => {
      const { rows } = await db.query(
        "INSERT INTO expense_categories (name) VALUES ($1) RETURNING id",
        ["Office Supplies"]
      );
      expenseCategoryId = rows[0].id;
      expect(expenseCategoryId).toBeGreaterThan(0);
    });

    it("POST /api/expenses creates an expense", async () => {
      const res = await request(app)
        .post("/api/expenses")
        .set("x-employee-id", "1")
        .send({
          category_id: expenseCategoryId,
          amount: 150,
          description: "Paper and pens",
          outlet_id: 1,
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      expenseId = res.body.id;
    });

    it("GET /api/expenses lists expenses", async () => {
      const res = await request(app)
        .get("/api/expenses")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("PUT /api/expenses/:id updates an expense", async () => {
      const res = await request(app)
        .put(`/api/expenses/${expenseId}`)
        .set("x-employee-id", "1")
        .send({ amount: 175, description: "Paper, pens, and folders" });
      expect(res.status).toBe(200);
    });
  });

  // ─── GIFT CARDS ───────────────────────────────────────

  describe("gift-cards", () => {
    let giftCode;

    it("POST /api/gift-cards creates a gift card", async () => {
      const res = await request(app)
        .post("/api/gift-cards")
        .set("x-employee-id", "1")
        .send({ initial_value: 500 });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeGreaterThan(0);
      giftCode = res.body.code;
    });

    it("GET /api/gift-cards lists gift cards", async () => {
      const res = await request(app)
        .get("/api/gift-cards")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/gift-cards/:code returns card details", async () => {
      const res = await request(app)
        .get(`/api/gift-cards/${giftCode}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.gift_card).toBeDefined();
      expect(Number(res.body.gift_card.remaining_value)).toBe(500);
    });

    it("POST /api/gift-cards/:code/redeem redeems amount", async () => {
      const res = await request(app)
        .post(`/api/gift-cards/${giftCode}/redeem`)
        .set("x-employee-id", "1")
        .send({ amount: 100 });
      expect(res.status).toBe(200);
      expect(Number(res.body.remaining_value)).toBe(400);
    });
  });

  // ─── SERIAL NUMBERS ───────────────────────────────────

  describe("serial-numbers", () => {
    it("GET /api/products/1/serials returns empty list initially", async () => {
      const res = await request(app)
        .get("/api/products/1/serials")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.serials || res.body)).toBe(true);
    });

    it("POST /api/products/1/serials adds serial numbers", async () => {
      const res = await request(app)
        .post("/api/products/1/serials")
        .set("x-employee-id", "1")
        .send({ serial_numbers: ["SN-001", "SN-002", "SN-003"] });
      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(3);
    });
  });

  // ─── NOTIFICATIONS ────────────────────────────────────

  describe("notifications", () => {
    it("GET /api/notifications returns list", async () => {
      const res = await request(app)
        .get("/api/notifications")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });
});
