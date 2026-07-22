/**
 * Business Modules v2 — D8 "copy settings from" on outlet creation
 * (PLAN-V2 Step 12, Phase 1).
 *
 * v2 copies exactly ONE thing: the source outlet's outlet_business_modules
 * override rows. This file is the contract for that scope:
 *   - copy_from_outlet_id → overrides match the source row-for-row (and ONLY
 *     module overrides — no stock/employee/sales rows follow)
 *   - no copy_from_outlet_id → zero override rows, i.e. the D1 inherit-by-
 *     default path is untouched (the regression that matters most: today's
 *     create path must behave exactly as it did before Step 12)
 *   - bad source (malformed / missing / foreign-tenant / van) → 400 or 404,
 *     never a half-built outlet
 *   - atomicity: an induced failure mid-clone leaves NO orphan outlet
 *   - plan limit still guards the route
 *   - one audit row per copy, naming source + row count
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("D8 copy-settings on outlet creation (Postgres)", () => {
  let app, db, deps, cleanup, priceListId, managerRoleId;

  // Unique per run — outlets.name is UNIQUE, and this file creates several.
  const N = (label) => `Step12 ${label} ${Math.random().toString(16).slice(2, 8)}`;

  const post = (body) =>
    request(app).post("/api/outlets").set("x-employee-id", "1").send(body);

  const overridesFor = async (outletId) => {
    const { rows } = await db.query(
      "SELECT module_key, enabled FROM outlet_business_modules WHERE outlet_id = $1 ORDER BY module_key",
      [outletId]
    );
    return rows;
  };

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/outlets")(app, deps);

    // Source = seeded outlet 1, given a deliberately mixed override set: one
    // ON, one OFF. A copy that only carried the ON rows (or flattened enabled
    // to true) would pass a single-row fixture — this one catches it.
    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled, updated_by)
       VALUES (1, 'restaurant', true, 'seed'), (1, 'appointments', false, 'seed')
       ON CONFLICT (outlet_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled`
    );

    // The four other ruled-copyable tables, seeded on outlet 1. kds_stations
    // deliberately carries a printer binding + runtime state so the test can
    // prove they are NOT carried over.
    await db.query(
      `INSERT INTO pos_layouts (name, scope_type, scope_id, layout_json, is_active, created_by)
       VALUES ('Main grid', 'outlet', 1, '[{"sku":"A"}]', true, 1)
       ON CONFLICT (scope_type, scope_id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO outlet_product_visibility (outlet_id, product_id, is_visible)
       VALUES (1, 1, false), (1, 2, true)
       ON CONFLICT (outlet_id, product_id) DO UPDATE SET is_visible = EXCLUDED.is_visible`
    );
    await db.query(
      `INSERT INTO price_lists (name) VALUES ('Step12 List') ON CONFLICT DO NOTHING`
    ).catch(() => {});
    const { rows: plRows } = await db.query("SELECT id FROM price_lists ORDER BY id LIMIT 1");
    priceListId = plRows[0]?.id;
    if (priceListId) {
      await db.query(
        `INSERT INTO price_list_assignments (price_list_id, scope_type, scope_id, priority, is_active)
         VALUES ($1, 'outlet', 1, 7, true)
         ON CONFLICT (price_list_id, scope_type, scope_id) DO NOTHING`,
        [priceListId]
      );
    }
    await db.query(
      `INSERT INTO tip_pool_distribution_rules (outlet_id, name, strategy, config_jsonb, is_default, is_active)
       VALUES (1, 'House split', 'hours_weighted', '{"w":2}'::jsonb, true, true)`
    );
    await db.query(
      `INSERT INTO printer_config (connection_type, host) VALUES ('network', '10.0.0.9') RETURNING id`
    );
    const { rows: prRows } = await db.query("SELECT id FROM printer_config ORDER BY id DESC LIMIT 1");
    await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role, is_active, balance_strategy, target_prep_seconds, printer_id, last_assigned_at)
       VALUES (1, 'Grill', 'prep', true, 'least_loaded', 300, $1, NOW())`,
      [prRows[0].id]
    );

    // PLAN-V3 Step 5 (owner ruling COPY, 2026-07-23) — approval_policies. Two
    // rows: one OUTLET-SPECIFIC + role-scoped (must copy with outlet_id rewritten
    // and its tenant-global role_id intact), one GLOBAL (outlet_id IS NULL — it
    // already applies everywhere via the evaluatePolicy wildcard, so it must NOT
    // be duplicated onto the new outlet).
    const { rows: mgrRows } = await db.query(
      "SELECT id FROM roles WHERE name = 'Manager' LIMIT 1"
    );
    managerRoleId = mgrRows[0]?.id;
    await db.query(
      `INSERT INTO approval_policies (action_type, outlet_id, role_id, policy, threshold_value, threshold_type)
       VALUES ('void', 1, $1, 'approval_required', 1000, 'amount')`,
      [managerRoleId]
    );
    await db.query(
      `INSERT INTO approval_policies (action_type, outlet_id, role_id, policy, threshold_value, threshold_type)
       VALUES ('manual_discount', NULL, NULL, 'approval_required', 20, 'percent')`
    );
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  describe("copy path", () => {
    it("clones the source's module overrides row-for-row and audits the copy", async () => {
      const name = N("Copied");
      const res = await post({ name, address: "12 Copy St", copy_from_outlet_id: 1 });

      expect(res.status).toBe(200);
      expect(res.body.copied_from_outlet_id).toBe(1);
      expect(res.body.copied_module_overrides).toBe(2);

      // Row-for-row identity with the source, including the FALSE override.
      expect(await overridesFor(res.body.id)).toEqual([
        { module_key: "appointments", enabled: false },
        { module_key: "restaurant", enabled: true },
      ]);

      const { rows: audit } = await db.query(
        `SELECT user_name, action_type, description FROM action_history
         WHERE action_type = 'outlet_settings_copied' AND description LIKE $1`,
        [`%to new outlet ${res.body.id}%`]
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].description).toContain("outlet_business_modules 2");
      expect(audit[0].description).toContain("from outlet 1");
    });

    it("copies the four other ruled tables, values intact", async () => {
      const res = await post({ name: N("FullCopy"), copy_from_outlet_id: 1 });
      expect(res.status).toBe(200);
      const id = res.body.id;

      const layout = await db.query(
        "SELECT name, layout_json, is_active, created_by FROM pos_layouts WHERE scope_type = 'outlet' AND scope_id = $1",
        [id]
      );
      expect(layout.rows).toEqual([
        { name: "Main grid", layout_json: '[{"sku":"A"}]', is_active: true, created_by: 1 },
      ]);

      const vis = await db.query(
        "SELECT product_id, is_visible FROM outlet_product_visibility WHERE outlet_id = $1 ORDER BY product_id",
        [id]
      );
      // The FALSE row is the one that matters — a new outlet must inherit what
      // the source hides, not silently expose it.
      expect(vis.rows).toEqual([
        { product_id: 1, is_visible: false },
        { product_id: 2, is_visible: true },
      ]);

      if (priceListId) {
        const pla = await db.query(
          "SELECT price_list_id, priority, is_active FROM price_list_assignments WHERE scope_type = 'outlet' AND scope_id = $1",
          [id]
        );
        expect(pla.rows).toEqual([{ price_list_id: priceListId, priority: 7, is_active: true }]);
      }

      const tip = await db.query(
        "SELECT name, strategy, config_jsonb, is_default FROM tip_pool_distribution_rules WHERE outlet_id = $1",
        [id]
      );
      expect(tip.rows).toEqual([
        { name: "House split", strategy: "hours_weighted", config_jsonb: { w: 2 }, is_default: true },
      ]);
    });

    it("copies a KDS station's config but NOT its printer binding or runtime state", async () => {
      const res = await post({ name: N("KdsCopy"), copy_from_outlet_id: 1 });
      const { rows } = await db.query(
        "SELECT name, station_role, balance_strategy, target_prep_seconds, printer_id, last_assigned_at FROM kds_stations WHERE outlet_id = $1",
        [res.body.id]
      );
      expect(rows).toHaveLength(1);
      // Config carries over…
      expect(rows[0].name).toBe("Grill");
      expect(rows[0].balance_strategy).toBe("least_loaded");
      expect(rows[0].target_prep_seconds).toBe(300);
      // …but the printer stands in the SOURCE outlet, and last_assigned_at is
      // the source's load-balancing state. Both must be absent.
      expect(rows[0].printer_id).toBeNull();
      expect(rows[0].last_assigned_at).toBeNull();
    });

    it("copies an outlet-specific approval policy (role_id intact) but NOT a global one", async () => {
      const res = await post({ name: N("ApprovalCopy"), copy_from_outlet_id: 1 });
      expect(res.status).toBe(200);
      const id = res.body.id;

      // The outlet-specific 'void' policy copies with outlet_id rewritten to the
      // new outlet and its tenant-global role_id carried verbatim — proving the
      // (outlet, role) grain survives the copy post-D2.
      const { rows } = await db.query(
        `SELECT action_type, outlet_id, role_id, policy, threshold_value, threshold_type, is_active
           FROM approval_policies WHERE outlet_id = $1 ORDER BY action_type`,
        [id]
      );
      expect(rows).toEqual([
        {
          action_type: "void",
          outlet_id: id,
          role_id: managerRoleId,
          policy: "approval_required",
          threshold_value: "1000.00",
          threshold_type: "amount",
          is_active: true,
        },
      ]);

      // The GLOBAL 'manual_discount' policy (outlet_id IS NULL) is never given an
      // outlet_id — it already applies to every outlet, so a copy must not
      // duplicate it onto the new one.
      const { rows: globals } = await db.query(
        "SELECT COUNT(*)::int AS c FROM approval_policies WHERE action_type = 'manual_discount' AND outlet_id = $1",
        [id]
      );
      expect(globals[0].c).toBe(0);
    });

    it("the audit row names every table it copied", async () => {
      const res = await post({ name: N("AuditDetail"), copy_from_outlet_id: 1 });
      const { rows } = await db.query(
        `SELECT description FROM action_history
          WHERE action_type = 'outlet_settings_copied' AND description LIKE $1`,
        [`%to new outlet ${res.body.id}%`]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].description).toContain("outlet_business_modules 2");
      expect(rows[0].description).toContain("kds_stations 1");
    });

    it("copies settings ONLY — no stock, employee or sales rows follow", async () => {
      const res = await post({ name: N("ScopeCheck"), copy_from_outlet_id: 1 });
      expect(res.status).toBe(200);
      const id = res.body.id;

      for (const table of ["outlet_stock", "employee_outlets", "sales"]) {
        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS c FROM ${table} WHERE outlet_id = $1`,
          [id]
        );
        expect({ table, count: rows[0].c }).toEqual({ table, count: 0 });
      }
    });

    it("copying from a source with no overrides yields zero rows (inherits defaults)", async () => {
      // Outlet 2 is seeded with no override rows of its own.
      const res = await post({ name: N("FromBare"), copy_from_outlet_id: 2 });
      expect(res.status).toBe(200);
      expect(res.body.copied_module_overrides).toBe(0);
      expect(await overridesFor(res.body.id)).toEqual([]);
    });
  });

  describe("the NEVER-copy ruling holds (owner ruling 2026-07-14)", () => {
    it("never copies tax profiles, floor plans, staff schedules, channel identity or kiosk tokens", async () => {
      // Seed the source with one row in each ruled-NEVER table, then copy.
      await db.query(
        "INSERT INTO outlet_tax_profiles (outlet_id, name) VALUES (1, 'Punjab GST') ON CONFLICT (outlet_id) DO NOTHING"
      );
      await db.query(
        "INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'Ground floor')"
      );
      await db.query(
        "INSERT INTO booking_availability_rules (employee_id, outlet_id, day_of_week, start_time, end_time) VALUES (1, 1, 1, '09:00', '17:00')"
      );
      await db.query(
        "INSERT INTO shopify_location_map (outlet_id, shopify_location_id) VALUES (1, 'gid://loc/1') ON CONFLICT DO NOTHING"
      );
      await db.query(
        "INSERT INTO restaurant_kiosk_slots (outlet_id, slot_token, label) VALUES (1, 'tok-step12-secret', 'Kiosk 1')"
      );
      await db.query(
        "INSERT INTO menu_schedules (name, outlet_id, day_of_week, start_time, end_time) VALUES ('Breakfast', 1, 1, '07:00', '11:00')"
      );

      const res = await post({ name: N("NeverCopy"), copy_from_outlet_id: 1 });
      expect(res.status).toBe(200);
      const id = res.body.id;

      for (const table of [
        "outlet_tax_profiles",
        "restaurant_floor_plans",
        "booking_availability_rules",
        "shopify_location_map",
        "restaurant_kiosk_slots",
        "menu_schedules",
      ]) {
        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS c FROM ${table} WHERE outlet_id = $1`,
          [id]
        );
        expect({ table, copied: rows[0].c }).toEqual({ table, copied: 0 });
      }
    });

    it("never copies modifier groups, options or product links (PLAN-V3 Step 6, ruled NEVER 2026-07-23)", async () => {
      // modifier_groups is de-facto tenant-global: the POS per-product path
      // (getModifierTreeForProduct) and the back-office list both ignore
      // outlet_id, and the create form never sets it. Seed outlet 1 with a full
      // tree — an outlet-specific group (the only kind a copy could target), an
      // option under it, and a product link — plus a tenant-wide (outlet_id
      // NULL) group. A copy must add NO modifier rows: the new outlet already
      // sees every product's modifier tree, and copying would double-display.
      const { rows: g1 } = await db.query(
        `INSERT INTO modifier_groups (outlet_id, name, selection_type)
         VALUES (1, 'Step6 Milk', 'single') RETURNING id`
      );
      await db.query(
        `INSERT INTO modifier_options (group_id, name, price_delta) VALUES ($1, 'Oat', 50)`,
        [g1[0].id]
      );
      await db.query(
        `INSERT INTO product_modifier_group_links (product_id, group_id) VALUES (1, $1)`,
        [g1[0].id]
      );
      await db.query(
        `INSERT INTO modifier_groups (outlet_id, name, selection_type)
         VALUES (NULL, 'Step6 Size', 'single')`
      );

      const totals = () =>
        db.query(
          `SELECT
             (SELECT COUNT(*)::int FROM modifier_groups) AS groups,
             (SELECT COUNT(*)::int FROM modifier_options) AS options,
             (SELECT COUNT(*)::int FROM product_modifier_group_links) AS links`
        );
      const before = (await totals()).rows[0];

      const res = await post({ name: N("ModifierNever"), copy_from_outlet_id: 1 });
      expect(res.status).toBe(200);

      // Not one modifier group is scoped to the new outlet…
      const scoped = await db.query(
        "SELECT COUNT(*)::int AS c FROM modifier_groups WHERE outlet_id = $1",
        [res.body.id]
      );
      expect(scoped.rows[0].c).toBe(0);

      // …and the copy created zero new modifier rows of any kind.
      const after = (await totals()).rows[0];
      expect(after).toEqual(before);
    });
  });

  describe("inherit-by-default path (no copy_from)", () => {
    it("creates zero override rows so every module falls back to its card default", async () => {
      const res = await post({ name: N("Fresh"), address: "9 Fresh Ave" });

      expect(res.status).toBe(200);
      expect(res.body.copied_from_outlet_id).toBeNull();
      expect(res.body.copied_module_overrides).toBe(0);
      expect(await overridesFor(res.body.id)).toEqual([]);
    });

    it("empty-string copy_from (the Select's 'Start fresh' option) is not a copy", async () => {
      const res = await post({ name: N("StartFresh"), copy_from_outlet_id: "" });

      expect(res.status).toBe(200);
      expect(res.body.copied_from_outlet_id).toBeNull();
      expect(await overridesFor(res.body.id)).toEqual([]);
    });

    it("writes no audit row when nothing was copied", async () => {
      const name = N("NoAudit");
      const res = await post({ name });
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS c FROM action_history
         WHERE action_type = 'outlet_settings_copied' AND description LIKE $1`,
        [`%to new outlet ${res.body.id}%`]
      );
      expect(rows[0].c).toBe(0);
    });
  });

  describe("invalid sources — rejected, and never a half-built outlet", () => {
    const rejects = async (body, status, code) => {
      const before = await db.query("SELECT COUNT(*)::int AS c FROM outlets");
      const res = await post(body);
      expect({ status: res.status, code: res.body.code }).toEqual({ status, code });
      const after = await db.query("SELECT COUNT(*)::int AS c FROM outlets");
      expect(after.rows[0].c).toBe(before.rows[0].c);
    };

    it("rejects a non-numeric source (400)", () =>
      rejects({ name: N("BadA"), copy_from_outlet_id: "not-an-id" }, 400, "INVALID_COPY_SOURCE"));

    it("rejects a zero/negative source (400)", () =>
      rejects({ name: N("BadB"), copy_from_outlet_id: 0 }, 400, "INVALID_COPY_SOURCE"));

    it("rejects a source that does not exist — the foreign-tenant case, since search_path scopes the lookup (404)", () =>
      rejects({ name: N("BadC"), copy_from_outlet_id: 999999 }, 404, "COPY_SOURCE_NOT_FOUND"));

    it("rejects a van as source — vans carry no per-outlet module state (404)", async () => {
      const { rows } = await db.query(
        `INSERT INTO outlets (name, outlet_type) VALUES ($1, 'van') RETURNING id`,
        [N("Van")]
      );
      await rejects(
        { name: N("BadD"), copy_from_outlet_id: rows[0].id },
        404,
        "COPY_SOURCE_NOT_FOUND"
      );
    });

    it("rejects copying INTO a van (400)", async () => {
      await db.query(
        "INSERT INTO feature_flags (key, enabled) VALUES ('wholesale_van_sales', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
      );
      await rejects(
        { name: N("BadE"), outlet_type: "van", copy_from_outlet_id: 1 },
        400,
        "COPY_SOURCE_NOT_SUPPORTED_FOR_VAN"
      );
      await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'wholesale_van_sales'");
    });
  });

  describe("atomicity", () => {
    it("an induced failure mid-clone leaves no orphan outlet", async () => {
      // Fail the clone itself — after the outlet INSERT has already run inside
      // the transaction. Only a real rollback can hide the outlet afterwards.
      await db.query(`
        CREATE OR REPLACE FUNCTION step12_boom() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'induced clone failure'; END;
        $$ LANGUAGE plpgsql`);
      await db.query(`
        CREATE TRIGGER step12_boom_trg BEFORE INSERT ON outlet_business_modules
        FOR EACH ROW EXECUTE FUNCTION step12_boom()`);

      const name = N("Orphan");
      try {
        const res = await post({ name, copy_from_outlet_id: 1 });
        expect(res.status).toBe(500);
      } finally {
        await db.query("DROP TRIGGER IF EXISTS step12_boom_trg ON outlet_business_modules");
        await db.query("DROP FUNCTION IF EXISTS step12_boom()");
      }

      const { rows } = await db.query("SELECT id FROM outlets WHERE name = $1", [name]);
      expect(rows).toEqual([]);
    });
  });

  describe("plan limit", () => {
    it("still guards POST /api/outlets — the cap is checked before any copy runs", async () => {
      // The shared harness stubs requirePlanLimit to a no-op, so wire a real
      // blocking one onto a second app to prove the guard is still on the route.
      const capped = await createTestApp();
      try {
        require("../../routes/outlets")(capped.app, {
          ...capped.deps,
          requirePlanLimit: (resource) => (req, res, next) =>
            resource === "outlets"
              ? res.status(403).json({ code: "PLAN_LIMIT_REACHED" })
              : next(),
        });

        const res = await request(capped.app)
          .post("/api/outlets")
          .set("x-employee-id", "1")
          .send({ name: N("Capped"), copy_from_outlet_id: 1 });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("PLAN_LIMIT_REACHED");
      } finally {
        await capped.cleanup();
      }
    }, 60000);
  });
});
