/**
 * PLAN-V2 Step 13 (D2a) — per-outlet role overrides.
 *
 * Covers the owner-approved 6-case no-context matrix plus the API contract:
 *  (a) base Cashier + Manager-override at outlet B: B-context passes Manager
 *      gates, A-context 403s, no-context = base Cashier
 *  (b) base Manager + Cashier-override at outlet B: B-context gets ONLY
 *      Cashier perms; A-context Manager; no-context on an outlet-scoped
 *      operational route → the Step 9 fail-closed 403 (header omission does
 *      NOT restore Manager there); no-context on a tenant-level endpoint →
 *      base Manager (documented: an override is scoping, not a demotion)
 *  (c) unassigned-outlet context → rejected by the resolver
 *  (d) malformed outlet context → rejected, never silent fallback
 *  (e) override removal reverts immediately (perms are per-request loads —
 *      there is no perm cache to invalidate)
 *  (f) role deletion → override degrades to inherit (ON DELETE SET NULL)
 *  Plus: multi-outlet Manager assignment accepted (policy relax), the PUT
 *  outlet_roles contract (validation errors), GET override visibility,
 *  bootstrap base+effective identity, widening containment (enforcement keys
 *  on BASE perms), and the JWT payload shape staying unchanged.
 *
 * Harness note: employee auth is header-based (x-employee-id), mirroring the
 * Step 9 suite; tenant-auth.init wires resolveEffectiveRole's DB handle the
 * same way outlet-context.init wires the resolver's.
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

const featureFlags = require("../../middleware/feature-flags");
const outletContext = require("../../middleware/outlet-context");
const tenantAuth = require("../../middleware/tenant-auth");

let app, db, deps, cleanup;

function invalidateAll() {
  featureFlags.invalidateFeatureFlagCache();
  featureFlags.invalidateModeCache();
  outletContext.invalidateOutletCache();
}

beforeAll(async () => {
  ({ app, db, deps, cleanup } = await createTestApp());

  featureFlags.init({ db, IS_MULTI_TENANT: false });
  outletContext.init({ db, IS_MULTI_TENANT: false });
  tenantAuth.init({ db, IS_MULTI_TENANT: false });

  app.use(outletContext.resolveOutletContext());
  app.use(tenantAuth.resolveEffectiveRole);
  app.use(outletContext.enforceOutletAssignment());

  require("../../routes/employees")(app, deps);
  require("../../routes/auth")(app, deps);

  // Probes. manager-gate: a perm Manager has and Cashier lacks. rentals-gate:
  // an outlet-scoped Bucket A flag → exercises the Step 9 fail-closed rule.
  const { requirePerm } = deps;
  app.get("/api/_test/manager-gate", requirePerm("manage_inventory"), (req, res) =>
    res.json({ ok: true })
  );
  app.get(
    "/api/_test/rentals-gate",
    featureFlags.requireFeature("phase4_rentals"),
    (req, res) => res.json({ ok: true })
  );
  app.get("/api/_test/whoami", (req, res) =>
    res.json({
      perms: req.employeePerms || [],
      basePerms: req.baseEmployeePerms || [],
      outlet: req.outletContext || null,
    })
  );

  // Outlet-scoped flag ON company-wide so the rentals-gate probe exercises
  // outlet resolution, not a disabled feature.
  await db.query(`
    INSERT INTO feature_flags (key, enabled) VALUES ('phase4_rentals', true)
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled
  `);

  // Fixtures via the REAL PUT contract (doubles as the policy-relax proof —
  // multi-outlet Manager/Cashier assignment used to 400):
  //  emp 2 (base Manager): outlets 1,2 — Cashier override at 2 (case b)
  //  emp 3 (base Cashier): outlets 1,2 — Manager override at 2 (case a)
  const putManager = await makeRequest(app, ADMIN_ID)
    .put(`/api/employees/${MANAGER_ID}/outlets`)
    .send({ outlet_ids: [1, 2], primary_outlet_id: 1, outlet_roles: { 2: 3 } });
  expect(putManager.status).toBe(200);
  const putCashier = await makeRequest(app, ADMIN_ID)
    .put(`/api/employees/${CASHIER_ID}/outlets`)
    .send({ outlet_ids: [1, 2], primary_outlet_id: 1, outlet_roles: { 2: 2 } });
  expect(putCashier.status).toBe(200);
  expect(putCashier.body.outlet_roles).toEqual({ 2: 2 });

  invalidateAll();
});

afterAll(async () => {
  invalidateAll();
  if (cleanup) await cleanup();
});

describe("(a) base Cashier + Manager override at outlet 2", () => {
  it("outlet-2 context passes a Manager gate (200)", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(200);
  });

  it("outlet-1 context stays Cashier (403)", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(403);
  });

  it("no context = base Cashier (403)", async () => {
    const res = await makeRequest(app, CASHIER_ID).get("/api/_test/manager-gate");
    expect(res.status).toBe(403);
  });

  it("effective perms swap but base perms are preserved for scope decisions", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/_test/whoami")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(200);
    expect(res.body.perms).toContain("manage_inventory");
    expect(res.body.basePerms).not.toContain("manage_inventory");
    expect(res.body.outlet.outletId).toBe(2);
    expect(res.body.outlet.overrideRoleId).toBe(2);
  });
});

describe("(b) base Manager + Cashier override at outlet 2 (reverse override)", () => {
  it("outlet-2 context gets ONLY Cashier perms (403 on Manager gate)", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(403);
  });

  it("outlet-1 context stays Manager (200)", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "1");
    expect(res.status).toBe(200);
  });

  it("no context on an outlet-scoped operational route → Step 9 fail-closed 403 (omission does not restore Manager)", async () => {
    const res = await makeRequest(app, MANAGER_ID).get("/api/_test/rentals-gate");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OUTLET_CONTEXT_REQUIRED");
  });

  it("no context on a tenant-level endpoint → base Manager (documented scoping rule)", async () => {
    const res = await makeRequest(app, MANAGER_ID).get("/api/_test/manager-gate");
    expect(res.status).toBe(200);
  });
});

describe("(c)+(d) resolver rejections are unchanged", () => {
  it("unassigned outlet context → 403 OUTLET_NOT_ASSIGNED", async () => {
    await db.query(
      `INSERT INTO outlets (id, name, is_active) VALUES (3, 'Third Branch', true)
       ON CONFLICT (id) DO NOTHING`
    );
    outletContext.invalidateOutletCache();
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "3");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OUTLET_NOT_ASSIGNED");
  });

  it("malformed outlet context → 400 INVALID_OUTLET_CONTEXT, never silent fallback", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "abc");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_OUTLET_CONTEXT");
  });
});

describe("widening containment — outlet reach keys on BASE perms", () => {
  it("an all_access override at outlet 2 does NOT let the employee reach an unassigned outlet", async () => {
    // Employee 4: base Cashier, assigned outlets 1+2, override at outlet 2 is
    // a role carrying all_access ("Regional Admin"). Requesting outlet 3
    // (exists, unassigned) must still 403 — skipAssignment is decided on the
    // BASE role before any override can apply, so overrides grant capability
    // at an outlet but never widen which outlets are reachable.
    await db.query(
      `INSERT INTO roles (id, name, description) VALUES (5, 'Regional Admin', 'temp')`
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission) VALUES (5, 'all_access')`
    );
    await db.query(
      `INSERT INTO employees (id, name, role, role_id) VALUES (4, 'Regional', 'Cashier', 3)`
    );
    await db.query(
      `INSERT INTO employee_outlets (employee_id, outlet_id, is_primary, role_id) VALUES
        (4, 1, true, NULL), (4, 2, false, 5)`
    );
    await db.query(
      `INSERT INTO outlets (id, name, is_active) VALUES (3, 'Third Branch', true)
       ON CONFLICT (id) DO NOTHING`
    );
    outletContext.invalidateOutletCache();

    const foreign = await makeRequest(app, 4)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "3");
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe("OUTLET_NOT_ASSIGNED");

    // …while AT outlet 2 the override does grant the capability.
    const atOverride = await makeRequest(app, 4)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "2");
    expect(atOverride.status).toBe(200);
  });
});

describe("PUT /api/employees/:id/outlets contract", () => {
  it("outlet_roles referencing an unassigned outlet → 400", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/employees/${CASHIER_ID}/outlets`)
      .send({ outlet_ids: [1, 2], outlet_roles: { 3: 2 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unassigned outlet/);
  });

  it("unknown role_id → 400", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/employees/${CASHIER_ID}/outlets`)
      .send({ outlet_ids: [1, 2], outlet_roles: { 2: 999 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown role_id/);
  });

  it("GET returns per-outlet overrides + base_role_id", async () => {
    const res = await makeRequest(app, ADMIN_ID).get(
      `/api/employees/${CASHIER_ID}/outlets`
    );
    expect(res.status).toBe(200);
    expect(res.body.base_role_id).toBe(3);
    const byOutlet = Object.fromEntries(
      res.body.outlets.map((o) => [o.outlet_id, o])
    );
    expect(byOutlet[1].role_id).toBeNull();
    expect(byOutlet[2].role_id).toBe(2);
    expect(byOutlet[2].role_name).toBe("Manager");
  });
});

describe("bootstrap exposes base + effective identity and effective perms", () => {
  it("with override context: effective_role_id/permissions reflect the override", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/context/bootstrap")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(200);
    expect(res.body.employee.base_role_id).toBe(3);
    expect(res.body.employee.effective_role_id).toBe(2);
    expect(res.body.employee.effective_role_name).toBe("Manager");
    expect(res.body.employee.permissions).toContain("manage_inventory");
    const outlet2 = res.body.outlets.find((o) => o.id === 2);
    expect(outlet2.role_id).toBe(2);
  });

  it("without context: effective = base", async () => {
    const res = await makeRequest(app, CASHIER_ID).get("/api/context/bootstrap");
    expect(res.status).toBe(200);
    expect(res.body.employee.base_role_id).toBe(3);
    expect(res.body.employee.effective_role_id).toBe(3);
    expect(res.body.employee.permissions).not.toContain("manage_inventory");
  });
});

describe("(e) override removal reverts on the very next request", () => {
  it("PUT without outlet_roles clears the override; outlet-2 context is base Cashier again", async () => {
    const put = await makeRequest(app, ADMIN_ID)
      .put(`/api/employees/${CASHIER_ID}/outlets`)
      .send({ outlet_ids: [1, 2], primary_outlet_id: 1 });
    expect(put.status).toBe(200);

    const res = await makeRequest(app, CASHIER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "2");
    expect(res.status).toBe(403);
  });
});

describe("(f) role deletion degrades the override to inherit (ON DELETE SET NULL)", () => {
  it("deleting the override role leaves the assignment row with role_id NULL and base behavior", async () => {
    await db.query(
      `INSERT INTO roles (id, name, description) VALUES (4, 'Supervisor', 'temp')`
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission) VALUES (4, 'manage_inventory')`
    );
    const put = await makeRequest(app, ADMIN_ID)
      .put(`/api/employees/${CASHIER_ID}/outlets`)
      .send({ outlet_ids: [1, 2], primary_outlet_id: 1, outlet_roles: { 2: 4 } });
    expect(put.status).toBe(200);

    const before = await makeRequest(app, CASHIER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "2");
    expect(before.status).toBe(200);

    await db.query(`DELETE FROM role_permissions WHERE role_id = 4`);
    await db.query(`DELETE FROM roles WHERE id = 4`);

    const { rows: [row] } = await db.query(
      `SELECT role_id FROM employee_outlets WHERE employee_id = $1 AND outlet_id = 2`,
      [CASHIER_ID]
    );
    expect(row.role_id).toBeNull();

    const after = await makeRequest(app, CASHIER_ID)
      .get("/api/_test/manager-gate")
      .set("x-outlet-id", "2");
    expect(after.status).toBe(403);
  });
});

describe("zero-override + token invariants", () => {
  it("an employee with no overrides pays no behavior change (Admin everywhere)", async () => {
    for (const header of [null, "1", "2"]) {
      let reqst = makeRequest(app, ADMIN_ID).get("/api/_test/manager-gate");
      if (header) reqst = reqst.set("x-outlet-id", header);
      const res = await reqst;
      expect(res.status).toBe(200);
    }
  });

  it("JWT access-token payload shape is unchanged", () => {
    const jwt = require("jsonwebtoken");
    const { signAccessToken } = require("../../jwt-auth");
    const token = signAccessToken({ tid: 1, eid: 2, rid: 2, oid: 1 }, "test-secret");
    const decoded = jwt.verify(token, "test-secret");
    expect(Object.keys(decoded).sort()).toEqual(
      ["eid", "exp", "iat", "jti", "oid", "rid", "scope", "tid"].sort()
    );
    expect(decoded.rid).toBe(2); // rid stays the BASE role — no token change
  });
});
