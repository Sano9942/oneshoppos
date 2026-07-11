/**
 * Roles & permissions contract (PLAN.md business-modules Step 7).
 *
 * Verifies the two previously-unguarded role GETs, the permission-catalog
 * endpoint, and catalog validation on PUT /api/roles/:id/permissions:
 *  - GET /api/roles is all_access-only (verified consumers: Administrator +
 *    Employees pages, both perm("all_access") routes).
 *  - GET /api/roles/:id/permissions allows any authenticated employee to
 *    read their OWN role (AuthProvider.refreshPermissions does this on every
 *    boot for every role) and admins/manage_employees to read any; a Cashier
 *    reading another role 403s.
 *  - PUT /api/roles/:id/permissions rejects unregistered strings (400,
 *    naming them) and accepts catalog members including
 *    manage_business_modules.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

const ADMIN = "1";
const MANAGER = "2";
const CASHIER = "3";

describe("roles & permissions contract (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/roles")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const as = (employeeId) => ({
    get: (url) => {
      const r = request(app).get(url);
      return employeeId ? r.set("x-employee-id", employeeId) : r;
    },
    put: (url, body) => {
      const r = request(app).put(url).send(body);
      return employeeId ? r.set("x-employee-id", employeeId) : r;
    },
  });

  describe("GET /api/roles guard", () => {
    it("403s unauthenticated, Cashier and Manager (all_access only)", async () => {
      expect((await as(null).get("/api/roles")).status).toBe(403);
      expect((await as(CASHIER).get("/api/roles")).status).toBe(403);
      expect((await as(MANAGER).get("/api/roles")).status).toBe(403);
    });

    it("returns roles for an admin", async () => {
      const res = await as(ADMIN).get("/api/roles");
      expect(res.status).toBe(200);
      expect(res.body.roles.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("GET /api/roles/:id/permissions guard (self-or-admin)", () => {
    it("any employee can read their OWN role (AuthProvider boot path)", async () => {
      const res = await as(CASHIER).get("/api/roles/3/permissions");
      expect(res.status).toBe(200);
      expect(res.body.permissions).toContain("view_reports");
    });

    it("a Cashier reading ANOTHER role 403s", async () => {
      expect((await as(CASHIER).get("/api/roles/2/permissions")).status).toBe(403);
      expect((await as(CASHIER).get("/api/roles/1/permissions")).status).toBe(403);
    });

    it("unauthenticated 403s", async () => {
      expect((await as(null).get("/api/roles/3/permissions")).status).toBe(403);
    });

    it("manage_employees (Manager) and all_access read any role", async () => {
      expect((await as(MANAGER).get("/api/roles/3/permissions")).status).toBe(200);
      expect((await as(ADMIN).get("/api/roles/2/permissions")).status).toBe(200);
    });
  });

  describe("GET /api/permissions-catalog", () => {
    it("403s a Cashier", async () => {
      expect((await as(CASHIER).get("/api/permissions-catalog")).status).toBe(403);
    });

    it("returns the full catalog for an admin", async () => {
      const res = await as(ADMIN).get("/api/permissions-catalog");
      expect(res.status).toBe(200);
      const perms = res.body.permissions;
      expect(perms.length).toBeGreaterThanOrEqual(29);
      for (const p of perms) {
        expect(typeof p.id).toBe("string");
        expect(typeof p.label).toBe("string");
        expect(typeof p.category).toBe("string");
      }
      const ids = perms.map((p) => p.id);
      expect(ids).toContain("manage_business_modules");
      // The 11 permissions the old hardcoded role-editor list was missing.
      for (const missing of [
        "manage_rentals", "manage_rooms", "manage_tickets",
        "manage_treatment_plans", "manage_tips", "manage_gift_cards",
        "manage_field_sales", "manage_forms", "override_price",
        "override_credit_limit", "override_void_comp",
      ]) {
        expect(ids).toContain(missing);
      }
    });
  });

  describe("PUT /api/roles/:id/permissions catalog validation", () => {
    it("400s on unknown strings, naming them", async () => {
      const res = await as(ADMIN).put("/api/roles/3/permissions", {
        permissions: ["view_reports", "not_a_real_perm", "also_fake"],
      });
      expect(res.status).toBe(400);
      expect(res.body.unknown).toEqual(["not_a_real_perm", "also_fake"]);
      // Nothing was written — Cashier still has the seeded set.
      const check = await as(ADMIN).get("/api/roles/3/permissions");
      expect(check.body.permissions).toContain("pos_discount");
    });

    it("accepts catalog members incl. manage_business_modules and persists", async () => {
      const res = await as(ADMIN).put("/api/roles/3/permissions", {
        permissions: ["view_reports", "pos_discount", "pos_park", "manage_business_modules"],
      });
      expect(res.status).toBe(200);
      const check = await as(ADMIN).get("/api/roles/3/permissions");
      expect(check.body.permissions).toContain("manage_business_modules");
      // Restore the seeded Cashier set for any later assertions.
      await as(ADMIN).put("/api/roles/3/permissions", {
        permissions: ["view_reports", "pos_discount", "pos_park"],
      });
    });

    it("still rejects a non-array body", async () => {
      const res = await as(ADMIN).put("/api/roles/3/permissions", {
        permissions: "view_reports",
      });
      expect(res.status).toBe(400);
    });
  });
});
