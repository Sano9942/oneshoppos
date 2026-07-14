import { describe, it, expect } from "vitest";
import {
  showOutletControls,
  locationSummaryLabel,
  isOutletOverridden,
  showChecklist,
  checklistProgress,
} from "../../src/pages/redesign/businessModules";

// PLAN-V2 Step 10 — per-outlet display helpers. These decide whether the
// "On at N of M locations" summary + Manage-locations Drawer appear, and the
// summary/badge copy. Pure functions so the "single-outlet tenant sees nothing
// new" invariant is asserted without mounting the API-driven page.

const outletCard = (over = {}) => ({
  key: "restaurant",
  title: "Restaurant",
  bucket: "A",
  state: "on",
  locked: false,
  outlets: [
    { outlet_id: 1, name: "Main", effective: true, override: null },
    { outlet_id: 2, name: "Branch", effective: false, override: false },
  ],
  outlet_count: 2,
  enabled_outlet_count: 1,
  default_outlet_enabled: true,
  ...over,
});

describe("showOutletControls", () => {
  it("shows for a company-on outlet-scoped card on a multi-outlet tenant", () => {
    expect(showOutletControls(outletCard())).toBe(true);
  });

  it("shows when the card is in the attention_required (on-with-setup) state", () => {
    expect(showOutletControls(outletCard({ state: "attention_required" }))).toBe(true);
  });

  it("hides when the module is company-off (summary would be meaningless)", () => {
    expect(showOutletControls(outletCard({ state: "off" }))).toBe(false);
  });

  it("hides on a platform-locked card (locked keeps its v1 treatment)", () => {
    expect(showOutletControls(outletCard({ locked: true }))).toBe(false);
  });

  it("hides when the backend sent no outlets[] (single-outlet tenant → v1 UI)", () => {
    const single = outletCard();
    delete single.outlets;
    delete single.outlet_count;
    delete single.enabled_outlet_count;
    expect(showOutletControls(single)).toBe(false);
  });
});

describe("locationSummaryLabel", () => {
  it("reads 'On at 1 of 2 locations'", () => {
    expect(locationSummaryLabel(outletCard())).toBe("On at 1 of 2 locations");
  });

  it("pluralizes correctly for a single location", () => {
    expect(
      locationSummaryLabel({ enabled_outlet_count: 1, outlet_count: 1 })
    ).toBe("On at 1 of 1 location");
  });

  it("reads 0-of-N when every outlet is overridden off", () => {
    expect(
      locationSummaryLabel({ enabled_outlet_count: 0, outlet_count: 3 })
    ).toBe("On at 0 of 3 locations");
  });
});

describe("isOutletOverridden", () => {
  it("treats null override as inherited", () => {
    expect(isOutletOverridden({ override: null })).toBe(false);
  });

  it("treats an explicit false override as an override", () => {
    expect(isOutletOverridden({ override: false })).toBe(true);
  });

  it("treats an explicit true override as an override", () => {
    expect(isOutletOverridden({ override: true })).toBe(true);
  });
});

// PLAN-V2 Step 11 (D6) — setup checklist display helpers. The "Get started"
// expander shows only while a REQUIRED item is un-done (the attention_required
// state); optional items never hold it, locked cards keep their v1 treatment.
const checklistCard = (over = {}) => ({
  key: "restaurant",
  title: "Restaurant",
  state: "attention_required",
  locked: false,
  checklist: [
    { id: "floor_plan", label: "Floor plan", required: true, scope: "outlet", done: false },
    { id: "menu_items", label: "Menu items", required: true, scope: "tenant", done: true },
    { id: "kds_station", label: "KDS", required: false, scope: "outlet", done: false },
  ],
  ...over,
});

describe("showChecklist", () => {
  it("shows when an enabled covered card has an incomplete required item", () => {
    expect(showChecklist(checklistCard())).toBe(true);
  });

  it("shows for a covered card whose state is a bare 'on' with a pending required step", () => {
    expect(showChecklist(checklistCard({ state: "on" }))).toBe(true);
  });

  it("hides once every required item is done (optional still open)", () => {
    const done = checklistCard({
      state: "on",
      checklist: [
        { id: "floor_plan", required: true, done: true },
        { id: "menu_items", required: true, done: true },
        { id: "kds_station", required: false, done: false },
      ],
    });
    expect(showChecklist(done)).toBe(false);
  });

  it("hides on a locked card (keeps v1 treatment)", () => {
    expect(showChecklist(checklistCard({ locked: true }))).toBe(false);
  });

  it("hides when the card is off / has no checklist", () => {
    expect(showChecklist(checklistCard({ state: "off" }))).toBe(false);
    const noChecklist = checklistCard();
    delete noChecklist.checklist;
    expect(showChecklist(noChecklist)).toBe(false);
  });
});

describe("checklistProgress", () => {
  it("counts done over total across required + optional items", () => {
    expect(checklistProgress(checklistCard())).toEqual({ done: 1, total: 3 });
  });

  it("returns 0 of 0 when there is no checklist", () => {
    expect(checklistProgress({})).toEqual({ done: 0, total: 0 });
  });
});
