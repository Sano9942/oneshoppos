/**
 * Business Modules toggle path (PLAN.md Step 6) — the 12-case verify matrix
 * (a)–(l). POST /api/business-modules/:key/toggle + GET /:key/impact +
 * the legacy PUT /api/feature-flags/:key lockdown + platform locks.
 *
 * State accumulates within this file by design — tests run sequentially and
 * each states its own preconditions.
 */

const request = require("supertest");
const fs = require("fs");
const path = require("path");
const { createTestApp } = require("../helpers/createTestApp-pg");
const pool = require("../../db-pg");

const RESTAURANT_BUNDLE = [
  "phase4_restaurant",
  "phase4_restaurant_kds",
  "phase4_restaurant_qr",
  "phase4_restaurant_86",
  "phase4_restaurant_void_comp",
  "phase4_restaurant_pay_at_table",
  "phase4_restaurant_reservations",
  "phase4_restaurant_kds_analytics",
  "phase4_restaurant_day_parting",
  "phase4_restaurant_fire_chits",
  "phase4_restaurant_drive_thru",
  "phase4_restaurant_menu_engineering",
];

// Arbitrary tenant id stamped on every request by the test shim — drives the
// per-tenant lock matching and the middleware cache keys.
const SHIM_TENANT_ID = 424242;
const LOCK_MODULES = ["gift_cards", "holds_layaway", "draft_orders"];

