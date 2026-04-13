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
});
