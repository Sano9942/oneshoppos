import { describe, it, expect } from "vitest";
import {
  GenericSerialScaleAdapter,
  getScaleAdapter,
  isScaleSupported,
} from "../../src/utils/scale.js";

// V01 grocery lane — the generic continuous-mode scale frame parser. The
// transport (open port, settle N reads) is not unit-tested here (needs Web
// Serial hardware); this guards the pure protocol parse used to interpret each
// serial frame, plus the feature-detect + registry.

const parse = (s) => GenericSerialScaleAdapter.parseFrame(s);

describe("GenericSerialScaleAdapter.parseFrame", () => {
  it("parses CAS continuous stable/unstable frames", () => {
    expect(parse("ST,GS,+  1.234kg")).toEqual({ weight: 1.234, unit: "kg", stable: true });
    expect(parse("US,GS,+  0.500 kg")).toEqual({ weight: 0.5, unit: "kg", stable: false });
  });

  it("parses a bare signed decimal as stable", () => {
    expect(parse("+001.234 kg")).toEqual({ weight: 1.234, unit: "kg", stable: true });
    expect(parse("1.234")).toEqual({ weight: 1.234, unit: "kg", stable: true });
  });

  it("parses AND-style leading stability + reads grams", () => {
    expect(parse("S    2.500 g")).toEqual({ weight: 2.5, unit: "g", stable: true });
    expect(parse("U 0.750 lb")).toEqual({ weight: 0.75, unit: "lb", stable: false });
  });

  it("returns null on empty or number-less frames", () => {
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
    expect(parse("ST,GS,kg")).toBeNull();
  });

  it("keeps 4-decimal weight precision", () => {
    expect(parse("ST,GS,+0.1235 kg").weight).toBe(0.1235);
  });
});

describe("scale registry + feature detect", () => {
  it("maps known keys and falls back to generic", () => {
    expect(getScaleAdapter("generic")).toBe(GenericSerialScaleAdapter);
    expect(getScaleAdapter("cas")).toBe(GenericSerialScaleAdapter);
    expect(getScaleAdapter("unknown-xyz")).toBe(GenericSerialScaleAdapter);
  });

  it("isScaleSupported reflects navigator.serial presence", () => {
    // jsdom has no navigator.serial → false. This asserts the graceful-fallback
    // gate the POS uses to decide whether to render the Weigh button.
    expect(isScaleSupported()).toBe(false);
  });
});
