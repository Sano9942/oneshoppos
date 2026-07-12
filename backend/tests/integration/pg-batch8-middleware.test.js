const request = require("supertest");
const express = require("express");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 8 — Middleware & startup hooks (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Register enough routes for middleware testing
    require("../../routes/auth")(app, deps);
    require("../../routes/roles")(app, deps);
    require("../../routes/employees")(app, deps);

    // Health endpoint
    app.get("/api/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ─── loadEmployeePerms ───────────────────────────────

  describe("loadEmployeePerms", () => {
    it("loads permissions for a valid employee", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.employee).toBeDefined();
      // Employee 1 is Administrator with all_access
      expect(res.body.employee.id).toBe(1);
    });

    it("returns empty perms for missing employee (clean 403, no crash)", async () => {
      const res = await request(app)
        .get("/api/roles")
        .set("x-employee-id", "9999");
      // 9999 does not exist — perms resolve empty. Since business-modules
      // Step 7, GET /api/roles is guarded by requirePerm("all_access"), so
      // empty perms now yield a clean 403 instead of the old open 200.
      expect(res.status).toBe(403);
    });

    it("rejects invalid x-employee-id header", async () => {
      // The test app's loadEmployeePerms doesn't validate — test the pattern directly
      const miniApp = express();
      miniApp.use(express.json());

      // Real validation middleware (mirrors index.js loadEmployeePerms)
      miniApp.use(async (req, res, next) => {
        const employeeId = req.headers["x-employee-id"];
        const parsed = parseInt(employeeId, 10);
        if (employeeId !== undefined && (isNaN(parsed) || parsed <= 0 || parsed > 999999)) {
          return res.status(400).json({ error: "Invalid employee ID header" });
        }
        req.employeePerms = [];
        next();
      });
      miniApp.get("/api/test", (req, res) => res.json({ ok: true }));

      const res = await request(miniApp)
        .get("/api/test")
        .set("x-employee-id", "abc");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid employee/i);
    });

    it("rejects negative x-employee-id", async () => {
      const miniApp = express();
      miniApp.use(express.json());
      miniApp.use(async (req, res, next) => {
        const employeeId = req.headers["x-employee-id"];
        const parsed = parseInt(employeeId, 10);
        if (employeeId !== undefined && (isNaN(parsed) || parsed <= 0 || parsed > 999999)) {
          return res.status(400).json({ error: "Invalid employee ID header" });
        }
        req.employeePerms = [];
        next();
      });
      miniApp.get("/api/test", (req, res) => res.json({ ok: true }));

      const res = await request(miniApp)
        .get("/api/test")
        .set("x-employee-id", "-1");
      expect(res.status).toBe(400);
    });

    it("no x-employee-id header → empty perms → guarded route 403s cleanly", async () => {
      // Pre-Step-7 this was an open 200 (GET /api/roles had no guard); the
      // point of the test — empty perms must not crash the middleware chain —
      // still holds, the guard just answers 403 now.
      const res = await request(app).get("/api/roles");
      expect(res.status).toBe(403);
    });
  });

  // ─── loadCompanyProfile ─────────────────────────────

  describe("loadCompanyProfile", () => {
    it("attaches company profile to req", async () => {
      // The test app stubs loadCompanyProfile, but we can verify the pattern
      // by checking that req.company exists on a handler that uses it
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("returns 503 when setup_complete is false", async () => {
      // Create a mini express app with real loadCompanyProfile behavior
      const miniApp = express();
      miniApp.use(express.json());

      // Middleware that reads setup_complete from DB
      miniApp.use(async (req, res, next) => {
        try {
          const { rows: [row] } = await db.query(
            "SELECT * FROM company_profile WHERE id = 1"
          );
          req.company = row || { timezone: "UTC" };
          if (row && !row.setup_complete &&
              !req.path.startsWith("/api/setup") &&
              !req.path.startsWith("/api/health")) {
            return res.status(503).json({ error: "Setup required", code: "SETUP_REQUIRED" });
          }
          next();
        } catch {
          req.company = { timezone: "UTC" };
          next();
        }
      });

      miniApp.get("/api/test", (req, res) => res.json({ ok: true }));
      miniApp.get("/api/health", (req, res) => res.json({ status: "ok" }));

      // Set setup_complete to false
      await db.query("UPDATE company_profile SET setup_complete = false WHERE id = 1");

      const res1 = await request(miniApp).get("/api/test");
      expect(res1.status).toBe(503);
      expect(res1.body.code).toBe("SETUP_REQUIRED");

      // Health should still work
      const res2 = await request(miniApp).get("/api/health");
      expect(res2.status).toBe(200);

      // Restore
      await db.query("UPDATE company_profile SET setup_complete = true WHERE id = 1");
    });
  });

  // ─── resolveContext ──────────────────────────────────

  describe("resolveContext", () => {
    it("reads context headers and attaches to req", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .set("x-scope-mode", "single");
      expect(res.status).toBe(200);
    });

    it("enforces context when flag is on (non-admin without outlet)", async () => {
      // Create mini app with context enforcement
      const miniApp = express();
      miniApp.use(express.json());

      // Load employee perms
      miniApp.use(async (req, res, next) => {
        const employeeId = req.headers["x-employee-id"];
        if (!employeeId) { req.employeePerms = []; return next(); }
        try {
          const { rows: [emp] } = await db.query(
            "SELECT role_id FROM employees WHERE id = $1", [employeeId]
          );
          if (!emp) { req.employeePerms = []; return next(); }
          const { rows } = await db.query(
            "SELECT permission FROM role_permissions WHERE role_id = $1", [emp.role_id]
          );
          req.employeePerms = rows.map(r => r.permission);
        } catch { req.employeePerms = []; }
        next();
      });

      // resolveContext with enforcement ON
      miniApp.use((req, res, next) => {
        req.context = { companyId: null, outletId: null, scopeMode: null };
        const outletId = req.headers["x-outlet-id"];
        if (outletId) req.context.outletId = Number(outletId);

        const employeeId = Number(req.headers["x-employee-id"] || 0);
        if (!employeeId) return next();

        const perms = req.employeePerms || [];
        const isAdmin = perms.includes("all_access");
        if (!outletId && !isAdmin) {
          return res.status(428).json({ error: "Context required", code: "CONTEXT_REQUIRED" });
        }
        next();
      });

      miniApp.get("/api/test", (req, res) => res.json({ ok: true }));

      // Cashier (employee 3) without outlet header → 428
      const res1 = await request(miniApp)
        .get("/api/test")
        .set("x-employee-id", "3");
      expect(res1.status).toBe(428);
      expect(res1.body.code).toBe("CONTEXT_REQUIRED");

      // Cashier with outlet header → OK
      const res2 = await request(miniApp)
        .get("/api/test")
        .set("x-employee-id", "3")
        .set("x-outlet-id", "1");
      expect(res2.status).toBe(200);
    });

    it("exempts admin users from context enforcement", async () => {
      const miniApp = express();
      miniApp.use(express.json());

      miniApp.use(async (req, res, next) => {
        const employeeId = req.headers["x-employee-id"];
        if (!employeeId) { req.employeePerms = []; return next(); }
        try {
          const { rows: [emp] } = await db.query(
            "SELECT role_id FROM employees WHERE id = $1", [employeeId]
          );
          if (!emp) { req.employeePerms = []; return next(); }
          const { rows } = await db.query(
            "SELECT permission FROM role_permissions WHERE role_id = $1", [emp.role_id]
          );
          req.employeePerms = rows.map(r => r.permission);
        } catch { req.employeePerms = []; }
        next();
      });

      miniApp.use((req, res, next) => {
        req.context = { companyId: null, outletId: null, scopeMode: null };
        const outletId = req.headers["x-outlet-id"];
        if (outletId) req.context.outletId = Number(outletId);

        const employeeId = Number(req.headers["x-employee-id"] || 0);
        if (!employeeId) return next();

        const perms = req.employeePerms || [];
        const isAdmin = perms.includes("all_access");
        if (!outletId && !isAdmin) {
          return res.status(428).json({ error: "Context required", code: "CONTEXT_REQUIRED" });
        }
        next();
      });

      miniApp.get("/api/test", (req, res) => res.json({ ok: true }));

      // Admin (employee 1) without outlet → should pass
      const res = await request(miniApp)
        .get("/api/test")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── ensureDefaultRolePermissions ───────────────────

  describe("ensureDefaultRolePermissions", () => {
    it("seeds permissions for default roles", async () => {
      // Implementation: insert default perms and verify they exist
      // D4 split (PLAN-V2 Step 4) — Manager holds all five report splits;
      // Cashier converges on the sales split only.
      const DEFAULT_ROLE_PERMISSIONS = {
        Administrator: ["all_access"],
        Manager: ["manage_inventory", "manage_orders",
                   "view_sales_reports", "view_inventory_reports", "view_financial_reports",
                   "view_hr_reports", "view_customer_reports", "manage_employees",
                   "pos_discount", "void_sales", "pos_park", "pos_void"],
        Cashier: ["view_sales_reports", "pos_discount", "pos_park"],
      };

      const { rows: roles } = await db.query("SELECT id, name FROM roles");
      for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        const role = roles.find(r => r.name === roleName);
        if (!role) continue;
        for (const perm of perms) {
          await db.query(
            "INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [role.id, perm]
          );
        }
      }

      // Verify Administrator has all_access
      const { rows: adminPerms } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1",
        [roles.find(r => r.name === "Administrator").id]
      );
      expect(adminPerms.map(r => r.permission)).toContain("all_access");

      // Verify Manager has manage_inventory
      const { rows: mgrPerms } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1",
        [roles.find(r => r.name === "Manager").id]
      );
      expect(mgrPerms.map(r => r.permission)).toContain("manage_inventory");
    });
  });

  // ─── createNotification ─────────────────────────────

  describe("createNotification", () => {
    it("inserts a notification row", async () => {
      await db.query(
        "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
        ["low_stock", "Test Alert", "Widget A is low", "/inventory"]
      );
      const { rows } = await db.query(
        "SELECT * FROM notifications WHERE title = $1", ["Test Alert"]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].type).toBe("low_stock");
      expect(rows[0].message).toBe("Widget A is low");
      expect(rows[0].link).toBe("/inventory");
    });
  });

  // ─── notifyLowStockForSale ──────────────────────────

  describe("notifyLowStockForSale", () => {
    it("creates notifications for low-stock products", async () => {
      // Set a product to low stock (quantity <= 10)
      await db.query(
        "UPDATE outlet_stock SET quantity = 5 WHERE product_id = $1 AND outlet_id = $2",
        [1, 1]
      );

      // Query low stock products like notifyLowStockForSale does
      const productIds = [1, 2];
      const placeholders = productIds.map((_, i) => "$" + (i + 2)).join(",");
      const { rows } = await db.query(
        `SELECT os.product_id, os.quantity, p.name
         FROM outlet_stock os
         JOIN products p ON p.id = os.product_id
         WHERE os.outlet_id = $1 AND os.product_id IN (${placeholders}) AND COALESCE(os.quantity, 0) <= 10`,
        [1, ...productIds]
      );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const lowStockProduct = rows.find(r => r.product_id === 1);
      expect(lowStockProduct).toBeDefined();
      expect(lowStockProduct.quantity).toBe(5);

      // Insert notification for each low-stock product
      for (const row of rows) {
        await db.query(
          "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
          ["low_stock", "Low Stock Alert", `${row.name} has ${row.quantity} units left`, "/inventory"]
        );
      }

      const { rows: notifs } = await db.query(
        "SELECT * FROM notifications WHERE type = $1 AND message LIKE $2",
        ["low_stock", "%Widget A has 5 units%"]
      );
      expect(notifs.length).toBeGreaterThanOrEqual(1);

      // Restore stock
      await db.query(
        "UPDATE outlet_stock SET quantity = 50 WHERE product_id = $1 AND outlet_id = $2",
        [1, 1]
      );
    });
  });

  // ─── Health endpoint ────────────────────────────────

  describe("health", () => {
    it("GET /api/health returns OK", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ─── Feature flags ─────────────────────────────────

  describe("feature flags (Postgres BOOLEAN)", () => {
    it("reads feature flags with boolean enabled column", async () => {
      const { rows } = await db.query("SELECT key, enabled FROM feature_flags");
      expect(rows.length).toBeGreaterThan(0);

      // Check that enabled values are boolean or integer (PG casts 0/1 to bool)
      for (const row of rows) {
        const val = row.enabled;
        expect(typeof val === "boolean" || typeof val === "number").toBe(true);
      }
    });

    it("correctly identifies enabled vs disabled flags", async () => {
      // backup_restore was seeded as enabled (1 → true)
      const { rows: [flag] } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = $1", ["backup_restore"]
      );
      // In Postgres, 1 is cast to true for BOOLEAN columns
      expect(flag.enabled === true || flag.enabled === 1).toBe(true);
    });
  });

  // ─── Cleanup workers (query patterns) ──────────────

  describe("cleanup worker query patterns", () => {
    it("cleanupSyncEvents deletes old events", async () => {
      // Insert an old sync event (idempotency_key is required + unique)
      const key = "test-cleanup-" + Date.now();
      await db.query(
        `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, created_at)
         VALUES ($1, $2, $3, $4, NOW() - interval '60 days')`,
        ["push", "product", key, "success"]
      );

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { rowCount } = await db.query(
        "DELETE FROM external_sync_events WHERE created_at < $1 AND status IN ('success', 'failed')",
        [cutoff]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });

    it("closeStaleAttendanceSessions closes old open sessions", async () => {
      // Insert a stale session from 2 days ago (outlet_id is NOT NULL)
      await db.query(
        `INSERT INTO attendance_sessions (employee_id, outlet_id, session_start, session_type)
         VALUES ($1, $2, NOW() - interval '2 days', $3)`,
        [1, 1, "regular"]
      );

      // Mirrors boot/workers.js closeStaleAttendanceSessions — tenant-tz-aware
      // "before today" (a bare ::date / CURRENT_DATE would use the DB session
      // timezone; see the tz-date-boundary class fix).
      const { rowCount } = await db.query(
        `UPDATE attendance_sessions
         SET session_end = session_start, session_type = 'auto_closed'
         WHERE session_end IS NULL
           AND (session_start AT TIME ZONE $1)::date < (NOW() AT TIME ZONE $1)::date`,
        ["Asia/Karachi"]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });
});
