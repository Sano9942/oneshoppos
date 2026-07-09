import { describe, it, expect } from "vitest";
import { INDUSTRY_PRESETS, getPreset, getPortalEnabledTabs } from "../../config/industry-config.js";
import { MODE_REGISTRY, getFeatureFlagsForModes } from "../../config/mode-registry.js";

const {
  generateBookingNumber,
  resolveRateForDate,
  calculateStayTotal,
  daysBetween,
  addDaysISO,
} = require("../../services/room-service.js");

// ── Preset config coverage ─────────────────────────────────────────

describe("room_management presets", () => {
  const ROOM_PRESETS = ["hotel", "guesthouse", "hostel"];

  it.each(ROOM_PRESETS)("%s preset exists in INDUSTRY_PRESETS", (key) => {
    expect(INDUSTRY_PRESETS).toHaveProperty(key);
  });

  it.each(ROOM_PRESETS)("%s enables room_management mode and uses list POS layout", (key) => {
    const p = getPreset(key);
    expect(p.modes).toContain("room_management");
    expect(p.pos_layout_mode).toBe("list");
    expect(p.business_model).toBe("room_management");
  });

  it.each(ROOM_PRESETS)("%s hides inventory_alerts + top_products; decorative keys dropped (WS2e)", (key) => {
    const p = getPreset(key);
    expect(p.dashboard_widgets.inventory_alerts).toBe(false);
    expect(p.dashboard_widgets.top_products).toBe(false);
    // floor_plan had no dashboard consumer — WS2e removed the key entirely.
    expect(p.dashboard_widgets.floor_plan).toBeUndefined();
  });

  it.each(ROOM_PRESETS)("%s onboarding steps include room + rate + booking + checkin", (key) => {
    const p = getPreset(key);
    expect(p.onboarding_steps).toContain("room");
    expect(p.onboarding_steps).toContain("rate");
    expect(p.onboarding_steps).toContain("booking");
    expect(p.onboarding_steps).toContain("checkin");
  });

  it.each(ROOM_PRESETS)("%s portal tabs include stays + invoices + profile", (key) => {
    const tabs = getPortalEnabledTabs(key);
    expect(tabs).toContain("stays");
    expect(tabs).toContain("invoices");
    expect(tabs).toContain("profile");
  });

  it("hotel uses Room / Guest / Booking labels", () => {
    const p = getPreset("hotel");
    expect(p.labels.product).toBe("Room");
    expect(p.labels.customer).toBe("Guest");
    expect(p.labels.order).toBe("Booking");
  });

  it("hostel uses Bed label", () => {
    const p = getPreset("hostel");
    expect(p.labels.product).toBe("Bed");
    expect(p.labels.products).toBe("Beds");
  });
});

// ── Mode registry coverage ─────────────────────────────────────────

describe("room_management mode registry", () => {
  it("room_management mode registered with phase4_room_management flag", () => {
    expect(MODE_REGISTRY).toHaveProperty("room_management");
    expect(MODE_REGISTRY.room_management.feature_flags_to_enable)
      .toContain("phase4_room_management");
  });

  it("getFeatureFlagsForModes(['room_management']) returns phase4_room_management", () => {
    const flags = getFeatureFlagsForModes(["room_management"]);
    expect(flags).toContain("phase4_room_management");
  });
});

// ── Pure date helpers ──────────────────────────────────────────────

describe("daysBetween", () => {
  it("returns 1 for one-night stay", () => {
    expect(daysBetween("2026-06-01", "2026-06-02")).toBe(1);
  });
  it("returns 7 for a week", () => {
    expect(daysBetween("2026-06-01", "2026-06-08")).toBe(7);
  });
  it("returns 0 when same day (no nights booked)", () => {
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(0);
  });
  it("returns 0 for reversed range", () => {
    expect(daysBetween("2026-06-08", "2026-06-01")).toBe(0);
  });
});

describe("addDaysISO", () => {
  it("adds 1 day forward", () => {
    expect(addDaysISO("2026-06-01", 1)).toBe("2026-06-02");
  });
  it("crosses month boundary", () => {
    expect(addDaysISO("2026-06-30", 1)).toBe("2026-07-01");
  });
  it("crosses year boundary", () => {
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });
});

// ── Rate resolution ────────────────────────────────────────────────

function makeFakeDb(overrideRows = [], baseRate = 10000) {
  return {
    async query(sql) {
      if (/room_rate_overrides/i.test(sql)) {
        return { rows: overrideRows };
      }
      if (/room_types/i.test(sql)) {
        return { rows: [{ base_rate: baseRate }] };
      }
      return { rows: [] };
    },
  };
}

