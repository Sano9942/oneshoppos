import { describe, it, expect } from "vitest";
import {
  MODE_REGISTRY,
  VALID_MODES,
  getModeConfig,
  getFeatureFlagsForModes,
} from "../../config/mode-registry.js";
import { INDUSTRY_PRESETS } from "../../config/industry-config.js";

describe("mode-registry", () => {
  it("VALID_MODES matches MODE_REGISTRY keys", () => {
    expect(VALID_MODES.sort()).toEqual(Object.keys(MODE_REGISTRY).sort());
  });

  it("getModeConfig returns config for known mode", () => {
    const c = getModeConfig("restaurant");
    expect(c).toHaveProperty("description");
    expect(c).toHaveProperty("feature_flags_to_enable");
    expect(c.feature_flags_to_enable).toContain("phase4_restaurant");
  });

  it("getModeConfig returns null for unknown mode", () => {
    expect(getModeConfig("nonexistent")).toBeNull();
  });

  it("getFeatureFlagsForModes returns union of flags", () => {
    const flags = getFeatureFlagsForModes(["restaurant", "commissions"]);
    expect(flags).toContain("phase4_restaurant");
    expect(flags).toContain("phase4_restaurant_kds");
    expect(flags).toContain("phase2_commissions");
  });

  it("getFeatureFlagsForModes returns empty for empty input", () => {
    expect(getFeatureFlagsForModes([])).toEqual([]);
  });

  it("every mode referenced by any preset exists in MODE_REGISTRY", () => {
    for (const preset of Object.values(INDUSTRY_PRESETS)) {
      for (const mode of preset.modes) {
        expect(MODE_REGISTRY).toHaveProperty(mode);
      }
    }
  });
});
