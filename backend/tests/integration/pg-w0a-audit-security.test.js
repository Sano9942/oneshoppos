/**
 * pg-w0a-audit-security.test.js — Wave 0 backend security fixes (PLAN-V2 W0a)
 *
 * S1 — POST /api/sales enforces pos_discount on MANUAL discounts:
 *      an employee whose role lacks pos_discount posting discount_amount > 0
 *      gets 403 DISCOUNT_NOT_PERMITTED; zero-discount sales still work;
 *      promo-engine discounts (folded into discount_amount client-side with
 *      applied_promotions carrying the breakdown) are re-verified server-side
 *      via evaluatePromotions and pass without the perm; a spoofed
 *      applied_promotions claim larger than the engine computes is rejected.
 *      cartItems[].discount is inert server-side (documented by test).
 *
 * S4 — PUT /api/roles/:id/permissions can never strip the last all_access:
 *      role 1 (built-in Administrator) always retains all_access; any update
 *      leaving zero roles with all_access → 400 CANNOT_REMOVE_LAST_ADMIN.
 *
 * C1 — GET /api/employees relaxed from all_access to manage_employees:
 *      Manager 200, Cashier 403, Admin 200.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

const ADMIN = "1";
const MANAGER = "2";
const CASHIER = "3";

describe("W0a — audit security fixes (Postgres)", () => {
  let app, db, deps, cleanup;
  let clerkId; // custom role WITHOUT pos_discount
  let promoId;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    require("../../routes/roles")(app, deps);
    require("../../routes/employees")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/sales")(app, deps);

    // Custom "Clerk" role: authenticated, can sell, but NO pos_discount.
    const { rows: [role] } = await db.query(
      "INSERT INTO roles (name) VALUES ('Clerk W0a') RETURNING id"
    );
    await db.query(
      "INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'view_reports')",
      [role.id]
    );
    const { rows: [emp] } = await db.query(
      "INSERT INTO employees (name, pin_code, role_id) VALUES ('Clerk W0a', '4747', $1) RETURNING id",
      [role.id]
    );
    clerkId = String(emp.id);
    await db.query(
      "INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES ($1, 1, true)",
      [emp.id]
    );

    // Deterministic catalog + tax: product 3 @ 500, no tax anywhere.
    await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");
    await db.query(
      "UPDATE products SET price = 500, tax_id = NULL, gst = 0, category_id = NULL WHERE id = 3"
    );

    // Active storewide 10% promotion → engine computes 50 on a 500 cart.
    const { rows: [promo] } = await db.query(
      `INSERT INTO promotions (name, type, value, applies_to, active)
       VALUES ('W0a Storewide 10', 'percent', 10, 'all', true) RETURNING id`
    );
    promoId = promo.id;

    // Sales need an open shift on the outlet AND a clocked-in employee.
    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", ADMIN)
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    for (const pin of ["2580", "3333", "4747"]) {
      await request(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: pin, outlet_id: 1 });
    }
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 30000);

  const postSale = (employeeId, body) =>
    request(app)
      .post("/api/sales")
      .set("x-employee-id", employeeId)
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: Number(employeeId),
        ...body,
      });

  const cart500 = () => [{ id: 3, name: "Gadget", price: 500, quantity: 1 }];

  // ── S1 — pos_discount enforcement ────────────────────────────────────
  describe("S1 — manual discount requires pos_discount", () => {
    it("403 DISCOUNT_NOT_PERMITTED: no perm + manual fixed discount", async () => {
      const res = await postSale(clerkId, {
        cartItems: cart500(),
        discount_amount: 50,
        discount_type: "fixed",
        payments: [{ method: "cash", amount: 450 }],
        idempotency_key: "w0a-s1-manual-fixed-" + Date.now(),
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("DISCOUNT_NOT_PERMITTED");
    });

    it("403 DISCOUNT_NOT_PERMITTED: no perm + manual percent discount", async () => {
      const res = await postSale(clerkId, {
        cartItems: cart500(),
        discount_amount: 10,
        discount_type: "percent",
        payments: [{ method: "cash", amount: 450 }],
        idempotency_key: "w0a-s1-manual-pct-" + Date.now(),
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("DISCOUNT_NOT_PERMITTED");
    });

    it("200: no perm + zero discount", async () => {
      const res = await postSale(clerkId, {
        cartItems: cart500(),
        payments: [{ method: "cash", amount: 500 }],
        idempotency_key: "w0a-s1-zero-" + Date.now(),
      });
      expect(res.status).toBe(200);
    });

    it("200: Cashier (holds pos_discount) + manual discount", async () => {
      const res = await postSale(CASHIER, {
        cartItems: cart500(),
        discount_amount: 50,
        discount_type: "fixed",
        payments: [{ method: "cash", amount: 450 }],
        idempotency_key: "w0a-s1-cashier-" + Date.now(),
      });
      expect(res.status).toBe(200);
      expect(Number(res.body.totalAmount)).toBe(450); // 500 − 50 manual
    });

    it("200: Admin (all_access) + manual discount", async () => {
      const res = await postSale(ADMIN, {
        cartItems: cart500(),
        discount_amount: 75,
        discount_type: "fixed",
        payments: [{ method: "cash", amount: 425 }],
        idempotency_key: "w0a-s1-admin-" + Date.now(),
      });
      expect(res.status).toBe(200);
    });

    it("200: no perm + promo-engine discount (folded, with applied_promotions)", async () => {
      // Client contract (useCheckout.js): promo discount is folded into
      // discount_amount; applied_promotions carries the breakdown. The
      // engine computes 10% of 500 = 50 server-side and clears it.
      const res = await postSale(clerkId, {
        cartItems: cart500(),
        discount_amount: 50,
        discount_type: "fixed",
        applied_promotions: [
          { promotion_id: promoId, name: "W0a Storewide 10", type: "percent", discount: 50 },
        ],
        payments: [{ method: "cash", amount: 450 }],
        idempotency_key: "w0a-s1-promo-ok-" + Date.now(),
      });
      expect(res.status).toBe(200);
    });

    it("403: no perm + spoofed applied_promotions claiming more than the engine computes", async () => {
      const res = await postSale(clerkId, {
        cartItems: cart500(),
        discount_amount: 200, // engine only justifies 50
        discount_type: "fixed",
        applied_promotions: [
          { promotion_id: promoId, name: "W0a Storewide 10", type: "percent", discount: 200 },
        ],
        payments: [{ method: "cash", amount: 300 }],
        idempotency_key: "w0a-s1-promo-spoof-" + Date.now(),
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("DISCOUNT_NOT_PERMITTED");
    });

    it("200: perm-holder + promo + manual on top (both allowed)", async () => {
      const res = await postSale(CASHIER, {
        cartItems: cart500(),
        discount_amount: 70, // 50 promo + 20 manual
        discount_type: "fixed",
        applied_promotions: [
          { promotion_id: promoId, name: "W0a Storewide 10", type: "percent", discount: 50 },
        ],
        payments: [{ method: "cash", amount: 430 }],
        idempotency_key: "w0a-s1-both-" + Date.now(),
      });
      expect(res.status).toBe(200);
    });

    it("cartItems[].discount is inert server-side (line discounts don't change totals)", async () => {
      // Line-level manual price cuts flow through price_override (already
      // gated by override_price + approval events); the legacy per-item
      // `discount` field is dead payload — subtotal is price * quantity.
      const res = await postSale(clerkId, {
        cartItems: [{ id: 3, name: "Gadget", price: 500, quantity: 1, discount: 100 }],
        payments: [{ method: "cash", amount: 500 }],
        idempotency_key: "w0a-s1-line-inert-" + Date.now(),
      });
      expect(res.status).toBe(200);
      expect(Number(res.body.totalAmount)).toBe(500);
    });
  });

  // ── S4 — admin self-lockout guard ────────────────────────────────────
  describe("S4 — CANNOT_REMOVE_LAST_ADMIN", () => {
    it("400: stripping all_access from the built-in Administrator role", async () => {
      const res = await request(app)
        .put("/api/roles/1/permissions")
        .set("x-employee-id", ADMIN)
        .send({ permissions: ["view_reports", "manage_employees"] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CANNOT_REMOVE_LAST_ADMIN");
      // Nothing was written.
      const check = await request(app)
        .get("/api/roles/1/permissions")
        .set("x-employee-id", ADMIN);
      expect(check.body.permissions).toContain("all_access");
    });

    it("400: even when another role also holds all_access, role 1 must retain it", async () => {
      const { rows: [role] } = await db.query(
        "INSERT INTO roles (name) VALUES ('Second Admin W0a') RETURNING id"
      );
      await db.query(
        "INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'all_access')",
        [role.id]
      );
      const res = await request(app)
        .put("/api/roles/1/permissions")
        .set("x-employee-id", ADMIN)
        .send({ permissions: ["view_reports"] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CANNOT_REMOVE_LAST_ADMIN");
      await db.query("DELETE FROM role_permissions WHERE role_id = $1", [role.id]);
      await db.query("DELETE FROM roles WHERE id = $1", [role.id]);
    });

    it("400: stripping the LAST all_access holder (non-built-in role)", async () => {
      // Simulate a legacy state where a custom role is the only holder, and
      // its own member (the only remaining admin) tries to strip it.
      const { rows: [role] } = await db.query(
        "INSERT INTO roles (name) VALUES ('Only Admin W0a') RETURNING id"
      );
      await db.query(
        "INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'all_access')",
        [role.id]
      );
      const { rows: [onlyAdmin] } = await db.query(
        "INSERT INTO employees (name, pin_code, role_id) VALUES ('Only Admin W0a', '5858', $1) RETURNING id",
        [role.id]
      );
      await db.query(
        "DELETE FROM role_permissions WHERE role_id = 1 AND permission = 'all_access'"
      );
      try {
        const res = await request(app)
          .put(`/api/roles/${role.id}/permissions`)
          .set("x-employee-id", String(onlyAdmin.id))
          .send({ permissions: ["view_reports"] });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("CANNOT_REMOVE_LAST_ADMIN");
      } finally {
        await db.query(
          "INSERT INTO role_permissions (role_id, permission) VALUES (1, 'all_access')"
        );
        await db.query("DELETE FROM employees WHERE id = $1", [onlyAdmin.id]);
        await db.query("DELETE FROM role_permissions WHERE role_id = $1", [role.id]);
        await db.query("DELETE FROM roles WHERE id = $1", [role.id]);
      }
    });

    it("200: stripping all_access from a non-last holder still works", async () => {
      const { rows: [role] } = await db.query(
        "INSERT INTO roles (name) VALUES ('Temp Admin W0a') RETURNING id"
      );
      await db.query(
        "INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'all_access')",
        [role.id]
      );
      const res = await request(app)
        .put(`/api/roles/${role.id}/permissions`)
        .set("x-employee-id", ADMIN)
        .send({ permissions: ["view_reports"] });
      expect(res.status).toBe(200);
      const check = await request(app)
        .get(`/api/roles/${role.id}/permissions`)
        .set("x-employee-id", ADMIN);
      expect(check.body.permissions).toEqual(["view_reports"]);
      await db.query("DELETE FROM role_permissions WHERE role_id = $1", [role.id]);
      await db.query("DELETE FROM roles WHERE id = $1", [role.id]);
    });

    it("200: other Administrator-role edits still work (all_access retained)", async () => {
      const res = await request(app)
        .put("/api/roles/1/permissions")
        .set("x-employee-id", ADMIN)
        .send({ permissions: ["all_access", "view_reports"] });
      expect(res.status).toBe(200);
      // Restore the seeded state.
      await request(app)
        .put("/api/roles/1/permissions")
        .set("x-employee-id", ADMIN)
        .send({ permissions: ["all_access"] });
    });
  });

  // ── C1 — staff list guard ────────────────────────────────────────────
  describe("C1 — GET /api/employees allows manage_employees", () => {
    it("200 for Manager (manage_employees)", async () => {
      const res = await request(app)
        .get("/api/employees")
        .set("x-employee-id", MANAGER);
      expect(res.status).toBe(200);
      expect(res.body.employees.length).toBeGreaterThanOrEqual(3);
    });

    it("403 for Cashier", async () => {
      const res = await request(app)
        .get("/api/employees")
        .set("x-employee-id", CASHIER);
      expect(res.status).toBe(403);
    });

    it("200 for Admin (all_access)", async () => {
      const res = await request(app)
        .get("/api/employees")
        .set("x-employee-id", ADMIN);
      expect(res.status).toBe(200);
    });
  });
});