describe("resolveRateForDate", () => {
  it("returns base_rate when no override covers the date", async () => {
    const db = makeFakeDb([], 10000);
    const rate = await resolveRateForDate(db, 1, "2026-06-15");
    expect(rate).toBe(10000);
  });

  it("returns override rate when one covers the date", async () => {
    const db = makeFakeDb([{ rate: 20000 }]);
    const rate = await resolveRateForDate(db, 1, "2026-12-25");
    expect(rate).toBe(20000);
  });

  it("handles string NUMERIC by coercing to Number", async () => {
    const db = makeFakeDb([{ rate: "15500.00" }]);
    const rate = await resolveRateForDate(db, 1, "2026-06-15");
    expect(rate).toBe(15500);
  });
});

// ── Stay total breakdown ──────────────────────────────────────────

describe("calculateStayTotal", () => {
  it("returns empty breakdown for zero-night stay", async () => {
    const db = makeFakeDb([], 10000);
    const r = await calculateStayTotal(db, {
      roomTypeId: 1, checkIn: "2026-06-01", checkOut: "2026-06-01",
    });
    expect(r.nights).toBe(0);
    expect(r.subtotal).toBe(0);
    expect(r.rate_breakdown).toEqual([]);
  });

  it("computes 3-night stay at base rate", async () => {
    const db = makeFakeDb([], 10000);
    const r = await calculateStayTotal(db, {
      roomTypeId: 1, checkIn: "2026-06-01", checkOut: "2026-06-04",
    });
    expect(r.nights).toBe(3);
    expect(r.subtotal).toBe(30000);
    expect(r.rate_breakdown.map((x) => x.date)).toEqual([
      "2026-06-01", "2026-06-02", "2026-06-03",
    ]);
  });

  it("applies override for dates inside an override window (fully inside)", async () => {
    // Override covers entire stay
    const db = {
      async query(sql, params) {
        if (/room_rate_overrides/i.test(sql)) {
          // Every call matches this override
          return { rows: [{ rate: 20000 }] };
        }
        return { rows: [{ base_rate: 10000 }] };
      },
    };
    const r = await calculateStayTotal(db, {
      roomTypeId: 1, checkIn: "2026-12-24", checkOut: "2026-12-27",
    });
    expect(r.nights).toBe(3);
    expect(r.subtotal).toBe(60000);
  });

  it("partial override — some nights at base, some at override", async () => {
    // Override covers 2026-06-05 to 2026-06-07 (Fri+Sat), 2 nights
    const db = {
      async query(sql, params) {
        if (/room_rate_overrides/i.test(sql)) {
          const date = params[1];
          if (date >= "2026-06-05" && date <= "2026-06-07") {
            return { rows: [{ rate: 20000 }] };
          }
          return { rows: [] };
        }
        return { rows: [{ base_rate: 10000 }] };
      },
    };
    // Stay: Thu 4 → Mon 8 = 4 nights (4, 5, 6, 7 stayed; 8 checkout)
    const r = await calculateStayTotal(db, {
      roomTypeId: 1, checkIn: "2026-06-04", checkOut: "2026-06-08",
    });
    expect(r.nights).toBe(4);
    // 2026-06-04 base=10000, 05=20000, 06=20000, 07=20000 → 70000
    expect(r.subtotal).toBe(70000);
    expect(r.rate_breakdown.find((b) => b.date === "2026-06-04").rate).toBe(10000);
    expect(r.rate_breakdown.find((b) => b.date === "2026-06-05").rate).toBe(20000);
  });
});

// ── Booking number ────────────────────────────────────────────────

describe("generateBookingNumber", () => {
  it("generates BK-000001 format zero-padded to 6 digits", async () => {
    const fakeDb = { query: async () => ({ rows: [{ next_id: 1 }] }) };
    const num = await generateBookingNumber(fakeDb);
    expect(num).toBe("BK-000001");
  });

  it("generates BK-000042 for id 42", async () => {
    const fakeDb = { query: async () => ({ rows: [{ next_id: 42 }] }) };
    const num = await generateBookingNumber(fakeDb);
    expect(num).toBe("BK-000042");
  });

  it("extends padding for 7-digit IDs", async () => {
    const fakeDb = { query: async () => ({ rows: [{ next_id: 9_999_999 }] }) };
    const num = await generateBookingNumber(fakeDb);
    expect(num).toBe("BK-9999999");
  });
});

// ── Permissions seed check ────────────────────────────────────────

describe("manage_rooms default role permissions", () => {
  it("Manager + Administrator roles get manage_rooms by default", () => {
    const { DEFAULT_ROLE_PERMISSIONS } = require("../../middleware/permissions.js");
    expect(DEFAULT_ROLE_PERMISSIONS.Manager).toContain("manage_rooms");
    // Admin has all_access — no explicit entry needed, but verify it's not denied
    expect(DEFAULT_ROLE_PERMISSIONS.Administrator).toContain("all_access");
  });
});
