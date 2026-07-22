/**
 * Business Modules v2 — setup checklists (PLAN-V2 Step 11, D6).
 *
 * The load-bearing case is outlet INDEPENDENCE (amendment a, the reason this
 * step moved after D1): a floor plan created at outlet A must complete outlet
 * A's checklist item WITHOUT completing outlet B's. Proven directly against the
 * computeChecklists service — that is where the outlet dimension lives (the v2
 * settings-page route consumer is deliberately tenant-wide).
 *
 * Also covers: an enabled-but-unconfigured covered card reads attention_required
 * (0/N); all required done → back to `on`; an optional item never holds the
 * state; checklist is absent for disabled + non-covered cards.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

const {
  loadLiveFlags,
  loadLiveModes,
  computeChecklists,
} = require("../../services/business-modules");

const SHIM_TENANT_ID = 626262;

describe("business modules setup checklists (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    app.use((req, res, next) => {
      req.tenantId = SHIM_TENANT_ID;
      next();
    });
    require("../../routes/business-modules")(app, deps);

    // Enable Restaurant (a covered vertical). Harness seeds phase4_restaurant
    // already, but make it explicit + self-contained.
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_restaurant', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    // Rooms is a covered vertical too — keep it OFF for the "no checklist on a
    // disabled card" assertion. The harness seeds every registry mode enabled
    // (fail-closed requireMode needs a non-empty map), and a Bucket A card's
    // state derives from its mode as well as its flag — so rooms_lodging is
    // only genuinely off once its mode row is off too. Otherwise the card reads
    // enabled and grows a checklist.
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_room_management', false)
       ON CONFLICT (key) DO UPDATE SET enabled = false`
    );
    await db.query(`UPDATE tenant_modes SET enabled = false WHERE mode = 'room_management'`);
    // Clean floor plans so the first read sees an un-done required item.
    await db.query(`DELETE FROM restaurant_floor_plans`);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const getModules = () =>
    request(app).get("/api/business-modules").set("x-employee-id", "1");
  const findCard = (body, key) => body.modules.find((m) => m.key === key);

  it("enabled covered card with an un-done REQUIRED item reads attention_required", async () => {
    const res = await getModules();
    expect(res.status).toBe(200);
    const resto = findCard(res.body, "restaurant");
    // Harness seeds 5 products → menu_items done; no floor plan → floor_plan
    // (required) un-done → attention_required.
    expect(resto.state).toBe("attention_required");
    expect(Array.isArray(resto.checklist)).toBe(true);
    const floor = resto.checklist.find((i) => i.id === "floor_plan");
    const menu = resto.checklist.find((i) => i.id === "menu_items");
    expect(floor).toMatchObject({ required: true, scope: "outlet", done: false });
    expect(menu).toMatchObject({ required: true, scope: "tenant", done: true });
  });

  it("checklist is absent for a DISABLED covered card and for a NON-covered card", async () => {
    const res = await getModules();
    // rooms_lodging is a covered vertical but off → no checklist.
    expect(findCard(res.body, "rooms_lodging")).not.toHaveProperty("checklist");
    // accounting is enabled (default) but not a covered vertical → no checklist.
    expect(findCard(res.body, "accounting")).not.toHaveProperty("checklist");
  });

  it("a floor plan at outlet 1 completes outlet 1's item but NOT outlet 2's (independence)", async () => {
    await db.query(
      `INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'Main Floor')`
    );
    const flags = await loadLiveFlags(db);
    const modes = await loadLiveModes(db);

    const at1 = await computeChecklists(db, { flags, modes, outletId: 1 });
    const at2 = await computeChecklists(db, { flags, modes, outletId: 2 });
    const tenantWide = await computeChecklists(db, { flags, modes, outletId: null });

    const floorAt = (r) => r.restaurant.checklist.find((i) => i.id === "floor_plan").done;
    expect(floorAt(at1)).toBe(true); // A has a floor plan
    expect(floorAt(at2)).toBe(false); // B does NOT — the independence guarantee
    expect(floorAt(tenantWide)).toBe(true); // any-location roll-up

    // Outlet 2's checklist still holds attention; outlet 1's required set is
    // complete (menu done from the seeded products) → not incomplete.
    expect(at2.restaurant.required_incomplete).toBe(true);
    expect(at1.restaurant.required_incomplete).toBe(false);
  });

  it("all required done → the card returns to `on`; the optional KDS item never held the state", async () => {
    // Floor plan (from the previous test) exists → tenant-wide floor_plan done;
    // menu done. KDS station is optional and still absent.
    const res = await getModules();
    const resto = findCard(res.body, "restaurant");
    expect(resto.state).toBe("on");
    const kds = resto.checklist.find((i) => i.id === "kds_station");
    expect(kds).toMatchObject({ required: false, done: false });
  });

  // ── E5 (PLAN-V3 Step 3): the seven remaining Bucket A cards ────────────────
  // The six moded cards are already enabled (the harness seeds every registry
  // mode on); field_sales is mode-null → enabled via its flag. Each carries a
  // single required item (plus, for a few, an optional). Prove attention→clear
  // both directions, and that projects' one scope:"outlet" item is outlet-aware.
  describe("E5 — the seven remaining Bucket A cards", () => {
    // key → { required item id, a fn that creates its prerequisite row }.
    const E5 = [
      {
        key: "subscriptions_memberships",
        item: "plan",
        make: () => db.query(`INSERT INTO subscription_plans (name, price) VALUES ('Gold', 100)`),
      },
      {
        key: "clinical",
        item: "template",
        make: () => db.query(`INSERT INTO treatment_plan_templates (name) VALUES ('Root canal')`),
      },
      {
        key: "service_tickets",
        item: "ticket_type",
        make: () => db.query(`INSERT INTO ticket_types (name) VALUES ('Screen repair')`),
      },
      {
        key: "projects_contracts",
        item: "contract_template", // the REQUIRED item; `project` is optional
        make: () => db.query(`INSERT INTO contract_templates (name) VALUES ('MSA')`),
      },
      {
        key: "commissions",
        item: "plan",
        make: () => db.query(`INSERT INTO commission_plans (name) VALUES ('Standard')`),
      },
      {
        key: "wholesale_credit",
        item: "credit_limit",
        make: () =>
          db.query(
            `UPDATE customers SET credit_limit = 5000 WHERE id = (SELECT id FROM customers ORDER BY id LIMIT 1)`
          ),
      },
      {
        key: "field_sales",
        item: "field_rep",
        make: () =>
          db.query(
            `UPDATE employees SET employee_type = 'field_rep' WHERE id = (SELECT id FROM employees ORDER BY id DESC LIMIT 1)`
          ),
      },
    ];

    beforeAll(async () => {
      // field_sales is flag-gated (mode is null → isCardEnabled keys on the flag).
      await db.query(
        `INSERT INTO feature_flags (key, enabled) VALUES ('wholesale_field_sales', true)
         ON CONFLICT (key) DO UPDATE SET enabled = true`
      );
      // Guarantee the "prerequisite absent" starting state for every card.
      await db.query(`DELETE FROM subscription_plans`);
      await db.query(`DELETE FROM treatment_plan_templates`);
      await db.query(`DELETE FROM ticket_types`);
      await db.query(`DELETE FROM contract_templates`);
      await db.query(`DELETE FROM service_projects`);
      await db.query(`DELETE FROM commission_plans`);
      await db.query(`UPDATE customers SET credit_limit = 0, payment_terms_days = 0`);
      await db.query(`UPDATE employees SET employee_type = 'in_store' WHERE employee_type = 'field_rep'`);
    }, 30000);

    it("each of the 7 cards is enabled and reads attention_required with its required item un-done", async () => {
      const res = await getModules();
      expect(res.status).toBe(200);
      for (const { key, item } of E5) {
        const card = findCard(res.body, key);
        expect(card, `${key} present`).toBeTruthy();
        expect(Array.isArray(card.checklist), `${key} has a checklist`).toBe(true);
        expect(card.state, `${key} state`).toBe("attention_required");
        const req = card.checklist.find((i) => i.id === item);
        expect(req, `${key}.${item}`).toMatchObject({ required: true, done: false });
      }
    });

    it("creating each prerequisite flips its required item done and clears the card to `on`", async () => {
      for (const { make } of E5) await make();
      const res = await getModules();
      for (const { key, item } of E5) {
        const card = findCard(res.body, key);
        const req = card.checklist.find((i) => i.id === item);
        expect(req.done, `${key}.${item} done`).toBe(true);
        expect(card.state, `${key} cleared`).toBe("on");
      }
    });

    it("projects' scope:outlet `project` item completes at outlet 1 only (independence)", async () => {
      await db.query(`INSERT INTO service_projects (name, outlet_id) VALUES ('Fitout', 1)`);
      const flags = await loadLiveFlags(db);
      const modes = await loadLiveModes(db);

      const at1 = await computeChecklists(db, { flags, modes, outletId: 1 });
      const at2 = await computeChecklists(db, { flags, modes, outletId: 2 });
      const tenantWide = await computeChecklists(db, { flags, modes, outletId: null });

      const projAt = (r) =>
        r.projects_contracts.checklist.find((i) => i.id === "project").done;
      expect(projAt(at1)).toBe(true); // outlet 1 has the project
      expect(projAt(at2)).toBe(false); // outlet 2 does NOT — the independence guarantee
      expect(projAt(tenantWide)).toBe(true); // any-outlet roll-up
    });
  });
});
