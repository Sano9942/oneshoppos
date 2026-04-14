import { describe, it, expect } from "vitest";
import {
  VALID_INDUSTRY_TYPES,
  DEFAULT_PORTAL_LABELS,
  DEFAULT_PORTAL_TABS,
  getPortalLabels,
  getPortalEnabledTabs,
} from "../../config/industry-config.js";

describe("M8 portal preset config", () => {
  it("returns the default label set for an unknown preset", () => {
    const labels = getPortalLabels("not_a_preset_xxx");
    expect(labels).toMatchObject(DEFAULT_PORTAL_LABELS);
  });

  it("merges preset-specific overrides over defaults", () => {
    const salon = getPortalLabels("salon");
    expect(salon.appointments_tab).toBe("My Bookings");
    // fallback keys still present
    expect(salon.profile_tab).toBe(DEFAULT_PORTAL_LABELS.profile_tab);
  });

  it("returns the documented tab list for each preset category", () => {
    expect(getPortalEnabledTabs("salon")).toEqual([
      "appointments",
      "invoices",
      "loyalty",
      "profile",
    ]);
    expect(getPortalEnabledTabs("restaurant")).toEqual([
      "orders",
      "loyalty",
      "profile",
    ]);
    expect(getPortalEnabledTabs("wholesale")).toEqual([
      "invoices",
      "orders",
      "profile",
    ]);
    expect(getPortalEnabledTabs("gym")).toEqual([
      "subscriptions",
      "invoices",
      "appointments",
      "profile",
    ]);
    expect(getPortalEnabledTabs("car_rental")).toEqual([
      "contracts",
      "invoices",
      "profile",
    ]);
    expect(getPortalEnabledTabs("repair_shop")).toEqual([
      "tickets",
      "invoices",
      "profile",
    ]);
  });

  it("unknown presets fall back to general_retail's tab list", () => {
    // getPortalEnabledTabs normalises unknown presets to DEFAULT_INDUSTRY_TYPE
    // (general_retail), which is the consistent behaviour used by all other
    // preset getters in this file.
    expect(getPortalEnabledTabs("not_a_preset_xxx")).toEqual(
      getPortalEnabledTabs("general_retail")
    );
  });

  it("every preset returns a non-empty tab list", () => {
    for (const preset of VALID_INDUSTRY_TYPES) {
      const tabs = getPortalEnabledTabs(preset);
      expect(Array.isArray(tabs)).toBe(true);
      expect(tabs.length).toBeGreaterThan(0);
      // Profile is always available — self-service account settings.
      expect(tabs).toContain("profile");
    }
  });

  it("rental presets include contracts tab", () => {
    for (const preset of ["car_rental", "equipment_hire", "furniture_rental", "party_supplies"]) {
      expect(getPortalEnabledTabs(preset)).toContain("contracts");
    }
  });
});
