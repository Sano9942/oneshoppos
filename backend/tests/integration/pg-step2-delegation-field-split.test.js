/**
 * PLAN-V2 Step 2 — D7 delegation permissions + S3 Field Rep split.
 *
 * D7:
 *  - a custom role holding ONLY manage_integrations can save/read integration
 *    credentials and courier config, but 403s on roles endpoints;
 *  - a custom role holding ONLY manage_roles can PUT role permissions, but
 *    403s on integration credential surfaces;
 *  - Manager (neither perm) 403s on both; Administrator unaffected.
 *
 * S3:
 *  - a token holding only execute_field_sales reaches rep-self surfaces
 *    (route/today, check-in) but 403s on the owner surfaces
 *    (GET /api/field/visits, GET+POST /api/admin/field-routes);
 *  - a manage_field_sales holder reaches the owner surfaces;
 *  - a rep cannot POST /api/sales linked to another rep's field visit
 *    (403 FIELD_VISIT_NOT_OWN), while their own visit passes the gate.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

const ADMIN = "1";
const MANAGER = "2";

describe("Step 2 — delegation perms + field split (Postgres)", () => {
  let app, db, deps, cleanup;
  // Custom-role employees created in beforeAll
  let integrationsMgrId, rolesMgrId, repAId, repBId, fieldOwnerId;
  let visitAId, visitBId;

  // Explicit ids well above the seeded fixtures — the harness seeds roles 1-3
  // and employees 1-3 with explicit ids, which leaves nextval() behind MAX(id)
  // (the v132 serial trap), so sequence-generated ids would collide.
  let nextRoleId = 901;
  let nextEmpId = 901;

  async function createRole(name, perms) {
    const roleId = nextRoleId++;
    await db.query(
      "INSERT INTO roles (id, name, description) VALUES ($1, $2, $3)",
      [roleId, name, `${name} (step2 test)`]
    );
    for (const p of perms) {
      await db.query(
        "INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [roleId, p]
      );
    }
    return roleId;
  }

  async function createEmployee(name, roleId) {
    const empId = nextEmpId++;
    await db.query(
      `INSERT INTO employees (id, name, role, pin_code, role_id)
       VALUES ($1, $2, 'Staff', '9999', $3)`,
      [empId, name, roleId]
    );
    return empId;
  }

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Feature flags the guarded routes require (insert BEFORE any request so
    // the 60s flag cache never caches an off state).
    for (const flag of ["marketplace_integrations", "wholesale_field_sales"]) {
      await db.query(
        `INSERT INTO feature_flags (key, enabled) VALUES ($1, true)
         ON CONFLICT (key) DO UPDATE SET enabled = true`,
        [flag]
      );
    }

    // field.js reads req.employee.id (JWT-set in production); the harness only
    // sets req.employeePerms from x-employee-id, so bridge it here — mounted
    // before the routes below, after the harness's own middleware.
    app.use((req, res, next) => {
      const id = Number(req.headers["x-employee-id"] || 0);
      if (id && !req.employee) req.employee = { id };
      next();
    });

    require("../../routes/roles")(app, deps);
    require("../../routes/integrations")(app, deps);
    require("../../routes/couriers")(app, deps);
    require("../../routes/field")(app, deps);
    require("../../routes/sales")(app, deps);

    integrationsMgrId = await createEmployee(
      "Integrations Delegate",
      await createRole("Integrations Delegate", ["manage_integrations"])
    );
    rolesMgrId = await createEmployee(
      "Roles Delegate",
      await createRole("Roles Delegate", ["manage_roles"])
    );
    const repRoleId = await createRole("Field Rep", ["execute_field_sales"]);
    repAId = await createEmployee("Rep A", repRoleId);
    repBId = await createEmployee("Rep B", repRoleId);
    fieldOwnerId = await createEmployee(
      "Field Owner",
      await createRole("Field Sales Owner", ["manage_field_sales"])
    );

    // One visit per rep (customer 1 is seeded by the harness).
    const { rows: [va] } = await db.query(
      `INSERT INTO field_visits (employee_id, customer_id, checked_in_at, status, client_uuid)
       VALUES ($1, 1, NOW(), 'ordered', 'step2-visit-a') RETURNING id`,
      [repAId]
    );
    const { rows: [vb] } = await db.query(
      `INSERT INTO field_visits (employee_id, customer_id, checked_in_at, status, client_uuid)
       VALUES ($1, 1, NOW(), 'ordered', 'step2-visit-b') RETURNING id`,
      [repBId]
    );
    visitAId = va.id;
    visitBId = vb.id;
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const as = (employeeId) => {
    const set = (r) => (employeeId ? r.set("x-employee-id", String(employeeId)) : r);
    return {
      get: (url) => set(request(app).get(url)),
      post: (url, body) => set(request(app).post(url).send(body || {})),
      put: (url, body) => set(request(app).put(url).send(body || {})),
    };
  };

  // ── D7: manage_integrations ────────────────────────────────────────────────

  describe("manage_integrations delegation", () => {
    it("delegate can save + disconnect + read integration credentials", async () => {
      const save = await as(integrationsMgrId).post("/api/integrations/connect", {
        provider: "daraz",
        api_key: "step2-test-key",
        api_secret: "step2-test-secret",
      });
      expect(save.status).toBe(200);
      expect(save.body.connected).toBe(true);

      const status = await as(integrationsMgrId).get("/api/integrations/daraz/status");
      expect(status.status).toBe(200);
      expect(status.body.connected).toBe(true);

      const test = await as(integrationsMgrId).post("/api/integrations/test", {
        provider: "daraz",
      });
      expect(test.status).toBe(200);

      const disc = await as(integrationsMgrId).post("/api/integrations/disconnect", {
        provider: "daraz",
      });
      expect(disc.status).toBe(200);
    });

    it("delegate can configure a courier (PUT /api/couriers/:id)", async () => {
      const { rows: [courier] } = await db.query(
        "SELECT id FROM courier_integrations ORDER BY id LIMIT 1"
      );
      const res = await as(integrationsMgrId).put(`/api/couriers/${courier.id}`, {
        enabled: true,
        api_key: "step2-courier-key",
      });
      expect(res.status).toBe(200);
    });

    it("delegate 403s on roles endpoints", async () => {
      expect((await as(integrationsMgrId).get("/api/roles")).status).toBe(403);
      expect(
        (await as(integrationsMgrId).put("/api/roles/3/permissions", {
          permissions: ["view_sales_reports"],
        })).status
      ).toBe(403);
    });

    it("Manager (manage_inventory, no manage_integrations) 403s on credential writes", async () => {
      const res = await as(MANAGER).post("/api/integrations/connect", {
        provider: "daraz",
        api_key: "nope",
      });
      expect(res.status).toBe(403);
      expect(
        (await as(MANAGER).put("/api/couriers/1", { enabled: true })).status
      ).toBe(403);
    });

    it("Manager keeps the manage_inventory-gated hub/status reads", async () => {
      expect((await as(MANAGER).get("/api/integrations/hub")).status).toBe(200);
      expect(
        (await as(MANAGER).get("/api/integrations/daraz/status")).status
      ).toBe(200);
    });

    it("Administrator unaffected (all_access bypass)", async () => {
      const res = await as(ADMIN).post("/api/integrations/connect", {
        provider: "whatsapp",
        api_key: "admin-key",
      });
      expect(res.status).toBe(200);
    });
  });

  // ── D7: manage_roles ───────────────────────────────────────────────────────

  describe("manage_roles delegation", () => {
    it("delegate can list roles, read the catalog, and PUT role permissions", async () => {
      expect((await as(rolesMgrId).get("/api/roles")).status).toBe(200);
      expect((await as(rolesMgrId).get("/api/permissions-catalog")).status).toBe(200);

      const res = await as(rolesMgrId).put("/api/roles/3/permissions", {
        permissions: ["view_sales_reports", "pos_discount", "pos_park"],
      });
      expect(res.status).toBe(200);
    });

    it("delegate cannot grant all_access or touch the Administrator role", async () => {
      const grant = await as(rolesMgrId).put("/api/roles/3/permissions", {
        permissions: ["view_sales_reports", "all_access"],
      });
      expect(grant.status).toBe(403);

      const adminRole = await as(rolesMgrId).put("/api/roles/1/permissions", {
        permissions: ["all_access"],
      });
      expect(adminRole.status).toBe(403);
    });

    it("delegate 403s on integration credential surfaces", async () => {
      const res = await as(rolesMgrId).post("/api/integrations/connect", {
        provider: "daraz",
        api_key: "nope",
      });
      expect(res.status).toBe(403);
    });

    it("Manager (no manage_roles) still 403s on role mutations", async () => {
      const res = await as(MANAGER).put("/api/roles/3/permissions", {
        permissions: ["view_sales_reports"],
      });
      expect(res.status).toBe(403);
    });
  });

  // ── S3: Field Rep split ────────────────────────────────────────────────────

  describe("field split — execute vs manage", () => {
    it("execute-only rep reaches rep-self surfaces", async () => {
      expect((await as(repAId).get("/api/field/route/today")).status).toBe(200);

      const checkin = await as(repAId).post("/api/field/check-in", {
        customer_id: 1,
        outcome: "ordered",
        client_uuid: "11111111-1111-4111-8111-111111111111",
      });
      expect(checkin.status).toBe(200);
    });

    it("execute-only rep 403s on owner surfaces", async () => {
      expect((await as(repAId).get("/api/field/visits")).status).toBe(403);
      expect((await as(repAId).get("/api/field/summary")).status).toBe(403);
      expect(
        (await as(repAId).get("/api/admin/field-routes?employee_id=1")).status
      ).toBe(403);
      expect(
        (await as(repAId).post("/api/admin/field-routes", {
          employee_id: Number(repAId),
          day_of_week: 1,
          customer_ids: [1],
        })).status
      ).toBe(403);
    });

    it("manage_field_sales holder reaches owner surfaces AND rep-self surfaces", async () => {
      expect((await as(fieldOwnerId).get("/api/field/visits")).status).toBe(200);
      expect(
        (await as(fieldOwnerId).get("/api/admin/field-routes?employee_id=1")).status
      ).toBe(200);
      // Rep-self endpoints accept manage too (owners doing double duty).
      expect((await as(fieldOwnerId).get("/api/field/route/today")).status).toBe(200);
    });

    it("a rep cannot post a field order against another rep's visit", async () => {
      const body = {
        cartItems: [{ id: 1, price: 10, quantity: 1 }],
        total_amount: 10,
        payment_method: "Cash",
        outlet_id: 1,
        field_visit_id: visitBId,
      };
      const res = await as(repAId).post("/api/sales", body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FIELD_VISIT_NOT_OWN");
    });

    it("a rep's own visit passes the ownership gate", async () => {
      const body = {
        cartItems: [{ id: 1, price: 10, quantity: 1 }],
        total_amount: 10,
        payment_method: "Cash",
        outlet_id: 1,
        field_visit_id: visitAId,
      };
      const res = await as(repAId).post("/api/sales", body);
      // Downstream failures (open shift etc.) are fine — the point is the
      // ownership gate does not fire for the rep's own visit.
      expect(res.body.code).not.toBe("FIELD_VISIT_NOT_OWN");
    });

    it("a manage_field_sales holder may link any rep's visit (phoned-in order path)", async () => {
      const body = {
        cartItems: [{ id: 1, price: 10, quantity: 1 }],
        total_amount: 10,
        payment_method: "Cash",
        outlet_id: 1,
        field_visit_id: visitBId,
      };
      const res = await as(fieldOwnerId).post("/api/sales", body);
      expect(res.body.code).not.toBe("FIELD_VISIT_NOT_OWN");
    });
  });
});
