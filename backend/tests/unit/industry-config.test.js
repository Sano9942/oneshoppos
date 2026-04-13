import { describe, it, expect } from "vitest";
import {
  INDUSTRY_PRESETS,
  VALID_INDUSTRY_TYPES,
  DEFAULT_INDUSTRY_TYPE,
  getPreset,
  getPresetLabels,
} from "../../config/industry-config.js";

describe("industry-config", () => {
  it("exports VALID_INDUSTRY_TYPES matching INDUSTRY_PRESETS keys", () => {
    expect(VALID_INDUSTRY_TYPES.sort()).toEqual(
      Object.keys(INDUSTRY_PRESETS).sort()
    );
  });

  it("DEFAULT_INDUSTRY_TYPE is general_retail", () => {
    expect(DEFAULT_INDUSTRY_TYPE).toBe("general_retail");
  });

  it("getPreset returns correct preset for known type", () => {
    const p = getPreset("restaurant");
    expect(p.industry_type).toBe("restaurant");
    expect(p.business_model).toBe("food_service");
    expect(p.modes).toContain("restaurant");
  });

  it("getPreset falls back to general_retail for unknown type", () => {
    expect(getPreset("unknown_thing").industry_type).toBe("general_retail");
  });

  it("getPreset falls back for undefined", () => {
    expect(getPreset(undefined).industry_type).toBe("general_retail");
  });

  it("every preset has required shape", () => {
    const REQUIRED_KEYS = [
      "industry_type", "business_model", "display_name",
      "modes", "labels", "dashboard_widgets",
      "onboarding_steps", "pos_layout_mode",
    ];
    const REQUIRED_LABELS = [
      "product", "products", "customer", "customers", "sale", "order",
    ];
    for (const key of VALID_INDUSTRY_TYPES) {
      const p = INDUSTRY_PRESETS[key];
      for (const k of REQUIRED_KEYS) expect(p).toHaveProperty(k);
      for (const l of REQUIRED_LABELS) expect(p.labels).toHaveProperty(l);
    }
  });

  it("getPresetLabels returns only labels", () => {
    const labels = getPresetLabels("salon");
    expect(labels.product).toBe("Service");
    expect(labels).not.toHaveProperty("modes");
  });

  it("has 10 industry presets", () => {
    expect(VALID_INDUSTRY_TYPES).toHaveLength(10);
  });

  it("grocery preset has no extra modes (base retail)", () => {
    const p = getPreset("grocery");
    expect(p.modes).toEqual([]);
    expect(p.pos_layout_mode).toBe("grid");
  });

  it("cafe preset has restaurant mode but no floor_plan widget", () => {
    const p = getPreset("cafe");
    expect(p.modes).toEqual(["restaurant"]);
    expect(p.dashboard_widgets.floor_plan).toBe(false);
    expect(p.labels.customer).toBe("Customer");
  });

  it("clinic preset has appointments but not commissions", () => {
    const p = getPreset("clinic");
    expect(p.modes).toEqual(["appointments"]);
    expect(p.modes).not.toContain("commissions");
    expect(p.labels.customer).toBe("Patient");
  });

  it("repair_shop preset has workflow_tickets mode", () => {
    const p = getPreset("repair_shop");
    expect(p.modes).toEqual(["workflow_tickets"]);
    expect(p.onboarding_steps).toContain("ticket");
  });

  it("gym preset has dual modes (subscriptions + appointments)", () => {
    const p = getPreset("gym");
    expect(p.modes).toContain("subscriptions");
    expect(p.modes).toContain("appointments");
    expect(p.labels.customer).toBe("Member");
    expect(p.onboarding_steps).toContain("membership");
  });

  it("wholesale preset has no extra modes and grid POS", () => {
    const p = getPreset("wholesale");
    expect(p.modes).toEqual([]);
    expect(p.pos_layout_mode).toBe("grid");
    expect(p.labels.customer).toBe("Buyer");
  });

  it("photography_studio preset has service_projects + appointments", () => {
    const p = getPreset("photography_studio");
    expect(p.modes).toContain("service_projects");
    expect(p.modes).toContain("appointments");
    expect(p.labels.product).toBe("Package");
  });
});
