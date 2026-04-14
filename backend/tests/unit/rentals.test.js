import { describe, it, expect } from "vitest";
import { INDUSTRY_PRESETS, getPreset } from "../../config/industry-config.js";
import { MODE_REGISTRY, getFeatureFlagsForModes } from "../../config/mode-registry.js";

const { computeLateFee, generateContractNumber } = require("../../services/rental-service.js");

// ── Preset config coverage ─────────────────────────────────────────

describe("rental presets", () => {
  const RENTAL_PRESETS = ["car_rental", "equipment_hire", "furniture_rental", "party_supplies"];

  it.each(RENTAL_PRESETS)("%s preset exists in INDUSTRY_PRESETS", (key) => {
    expect(INDUSTRY_PRESETS).toHaveProperty(key);
  });

  it.each(RENTAL_PRESETS)("%s enables rentals mode and has list POS layout", (key) => {
    const p = getPreset(key);
    expect(p.modes).toContain("rentals");
    expect(p.pos_layout_mode).toBe("list");
    expect(p.business_model).toBe("asset_rental");
  });

  it.each(RENTAL_PRESETS)("%s hides inventory_alerts + floor_plan widgets", (key) => {
    const p = getPreset(key);
    expect(p.dashboard_widgets.inventory_alerts).toBe(false);
    expect(p.dashboard_widgets.floor_plan).toBe(false);
    expect(p.dashboard_widgets.appointments_today).toBe(false);
  });

  it.each(RENTAL_PRESETS)("%s onboarding steps include contract + checkout", (key) => {
    const p = getPreset(key);
    expect(p.onboarding_steps).toContain("contract");
    expect(p.onboarding_steps).toContain("checkout");
    expect(p.onboarding_steps).toContain("rental_item");
  });

  it("car_rental uses Vehicle / Renter / Contract labels", () => {
    const p = getPreset("car_rental");
    expect(p.labels.product).toBe("Vehicle");
    expect(p.labels.customer).toBe("Renter");
    expect(p.labels.sale).toBe("Contract");
  });

  it("equipment_hire labels equipment as 'Hire Contract'", () => {
    const p = getPreset("equipment_hire");
    expect(p.labels.product).toBe("Equipment");
    expect(p.labels.sale).toBe("Hire Contract");
  });
});

// ── Mode registry coverage ─────────────────────────────────────────

describe("rentals mode registry", () => {
  it("rentals mode registered with phase4_rentals flag", () => {
    expect(MODE_REGISTRY).toHaveProperty("rentals");
    expect(MODE_REGISTRY.rentals.feature_flags_to_enable).toContain("phase4_rentals");
  });

  it("getFeatureFlagsForModes(['rentals']) returns phase4_rentals", () => {
    const flags = getFeatureFlagsForModes(["rentals"]);
    expect(flags).toContain("phase4_rentals");
  });
});

// ── Late-fee pure function ─────────────────────────────────────────

describe("computeLateFee", () => {
  it("returns 0 when actual_return is on or before expected_return", () => {
    const expectedReturn = new Date("2026-04-15T10:00:00Z");
    const actualReturn = new Date("2026-04-15T10:00:00Z");
    expect(computeLateFee({ expectedReturn, actualReturn, dailyRate: 100, quantity: 1 })).toBe(0);

    const earlier = new Date("2026-04-14T09:00:00Z");
    expect(computeLateFee({ expectedReturn, actualReturn: earlier, dailyRate: 100, quantity: 1 })).toBe(0);
  });

  it("charges 1 day * daily_rate * qty for < 24h overdue", () => {
    const expectedReturn = new Date("2026-04-15T10:00:00Z");
    const actualReturn = new Date("2026-04-16T05:00:00Z"); // ~19h late
    expect(computeLateFee({ expectedReturn, actualReturn, dailyRate: 100, quantity: 1 })).toBe(100);
  });

  it("charges 2 days for 25h overdue (rounds up via Math.ceil)", () => {
    const expectedReturn = new Date("2026-04-15T10:00:00Z");
    const actualReturn = new Date("2026-04-16T11:00:00Z"); // 25h late
    expect(computeLateFee({ expectedReturn, actualReturn, dailyRate: 100, quantity: 1 })).toBe(200);
  });

  it("multiplies by quantity", () => {
    const expectedReturn = new Date("2026-04-15T10:00:00Z");
    const actualReturn = new Date("2026-04-17T10:00:00Z"); // 2 days exact
    expect(computeLateFee({ expectedReturn, actualReturn, dailyRate: 50, quantity: 3 })).toBe(300);
  });

  it("handles string dates", () => {
    expect(computeLateFee({
      expectedReturn: "2026-04-15T10:00:00Z",
      actualReturn: "2026-04-16T11:00:00Z",
      dailyRate: 80,
      quantity: 2,
    })).toBe(320); // 2 days × 80 × 2
  });

  it("returns 0 on invalid dates", () => {
    expect(computeLateFee({
      expectedReturn: "not-a-date",
      actualReturn: "2026-04-15T10:00:00Z",
      dailyRate: 100,
      quantity: 1,
    })).toBe(0);
  });
});

// ── Contract number generation ─────────────────────────────────────

describe("generateContractNumber", () => {
  it("generates RNT-000001 format zero-padded to 6 digits", async () => {
    const fakeDb = {
      query: async () => ({ rows: [{ next_id: 1 }] }),
    };
    const num = await generateContractNumber(fakeDb);
    expect(num).toBe("RNT-000001");
  });

  it("generates RNT-000123 for id 123", async () => {
    const fakeDb = {
      query: async () => ({ rows: [{ next_id: 123 }] }),
    };
    const num = await generateContractNumber(fakeDb);
    expect(num).toBe("RNT-000123");
  });

  it("handles 7-digit IDs by extending padding", async () => {
    const fakeDb = {
      query: async () => ({ rows: [{ next_id: 1_234_567 }] }),
    };
    const num = await generateContractNumber(fakeDb);
    expect(num).toBe("RNT-1234567");
  });
});
