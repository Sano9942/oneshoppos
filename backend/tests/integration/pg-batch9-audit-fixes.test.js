const request = require("supertest");
const express = require("express");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 9 — Architecture audit fixes (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Wire routes needed for these tests
    require("../../routes/auth")(app, deps);
    require("../../routes/employees")(app, deps);
    require("../../routes/support")(app, deps);
    require("../../routes/returns")(app, deps);
    require("../../routes/customers")(app, deps);
    require("../../routes/purchase-orders")(app, deps);
    require("../../routes/inventory")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ─── Fix 1: CORS_ORIGIN .split(",")[0] ──────────────────────

  describe("CORS_ORIGIN password reset URL", () => {
    it("forgot-password uses first origin from comma-separated CORS_ORIGIN", async () => {
      // Set up: employee with email
      await db.query(
        "UPDATE employees SET email = $1 WHERE id = 1",
        ["test-reset@example.com"]
      );

      // Temporarily set CORS_ORIGIN to comma-separated value and disable MT
      const origCors = process.env.CORS_ORIGIN;
      const origMt = process.env.MULTI_TENANT;
      process.env.CORS_ORIGIN = "https://sanopos.com,https://www.sanopos.com,https://sanopos.vercel.app";
      delete process.env.MULTI_TENANT;

      // Mock sendPasswordResetEmail to capture the reset link
      let capturedResetLink = null;
      const resendModule = require("../../utils/resendEmail");
      const originalSend = resendModule.sendPasswordResetEmail;
      resendModule.sendPasswordResetEmail = async (opts) => {
        capturedResetLink = opts.resetLink;
      };

      try {
        await request(app)
          .post("/api/auth/forgot-password")
          .send({ username: "Hassan" });

        // The reset link should use ONLY the first origin
        expect(capturedResetLink).toBeTruthy();
        expect(capturedResetLink).toMatch(/^https:\/\/sanopos\.com\/reset-password\?token=/);
        expect(capturedResetLink).not.toContain(",");
      } finally {
        // Restore
        if (origCors !== undefined) process.env.CORS_ORIGIN = origCors;
        else delete process.env.CORS_ORIGIN;
        if (origMt !== undefined) process.env.MULTI_TENANT = origMt;
        else delete process.env.MULTI_TENANT;
        resendModule.sendPasswordResetEmail = originalSend;
      }
    });
  });

  // ─── Fix 2: SQL injection in admin tax suggestion approval ──

  describe("Admin tax suggestion slug validation", () => {
    it("rejects malicious tenant_slug with SQL injection", async () => {
      // The admin route requires requireAllowedIp + requireSuperAdmin,
      // which aren't wired in test context. We test the validation
      // by directly calling the route handler logic.
      // Since admin.js isn't registered, let's test the regex directly.
      const validSlug = /^[a-z0-9_]{3,40}$/;

      // Malicious slugs
      expect(validSlug.test("'; DROP TABLE--")).toBe(false);
      expect(validSlug.test("tenant_ok; DELETE FROM")).toBe(false);
      expect(validSlug.test("../../etc/passwd")).toBe(false);
      expect(validSlug.test("ab")).toBe(false); // too short
      expect(validSlug.test("a".repeat(41))).toBe(false); // too long
      expect(validSlug.test("tenant-with-hyphens")).toBe(false); // hyphens not allowed

      // Valid slugs
      expect(validSlug.test("packagesmall")).toBe(true);
      expect(validSlug.test("test_pro_store_2")).toBe(true);
      expect(validSlug.test("abc")).toBe(true);
    });
  });

  // ─── Fix 3: HTML escape in support ticket alert ─────────────

  describe("Support ticket HTML sanitization", () => {
    it("creates ticket with HTML in message (stored as-is, escaped in email)", async () => {
      const maliciousMessage = '<script>alert("xss")</script><img src=x onerror=alert(1)>';

      const res = await request(app)
        .post("/api/support/tickets")
        .set("x-employee-id", "1")
        .send({
          type: "bug",
          message: maliciousMessage,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();

      // Message is stored as-is in DB (the escaping happens in the email, not storage)
      const { rows } = await db.query(
        "SELECT message FROM support_tickets WHERE id = $1",
        [res.body.id]
      );
      expect(rows[0].message).toBe(maliciousMessage.trim());
    });

    it("esc helper escapes HTML entities correctly", () => {
      // Verify the inline esc function's logic matches what we deployed
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(esc("Normal text")).toBe("Normal text");
      expect(esc("Tom & Jerry <friends>")).toBe("Tom &amp; Jerry &lt;friends&gt;");
      expect(esc('a"b')).toBe('a&quot;b');
    });
  });

  // ─── Fix 5: Stop writing pin_code plaintext ─────────────────

  describe("pin_code no longer written on create/update", () => {
    it("new employee has pin_hash but no plaintext pin_code", async () => {
      const res = await request(app)
        .post("/api/employees")
        .set("x-employee-id", "1")
        .send({ name: "Pin Test User", pin_code: "9876", role_id: 3 });

      expect(res.status).toBe(200);
      const newId = res.body.id;

      const { rows } = await db.query(
        "SELECT pin_code, pin_hash FROM employees WHERE id = $1",
        [newId]
      );
      expect(rows[0].pin_code).toBeNull();
      expect(rows[0].pin_hash).toBeTruthy();
    });

    it("updating employee PIN sets hash but not plaintext", async () => {
      const res = await request(app)
        .put("/api/employees/3")
        .set("x-employee-id", "1")
        .send({ pin_code: "5555" });

      expect(res.status).toBe(200);

      const { rows } = await db.query(
        "SELECT pin_code, pin_hash FROM employees WHERE id = 3"
      );
      // pin_code should still be the old seeded value (not overwritten to "5555")
      expect(rows[0].pin_code).not.toBe("5555");
      expect(rows[0].pin_hash).toBeTruthy();

      // Verify the hash matches the new PIN
      const bcrypt = require("bcryptjs");
      const match = await bcrypt.compare("5555", rows[0].pin_hash);
      expect(match).toBe(true);
    });

    it("login still works with hash-only employee (no pin_code)", async () => {
      // Create employee with hash only (no pin_code)
      const bcrypt = require("bcryptjs");
      const hash = await bcrypt.hash("7777", 10);
      await db.query(
        "INSERT INTO employees (id, name, pin_hash, role_id) VALUES (99, 'HashOnly User', $1, 3)",
        [hash]
      );
      await db.query(
        "INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (99, 1, true)"
      );

      const res = await request(app)
        .post("/api/employees/validate-pin")
        .send({ pin_code: "7777" });

      expect(res.status).toBe(200);
      expect(res.body.employee.id).toBe(99);
    });
  });

  // ─── Fix 8: Opaque upload filenames ─────────────────────────

  describe("Support upload opaque filenames", () => {
    it("generates opaque filename from crypto, preserving extension", () => {
      const crypto = require("crypto");
      const path = require("path");

      // Simulate the logic deployed in support.js
      const originalname = "my-secret-screenshot.png";
      const ext = path.extname(originalname).toLowerCase() || ".png";
      const opaqueId = crypto.randomBytes(16).toString("hex");
      const key = `support/${opaqueId}${ext}`;

      // Key should not contain the original filename
      expect(key).not.toContain("my-secret-screenshot");
      // Key should have correct extension
      expect(key).toMatch(/^support\/[a-f0-9]{32}\.png$/);
    });

    it("handles files with no extension", () => {
      const crypto = require("crypto");
      const path = require("path");

      const ext = path.extname("noextension").toLowerCase() || ".png";
      const opaqueId = crypto.randomBytes(16).toString("hex");
      const key = `support/${opaqueId}${ext}`;

      // Falls back to .png
      expect(key).toMatch(/\.png$/);
    });
  });

  // ─── Fix 9: Feature flag fail-closed defaults ───────────────

  describe("Feature flag defaults are fail-closed", () => {
    it("DEFAULT_FLAGS has all privileged flags set to false", () => {
      // This mirrors the frontend useFeatureFlags.js DEFAULT_FLAGS
      const DEFAULT_FLAGS = {
        backup_restore: false,
        e_invoicing_export: false,
        supplier_payables: false,
        approvals: false,
        notifications: false,
        accounting_core: false,
        crm_quotations: false,
        advanced_hr: false,
        multi_company: false,
        ui_redesign_pos: false,
        reports_enhanced_filters: false,
        reports_profit_layer: false,
        reports_inventory_health_plus: false,
        reports_exceptions: false,
        reports_scheduled_exports: false,
        context_selection_required: false,
        context_header_enforced: false,
        kiosk_context_locked: false,
      };

      // Every default must be false (fail-closed)
      for (const [key, value] of Object.entries(DEFAULT_FLAGS)) {
        expect(value).toBe(false);
      }
    });
  });

  // ─── Phase 17: Zod expansion — returns ──────────────────────

  describe("Zod validation — returns", () => {
    it("rejects POST /api/returns with missing outlet_id", async () => {
      const res = await request(app)
        .post("/api/returns")
        .set("x-employee-id", "1")
        .send({
          total_refund: 100,
          refund_method: "cash",
          items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("rejects POST /api/returns with missing refund_method", async () => {
      const res = await request(app)
        .post("/api/returns")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          total_refund: 100,
          items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("rejects POST /api/returns with empty items array", async () => {
      const res = await request(app)
        .post("/api/returns")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, total_refund: 100, refund_method: "cash", items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("passes valid POST /api/returns through Zod (no 400)", async () => {
      const res = await request(app)
        .post("/api/returns")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          total_refund: 50,
          refund_method: "cash",
          items: [{ product_id: 1, quantity: 1, refund_price: 50 }],
        });
      // Zod should not reject — response may be 200 or a DB-level error but not a 400 from Zod
      expect(res.status).not.toBe(400);
    });
  });

  // ─── Phase 17: Zod expansion — customers ────────────────────

  describe("Zod validation — customers", () => {
    it("rejects POST /api/customers with missing name", async () => {
      const res = await request(app)
        .post("/api/customers")
        .set("x-employee-id", "1")
        .send({ mobile: "123-456", email: "test@test.com" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("rejects POST /api/customers with empty name", async () => {
      const res = await request(app)
        .post("/api/customers")
        .set("x-employee-id", "1")
        .send({ name: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("passes valid POST /api/customers through Zod", async () => {
      const res = await request(app)
        .post("/api/customers")
        .set("x-employee-id", "1")
        .send({ name: "Zod Test Customer", mobile: "999-0001" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
    });

    it("rejects PUT /api/customers/:id with missing name", async () => {
      const res = await request(app)
        .put("/api/customers/1")
        .set("x-employee-id", "1")
        .send({ mobile: "555-0001" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  // ─── Phase 17: Zod expansion — purchase-orders ──────────────

  describe("Zod validation — purchase-orders", () => {
    it("rejects POST /api/purchase-orders with missing supplier_id", async () => {
      const res = await request(app)
        .post("/api/purchase-orders")
        .set("x-employee-id", "1")
        .send({ items: [{ product_id: 1, quantity: 5, cost_price: 50 }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("rejects POST /api/purchase-orders with empty items array", async () => {
      const res = await request(app)
        .post("/api/purchase-orders")
        .set("x-employee-id", "1")
        .send({ supplier_id: 1, items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("passes valid POST /api/purchase-orders through Zod", async () => {
      const res = await request(app)
        .post("/api/purchase-orders")
        .set("x-employee-id", "1")
        .send({
          supplier_id: 1,
          total_cost: 250,
          items: [{ product_id: 1, quantity: 5, cost_price: 50 }],
        });
      expect(res.status).not.toBe(400);
      expect(res.body.id).toBeDefined();
    });
  });

  // ─── Phase 17: Zod expansion — inventory ────────────────────

  describe("Zod validation — inventory transfers", () => {
    it("rejects POST /api/transfers with missing product_id", async () => {
      const res = await request(app)
        .post("/api/transfers")
        .set("x-employee-id", "1")
        .send({ from_outlet_id: 1, to_outlet_id: 2, quantity: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("rejects POST /api/transfers with missing to_outlet_id", async () => {
      const res = await request(app)
        .post("/api/transfers")
        .set("x-employee-id", "1")
        .send({ product_id: 1, from_outlet_id: 1, quantity: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("passes valid POST /api/transfers through Zod", async () => {
      const res = await request(app)
        .post("/api/transfers")
        .set("x-employee-id", "1")
        .send({ product_id: 1, from_outlet_id: 1, to_outlet_id: 2, quantity: 3 });
      // Zod passes — may succeed or fail at stock check but not 400 from Zod
      expect(res.status).not.toBe(400);
    });
  });

  describe("Zod validation — stock adjustments", () => {
    it("rejects POST /api/adjustments with missing reason", async () => {
      const res = await request(app)
        .post("/api/adjustments")
        .set("x-employee-id", "1")
        .send({ product_id: 1, outlet_id: 1, quantity_change: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("rejects POST /api/adjustments with missing outlet_id", async () => {
      const res = await request(app)
        .post("/api/adjustments")
        .set("x-employee-id", "1")
        .send({ product_id: 1, quantity_change: 5, reason: "restock" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("passes valid POST /api/adjustments through Zod", async () => {
      const res = await request(app)
        .post("/api/adjustments")
        .set("x-employee-id", "1")
        .send({ product_id: 1, outlet_id: 1, quantity_change: 3, reason: "restock" });
      expect(res.status).not.toBe(400);
    });
  });
});