describe("business modules toggle API (Postgres)", () => {
  let app, db, deps, cleanup;
  const featureFlags = require("../../middleware/feature-flags");

  beforeAll(async () => {
    // The public lock table normally arrives via migration v131 — create
    // idempotently in case this test DB's public schema predates it.
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

    // Shim: stamp req.tenantId so lock matching + cache invalidation use a
    // stable key (production gets this from the JWT via loadTenantAndPerms).
    app.use((req, res, next) => {
      req.tenantId = SHIM_TENANT_ID;
      next();
    });
    require("../../routes/business-modules")(app, deps);

    // Replica of the legacy PUT /api/feature-flags/:key endpoint with the
    // Step 6 lockdown middleware in the same position as registerAllRoutes.js
    // (that file requires every route module, so it can't mount in this
    // harness — a source assertion below verifies the real wiring).
    const { rejectCatalogManagedFlagWrites } = require("../../services/business-modules");
    app.put(
      "/api/feature-flags/:key",
      deps.requirePerm("all_access"),
      rejectCatalogManagedFlagWrites,
      async (req, res) => {
        const { key } = req.params;
        const enabledVal = req.body?.enabled ? true : false;
        await db.query(
          `INSERT INTO feature_flags (key, enabled, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
          [key, enabledVal]
        );
        res.json({ message: "Feature flag updated", key, enabled: enabledVal });
      }
    );

    // Real middleware caches for case (h).
    featureFlags.init({ db, IS_MULTI_TENANT: false, tenantDbManager: null, dbProxy: null });

    // Gated probe route for case (c) — proves "access restored" through a
    // real feature gate, not just a flag-row read.
    app.get("/api/_probe/loyalty", deps.requireFeature("phase2g_loyalty"), (req, res) =>
      res.json({ ok: true })
    );

    await pool.query(
      `DELETE FROM public.platform_module_locks WHERE locked_by = 'toggle-test' OR module_key = ANY($1)`,
      [LOCK_MODULES]
    ).catch(() => {});

    // This suite exercises the modeless → first-mode-row backfill path (the
    // empty→enforcing transition trap), so it needs a genuinely MODELESS
    // tenant: case (a) asserts COUNT(*) FROM tenant_modes = 0 as its
    // precondition. createTestApp now seeds the full registry row set for the
    // fail-closed requireMode, so clear it back out here — this suite owns its
    // mode state rather than inheriting the harness default.
    await db.query("DELETE FROM tenant_modes");
    featureFlags.invalidateModeCache();
  }, 60000);

  afterAll(async () => {
    await pool.query(
      `DELETE FROM public.platform_module_locks WHERE locked_by = 'toggle-test'`
    ).catch(() => {});
    if (cleanup) await cleanup();
  });

  const post = (key, body, employeeId = "1") =>
    request(app)
      .post(`/api/business-modules/${key}/toggle`)
      .set("x-employee-id", employeeId)
      .send(body);
  const impact = (key, direction, employeeId = "1") =>
    request(app)
      .get(`/api/business-modules/${key}/impact${direction ? `?direction=${direction}` : ""}`)
      .set("x-employee-id", employeeId);
  const getModules = () =>
    request(app).get("/api/business-modules").set("x-employee-id", "1");
  const flagValue = async (key) => {
    const { rows } = await db.query("SELECT enabled FROM feature_flags WHERE key = $1", [key]);
    return rows.length ? rows[0].enabled === true : null;
  };
  const modeRow = async (mode) => {
    const { rows } = await db.query("SELECT enabled FROM tenant_modes WHERE mode = $1", [mode]);
    return rows.length ? rows[0].enabled === true : null;
  };
  const moduleRow = async (key) => {
    const { rows } = await db.query(
      "SELECT enabled, saved_flags FROM tenant_business_modules WHERE module_key = $1",
      [key]
    );
    return rows[0] || null;
  };

  // ── (j) perm-gated ────────────────────────────────────────────────────────
  it("(j) toggle + impact are perm-gated (no header 403, Cashier 403)", async () => {
    expect((await request(app).post("/api/business-modules/loyalty/toggle").send({ enabled: true })).status).toBe(403);
    expect((await post("loyalty", { enabled: true }, "3")).status).toBe(403);
    expect((await request(app).get("/api/business-modules/loyalty/impact")).status).toBe(403);
    expect((await impact("loyalty", null, "3")).status).toBe(403);
  });

  it("(j) toggle body is Zod-validated (missing enabled → 400)", async () => {
    expect((await post("loyalty", {})).status).toBe(400);
    expect((await post("loyalty", { enabled: "yes" })).status).toBe(400);
  });

  // ── (f) unreachable keys ─────────────────────────────────────────────────
  it("(f) unknown keys, Bucket D flags and bundle-flag keys are 404", async () => {
    expect((await post("not_a_module", { enabled: true })).status).toBe(404);
    // Bucket D / UNMANAGED flag — never a toggle target.
    expect((await post("multi_company", { enabled: true })).status).toBe(404);
    expect((await post("context_header_enforced", { enabled: false })).status).toBe(404);
    // Bundle flag keys are not cards either — only card keys + sub_toggles.
    expect((await post("phase4_restaurant_kds", { enabled: true })).status).toBe(404);
    expect((await impact("not_a_module")).status).toBe(404);
  });

  // ── (e) Bucket C rejected ────────────────────────────────────────────────
  it("(e) Bucket C keys reject toggling with 409 REQUIRES_SETUP + setup_route", async () => {
    const res = await post("fbr_digital_invoicing", { enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REQUIRES_SETUP");
    expect(res.body.setup_route).toBe("/settings/fbr");
    // Both directions — the C state machine is credential-driven.
    expect((await post("marketplace_channels", { enabled: false })).status).toBe(409);
  });

  // ── (a) Bucket A enable: mode row + bundle + first-row backfill ──────────
  it("(a) enabling Restaurant on a modeless tenant writes mode row + all 13 bundle flags and backfills drifted modes", async () => {
    // Precondition: retail-ish tenant — restaurant flags off, but the harness
    // seeds several other phase4_* verticals true = drifted flags without
    // mode rows (the empty→enforcing transition trap).
    for (const f of RESTAURANT_BUNDLE) {
      await db.query(
        `INSERT INTO feature_flags (key, enabled) VALUES ($1, false)
         ON CONFLICT (key) DO UPDATE SET enabled = false`,
        [f]
      );
    }
    const { rows: pre } = await db.query("SELECT COUNT(*)::int AS n FROM tenant_modes");
    expect(pre[0].n).toBe(0);

    const res = await post("restaurant", { enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);

    // Mode row + full bundle.
    expect(await modeRow("restaurant")).toBe(true);
    for (const f of RESTAURANT_BUNDLE) {
      expect(await flagValue(f), f).toBe(true);
    }
    expect((await moduleRow("restaurant")).enabled).toBe(true);

    // Backfill: harness seeds phase4_rentals/appointments/etc. true with no
    // mode rows — those modes must be materialised enabled=true so
    // requireMode doesn't start 403ing them the moment enforcement begins.
    expect(res.body.modes_backfilled).toEqual(
      expect.arrayContaining(["rentals", "appointments", "workflow_tickets", "room_management", "treatment_plans"])
    );
    expect(await modeRow("rentals")).toBe(true);
    expect(await modeRow("appointments")).toBe(true);
    // Modes with no enabled flags are NOT backfilled (no row at all).
    expect(await modeRow("wholesale")).toBe(null);
    expect(await modeRow("commissions")).toBe(null);
  });

  // ── (i) audit ────────────────────────────────────────────────────────────
  it("(i) each toggle writes exactly one action_history row", async () => {
    // Only (a)'s restaurant enable has succeeded so far — every earlier call
    // was rejected before any write.
    const { rows } = await db.query(
      `SELECT user_name, description FROM action_history WHERE action_type = 'business_module_toggle'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].description).toContain("restaurant");
    expect(rows[0].description).toContain("flags:");
    expect(rows[0].user_name).toBeTruthy();
  });

  // ── (b) disable: saved_flags, never deletes, domain untouched ────────────
  it("(b) disable writes saved_flags, flips flags off, never touches domain data, never deletes mode rows", async () => {
    // Loyalty (Bucket B): enable, then disable. Customer #1 holds 100 points.
    expect((await post("loyalty", { enabled: true })).status).toBe(200);
    expect(await flagValue("phase2g_loyalty")).toBe(true);

    const res = await post("loyalty", { enabled: false });
    expect(res.status).toBe(200);
    expect(await flagValue("phase2g_loyalty")).toBe(false);
    const row = await moduleRow("loyalty");
    expect(row.enabled).toBe(false);
    expect(row.saved_flags).toEqual({ phase2g_loyalty: true });

    // Domain data untouched (hide-not-delete)...
    const { rows: [cust] } = await db.query("SELECT loyalty_points FROM customers WHERE id = 1");
    expect(Number(cust.loyalty_points)).toBe(100);
    // ...but the gate is really closed.
    expect((await request(app).get("/api/_probe/loyalty").set("x-employee-id", "1")).status).toBe(503);

    // Bucket A disable flips the mode row off but NEVER deletes it.
    expect((await post("restaurant", { enabled: false })).status).toBe(200);
    expect(await modeRow("restaurant")).toBe(false); // row exists, enabled=false
    expect(await flagValue("phase4_restaurant")).toBe(false);
  });

  // ── (c) re-enable restores access ────────────────────────────────────────
  it("(c) re-enable restores access to pre-existing data through the real gate", async () => {
    expect((await post("loyalty", { enabled: true })).status).toBe(200);
    expect(await flagValue("phase2g_loyalty")).toBe(true);
    const { rows: [cust] } = await db.query("SELECT loyalty_points FROM customers WHERE id = 1");
    expect(Number(cust.loyalty_points)).toBe(100);
    expect((await moduleRow("loyalty")).enabled).toBe(true);
    expect((await request(app).get("/api/_probe/loyalty").set("x-employee-id", "1")).status).toBe(200);
  });

  // ── (d) saved_flags round-trip with sub_toggles ──────────────────────────
  it("(d) sub-toggle choices survive an off/on cycle (exact snapshot restore, no blanket re-enable)", async () => {
    // First enable: bundle flag on, sub_toggles untouched (stay false).
    expect((await post("appointments", { enabled: true })).status).toBe(200);
    expect(await flagValue("phase4_appointments")).toBe(true);

    // Merchant customization: waitlists ON, classes stays OFF.
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_appointments_waitlists', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );

    // Disable — snapshot taken, everything managed goes dark.
    expect((await post("appointments", { enabled: false })).status).toBe(200);
    const row = await moduleRow("appointments");
    expect(row.saved_flags).toMatchObject({
      phase4_appointments: true,
      phase4_appointments_waitlists: true,
      phase4_appointments_classes: false,
    });
    expect(await flagValue("phase4_appointments")).toBe(false);
    expect(await flagValue("phase4_appointments_waitlists")).toBe(false);

    // Re-enable — exact restore: waitlists back ON, classes STILL OFF.
    expect((await post("appointments", { enabled: true })).status).toBe(200);
    expect(await flagValue("phase4_appointments")).toBe(true);
    expect(await flagValue("phase4_appointments_waitlists")).toBe(true);
    expect(await flagValue("phase4_appointments_classes")).toBe(false);
    expect(await modeRow("appointments")).toBe(true);
  });

  // ── (d2) toggle idempotency guards (verifier findings 1+2) ───────────────
  it("(d2) repeated disable keeps the real snapshot; repeated enable never applies a stale one", async () => {
    // From (d): appointments enabled, waitlists ON, classes OFF, snapshot
    // consumed (cleared on enable).
    expect((await moduleRow("appointments")).saved_flags).toBeNull();

    // Disable, then disable AGAIN (double-click / retry).
    expect((await post("appointments", { enabled: false })).status).toBe(200);
    expect((await post("appointments", { enabled: false })).status).toBe(200);
    // The second disable must NOT have clobbered the snapshot with zeros.
    expect((await moduleRow("appointments")).saved_flags).toMatchObject({
      phase4_appointments: true,
      phase4_appointments_waitlists: true,
    });

    // Re-enable restores waitlists; merchant then turns it OFF while on.
    expect((await post("appointments", { enabled: true })).status).toBe(200);
    expect(await flagValue("phase4_appointments_waitlists")).toBe(true);
    await db.query(
      `UPDATE feature_flags SET enabled = false WHERE key = 'phase4_appointments_waitlists'`
    );
    // A redundant second enable must NOT resurrect the stale snapshot value.
    expect((await post("appointments", { enabled: true })).status).toBe(200);
    expect(await flagValue("phase4_appointments_waitlists")).toBe(false);
  });

  // ── (g) depends_on both directions ───────────────────────────────────────
  it("(g) impact lists prerequisites; enable auto-enables and names them; disable needs cascade", async () => {
    // wholesale_field_sales is off — van sales' prerequisite.
    expect(await flagValue("wholesale_field_sales")).not.toBe(true);

    const preview = await impact("wholesale_van_sales", "enable");
    expect(preview.status).toBe(200);
    expect(preview.body.prerequisites).toEqual([
      expect.objectContaining({ key: "field_sales" }),
    ]);

    // Enable the sub_toggle — prerequisite module auto-enabled and NAMED.
    const res = await post("wholesale_van_sales", { enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.also_enabled).toContain("field_sales");
    expect(await flagValue("wholesale_van_sales")).toBe(true);
    expect(await flagValue("wholesale_field_sales")).toBe(true);
    expect((await moduleRow("field_sales")).enabled).toBe(true);

    // Disable-direction impact on the prerequisite names the dependent.
    const dimpact = await impact("field_sales");
    expect(dimpact.status).toBe(200);
    expect(dimpact.body.dependents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "wholesale_van_sales", type: "sub_toggle" }),
      ])
    );

    // Disabling the prerequisite without cascade is refused with the list.
    const refused = await post("field_sales", { enabled: false });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("HAS_ENABLED_DEPENDENTS");
    expect(refused.body.dependents.map((d) => d.key)).toContain("wholesale_van_sales");

    // With cascade:true it proceeds and disables the dependent too.
    const cascaded = await post("field_sales", { enabled: false, cascade: true });
    expect(cascaded.status).toBe(200);
    expect(cascaded.body.cascaded.map((d) => d.key)).toContain("wholesale_van_sales");
    expect(await flagValue("wholesale_field_sales")).toBe(false);
    expect(await flagValue("wholesale_van_sales")).toBe(false);
  });

  it("(g3) cascade leaves Bucket C dependents connected (no re-enable dead-end)", async () => {
    // Restaurant back on; Delivery Aggregators (Bucket C, depends_on
    // restaurant) enabled via its flag — the cafe/restaurant-preset state.
    expect((await post("restaurant", { enabled: true })).status).toBe(200);
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('delivery_aggregators', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );

    // Refused without cascade, and the C dependent is named.
    const refused = await post("restaurant", { enabled: false });
    expect(refused.status).toBe(409);
    expect(refused.body.dependents.map((d) => d.key)).toContain("delivery_aggregators");

    // With cascade: restaurant goes off, but the C card is NOT zeroed —
    // this endpoint could never turn it back on (409 REQUIRES_SETUP) and
    // the legacy PUT rejects its primary flag, so cascading it off would be
    // un-undoable. It is reported as left_connected instead.
    const res = await post("restaurant", { enabled: false, cascade: true });
    expect(res.status).toBe(200);
    expect(res.body.left_connected.map((d) => d.key)).toContain("delivery_aggregators");
    expect(res.body.cascaded.map((d) => d.key)).not.toContain("delivery_aggregators");
    expect(await flagValue("delivery_aggregators")).toBe(true);
    expect(await flagValue("phase4_restaurant")).toBe(false);

    // cascade:true with zero dependents is a plain disable (no error).
    expect((await post("batch_expiry", { enabled: true })).status).toBe(200);
    const plain = await post("batch_expiry", { enabled: false, cascade: true });
    expect(plain.status).toBe(200);
    expect(plain.body.cascaded).toEqual([]);
  });

  it("(g2) disable-direction impact returns live counts", async () => {
    const res = await impact("restaurant");
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.counts.map((c) => [c.key, c]));
    expect(byKey.open_table_sessions).toBeDefined();
    expect(byKey.open_table_sessions.count).toBe(0);
    expect(byKey.open_tabs.label).toBe("Open tabs");
  });

  // ── (h) cache invalidation ───────────────────────────────────────────────
  it("(h) both middleware caches reflect a toggle immediately", async () => {
    // Prime the REAL 60s caches for this tenant key. (The subscriptions mode
    // was already backfilled in (a) — harness seeds subscription_billing true
    // — so use commissions, whose flag is off and thus never backfilled.)
    const before = await featureFlags.getFeatureFlagsMap(SHIM_TENANT_ID);
    expect(before.phase2g_gift_cards).toBe(false);
    const modesBefore = await featureFlags.getModesMap(SHIM_TENANT_ID);
    expect(modesBefore.commissions).toBeUndefined();

    expect((await post("gift_cards", { enabled: true })).status).toBe(200);
    expect((await post("commissions", { enabled: true })).status).toBe(200);

    // No TTL wait — the toggle must have invalidated both caches.
    const after = await featureFlags.getFeatureFlagsMap(SHIM_TENANT_ID);
    expect(after.phase2g_gift_cards).toBe(true);
    expect(after.phase2_commissions).toBe(true);
    const modesAfter = await featureFlags.getModesMap(SHIM_TENANT_ID);
    expect(modesAfter.commissions).toBe(true);
  });

  // ── (l) platform locks ───────────────────────────────────────────────────
  it("(l) global lock blocks enable, per-tenant lock blocks that tenant, disable always works, GET shows locked", async () => {
    // gift_cards is ON from (h). Lock it globally.
    await pool.query(
      `INSERT INTO public.platform_module_locks (module_key, tenant_id, locked_by, reason)
       VALUES ('gift_cards', NULL, 'toggle-test', 'test global lock')`
    );

    // Locked module still DISABLEs fine.
    expect((await post("gift_cards", { enabled: false })).status).toBe(200);

    // ...but cannot self-ENABLE.
    const blocked = await post("gift_cards", { enabled: true });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MODULE_LOCKED");
    expect(blocked.body.module_key).toBe("gift_cards");

    // GET marks it: locked:true and (being off) state "locked".
    const list = await getModules();
    const card = list.body.modules.find((m) => m.key === "gift_cards");
    expect(card.locked).toBe(true);
    expect(card.state).toBe("locked");

    // Enable-direction impact preview also reports the lock.
    const preview = await impact("gift_cards", "enable");
    expect(preview.body.locked).toBe(true);

    // Per-tenant lock for THIS tenant blocks it...
    await pool.query(
      `INSERT INTO public.platform_module_locks (module_key, tenant_id, locked_by, reason)
       VALUES ('holds_layaway', $1, 'toggle-test', 'test tenant lock')`,
      [SHIM_TENANT_ID]
    );
    const tenantBlocked = await post("holds_layaway", { enabled: true });
    expect(tenantBlocked.status).toBe(403);
    expect(tenantBlocked.body.code).toBe("MODULE_LOCKED");

    // ...while a lock for a DIFFERENT tenant does not.
    await pool.query(
      `INSERT INTO public.platform_module_locks (module_key, tenant_id, locked_by, reason)
       VALUES ('draft_orders', 999999, 'toggle-test', 'other tenant lock')`
    );
    expect((await post("draft_orders", { enabled: true })).status).toBe(200);
  });

  // ── (k) legacy PUT lockdown ──────────────────────────────────────────────
  it("(k) legacy PUT /api/feature-flags/:key rejects catalog-managed keys, allows sub_toggles + UNMANAGED", async () => {
    const put = (key, enabled = true) =>
      request(app)
        .put(`/api/feature-flags/${key}`)
        .set("x-employee-id", "1")
        .send({ enabled });

    // Module primary flag.
    const primary = await put("phase4_rentals");
    expect(primary.status).toBe(409);
    expect(primary.body.code).toBe("MANAGED_BY_BUSINESS_MODULES");
    expect(primary.body.module_key).toBe("rentals");

    // Bundle flag (member of a card's flag bundle).
    const bundle = await put("phase4_restaurant_kds");
    expect(bundle.status).toBe(409);
    expect(bundle.body.module_key).toBe("restaurant");

    // Bucket C primary flag is catalog-managed too.
    expect((await put("marketplace_integrations")).status).toBe(409);

    // sub_toggles keep working (v1 has no sub-toggle UI — deferral D3).
    expect((await put("phase4_appointments_classes")).status).toBe(200);
    // UNMANAGED / Bucket D keys keep working (config contract — see the
    // rejectCatalogManagedFlagWrites doc note on the PLAN wording).
    expect((await put("multi_company", false)).status).toBe(200);
    // Non-catalog keys keep the endpoint's historical upsert-anything shape.
    expect((await put("some_future_experiment")).status).toBe(200);
  });

  it("(k2) registerAllRoutes.js actually wires the lockdown middleware on the real endpoint", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../routes/registerAllRoutes.js"),
      "utf8"
    );
    expect(src).toMatch(
      /\/api\/feature-flags\/:key"[\s\S]{0,600}rejectCatalogManagedFlagWrites[\s\S]{0,600}async \(req, res\)/
    );
  });
});
