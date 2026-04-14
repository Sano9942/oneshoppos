import { describe, it, expect } from "vitest";
import {
  INDUSTRY_PRESETS,
  VALID_INDUSTRY_TYPES,
  DEFAULT_INDUSTRY_TYPE,
  WEIGHTED_UNITS,
  DEFAULT_UNIT_VOCABULARY,
  DEFAULT_PUBLIC_BOOKING_LABELS,
  getPreset,
  getPresetLabels,
  getUnitVocabulary,
  isWeightedUnit,
  getPublicBookingLabels,
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

  it("has 17 industry presets (10 v1 + 3 M5 weighted + 4 M7 rentals)", () => {
    expect(VALID_INDUSTRY_TYPES).toHaveLength(17);
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

  // --- M5 weight-based selling presets ---

  it("butcher preset: weight labels + kg vocabulary + tare enabled", () => {
    const p = getPreset("butcher");
    expect(p.modes).toEqual([]);
    expect(p.labels.product).toBe("Cut");
    expect(p.labels.quantity_label).toBe("Weight");
    expect(p.unit_vocabulary).toContain("kg");
    expect(p.unit_vocabulary).toContain("lb");
    expect(p.pos_search_config.show_tare).toBe(true);
  });

  it("sweet_shop preset: mithai + dozen unit + grid POS", () => {
    const p = getPreset("sweet_shop");
    expect(p.labels.product).toBe("Sweet");
    expect(p.labels.quantity_label).toBe("Weight");
    expect(p.unit_vocabulary).toContain("dozen");
    expect(p.pos_layout_mode).toBe("grid");
    expect(p.pos_search_config.show_tare).toBe(true);
  });

  it("textile preset: length labels + metre vocabulary + no tare", () => {
    const p = getPreset("textile");
    expect(p.labels.product).toBe("Fabric");
    expect(p.labels.quantity_label).toBe("Length");
    expect(p.unit_vocabulary).toEqual(["m", "cm", "pcs", "pack"]);
    expect(p.pos_search_config.show_tare).toBe(false);
  });

  // --- M5 helpers ---

  it("WEIGHTED_UNITS includes kg/g/lb/oz/m/cm", () => {
    expect(WEIGHTED_UNITS).toEqual(
      expect.arrayContaining(["kg", "g", "lb", "oz", "m", "cm"])
    );
  });

  it("DEFAULT_UNIT_VOCABULARY is a non-empty array", () => {
    expect(Array.isArray(DEFAULT_UNIT_VOCABULARY)).toBe(true);
    expect(DEFAULT_UNIT_VOCABULARY.length).toBeGreaterThan(0);
  });

  it("isWeightedUnit returns true for weight units, false for pieces", () => {
    expect(isWeightedUnit("kg")).toBe(true);
    expect(isWeightedUnit("KG")).toBe(true); // case insensitive
    expect(isWeightedUnit("m")).toBe(true);
    expect(isWeightedUnit("pcs")).toBe(false);
    expect(isWeightedUnit("dozen")).toBe(false);
    expect(isWeightedUnit(null)).toBe(false);
    expect(isWeightedUnit(undefined)).toBe(false);
    expect(isWeightedUnit("")).toBe(false);
  });

  it("getUnitVocabulary returns preset-specific vocabulary", () => {
    expect(getUnitVocabulary("butcher")).toEqual(["kg", "g", "lb", "pcs"]);
    expect(getUnitVocabulary("textile")).toEqual(["m", "cm", "pcs", "pack"]);
  });

  it("getUnitVocabulary falls back to default when preset has none", () => {
    const v = getUnitVocabulary("general_retail");
    expect(v).toEqual(DEFAULT_UNIT_VOCABULARY);
  });

  it("getPresetLabels merges M5 label defaults for presets that don't override", () => {
    // general_retail doesn't set quantity_label — should inherit default "Qty"
    const labels = getPresetLabels("general_retail");
    expect(labels.quantity_label).toBe("Qty");
    expect(labels.customer_search_placeholder).toBe("Search customer...");
  });

  it("getPresetLabels respects preset overrides of M5 keys", () => {
    // butcher overrides quantity_label to "Weight"
    const labels = getPresetLabels("butcher");
    expect(labels.quantity_label).toBe("Weight");
  });

  it("weighted presets do not enable any business modes (pure retail base)", () => {
    for (const key of ["butcher", "sweet_shop", "textile"]) {
      expect(getPreset(key).modes).toEqual([]);
      expect(getPreset(key).business_model).toBe("buy_sell");
    }
  });

  // --- M6 public booking labels ---

  it("getPublicBookingLabels returns preset overrides for salon (Stylist)", () => {
    const labels = getPublicBookingLabels("salon");
    expect(labels.booking_cta).toBe("Book an appointment");
    expect(labels.staff_singular).toBe("Stylist");
    expect(labels.service_singular).toBe("Service");
  });

  it("getPublicBookingLabels returns preset overrides for clinic (Provider)", () => {
    const labels = getPublicBookingLabels("clinic");
    expect(labels.booking_cta).toBe("Book a visit");
    expect(labels.staff_singular).toBe("Provider");
  });

  it("getPublicBookingLabels returns preset overrides for gym (Trainer + Class)", () => {
    const labels = getPublicBookingLabels("gym");
    expect(labels.booking_cta).toBe("Book a session");
    expect(labels.staff_singular).toBe("Trainer");
    expect(labels.service_singular).toBe("Class");
  });

  it("getPublicBookingLabels returns preset overrides for photography_studio (Photographer)", () => {
    const labels = getPublicBookingLabels("photography_studio");
    expect(labels.staff_singular).toBe("Photographer");
    expect(labels.service_singular).toBe("Package");
  });

  it("getPublicBookingLabels falls back to defaults for presets without overrides", () => {
    const labels = getPublicBookingLabels("general_retail");
    expect(labels).toEqual(DEFAULT_PUBLIC_BOOKING_LABELS);
    expect(labels.staff_singular).toBe("Staff");
  });

  it("getPublicBookingLabels falls back to defaults for unknown industry", () => {
    const labels = getPublicBookingLabels("unknown_thing");
    expect(labels).toEqual(DEFAULT_PUBLIC_BOOKING_LABELS);
  });
});
