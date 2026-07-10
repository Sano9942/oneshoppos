"use strict";

/**
 * Bidirectional enforcement test for the Business Modules catalog
 * (config/business-modules.js) — PLAN.md Step 2 verify list.
 *
 * The load-bearing check is (e): EVERY key in DEFAULT_FEATURE_FLAGS must be
 * classified exactly once (card primary flag, card sub_toggle, or
 * UNMANAGED_FLAGS). A new feature flag added without a catalog decision
 * fails this suite — that is the point, not an inconvenience. Classify it
 * in config/business-modules.js (card, sub_toggle, or UNMANAGED_FLAGS with
 * a reason) to make this pass.
 */

import {
  MODULE_STATES,
  VALID_SCOPES,
  DB_ONLY_FLAGS,
  BUSINESS_MODULES,
  UNMANAGED_FLAGS,
  cardManagedFlags,
  classifyFlag,
  isCatalogManagedFlag,
  presetRecommendedModules,
} from "../../config/business-modules";
import { DEFAULT_FEATURE_FLAGS } from "../../middleware/feature-flags";
import { MODE_REGISTRY, VALID_MODES } from "../../config/mode-registry";
import { VALID_INDUSTRY_TYPES } from "../../config/industry-config";

const cards = Object.entries(BUSINESS_MODULES);
const defaultKeys = new Set(Object.keys(DEFAULT_FEATURE_FLAGS));

describe("business-modules catalog — structure", () => {
  it("every card has a valid bucket, title, description, scope (f)", () => {
    for (const [key, card] of cards) {
      expect(["A", "B", "C"], `${key}.bucket`).toContain(card.bucket);
      expect(typeof card.title, `${key}.title`).toBe("string");
      expect(card.title.length, `${key}.title empty`).toBeGreaterThan(0);
      expect(typeof card.description, `${key}.description`).toBe("string");
      expect(VALID_SCOPES, `${key}.scope invalid: ${card.scope}`).toContain(card.scope);
      expect(Array.isArray(card.flags), `${key}.flags`).toBe(true);
      expect(Array.isArray(card.sub_toggles), `${key}.sub_toggles`).toBe(true);
      expect(Array.isArray(card.depends_on), `${key}.depends_on`).toBe(true);
    }
  });

  it("Bucket A cards carry a mode (or explicit null for flag-only verticals); B/C carry none", () => {
    for (const [key, card] of cards) {
      if (card.bucket === "A") {
        expect(card.mode === null || typeof card.mode === "string", `${key}.mode`).toBe(true);
      } else {
        expect(card.mode, `${key} (bucket ${card.bucket}) must not define a mode`).toBeUndefined();
      }
    }
  });

  it("Bucket C cards have setup_route, setup_required_when, and a well-formed connected_check; A/B have none", () => {
    for (const [key, card] of cards) {
      if (card.bucket === "C") {
        expect(typeof card.setup_route, `${key}.setup_route`).toBe("string");
        expect(card.setup_route.startsWith("/"), `${key}.setup_route path`).toBe(true);
        expect(typeof card.setup_required_when, `${key}.setup_required_when`).toBe("string");
        const cc = card.connected_check;
        expect(cc, `${key}.connected_check`).toBeTruthy();
        expect(["query", "env"], `${key}.connected_check.type`).toContain(cc.type);
        if (cc.type === "query") {
          expect(typeof cc.sql, `${key}.connected_check.sql`).toBe("string");
          expect(/\bconnected\b/i.test(cc.sql), `${key} sql must yield a 'connected' column`).toBe(true);
        } else {
          expect(typeof cc.env, `${key}.connected_check.env`).toBe("string");
        }
      } else {
        expect(card.setup_route, `${key} must not define setup_route`).toBeUndefined();
        expect(card.connected_check, `${key} must not define connected_check`).toBeUndefined();
      }
    }
  });

  it("impact_queries are named COUNT queries", () => {
    for (const [key, card] of cards) {
      for (const [qName, q] of Object.entries(card.impact_queries || {})) {
        expect(typeof q.label, `${key}.${qName}.label`).toBe("string");
        expect(typeof q.sql, `${key}.${qName}.sql`).toBe("string");
        expect(/COUNT\(\*\)/i.test(q.sql), `${key}.${qName} must be a COUNT query`).toBe(true);
      }
    }
  });

  it("MODULE_STATES documents the full six-state enum", () => {
    expect(Object.values(MODULE_STATES).sort()).toEqual(
      ["attention_required", "connected", "locked", "off", "on", "setup_required"].sort()
    );
  });
});

