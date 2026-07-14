/**
 * Business Modules read path (PLAN.md Step 4) — GET /api/business-modules.
 *
 * Verifies: perm gating (proper requirePerm, NOT the weak x-employee-id-only
 * pattern of GET /api/feature-flags), fresh-tenant defaults, state flips when
 * a mode + flags are seeded, Bucket C setup_required/connected derivation,
 * and industry-recommended chips.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("business modules read API (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/business-modules")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const getModules = async (employeeId = "1") => {
    const req = request(app).get("/api/business-modules");
    if (employeeId) req.set("x-employee-id", employeeId);
    return req;
  };

  const findCard = (body, key) => body.modules.find((m) => m.key === key);

  it("rejects unauthenticated requests (no employee header → 403)", async () => {
    const res = await request(app).get("/api/business-modules");
    expect(res.status).toBe(403);
  });

  it("rejects a Cashier (no all_access)", async () => {
    const res = await getModules("3");
    expect(res.status).toBe(403);
  });

  it("returns the full catalog with a state enum for an admin", async () => {
    const res = await getModules();
    expect(res.status).toBe(200);
    expect(res.body.modules.length).toBeGreaterThan(40);
    const states = new Set(["off", "on", "setup_required", "connected", "locked", "attention_required"]);
    for (const m of res.body.modules) {
      expect(states.has(m.state), `${m.key} state '${m.state}'`).toBe(true);
      expect(["tenant", "outlet", "hybrid", "device"]).toContain(m.scope);
      expect(typeof m.locked).toBe("boolean");
    }
  });

  it("state derives from merged defaults + DB rows", async () => {
    const res = await getModules();
    // Default-true flag with no DB row → on.
    expect(findCard(res.body, "accounting").state).toBe("on");
    // Harness fixture seeds every phase4_* vertical true → enabled. Restaurant
    // is a covered vertical (PLAN-V2 D6 setup checklist): enabled but with no
    // floor plan configured, its required checklist items are un-done, so the
    // card reads `attention_required` rather than a bare `on`.
    expect(findCard(res.body, "restaurant").state).toBe("attention_required");
    // Fixture seeds these false → off.
    expect(findCard(res.body, "gift_cards").state).toBe("off");
    expect(findCard(res.body, "loyalty").state).toBe("off");
    // No fixture row + default false → off.
    expect(findCard(res.body, "field_sales").state).toBe("off");
  });

  it("seeding a mode row + bundle flags flips the Bucket A card to on", async () => {
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled, enabled_at) VALUES ('rentals', true, NOW())
       ON CONFLICT (mode) DO UPDATE SET enabled = true`
    );
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_rentals', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    // Rentals is a covered vertical (D6). Seed its one required checklist item
    // (a rental item) so this test stays focused on the mode/flag → on flip
    // rather than the attention_required setup state.
    await db.query(`INSERT INTO rental_items (name) VALUES ('Setup Test Item')`);
    const res = await getModules();
    expect(findCard(res.body, "rentals").state).toBe("on");

    // Mode row is the truth for Bucket A: enabled=false wins over the flag.
    await db.query(`UPDATE tenant_modes SET enabled = false WHERE mode = 'rentals'`);
    const res2 = await getModules();
    expect(findCard(res2.body, "rentals").state).toBe("off");
  });

  it("drifted tenant (flag on, NO mode row) derives Bucket A state from the flag", async () => {
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_workflow_tickets', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    const res = await getModules();
    expect(findCard(res.body, "service_tickets").state).toBe("on");
  });

  it("Bucket C card without credentials is setup_required; with credentials connected", async () => {
    const res = await getModules();
    const shopify = findCard(res.body, "shopify");
    expect(shopify.state).toBe("setup_required");
    expect(shopify.setup_route).toBe("/integrations/shopify");
    expect(shopify.connected).toBe(false);

    await db.query(
      `INSERT INTO shopify_connections (shop_domain, access_token, is_active)
       VALUES ('test.myshopify.com', 'tok', true)`
    );
    const res2 = await getModules();
    expect(findCard(res2.body, "shopify").state).toBe("connected");
  });

  it("Bucket C card with credentials but flags off shows off (not connected)", async () => {
    // marketplace_integrations defaults true — store creds, then disable it.
    await db.query(
      `INSERT INTO integration_settings (provider, category, is_active, api_key)
       VALUES ('daraz', 'marketplace', true, 'k')
       ON CONFLICT (provider) DO UPDATE SET is_active = true`
    );
    const before = await getModules();
    expect(findCard(before.body, "marketplace_channels").state).toBe("connected");

    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('marketplace_integrations', false)
       ON CONFLICT (key) DO UPDATE SET enabled = false`
    );
    const after = await getModules();
    expect(findCard(after.body, "marketplace_channels").state).toBe("off");
  });

  it("recommended chips follow the tenant's industry preset", async () => {
    // Fixture company has no industry — defaults to general_retail.
    const retail = await getModules();
    expect(findCard(retail.body, "restaurant").preset_recommended).toBe(false);

    await db.query(`UPDATE company_profile SET industry_type = 'restaurant' WHERE id = 1`);
    const resto = await getModules();
    expect(resto.body.industry_type).toBe("restaurant");
    expect(findCard(resto.body, "restaurant").preset_recommended).toBe(true);
    // Restaurant seed bundle includes loyalty + gift cards.
    expect(findCard(resto.body, "loyalty").preset_recommended).toBe(true);
  });

  it("sub_toggles carry live values and metadata", async () => {
    const res = await getModules();
    const wholesale = findCard(res.body, "wholesale_credit");
    const van = wholesale.sub_toggles.find((s) => s.key === "wholesale_van_sales");
    expect(van).toBeDefined();
    expect(van.depends_on).toEqual(["field_sales"]);
    expect(van.enabled).toBe(false);
  });

  // ── Step 7 — manage_business_modules delegation + roles_with_access ──────
  describe("Step 7: permission contract", () => {
    beforeAll(async () => {
      // Match production role seeding (ensureDefaultRolePermissions runs at
      // provisioning) — the harness fixture seeds Manager with a truncated
      // 8-perm set; production Managers hold manage_rentals etc.
      const { ensureDefaultRolePermissions } = require("../../middleware/permissions");
      await ensureDefaultRolePermissions(db);
      // A custom delegated role holding ONLY manage_business_modules.
      await db.query(
        `INSERT INTO roles (id, name, description) VALUES (50, 'Module Manager', 'Delegated module management')`
      );
      await db.query(
        `INSERT INTO role_permissions (role_id, permission) VALUES (50, 'manage_business_modules')`
      );
      await db.query(
        `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary)
         VALUES (50, 'Module Manager User', 'Module Manager', '5050', 50, 0)`
      );
    });

    it("403s a Manager (broad default set, no manage_business_modules)", async () => {
      expect((await getModules("2")).status).toBe(403);
      const impact = await request(app)
        .get("/api/business-modules/rentals/impact")
        .set("x-employee-id", "2");
      expect(impact.status).toBe(403);
    });

    it("a custom role with only manage_business_modules passes all three endpoints", async () => {
      const res = await getModules("50");
      expect(res.status).toBe(200);

      const impact = await request(app)
        .get("/api/business-modules/gift_cards/impact")
        .set("x-employee-id", "50");
      expect(impact.status).toBe(200);

      const before = await db.query("SELECT COUNT(*)::int AS n FROM role_permissions");
      const toggle = await request(app)
        .post("/api/business-modules/gift_cards/toggle")
        .set("x-employee-id", "50")
        .send({ enabled: true });
      expect(toggle.status).toBe(200);
      // Invariant: a module toggle never grants or revokes any permission.
      const after = await db.query("SELECT COUNT(*)::int AS n FROM role_permissions");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("Administrator still passes via the all_access bypass", async () => {
      expect((await getModules("1")).status).toBe(200);
    });

    it("cards carry permissions + roles_with_access (dormant while off)", async () => {
      const res = await getModules("1");

      const rentals = findCard(res.body, "rentals");
      expect(rentals.permissions).toEqual(["manage_rentals"]);
      expect(rentals.roles_with_access).toContain("Administrator");
      expect(rentals.roles_with_access).toContain("Manager");
      expect(rentals.roles_with_access).not.toContain("Cashier");
      expect(rentals.roles_with_access).not.toContain("Module Manager");

      // No dedicated permission → only all_access roles listed.
      const accounting = findCard(res.body, "accounting");
      expect(accounting.permissions).toEqual([]);
      expect(accounting.roles_with_access).toEqual(["Administrator"]);

      // roles_with_access is computed from role assignments regardless of
      // module state — rentals stayed listed above even while the card was
      // off/on across earlier tests (hide-not-delete for permissions too).
      const restaurant = findCard(res.body, "restaurant");
      expect(restaurant.roles_with_access).toContain("Manager");
    });
  });
});
