/**
 * pg-preset-engine.test.js — Integration tests for the Tenant Preset Engine v1
 *
 * Tests the full flow: setup with industry_type → company_profile + tenant_modes + feature_flags → bootstrap returns preset data.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

let app, db, deps, cleanup;

beforeAll(async () => {
  ({ app, db, deps, cleanup } = await createTestApp());

  // Register setup + auth routes
  const createSetupRouter = require("../../routes/setup");
  app.use("/api/setup", createSetupRouter(db));
  require("../../routes/auth")(app, deps);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("Tenant Preset Engine — Setup + Bootstrap", () => {
  describe("POST /api/setup/complete with industry_type", () => {
    it("rejects invalid industry_type", async () => {
      // Reset setup state for this test
      await db.query(
        "UPDATE company_profile SET setup_complete = false, setup_token = 'test-token-invalid', setup_token_expires_at = NOW() + INTERVAL '1 hour' WHERE id = 1"
      );

      const res = await request(app)
        .post("/api/setup/complete")
        .send({
          token: "test-token-invalid",
          company_name: "Test Store",
          admin_name: "Admin",
          admin_pin: "1234",
          industry_type: "not_a_real_industry",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid industry_type/);
    });

    it("seeds restaurant preset: industry_type, modes, and flags", async () => {
      // Reset setup state
      await db.query(
        "UPDATE company_profile SET setup_complete = false, setup_token = 'test-token-rest', setup_token_expires_at = NOW() + INTERVAL '1 hour' WHERE id = 1"
      );
      // Clear any existing modes
      await db.query("DELETE FROM tenant_modes");

      const res = await request(app)
        .post("/api/setup/complete")
        .send({
          token: "test-token-rest",
          company_name: "Test Restaurant",
          admin_name: "Chef Admin",
          admin_pin: "4567",
          industry_type: "restaurant",
          country: "Pakistan",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify company_profile
      const { rows: [profile] } = await db.query(
        "SELECT industry_type, business_model, country_code FROM company_profile WHERE id = 1"
      );
      expect(profile.industry_type).toBe("restaurant");
      expect(profile.business_model).toBe("food_service");
      expect(profile.country_code).toBe("PK");

      // Verify tenant_modes — D5 full materialisation (PLAN-V2 Step 5): every
      // registry mode has an explicit row (preset mode enabled, the rest
      // disabled), not just the enabled ones.
      const { VALID_MODES } = require("../../config/mode-registry");
      const { rows: modes } = await db.query(
        "SELECT mode, enabled FROM tenant_modes ORDER BY mode"
      );
      expect(modes.length).toBe(VALID_MODES.length);
      expect(modes.filter((m) => m.enabled).map((m) => m.mode)).toEqual(["restaurant"]);

      // Verify feature flags were enabled
      const { rows: flags } = await db.query(
        "SELECT key, enabled FROM feature_flags WHERE key IN ('phase4_restaurant', 'phase4_restaurant_kds') ORDER BY key"
      );
      expect(flags).toEqual([
        { key: "phase4_restaurant", enabled: true },
        { key: "phase4_restaurant_kds", enabled: true },
      ]);
    });

    it("seeds salon preset with multiple modes", async () => {
      // Reset
      await db.query(
        "UPDATE company_profile SET setup_complete = false, setup_token = 'test-token-salon', setup_token_expires_at = NOW() + INTERVAL '1 hour' WHERE id = 1"
      );
      await db.query("DELETE FROM tenant_modes");

      const res = await request(app)
        .post("/api/setup/complete")
        .send({
          token: "test-token-salon",
          company_name: "Glamour Salon",
          admin_name: "Salon Admin",
          admin_pin: "5678",
          industry_type: "salon",
          country: "Pakistan",
        });

      expect(res.status).toBe(200);

      const { rows: [profile] } = await db.query(
        "SELECT industry_type, business_model FROM company_profile WHERE id = 1"
      );
      expect(profile.industry_type).toBe("salon");
      expect(profile.business_model).toBe("service_appointment");

      const { rows: modes } = await db.query(
        "SELECT mode FROM tenant_modes WHERE enabled = true ORDER BY mode"
      );
      expect(modes.map(m => m.mode)).toEqual(["appointments", "commissions"]);

      const { rows: flags } = await db.query(
        "SELECT key FROM feature_flags WHERE key IN ('phase4_appointments', 'phase2_commissions') AND enabled = true ORDER BY key"
      );
      expect(flags.map(f => f.key)).toEqual(["phase2_commissions", "phase4_appointments"]);
    });

    it("seeds clinic-family preset (dental_clinic) with a full materialised mode set", async () => {
      // D5 fresh-provision coverage for the clinic preset family (PLAN-V2 Step
      // 5 verify list: retail + restaurant + clinic).
      await db.query(
        "UPDATE company_profile SET setup_complete = false, setup_token = 'test-token-clinic', setup_token_expires_at = NOW() + INTERVAL '1 hour' WHERE id = 1"
      );
      await db.query("DELETE FROM tenant_modes");

      const res = await request(app)
        .post("/api/setup/complete")
        .send({
          token: "test-token-clinic",
          company_name: "Bright Smile Dental",
          admin_name: "Clinic Admin",
          admin_pin: "9012",
          industry_type: "dental_clinic",
          country: "Pakistan",
        });

      expect(res.status).toBe(200);

      const { rows: [profile] } = await db.query(
        "SELECT industry_type FROM company_profile WHERE id = 1"
      );
      expect(profile.industry_type).toBe("dental_clinic");

      // Full materialisation: all registry modes present; the preset's two
      // clinical modes enabled, the rest disabled.
      const { VALID_MODES } = require("../../config/mode-registry");
      const { rows: modes } = await db.query(
        "SELECT mode, enabled FROM tenant_modes ORDER BY mode"
      );
      expect(modes.length).toBe(VALID_MODES.length);
      expect(modes.filter((m) => m.enabled).map((m) => m.mode)).toEqual([
        "appointments",
        "treatment_plans",
      ]);
    });

    it("defaults to general_retail when no industry_type sent", async () => {
      await db.query(
        "UPDATE company_profile SET setup_complete = false, setup_token = 'test-token-default', setup_token_expires_at = NOW() + INTERVAL '1 hour' WHERE id = 1"
      );
      await db.query("DELETE FROM tenant_modes");

      const res = await request(app)
        .post("/api/setup/complete")
        .send({
          token: "test-token-default",
          company_name: "Generic Store",
          admin_name: "Admin",
          admin_pin: "9876",
          country: "Pakistan",
        });

      expect(res.status).toBe(200);

      const { rows: [profile] } = await db.query(
        "SELECT industry_type, business_model FROM company_profile WHERE id = 1"
      );
      expect(profile.industry_type).toBe("general_retail");
      expect(profile.business_model).toBe("buy_sell");

      // D5 full materialisation (PLAN-V2 Step 5): retail has no vertical modes,
      // but still gets a full row set — every mode present, all disabled.
      const { VALID_MODES } = require("../../config/mode-registry");
      const { rows: modes } = await db.query("SELECT mode, enabled FROM tenant_modes");
      expect(modes.length).toBe(VALID_MODES.length);
      expect(modes.filter((m) => m.enabled)).toEqual([]);
    });
  });

  describe("GET /api/context/bootstrap — preset data", () => {
    it("returns preset data for restaurant tenant", async () => {
      // Setup as restaurant first
      await db.query(
        "UPDATE company_profile SET setup_complete = false, setup_token = 'test-token-boot', setup_token_expires_at = NOW() + INTERVAL '1 hour' WHERE id = 1"
      );
      await db.query("DELETE FROM tenant_modes");

      await request(app)
        .post("/api/setup/complete")
        .send({
          token: "test-token-boot",
          company_name: "Bootstrap Restaurant",
          admin_name: "Chef",
          admin_pin: "1111",
          industry_type: "restaurant",
          country: "Pakistan",
        });

      // Call bootstrap as employee 1 (admin)
      const res = await request(app)
        .get("/api/context/bootstrap")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.preset).toBeDefined();
      expect(res.body.preset.industry_type).toBe("restaurant");
      expect(res.body.preset.labels.product).toBe("Menu Item");
      expect(res.body.preset.labels.customer).toBe("Guest");
      expect(res.body.preset.enabled_modes).toContain("restaurant");
      expect(res.body.preset.pos_layout_mode).toBe("list");
      // WS2e — the decorative floor_plan widget key was dropped (no consumer).
      expect(res.body.preset.dashboard_widgets.floor_plan).toBeUndefined();
    });

    it("returns preset data for general_retail tenant", async () => {
      // Reset to retail
      await db.query(
        "UPDATE company_profile SET industry_type = 'general_retail', business_model = 'buy_sell' WHERE id = 1"
      );
      await db.query("DELETE FROM tenant_modes");

      const res = await request(app)
        .get("/api/context/bootstrap")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.preset).toBeDefined();
      expect(res.body.preset.industry_type).toBe("general_retail");
      expect(res.body.preset.labels.product).toBe("Product");
      expect(res.body.preset.enabled_modes).toEqual([]);
      expect(res.body.preset.pos_layout_mode).toBe("grid");
    });

    it("still returns employee/outlets even when preset columns missing", async () => {
      // Even without preset data, the existing bootstrap fields should work
      const res = await request(app)
        .get("/api/context/bootstrap")
        .set("x-employee-id", "1");

      expect(res.status).toBe(200);
      expect(res.body.employee).toBeDefined();
      expect(res.body.outlets).toBeDefined();
      expect(res.body.companies).toBeDefined();
    });
  });
});