describe("business-modules catalog — flag existence (a)", () => {
  it("every catalog flag (primary + sub_toggle) exists in DEFAULT_FEATURE_FLAGS or is a documented DB-only key", () => {
    for (const [key, card] of cards) {
      for (const flag of cardManagedFlags(card)) {
        const known = defaultKeys.has(flag) || DB_ONLY_FLAGS.includes(flag);
        expect(known, `${key} references unknown flag '${flag}'`).toBe(true);
      }
    }
  });

  it("every UNMANAGED_FLAGS key exists in DEFAULT_FEATURE_FLAGS and carries a reason", () => {
    for (const [flag, reason] of Object.entries(UNMANAGED_FLAGS)) {
      expect(defaultKeys.has(flag), `UNMANAGED flag '${flag}' not in DEFAULT_FEATURE_FLAGS`).toBe(true);
      expect(typeof reason, `UNMANAGED '${flag}' reason`).toBe("string");
      expect(reason.length, `UNMANAGED '${flag}' reason empty`).toBeGreaterThan(10);
    }
  });
});

describe("business-modules catalog — mode pairing (b)", () => {
  it("every Bucket A mode is a VALID_MODE and its flags cover the registry bundle", () => {
    for (const [key, card] of cards) {
      if (card.bucket !== "A" || !card.mode) continue;
      expect(VALID_MODES, `${key}.mode '${card.mode}'`).toContain(card.mode);
      const bundle = MODE_REGISTRY[card.mode].feature_flags_to_enable;
      for (const flag of bundle) {
        expect(card.flags, `${key} missing registry flag '${flag}' for mode '${card.mode}'`).toContain(flag);
      }
    }
  });

  it("every VALID_MODE is owned by exactly one Bucket A card", () => {
    const owned = cards.filter(([, c]) => c.bucket === "A" && c.mode).map(([, c]) => c.mode);
    expect(owned.sort()).toEqual([...VALID_MODES].sort());
    expect(new Set(owned).size).toBe(owned.length);
  });
});

describe("business-modules catalog — Bucket D exclusion (c)", () => {
  it("no UNMANAGED flag appears in any card", () => {
    const unmanaged = new Set(Object.keys(UNMANAGED_FLAGS));
    for (const [key, card] of cards) {
      for (const flag of cardManagedFlags(card)) {
        expect(unmanaged.has(flag), `${key} exposes unmanaged flag '${flag}'`).toBe(false);
      }
    }
  });
});

describe("business-modules catalog — depends_on graph (d)", () => {
  it("all card-level and sub_toggle-level depends_on references resolve to catalog keys", () => {
    for (const [key, card] of cards) {
      for (const dep of card.depends_on) {
        expect(BUSINESS_MODULES[dep], `${key}.depends_on '${dep}' unresolved`).toBeTruthy();
      }
      for (const sub of card.sub_toggles) {
        for (const dep of sub.depends_on || []) {
          expect(BUSINESS_MODULES[dep], `${key}.${sub.key}.depends_on '${dep}' unresolved`).toBeTruthy();
        }
      }
    }
  });

  it("depends_on contains no cycles", () => {
    const visiting = new Set();
    const done = new Set();
    function visit(key, path) {
      if (done.has(key)) return;
      expect(visiting.has(key), `dependency cycle: ${[...path, key].join(" -> ")}`).toBe(false);
      visiting.add(key);
      for (const dep of BUSINESS_MODULES[key].depends_on) visit(dep, [...path, key]);
      visiting.delete(key);
      done.add(key);
    }
    for (const [key] of cards) visit(key, []);
  });

  it("no card depends on itself", () => {
    for (const [key, card] of cards) {
      expect(card.depends_on, `${key} self-dependency`).not.toContain(key);
    }
  });
});

