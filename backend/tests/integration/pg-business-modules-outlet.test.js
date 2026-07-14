/**
 * Business Modules v2 — per-outlet read + write path (PLAN-V2 Step 8, D1b).
 *
 * Covers the full Step 8 verify matrix:
 *   - single-outlet tenant payload is byte-compatible with v1 (regression, first)
 *   - effective(outlet) = company AND (override ?? default ?? TRUE); company-off
 *     wins everywhere; dormant overrides survive a company off/on cycle
 *   - enabled:null clears the override (row gone, re-inherits default)
 *   - default_outlet_enabled write (column-scoped: never clobbers saved_flags)
 *   - sparse-row module resolves as default TRUE
 *   - tenant/device/hybrid keys → 409 TENANT_SCOPED; unknown outlet → 404
 *   - platform lock blocks enable-direction override AND default; clear is exempt
 *   - one audit row per write; perm matrix; Zod validation
 *   - GET /:key/impact?outlet_id= scopes disable counts (tenant_wide where the
 *     impact table has no outlet_id column)
 *   - query budget: the per-outlet augmentation issues a FIXED number of bulk
 *     queries regardless of outlet count
 *
 * State accumulates within a describe by design; each block states its own
 * preconditions.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const pool = require("../../db-pg");

const SHIM_TENANT_ID = 515151;

describe("business modules per-outlet API (Postgres)", () => {
  let app, db, deps, cleanup;
  const featureFlags = require("../../middleware/feature-flags");

  // Records every SQL string the business-modules routes issue via deps.db, so
  // the query-budget test can assert the augmentation is bulk.
  let recorded = [];

  beforeAll(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.platform_module_locks (
        id SERIAL PRIMARY KEY,
        module_key TEXT NOT NULL,
        tenant_id INTEGER,
        locked_by TEXT,
        reason TEXT,
        locked_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    ({ app, db, deps, cleanup } = await createTestApp());

    app.use((req, res, next) => {
      req.tenantId = SHIM_TENANT_ID;
      next();
    });

    const countingDb = {
      query: (...args) => {
        recorded.push(String(args[0]));
        return db.query(...args);
      },
      transaction: (fn) => db.transaction(fn),
      getClient: (...a) => db.getClient(...a),
    };
    require("../../routes/business-modules")(app, { ...deps, db: countingDb });

    featureFlags.init({ db, IS_MULTI_TENANT: false, tenantDbManager: null, dbProxy: null });

    await pool
      .query(`DELETE FROM public.platform_module_locks WHERE locked_by = 'outlet-test'`)
      .catch(() => {});
  }, 60000);

  afterAll(async () => {
    await pool
      .query(`DELETE FROM public.platform_module_locks WHERE locked_by = 'outlet-test'`)
      .catch(() => {});
    if (cleanup) await cleanup();
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  const getModules = (employeeId = "1") =>
    request(app).get("/api/business-modules").set("x-employee-id", employeeId);
  const outletToggle = (key, body, employeeId = "1") =>
    request(app)
      .post(`/api/business-modules/${key}/outlet-toggle`)
      .set("x-employee-id", employeeId)
      .send(body);
  const impact = (key, outletId, employeeId = "1") =>
    request(app)
      .get(
        `/api/business-modules/${key}/impact${
          outletId !== undefined ? `?outlet_id=${outletId}` : ""
        }`
      )
      .set("x-employee-id", employeeId);
  const findCard = (body, key) => body.modules.find((m) => m.key === key);
  const setFlag = (key, val) =>
    db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [key, val]
    );
  const overrideRow = async (outletId, key) => {
    const { rows } = await db.query(
      "SELECT enabled FROM outlet_business_modules WHERE outlet_id = $1 AND module_key = $2",
      [outletId, key]
    );
    return rows.length ? rows[0].enabled === true : null;
  };
  const cardOutlet = (card, outletId) =>
    card.outlets.find((o) => o.outlet_id === outletId);

  // ══ (0) byte-compat regression — WRITTEN FIRST ═════════════════════════════
  it("single-outlet tenant payload stays byte-compatible with v1 (no v2 fields)", async () => {
    // Collapse to one active outlet: mark outlet 2 a van (excluded from the
    // non-van count, same definition GET uses for outlet_count).
    await db.query(`UPDATE outlets SET outlet_type = 'van' WHERE id = 2`);

    const res = await getModules();
    expect(res.status).toBe(200);
    expect(res.body.outlet_count).toBe(1);
    // Exactly the v1 top-level shape.
    expect(Object.keys(res.body).sort()).toEqual(["industry_type", "modules", "outlet_count"]);
    // No card carries any of the v2 per-outlet fields.
    for (const m of res.body.modules) {
      expect(m, `${m.key}`).not.toHaveProperty("outlets");
      expect(m, `${m.key}`).not.toHaveProperty("enabled_outlet_count");
      expect(m, `${m.key}`).not.toHaveProperty("default_outlet_enabled");
    }

    // Restore two active outlets for the rest of the suite.
    await db.query(`UPDATE outlets SET outlet_type = 'store' WHERE id = 2`);
    const res2 = await getModules();
    expect(res2.body.outlet_count).toBe(2);
    expect(findCard(res2.body, "holds_layaway")).toHaveProperty("outlets");
  });

  // ══ (perm + validation) ════════════════════════════════════════════════════
  describe("permission matrix + Zod validation", () => {
    beforeAll(async () => {
      // Custom delegated roles: one with only manage_outlet_modules, one with
      // only manage_business_modules.
      await db.query(
        `INSERT INTO roles (id, name, description) VALUES
           (60, 'Outlet Module Manager', 'per-outlet delegation'),
           (61, 'BM Manager', 'company module delegation')`
      );
      await db.query(
        `INSERT INTO role_permissions (role_id, permission) VALUES
           (60, 'manage_outlet_modules'), (61, 'manage_business_modules')`
      );
      await db.query(
        `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary) VALUES
           (60, 'Outlet Mgr', 'Outlet Module Manager', '6060', 60, 0),
           (61, 'BM Mgr', 'BM Manager', '6161', 61, 0)`
      );
    });

    it("rejects no-header, Cashier, and default Manager; allows admin + both delegated roles", async () => {
      const body = { outlet_id: 1, enabled: true };
      expect(
        (await request(app).post("/api/business-modules/holds_layaway/outlet-toggle").send(body)).status
      ).toBe(403);
      expect((await outletToggle("holds_layaway", body, "3")).status).toBe(403); // Cashier
      expect((await outletToggle("holds_layaway", body, "2")).status).toBe(403); // Manager (no delegation perm)
      expect((await outletToggle("holds_layaway", body, "1")).status).toBe(200); // Admin (all_access)
      expect((await outletToggle("holds_layaway", body, "60")).status).toBe(200); // manage_outlet_modules
      expect((await outletToggle("holds_layaway", body, "61")).status).toBe(200); // manage_business_modules
    });

    it("Zod rejects malformed bodies", async () => {
      expect((await outletToggle("holds_layaway", {})).status).toBe(400); // neither shape
      expect(
        (await outletToggle("holds_layaway", { outlet_id: 1, default_outlet_enabled: true })).status
      ).toBe(400); // both shapes
      expect((await outletToggle("holds_layaway", { outlet_id: 1 })).status).toBe(400); // missing enabled
      expect((await outletToggle("holds_layaway", { default_outlet_enabled: "yes" })).status).toBe(400);
      // enabled:null IS valid (a clear).
      expect((await outletToggle("holds_layaway", { outlet_id: 1, enabled: null })).status).toBe(200);
    });
  });

  // ══ (scope guards) ═════════════════════════════════════════════════════════
  describe("scope + not-found guards", () => {
    it("tenant / device / hybrid keys are rejected 409 TENANT_SCOPED (both shapes)", async () => {
      const loyalty = await outletToggle("loyalty", { outlet_id: 1, enabled: true }); // tenant
      expect(loyalty.status).toBe(409);
      expect(loyalty.body.code).toBe("TENANT_SCOPED");
      expect(loyalty.body.scope).toBe("tenant");

      const posAddons = await outletToggle("pos_addons", { default_outlet_enabled: false }); // device
      expect(posAddons.status).toBe(409);
      expect(posAddons.body.scope).toBe("device");

      const shopify = await outletToggle("shopify", { outlet_id: 1, enabled: true }); // hybrid (Bucket C)
      expect(shopify.status).toBe(409);
      expect(shopify.body.scope).toBe("hybrid");
    });

    it("unknown module → 404; unknown / van outlet → 404 OUTLET_NOT_FOUND", async () => {
      expect((await outletToggle("not_a_module", { outlet_id: 1, enabled: true })).status).toBe(404);

      const ghost = await outletToggle("holds_layaway", { outlet_id: 99999, enabled: true });
      expect(ghost.status).toBe(404);
      expect(ghost.body.code).toBe("OUTLET_NOT_FOUND");

      // A van is not a valid module-outlet target.
      await db.query(`INSERT INTO outlets (id, name, outlet_type) VALUES (90, 'Van 90', 'van')`);
      const van = await outletToggle("holds_layaway", { outlet_id: 90, enabled: true });
      expect(van.status).toBe(404);
      await db.query(`DELETE FROM outlets WHERE id = 90`);
    });
  });

  // ══ (effective resolution matrix) ══════════════════════════════════════════
  describe("effective(outlet) = company AND (override ?? default ?? TRUE)", () => {
    beforeAll(async () => {
      // Clean slate for holds_layaway; company ON (Bucket B, flag-only).
      await db.query(`DELETE FROM outlet_business_modules WHERE module_key = 'holds_layaway'`);
      await db.query(`DELETE FROM tenant_business_modules WHERE module_key = 'holds_layaway'`);
      await setFlag("phase2g_holds", true);
    });

    it("override off at outlet 2 → effective false at 2, true at 1", async () => {
      const res = await outletToggle("holds_layaway", { outlet_id: 2, enabled: false });
      expect(res.status).toBe(200);

      const card = findCard((await getModules()).body, "holds_layaway");
      expect(card.default_outlet_enabled).toBe(true);
      expect(card.outlet_count).toBe(2);
      expect(cardOutlet(card, 1)).toMatchObject({ effective: true, override: null });
      expect(cardOutlet(card, 2)).toMatchObject({ effective: false, override: false });
      expect(card.enabled_outlet_count).toBe(1);
    });

    it("company off → effective false everywhere, override rows preserved (dormant)", async () => {
      await setFlag("phase2g_holds", false);
      const card = findCard((await getModules()).body, "holds_layaway");
      expect(cardOutlet(card, 1).effective).toBe(false);
      expect(cardOutlet(card, 2).effective).toBe(false);
      expect(card.enabled_outlet_count).toBe(0);
      // The override was NOT deleted by turning the company off.
      expect(await overrideRow(2, "holds_layaway")).toBe(false);
    });

    it("company re-enable → outlet 2's dormant override is still off", async () => {
      await setFlag("phase2g_holds", true);
      const card = findCard((await getModules()).body, "holds_layaway");
      expect(cardOutlet(card, 1).effective).toBe(true);
      expect(cardOutlet(card, 2)).toMatchObject({ effective: false, override: false });
    });

    it("enabled:null clears the override — row gone, outlet re-inherits default TRUE", async () => {
      const res = await outletToggle("holds_layaway", { outlet_id: 2, enabled: null });
      expect(res.status).toBe(200);
      expect(await overrideRow(2, "holds_layaway")).toBe(null); // deleted
      const card = findCard((await getModules()).body, "holds_layaway");
      expect(cardOutlet(card, 2)).toMatchObject({ effective: true, override: null });
      expect(card.enabled_outlet_count).toBe(2);
    });

    it("default_outlet_enabled:false → unlisted outlets effective-off; explicit override stays on", async () => {
      // Clean overrides, set an explicit ON at outlet 1, default OFF.
      await db.query(`DELETE FROM outlet_business_modules WHERE module_key = 'holds_layaway'`);
      expect((await outletToggle("holds_layaway", { outlet_id: 1, enabled: true })).status).toBe(200);
      const res = await outletToggle("holds_layaway", { default_outlet_enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.default_outlet_enabled).toBe(false);

      const card = findCard((await getModules()).body, "holds_layaway");
      expect(card.default_outlet_enabled).toBe(false);
      expect(cardOutlet(card, 1)).toMatchObject({ effective: true, override: true }); // explicit
      expect(cardOutlet(card, 2)).toMatchObject({ effective: false, override: null }); // inherits default false
    });

    it("sparse module (no tenant_business_modules row) resolves default_outlet_enabled TRUE", async () => {
      // draft_orders: never written via any toggle here → no tbm row. Company ON.
      await setFlag("phase2_draft_orders", true);
      await db.query(`DELETE FROM tenant_business_modules WHERE module_key = 'draft_orders'`);
      await db.query(`DELETE FROM outlet_business_modules WHERE module_key = 'draft_orders'`);
      const card = findCard((await getModules()).body, "draft_orders");
      expect(card.default_outlet_enabled).toBe(true);
      expect(cardOutlet(card, 1).effective).toBe(true);
      expect(cardOutlet(card, 2).effective).toBe(true);
    });

    it("default_outlet_enabled upsert is column-scoped — never clobbers saved_flags/enabled", async () => {
      await db.query(
        `INSERT INTO tenant_business_modules (module_key, enabled, saved_flags, default_outlet_enabled)
         VALUES ('holds_layaway', false, '{"phase2g_holds":true}'::jsonb, true)
         ON CONFLICT (module_key) DO UPDATE SET
           enabled = false, saved_flags = '{"phase2g_holds":true}'::jsonb, default_outlet_enabled = true`
      );
      const res = await outletToggle("holds_layaway", { default_outlet_enabled: false });
      expect(res.status).toBe(200);
      const { rows } = await db.query(
        `SELECT enabled, saved_flags, default_outlet_enabled
           FROM tenant_business_modules WHERE module_key = 'holds_layaway'`
      );
      expect(rows[0].enabled).toBe(false); // untouched
      expect(rows[0].saved_flags).toEqual({ phase2g_holds: true }); // untouched
      expect(rows[0].default_outlet_enabled).toBe(false); // only this moved
    });
  });

  // ══ (platform lock) ════════════════════════════════════════════════════════
  describe("platform lock — enable-direction override + default; clear/disable exempt", () => {
    afterAll(async () => {
      await pool
        .query(`DELETE FROM public.platform_module_locks WHERE locked_by = 'outlet-test'`)
        .catch(() => {});
    });

    it("locked module: enable override 403, enable default 403; disable + clear allowed", async () => {
      await db.query(`DELETE FROM outlet_business_modules WHERE module_key = 'holds_layaway'`);
      await pool.query(
        `INSERT INTO public.platform_module_locks (module_key, tenant_id, locked_by, reason)
         VALUES ('holds_layaway', NULL, 'outlet-test', 'global lock')`
      );

      // Enable-direction override → blocked.
      const enOv = await outletToggle("holds_layaway", { outlet_id: 1, enabled: true });
      expect(enOv.status).toBe(403);
      expect(enOv.body.code).toBe("MODULE_LOCKED");

      // Enable-direction default → blocked.
      const enDef = await outletToggle("holds_layaway", { default_outlet_enabled: true });
      expect(enDef.status).toBe(403);
      expect(enDef.body.code).toBe("MODULE_LOCKED");

      // Disable override → allowed.
      expect((await outletToggle("holds_layaway", { outlet_id: 1, enabled: false })).status).toBe(200);
      // Disable-direction default → allowed.
      expect((await outletToggle("holds_layaway", { default_outlet_enabled: false })).status).toBe(200);
      // Clear (enabled:null) → allowed even while locked (lock-exempt).
      expect((await outletToggle("holds_layaway", { outlet_id: 1, enabled: null })).status).toBe(200);
    });
  });

  // ══ (audit) ════════════════════════════════════════════════════════════════
  describe("audit trail", () => {
    const auditRows = async () => {
      const { rows } = await db.query(
        `SELECT description FROM action_history
          WHERE action_type = 'business_module_outlet_toggle' ORDER BY id DESC`
      );
      return rows;
    };

    it("writes one audit row per successful write, naming module + scope + direction", async () => {
      await db.query(`DELETE FROM outlet_business_modules WHERE module_key = 'holds_layaway'`);
      const before = (await auditRows()).length;

      expect((await outletToggle("holds_layaway", { outlet_id: 2, enabled: false })).status).toBe(200);
      expect((await outletToggle("holds_layaway", { default_outlet_enabled: true })).status).toBe(200);
      expect((await outletToggle("holds_layaway", { outlet_id: 2, enabled: null })).status).toBe(200);

      const after = await auditRows();
      expect(after.length).toBe(before + 3);
      expect(after[2].description).toMatch(/business module 'holds_layaway'.*outlet 2/); // oldest of the 3
      expect(after[1].description).toMatch(/business module 'holds_layaway'.*default/);
      expect(after[0].description).toMatch(/Cleared override.*outlet 2/);

      // A rejected write leaves no audit row.
      const rejected = await outletToggle("loyalty", { outlet_id: 1, enabled: true });
      expect(rejected.status).toBe(409);
      expect((await auditRows()).length).toBe(after.length);
    });
  });

  // ══ (impact ?outlet_id=) ═══════════════════════════════════════════════════
  describe("GET /:key/impact?outlet_id= scopes disable counts", () => {
    beforeAll(async () => {
      // 2 active holds at outlet 1, 1 at outlet 2.
      await db.query(`DELETE FROM holds`);
      await db.query(
        `INSERT INTO holds (hold_number, outlet_id, status, total_amount, balance_due) VALUES
           ('H-1', 1, 'active', 100, 100),
           ('H-2', 1, 'active', 100, 100),
           ('H-3', 2, 'active', 100, 100)`
      );
    });

    it("scopes a per-outlet impact query and leaves the unscoped one tenant-wide", async () => {
      // Unscoped: all 3 active holds.
      const all = await impact("holds_layaway");
      const allByKey = Object.fromEntries(all.body.counts.map((c) => [c.key, c]));
      expect(allByKey.active_holds.count).toBe(3);
      expect(allByKey.active_holds).not.toHaveProperty("tenant_wide"); // byte-compat: no flag without outlet_id
      expect(all.body).not.toHaveProperty("outlet_id");

      // Scoped to outlet 1 → 2 active holds, holds table has outlet_id.
      const at1 = await impact("holds_layaway", 1);
      const at1ByKey = Object.fromEntries(at1.body.counts.map((c) => [c.key, c]));
      expect(at1.body.outlet_id).toBe(1);
      expect(at1ByKey.active_holds.count).toBe(2);
      expect(at1ByKey.active_holds).not.toHaveProperty("tenant_wide");
    });

    it("marks impact queries tenant_wide when their table has no outlet_id column", async () => {
      // projects_contracts.active_projects → service_projects (has outlet_id) is
      // scoped; open_contracts → contracts (no outlet_id) is tenant_wide.
      const res = await impact("projects_contracts", 1);
      const byKey = Object.fromEntries(res.body.counts.map((c) => [c.key, c]));
      expect(byKey.active_projects).not.toHaveProperty("tenant_wide");
      expect(byKey.open_contracts.tenant_wide).toBe(true);
    });

    it("outlet_id on a tenant-scoped card is ignored (v1 tenant-wide behaviour)", async () => {
      const res = await impact("loyalty", 1);
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("outlet_id");
      for (const c of res.body.counts) expect(c).not.toHaveProperty("tenant_wide");
    });
  });

  // ══ (query budget) — LAST: mutates the outlet set ══════════════════════════
  describe("query budget", () => {
    it("per-outlet augmentation is a fixed number of bulk queries, independent of outlet count", async () => {
      recorded = [];
      await getModules();
      const c2 = recorded.length;
      expect(recorded.filter((s) => /outlet_business_modules/i.test(s)).length).toBe(1);
      expect(recorded.filter((s) => /tenant_business_modules/i.test(s)).length).toBe(1);
      expect(recorded.filter((s) => /from outlets\b/i.test(s)).length).toBe(1);

      // Grow from 2 → 4 active outlets.
      await db.query(`INSERT INTO outlets (id, name) VALUES (3, 'Outlet 3'), (4, 'Outlet 4')`);
      recorded = [];
      const res4 = await getModules();
      const c4 = recorded.length;

      // The augmentation must NOT scale with outlet count.
      expect(c4).toBe(c2);
      expect(recorded.filter((s) => /outlet_business_modules/i.test(s)).length).toBe(1);
      expect(recorded.filter((s) => /tenant_business_modules/i.test(s)).length).toBe(1);
      // Sanity: the breakdown now spans all 4 outlets.
      expect(findCard(res4.body, "holds_layaway").outlets.length).toBe(4);
    });
  });
});
