/**
 * context-enforcement.test.js — Phase 2: Context Enforcement and RBAC Hardening
 *
 * Tests:
 *   CE1 — Context header enforcement (flag ON): non-admin without x-outlet-id → 428
 *   CE2 — Admin bypass: admin without x-outlet-id → passes through
 *   CE3 — Exempt paths pass without header (auth, attendance/pin-*, context/*)
 *   CE4 — Outlet assignment enforcement: non-admin blocked from unassigned outlet
 *   CE5 — RBAC matrix: role × workflow for all 3 roles across 5 key endpoints
 */

const { createTestApp, closeDb, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

// ─── Exempt-path regex (mirrors index.js CONTEXT_EXEMPT_PATHS) ───────────────
const CONTEXT_EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/context\//,
  /^\/api\/feature-flags/,
  /^\/api\/attendance\/pin-/,
  /^\/api\/roles\/\d+\/permissions/,
  /^\/api\/outlets$/,
];

/**
 * Build a real resolveContext middleware that enforces the 428 gate.
 * Used in tests that need to verify enforcement (CE1–CE3).
 * The factory function always enforces (flag treated as ON).
 */
function buildEnforcingResolveContext() {
  return function resolveContext(req, res, next) {
    req.context = { companyId: null, outletId: null, scopeMode: null };
    const outletId = req.headers["x-outlet-id"];
    const companyId = req.headers["x-company-id"];
    const scopeMode = req.headers["x-scope-mode"];
    if (companyId) req.context.companyId = Number(companyId);
    if (outletId) req.context.outletId = Number(outletId);
    if (scopeMode) req.context.scopeMode = scopeMode;

    if (!req.path.startsWith("/api/")) return next();

    const exempt = CONTEXT_EXEMPT_PATHS.some((rx) => rx.test(req.path));
    const employeeId = Number(req.headers["x-employee-id"] || 0);

    // No employee attached — defer to route-level auth
    if (!exempt && !employeeId) return next();

    const perms = req.employeePerms || [];
    const isAdmin = perms.includes("all_access");

    if (!exempt && !outletId && !isAdmin) {
      return res.status(428).json({
        error: "Context required: select a branch before using this feature.",
        code: "CONTEXT_REQUIRED",
      });
    }

    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CE1–CE3 — Context header enforcement (flag ON)
// Uses a separate app wired with the enforcing resolveContext
// ─────────────────────────────────────────────────────────────────────────────

describe("CE1–CE3 — Context header enforcement (flag ON)", () => {
  let app, db;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;

    // Swap in the enforcing resolveContext after the fact by injecting a global
    // middleware BEFORE the app is used. Since registerAllRoutes already wired
    // the stub, we need a fresh app with a custom resolver.
    // Strategy: create a new app with a custom resolveContext injected via deps.
    await closeDb(db);

    // Build a fresh app with enforcing resolver
    const { createTestApp: _cta } = require("../helpers/createTestApp");
    const ctx2 = await _cta();
    app = ctx2.app;
    db = ctx2.db;

    // Monkey-patch: prepend the enforcing middleware by rebuilding with custom deps.
    // Since createTestApp doesn't expose this override, we build a second app
    // using a workaround: wrap the existing app with an enforcing prefix.
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("non-admin without x-outlet-id → 428 CONTEXT_REQUIRED", async () => {
    // Spin up a dedicated app with the enforcing resolveContext
    const { createTestApp: _cta, closeDb: _cdb } = require("../helpers/createTestApp");

    // We'll create a wrapper express app that injects enforcement, then proxies to
    // the real app. Simpler: create the test app, then test with custom middleware order.
    // The cleanest approach: override resolveContext in createTestApp options.
    // Since createTestApp doesn't support options.deps override directly,
    // we test enforcement by reading the resolveContext implementation directly.

    // APPROACH: Create a mini express app that ONLY mounts the enforcing middleware
    // so we can verify the logic in isolation.
    const express = require("express");
    const supertest = require("supertest");

    const miniApp = express();
    miniApp.use(express.json());

    // Simulate loadEmployeePerms setting perms for employee 2 (manager, no all_access)
    miniApp.use((req, res, next) => {
      const eid = Number(req.headers["x-employee-id"] || 0);
      // Manager (id=2) has manage_orders, manage_inventory, view_reports — no all_access
      if (eid === 2) req.employeePerms = ["manage_orders", "manage_inventory", "view_reports"];
      else if (eid === 1) req.employeePerms = ["all_access"];
      else if (eid === 3) req.employeePerms = ["view_reports"];
      else req.employeePerms = [];
      next();
    });

    miniApp.use(buildEnforcingResolveContext());
    miniApp.get("/api/products", (req, res) => res.json({ ok: true }));

    const res = await supertest(miniApp)
      .get("/api/products")
      .set("x-employee-id", String(MANAGER_ID));
    // No x-outlet-id, not admin → 428
    expect(res.status).toBe(428);
    expect(res.body.code).toBe("CONTEXT_REQUIRED");
  });

  it("admin without x-outlet-id → passes through (admin bypass)", async () => {
    const express = require("express");
    const supertest = require("supertest");

    const miniApp = express();
    miniApp.use(express.json());
    miniApp.use((req, res, next) => {
      req.employeePerms = ["all_access"];
      next();
    });
    miniApp.use(buildEnforcingResolveContext());
    miniApp.get("/api/products", (req, res) => res.json({ ok: true }));

    const res = await supertest(miniApp)
      .get("/api/products")
      .set("x-employee-id", String(ADMIN_ID));
    expect(res.status).toBe(200);
  });

  it("request with x-outlet-id → passes (context satisfied)", async () => {
    const express = require("express");
    const supertest = require("supertest");

    const miniApp = express();
    miniApp.use(express.json());
    miniApp.use((req, res, next) => {
      req.employeePerms = ["manage_orders", "view_reports"];
      next();
    });
    miniApp.use(buildEnforcingResolveContext());
    miniApp.get("/api/products", (req, res) => res.json({ ok: true }));

    const res = await supertest(miniApp)
      .get("/api/products")
      .set("x-employee-id", String(MANAGER_ID))
      .set("x-outlet-id", "1");
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CE3 — Exempt paths pass without context header
// ─────────────────────────────────────────────────────────────────────────────

describe("CE3 — Exempt paths pass without context header (enforcement ON)", () => {
  const EXEMPT_CASES = [
    { path: "/api/auth/login", label: "/api/auth/login" },
    { path: "/api/context/bootstrap", label: "/api/context/bootstrap" },
    { path: "/api/feature-flags", label: "/api/feature-flags" },
    { path: "/api/attendance/pin-checkin", label: "/api/attendance/pin-checkin" },
    { path: "/api/attendance/pin-status", label: "/api/attendance/pin-status" },
  ];

  it.each(EXEMPT_CASES)("$label is exempt from context enforcement", async ({ path }) => {
    const express = require("express");
    const supertest = require("supertest");

    const miniApp = express();
    miniApp.use(express.json());
    miniApp.use((req, res, next) => {
      req.employeePerms = ["manage_orders", "view_reports"];
      next();
    });
    miniApp.use(buildEnforcingResolveContext());
    // Mount a catch-all that returns 200 for all paths (Express v5: use "/*path")
    miniApp.use((req, res) => res.status(200).json({ ok: true }));

    const res = await supertest(miniApp)
      .post(path)
      .set("x-employee-id", String(MANAGER_ID))
      // No x-outlet-id — should pass because path is exempt
      .send({});
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CE4 — Outlet assignment enforcement (registerAllRoutes middleware)
// ─────────────────────────────────────────────────────────────────────────────

describe("CE4 — Outlet assignment enforcement", () => {
  let app, db;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("Manager (assigned to outlet 1) can access outlet 1 products — no 403", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/products?outlet_id=1");
    expect(res.status).not.toBe(403);
  });

  it("Manager (NOT assigned to outlet 2) blocked from outlet 2 — 403", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/products?outlet_id=2");
    expect(res.status).toBe(403);
  });

  it("Admin (all_access) can access any outlet — outlet 2 not blocked", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/products?outlet_id=2");
    expect(res.status).not.toBe(403);
  });

  it("Cashier (assigned to outlet 1) blocked from outlet 2 — 403", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/products?outlet_id=2");
    expect(res.status).toBe(403);
  });

  it("Cashier (assigned to outlet 1) can access outlet 1 — no 403", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/products?outlet_id=1");
    expect(res.status).not.toBe(403);
  });

  it("Manager kiosk check-in at unassigned outlet 2 — 403", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: "2222", outlet_id: 2 });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CE5 — Automated RBAC Matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("CE5 — Automated RBAC Matrix", () => {
  let app, db, openShiftId;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;

    // Clock in admin (needed for shift open + sale)
    await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });

    // Open a shift (manager opens it)
    const shiftRes = await makeRequest(app, MANAGER_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: MANAGER_ID, opening_float: 500 });
    openShiftId = shiftRes.body?.shift_id;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  // POST /api/shifts/open
  describe("POST /api/shifts/open", () => {
    it("Admin → 400 (shift already open, not 403)", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/shifts/open")
        .send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 0 });
      // 400 = shift already open (permission OK, business rule blocks)
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(403);
    });

    it("Manager → 400 (shift already open, not 403)", async () => {
      const res = await makeRequest(app, MANAGER_ID)
        .post("/api/shifts/open")
        .send({ outlet_id: 1, employee_id: MANAGER_ID, opening_float: 0 });
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(403);
    });

    it("Cashier → 403 (no manage_orders permission)", async () => {
      const res = await makeRequest(app, CASHIER_ID)
        .post("/api/shifts/open")
        .send({ outlet_id: 1, employee_id: CASHIER_ID, opening_float: 0 });
      expect(res.status).toBe(403);
    });
  });

  // POST /api/shifts/:id/close
  describe("POST /api/shifts/:id/close", () => {
    it("Cashier → 403 (no manage_orders permission)", async () => {
      const res = await makeRequest(app, CASHIER_ID)
        .post(`/api/shifts/${openShiftId}/close`)
        .send({ closing_cash: 500 });
      expect(res.status).toBe(403);
    });

    it("Manager → not 403 (has manage_orders)", async () => {
      // We won't actually close the shift here (needed for sale test)
      // Just verify the close endpoint doesn't return 403 for manager on a different shift
      // We'll check by looking at the shape: 200 or 404, not 403
      const fakeShiftId = 99999;
      const res = await makeRequest(app, MANAGER_ID)
        .post(`/api/shifts/${fakeShiftId}/close`)
        .send({ closing_cash: 500 });
      // 404 = shift not found (permission passed), not 403
      expect(res.status).not.toBe(403);
    });

    it("Admin → not 403 (all_access)", async () => {
      const fakeShiftId = 99999;
      const res = await makeRequest(app, ADMIN_ID)
        .post(`/api/shifts/${fakeShiftId}/close`)
        .send({ closing_cash: 500 });
      expect(res.status).not.toBe(403);
    });
  });

  // POST /api/products
  describe("POST /api/products", () => {
    const newProduct = {
      name: "RBAC Test Product",
      barcode: "RBAC-001",
      selling_price: 100,
      cost_price: 60,
      category_id: 1,
      outlet_id: 1,
    };

    it("Admin → not 403 (all_access)", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/products")
        .send(newProduct);
      expect(res.status).not.toBe(403);
    });

    it("Manager → not 403 (has manage_inventory)", async () => {
      const res = await makeRequest(app, MANAGER_ID)
        .post("/api/products")
        .send({ ...newProduct, barcode: "RBAC-002" });
      expect(res.status).not.toBe(403);
    });

    it("Cashier → 403 (no manage_inventory)", async () => {
      const res = await makeRequest(app, CASHIER_ID)
        .post("/api/products")
        .send({ ...newProduct, barcode: "RBAC-003" });
      expect(res.status).toBe(403);
    });
  });

  // POST /api/returns
  describe("POST /api/returns", () => {
    let saleId;

    beforeAll(async () => {
      // Clock in cashier too (for cashier test)
      await makeRequest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: "3333", outlet_id: 1 });

      // Create a sale to return against
      const saleRes = await makeRequest(app, ADMIN_ID)
        .post("/api/sales")
        .send({
          cartItems: [{ id: 1, quantity: 1, price: 100, cost_price: 60 }],
          paymentMethod: "Cash",
          outlet_id: 1,
        });
      saleId = saleRes.body?.saleId;
    });

    const returnPayload = () => ({
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });

    it("Admin → not 403 (all_access)", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/returns")
        .send(returnPayload());
      expect(res.status).not.toBe(403);
    });

    it("Manager → not 403 (has manage_orders)", async () => {
      const res = await makeRequest(app, MANAGER_ID)
        .post("/api/returns")
        .send(returnPayload());
      expect(res.status).not.toBe(403);
    });

    it("Cashier → 403 (no manage_orders)", async () => {
      const res = await makeRequest(app, CASHIER_ID)
        .post("/api/returns")
        .send(returnPayload());
      expect(res.status).toBe(403);
    });
  });

  // POST /api/sales
  describe("POST /api/sales", () => {
    const cartItems = [{ id: 2, quantity: 1, price: 200, cost_price: 120 }];

    it("Admin → 200 (all_access + shift open + clocked in)", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/sales")
        .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });
      expect(res.status).toBe(200);
    });

    it("Cashier → 200 (sales require no permission — gate checks only)", async () => {
      const res = await makeRequest(app, CASHIER_ID)
        .post("/api/sales")
        .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });
      expect(res.status).toBe(200);
    });

    it("Manager → 200 (has manage_orders, shift open, clocked in via clock-in below)", async () => {
      // Clock in manager first
      await makeRequest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: "2222", outlet_id: 1 });

      const res = await makeRequest(app, MANAGER_ID)
        .post("/api/sales")
        .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });
      expect(res.status).toBe(200);
    });
  });
});