describe("business-modules catalog — bidirectional classification (e)", () => {
  it("every DEFAULT_FEATURE_FLAGS key is classified EXACTLY once (card flag, sub_toggle, or UNMANAGED)", () => {
    const seen = new Map(); // flag -> [owner descriptions]
    for (const [key, card] of cards) {
      for (const flag of card.flags) {
        seen.set(flag, [...(seen.get(flag) || []), `${key}.flags`]);
      }
      for (const sub of card.sub_toggles) {
        seen.set(sub.key, [...(seen.get(sub.key) || []), `${key}.sub_toggles`]);
      }
    }
    for (const flag of Object.keys(UNMANAGED_FLAGS)) {
      seen.set(flag, [...(seen.get(flag) || []), "UNMANAGED_FLAGS"]);
    }

    const unclassified = [...defaultKeys].filter((f) => !seen.has(f));
    expect(
      unclassified,
      `Unclassified DEFAULT_FEATURE_FLAGS keys — add each to a card or UNMANAGED_FLAGS in config/business-modules.js: ${unclassified.join(", ")}`
    ).toEqual([]);

    const duplicated = [...seen.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([f, owners]) => `${f} (${owners.join(" + ")})`);
    expect(duplicated, `Flags classified more than once: ${duplicated.join("; ")}`).toEqual([]);
  });

  it("classifyFlag agrees with the classification tables", () => {
    expect(classifyFlag("phase4_restaurant")).toEqual({ role: "primary", module_key: "restaurant" });
    expect(classifyFlag("wholesale_van_sales")).toEqual({ role: "sub_toggle", module_key: "wholesale_credit" });
    expect(classifyFlag("multi_company")).toEqual({ role: "unmanaged" });
    expect(classifyFlag("no_such_flag")).toBeNull();
  });

  it("isCatalogManagedFlag rejects primary flags only (legacy-PUT lockdown contract)", () => {
    expect(isCatalogManagedFlag("phase4_rentals")).toBe(true); // module primary
    expect(isCatalogManagedFlag("phase4_restaurant_kds")).toBe(true); // bundle member
    expect(isCatalogManagedFlag("rental_online_booking")).toBe(false); // sub_toggle stays writable
    expect(isCatalogManagedFlag("multi_company")).toBe(false); // unmanaged stays writable
    expect(isCatalogManagedFlag("no_such_flag")).toBe(false);
  });
});

describe("business-modules catalog — preset recommendation derivation", () => {
  it("derives recommendations for every valid industry preset without throwing", () => {
    for (const industry of VALID_INDUSTRY_TYPES) {
      const rec = presetRecommendedModules(industry);
      expect(Array.isArray(rec)).toBe(true);
      for (const key of rec) expect(BUSINESS_MODULES[key], `${industry} -> ${key}`).toBeTruthy();
    }
  });

  it("restaurant preset recommends the restaurant card; retail does not", () => {
    expect(presetRecommendedModules("restaurant")).toContain("restaurant");
    expect(presetRecommendedModules("general_retail")).not.toContain("restaurant");
  });

  it("wholesale preset recommends credit + field sales; clinical presets recommend clinical", () => {
    const ws = presetRecommendedModules("wholesale");
    expect(ws).toContain("wholesale_credit");
    expect(ws).toContain("field_sales");
    expect(presetRecommendedModules("dental_clinic")).toContain("clinical");
  });

  it("multi-outlet tenants get the multi-outlet pricing card recommended", () => {
    expect(presetRecommendedModules("general_retail", { outletCount: 2 })).toContain("multi_outlet_pricing");
    expect(presetRecommendedModules("general_retail", { outletCount: 1 })).not.toContain("multi_outlet_pricing");
  });
});
