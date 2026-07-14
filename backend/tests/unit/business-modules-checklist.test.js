"use strict";

/**
 * Setup checklists (Business Modules v2 / D6, PLAN-V2 Step 11).
 *
 * Two concerns:
 *  1. Catalog structure — the four covered Bucket A cards carry a well-formed
 *     setup_checklist; nothing else does (E5 defers the rest).
 *  2. computeChecklists — the read-path helper: batched single query, the
 *     required-items state rule, the tenant/outlet scope dimension, and the
 *     zero-query fast path when no covered card is enabled.
 *
 * Pattern A (unit-tests CLAUDE.md): the real function against a hand-built fake
 * db that records SQL/params and evaluates each EXISTS column from a supplied
 * "done tables" set.
 */

import { describe, it, expect } from "vitest";
import { BUSINESS_MODULES } from "../../config/business-modules";
import { computeChecklists } from "../../services/business-modules";

const COVERED = ["restaurant", "appointments", "rentals", "rooms_lodging"];

// Fake db: parse the batched `EXISTS(<body>) AS iN` columns and mark a column
// done when its FROM table is in `doneTables`. Records every call for budget
// + param assertions.
function fakeDb(doneTables, { throwMissingTableOnBatch = false } = {}) {
  const calls = [];
  const tableOf = (body) => {
    const m = /\bfrom\s+([a-z_]+)/i.exec(body);
    return m ? m[1] : null;
  };
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      // The batch is the multi-column SELECT; a per-item fallback is a single
      // `... AS done`. Distinguish by column count.
      const cols = [...sql.matchAll(/EXISTS\(([^)]*)\)\s+AS\s+(\w+)/gi)];
      if (cols.length > 1 && throwMissingTableOnBatch) {
        const err = new Error('relation "restaurant_floor_plans" does not exist');
        throw err;
      }
      const row = {};
      for (const [, body, alias] of cols) {
        row[alias] = doneTables.has(tableOf(body));
      }
      return { rows: [row] };
    },
  };
}

const enableRestaurant = { modes: { restaurant: true }, flags: {} };

describe("business-modules setup_checklist — catalog structure", () => {
  it("exactly the four covered verticals carry a setup_checklist", () => {
    const withChecklist = Object.entries(BUSINESS_MODULES)
      .filter(([, c]) => Array.isArray(c.setup_checklist) && c.setup_checklist.length)
      .map(([k]) => k)
      .sort();
    expect(withChecklist).toEqual([...COVERED].sort());
  });

  it("every checklist item is well-formed; outlet-scoped items declare an outlet column", () => {
    for (const key of COVERED) {
      for (const item of BUSINESS_MODULES[key].setup_checklist) {
        expect(typeof item.id, `${key}.${item.id}`).toBe("string");
        expect(typeof item.label).toBe("string");
        expect(typeof item.required).toBe("boolean");
        expect(["tenant", "outlet"], `${key}.${item.id}.scope`).toContain(item.scope);
        expect(typeof item.route).toBe("string");
        expect(item.route.startsWith("/"), `${key}.${item.id}.route`).toBe(true);
        expect(typeof item.done_query.sql).toBe("string");
        expect(/^\s*select\s+1\s+from\b/i.test(item.done_query.sql), `${key}.${item.id} EXISTS body`).toBe(true);
        if (item.scope === "outlet") {
          expect(typeof item.done_query.outlet_column, `${key}.${item.id}.outlet_column`).toBe("string");
        }
      }
    }
  });

  it("every covered card has at least one required item (so it can reach attention_required)", () => {
    for (const key of COVERED) {
      expect(
        BUSINESS_MODULES[key].setup_checklist.some((i) => i.required),
        `${key} has no required item`
      ).toBe(true);
    }
  });
});

describe("computeChecklists — enablement + query budget", () => {
  it("returns {} and issues ZERO queries when no covered card is enabled", async () => {
    const db = fakeDb(new Set());
    const out = await computeChecklists(db, { flags: {}, modes: {} });
    expect(out).toEqual({});
    expect(db.calls.length).toBe(0);
  });

  it("computes an enabled covered card with a SINGLE batched query", async () => {
    // All three restaurant tables "done".
    const db = fakeDb(new Set(["restaurant_floor_plans", "products", "kds_stations"]));
    const out = await computeChecklists(db, enableRestaurant);
    expect(db.calls.length).toBe(1); // one bulk query, not one-per-item
    expect(out.restaurant.checklist.map((i) => i.id)).toEqual([
      "floor_plan",
      "menu_items",
      "kds_station",
    ]);
    expect(out.restaurant.checklist.every((i) => i.done)).toBe(true);
    expect(out.restaurant.required_incomplete).toBe(false);
  });
});

describe("computeChecklists — required-items state rule", () => {
  it("a missing REQUIRED item holds required_incomplete", async () => {
    // floor_plan (required) NOT done; menu_items done; kds (optional) done.
    const db = fakeDb(new Set(["products", "kds_stations"]));
    const out = await computeChecklists(db, enableRestaurant);
    const floor = out.restaurant.checklist.find((i) => i.id === "floor_plan");
    expect(floor.done).toBe(false);
    expect(out.restaurant.required_incomplete).toBe(true);
  });

  it("a missing OPTIONAL item does NOT hold required_incomplete", async () => {
    // Both required done; only kds_station (optional) missing.
    const db = fakeDb(new Set(["restaurant_floor_plans", "products"]));
    const out = await computeChecklists(db, enableRestaurant);
    const kds = out.restaurant.checklist.find((i) => i.id === "kds_station");
    expect(kds.done).toBe(false);
    expect(kds.required).toBe(false);
    expect(out.restaurant.required_incomplete).toBe(false);
  });
});

describe("computeChecklists — tenant/outlet scope dimension", () => {
  it("tenant-wide (outletId null): no $1 predicate, no params", async () => {
    const db = fakeDb(new Set());
    await computeChecklists(db, { ...enableRestaurant, outletId: null });
    const { sql, params } = db.calls[0];
    expect(sql).not.toMatch(/outlet_id = \$1/);
    expect(params).toEqual([]);
  });

  it("outlet-scoped: injects `outlet_id = $1` for scope:outlet items, params [outletId]", async () => {
    const db = fakeDb(new Set());
    await computeChecklists(db, { ...enableRestaurant, outletId: 7 });
    const { sql, params } = db.calls[0];
    // floor_plan + kds_station are outlet-scoped → predicate present.
    expect((sql.match(/outlet_id = \$1/g) || []).length).toBe(2);
    // menu_items is tenant-scoped → its products EXISTS carries no predicate.
    expect(sql).toMatch(/from products where deleted_at is null\)/i);
    expect(params).toEqual([7]);
  });
});

describe("computeChecklists — missing-table fallback", () => {
  it("falls back to per-item queries when the batch hits a missing table", async () => {
    // Batch throws "does not exist"; per-item path succeeds for the tables we
    // mark done.
    const db = fakeDb(new Set(["products"]), { throwMissingTableOnBatch: true });
    const out = await computeChecklists(db, enableRestaurant);
    // 1 failed batch + 3 per-item fallback queries.
    expect(db.calls.length).toBe(4);
    const menu = out.restaurant.checklist.find((i) => i.id === "menu_items");
    expect(menu.done).toBe(true);
    expect(out.restaurant.required_incomplete).toBe(true); // floor_plan still missing
  });
});
