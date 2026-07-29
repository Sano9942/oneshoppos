const request = require("supertest");
const Papa = require("papaparse");
const { createTestApp } = require("../helpers/createTestApp-pg");

/**
 * Build a CSV upload fixture from an array of row objects.
 *
 * These tests used to build .xlsx workbooks with SheetJS. Imports are CSV-only
 * now — `xlsx` was removed from the product because npm's copy is frozen at
 * 0.18.5 with two advisories whose fixes are published only to SheetJS's own
 * registry — so the fixtures follow.
 *
 * Headers union across all rows in first-seen order, matching what
 * XLSX.utils.json_to_sheet produced, so a row that omits a key still lines up
 * with the header the other rows established.
 */
function csvBuffer(rows) {
  const fields = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!fields.includes(k)) fields.push(k);
  return Buffer.from(Papa.unparse({ fields, data: rows }), "utf8");
}

describe("Batch 10 — Wave 2 tests: support, FBR, import (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Wire routes under test
    require("../../routes/support")(app, deps);
    require("../../routes/fbr")(app, deps);
    require("../../routes/import")(app, deps);

    // Add employee context middleware for support routes
    // (support.js reads req.employee — not set by test harness)
    // We'll set it via headers in tests instead; the loadEmployeePerms
    // middleware is already wired by createTestApp.

    // Seed FBR feature flag as enabled
    await db.query(
      "INSERT INTO feature_flags (key, enabled) VALUES ('fbr_integration', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
    );
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  SUPPORT TICKETS
  // ═══════════════════════════════════════════════════════════════════════

  describe("Support tickets", () => {
    it("POST /api/support/tickets — creates a ticket", async () => {
      const res = await request(app)
        .post("/api/support/tickets")
        .set("x-employee-id", "1")
        .send({
          type: "bug",
          message: "The POS freezes on checkout",
          page_url: "/pos",
          browser: "Chrome 120",
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.type).toBe("bug");
      expect(res.body.message).toBe("The POS freezes on checkout");
      expect(res.body.page_url).toBe("/pos");
      expect(res.body.status).toBe("open");
    });

    it("POST /api/support/tickets — rejects empty message", async () => {
      const res = await request(app)
        .post("/api/support/tickets")
        .set("x-employee-id", "1")
        .send({ type: "bug", message: "" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/message/i);
    });

    it("POST /api/support/tickets — trims whitespace from message", async () => {
      const res = await request(app)
        .post("/api/support/tickets")
        .set("x-employee-id", "1")
        .send({ type: "feature_request", message: "   Add dark mode   " });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Add dark mode");
    });

    it("POST /api/support/tickets — stores screenshots as JSON", async () => {
      const screenshots = [{ filename: "shot1.png", url: "https://r2.example.com/shot1.png" }];
      const res = await request(app)
        .post("/api/support/tickets")
        .set("x-employee-id", "1")
        .send({ type: "bug", message: "UI bug", screenshots });

      expect(res.status).toBe(201);
      const { rows } = await db.query(
        "SELECT screenshots FROM support_tickets WHERE id = $1",
        [res.body.id]
      );
      // Postgres may return pre-parsed JSON or a string
      const parsed = typeof rows[0].screenshots === "string"
        ? JSON.parse(rows[0].screenshots)
        : rows[0].screenshots;
      expect(parsed[0].filename).toBe("shot1.png");
    });

    it("POST /api/support/tickets — defaults type to bug", async () => {
      const res = await request(app)
        .post("/api/support/tickets")
        .set("x-employee-id", "1")
        .send({ message: "Something is broken" });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("bug");
    });

    it("GET /api/support/tickets — lists own tickets only", async () => {
      // Create ticket as employee 2
      await request(app)
        .post("/api/support/tickets")
        .set("x-employee-id", "2")
        .send({ message: "Manager's ticket" });

      // List as employee 2 — should see their ticket
      const res2 = await request(app)
        .get("/api/support/tickets")
        .set("x-employee-id", "2");

      expect(res2.status).toBe(200);
      expect(Array.isArray(res2.body)).toBe(true);
      // All tickets should belong to employee 2
      res2.body.forEach((t) => expect(t.employee_id).toBe(2));

      // List as employee 3 — should NOT see employee 2's ticket
      const res3 = await request(app)
        .get("/api/support/tickets")
        .set("x-employee-id", "3");

      expect(res3.status).toBe(200);
      expect(res3.body.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  FBR CONFIG & DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════

  describe("FBR config", () => {
    it("GET /api/fbr/config — returns config with masked token", async () => {
      // Seed FBR token
      await db.query(
        "UPDATE company_profile SET fbr_api_token = 'secret-token-123', fbr_environment = 'sandbox', fbr_province = 'punjab' WHERE id = 1"
      );

      const res = await request(app)
        .get("/api/fbr/config")
        .set("x-employee-id", "1"); // admin (all_access)

      expect(res.status).toBe(200);
      expect(res.body.fbr_api_token).toBe("••••••••");
      expect(res.body.fbr_environment).toBe("sandbox");
      expect(res.body.fbr_province).toBe("punjab");
      expect(res.body.enabled).toBe(true);
    });

    it("GET /api/fbr/config — returns null token when not set", async () => {
      await db.query(
        "UPDATE company_profile SET fbr_api_token = NULL WHERE id = 1"
      );

      const res = await request(app)
        .get("/api/fbr/config")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.fbr_api_token).toBeNull();
    });

    it("GET /api/fbr/config — 403 for non-admin", async () => {
      const res = await request(app)
        .get("/api/fbr/config")
        .set("x-employee-id", "3"); // cashier

      expect(res.status).toBe(403);
    });

    it("PUT /api/fbr/config — updates FBR settings", async () => {
      const res = await request(app)
        .put("/api/fbr/config")
        .set("x-employee-id", "1")
        .send({
          fbr_api_token: "new-token-456",
          fbr_environment: "production",
          fbr_province: "sindh",
          enabled: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("FBR config updated");

      // Verify DB
      const { rows: [profile] } = await db.query(
        "SELECT fbr_api_token, fbr_environment, fbr_province FROM company_profile WHERE id = 1"
      );
      expect(profile.fbr_api_token).toBe("new-token-456");
      expect(profile.fbr_environment).toBe("production");
      expect(profile.fbr_province).toBe("sindh");
    });

    it("PUT /api/fbr/config — skips masked token update", async () => {
      await db.query(
        "UPDATE company_profile SET fbr_api_token = 'keep-me' WHERE id = 1"
      );

      const res = await request(app)
        .put("/api/fbr/config")
        .set("x-employee-id", "1")
        .send({ fbr_api_token: "••••••••", fbr_province: "kpk" });

      expect(res.status).toBe(200);

      const { rows: [profile] } = await db.query(
        "SELECT fbr_api_token, fbr_province FROM company_profile WHERE id = 1"
      );
      expect(profile.fbr_api_token).toBe("keep-me"); // unchanged
      expect(profile.fbr_province).toBe("kpk"); // updated
    });
  });

  describe("FBR dashboard & invoices", () => {
    beforeAll(async () => {
      // Create a sale for FBR invoice join
      await db.query(
        `INSERT INTO sales (id, invoice_number, total_amount, payment_method, employee_id, outlet_id)
         VALUES (901, 'INV-FBR-001', 5000, 'cash', 1, 1)`
      );

      // Seed FBR invoices
      await db.query(
        `INSERT INTO fbr_invoices (id, sale_id, invoice_type, status, payload)
         VALUES (1, 901, 'sale', 'posted', '{}'),
                (2, 901, 'sale', 'pending', '{}'),
                (3, 901, 'sale', 'failed', '{"error":"timeout"}')`
      );
    });

    it("GET /api/fbr/dashboard — returns status counts", async () => {
      const res = await request(app)
        .get("/api/fbr/dashboard")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.posted).toBeGreaterThanOrEqual(1);
      expect(res.body.pending).toBeGreaterThanOrEqual(1);
      expect(res.body.failed).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.total).toBe("number");
    });

    it("GET /api/fbr/dashboard — 403 for non-admin", async () => {
      const res = await request(app)
        .get("/api/fbr/dashboard")
        .set("x-employee-id", "3");

      expect(res.status).toBe(403);
    });

    it("GET /api/fbr/invoices — lists invoices with pagination", async () => {
      const res = await request(app)
        .get("/api/fbr/invoices")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.invoices.length).toBeGreaterThanOrEqual(3);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
      expect(res.body.page).toBe(1);
    });

    it("GET /api/fbr/invoices — filters by status", async () => {
      const res = await request(app)
        .get("/api/fbr/invoices?status=failed")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      res.body.invoices.forEach((inv) => expect(inv.status).toBe("failed"));
    });

    it("POST /api/fbr/invoices/:id/retry — retries failed invoice", async () => {
      const res = await request(app)
        .post("/api/fbr/invoices/3/retry")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/queued for retry/i);

      // Verify status changed
      const { rows: [inv] } = await db.query(
        "SELECT status, retry_count FROM fbr_invoices WHERE id = 3"
      );
      expect(inv.status).toBe("pending");
      expect(inv.retry_count).toBe(0);
    });

    it("POST /api/fbr/invoices/:id/retry — 404 for non-failed invoice", async () => {
      const res = await request(app)
        .post("/api/fbr/invoices/1/retry") // status=posted
        .set("x-employee-id", "1");

      expect(res.status).toBe(404);
    });

    it("POST /api/fbr/invoices/retry-all — retries all failed", async () => {
      // Reset one back to failed
      await db.query("UPDATE fbr_invoices SET status = 'failed' WHERE id = 3");

      const res = await request(app)
        .post("/api/fbr/invoices/retry-all")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/\d+ invoice\(s\) queued for retry/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  IMPORT
  // ═══════════════════════════════════════════════════════════════════════

  describe("Import routes", () => {
    it("POST /api/import/products — preview mode validates rows", async () => {
      const buffer = csvBuffer([
        { name: "Test Widget", selling_price: 100, category: "Electronics", brand: "TestBrand" },
        { name: "Bad Widget", selling_price: "not-a-number" },
        { name: "", selling_price: 50 }, // missing name
      ]);

      const res = await request(app)
        .post("/api/import/products?preview=1")
        .set("x-employee-id", "1")
        .attach("file", buffer, "products.csv");

      expect(res.status).toBe(200);
      expect(res.body.preview).toBe(true);
      expect(res.body.valid).toBeGreaterThanOrEqual(1);
      // `errors` is a COUNT, not an array — import.js returns
      // `{ valid: valid.length, errors: errors.length }`. The assertion used to
      // read `.length` off that number, which is `undefined`, so it threw a
      // TypeError rather than checking anything. Pre-existing, unrelated to the
      // CSV migration; fixed here because this file had to be touched anyway.
      expect(res.body.errors).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/import/products — real import creates products", async () => {
      const buffer = csvBuffer([
        { name: "Import Widget X", selling_price: 250, category: "Electronics" },
      ]);

      const res = await request(app)
        .post("/api/import/products")
        .set("x-employee-id", "1")
        .attach("file", buffer, "products.csv");

      expect(res.status).toBe(200);
      expect(res.body.imported).toBeGreaterThanOrEqual(1);

      // Verify product exists
      const { rows } = await db.query(
        "SELECT name, price FROM products WHERE name = 'Import Widget X'"
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0].price)).toBe(250);
    });

    it("POST /api/import/products — 400 without file", async () => {
      const res = await request(app)
        .post("/api/import/products")
        .set("x-employee-id", "1");

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no file/i);
    });

    it("POST /api/import/products — 403 for non-admin", async () => {
      const buffer = csvBuffer([{ name: "X", selling_price: 10 }]);

      const res = await request(app)
        .post("/api/import/products?preview=1")
        .set("x-employee-id", "3") // cashier
        .attach("file", buffer, "products.csv");

      expect(res.status).toBe(403);
    });

    it("POST /api/import/customers — imports customers", async () => {
      const buffer = csvBuffer([
        { name: "Imported Customer A", mobile: "0300-1234567", email: "a@test.com" },
        { name: "Imported Customer B" },
      ]);

      const res = await request(app)
        .post("/api/import/customers")
        .set("x-employee-id", "1")
        .attach("file", buffer, "customers.csv");

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(2);
    });

    it("POST /api/import/suppliers — imports suppliers", async () => {
      const buffer = csvBuffer([
        { name: "Imported Supplier X", phone: "021-9999999" },
      ]);

      const res = await request(app)
        .post("/api/import/suppliers")
        .set("x-employee-id", "1")
        .attach("file", buffer, "suppliers.csv");

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1);
    });

    it("GET /api/import/template/products — returns a CSV template", async () => {
      const res = await request(app)
        .get("/api/import/template/products")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
    });

    it("GET /api/import/template/unknown — 400 for invalid entity", async () => {
      const res = await request(app)
        .get("/api/import/template/unknown")
        .set("x-employee-id", "1");

      expect(res.status).toBe(400);
    });
  });
});
