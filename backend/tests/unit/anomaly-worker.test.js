/**
 * Unit tests for the anomaly worker (2-G.17).
 *
 * Covers the pure math + fake-db-injection path — no real Postgres. We pass
 * a stub `db` whose `query()` returns canned responses in the exact order
 * the worker calls them, and assert the INSERT statements it issues.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { runAnomalyWorkerForDb } = require("../../workers/anomaly-worker-boss");

function makeStubDb(responses) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const canned = responses.shift();
      if (!canned) return { rows: [] };
      return canned;
    },
  };
}

describe("runAnomalyWorkerForDb", () => {
  test("returns 0 when feature flag is OFF", async () => {
    const db = makeStubDb([
      { rows: [{ enabled: false }] }, // flag lookup
    ]);
    const n = await runAnomalyWorkerForDb({ db });
    expect(n).toBe(0);
    expect(db.calls.length).toBe(1); // bails after flag check
  });

  test("returns 0 when no sales rows", async () => {
    const db = makeStubDb([
      { rows: [{ enabled: true }] },
      { rows: [{ anomaly_z_score_threshold: 2.0 }] },
      { rows: [] }, // no sales
    ]);
    const n = await runAnomalyWorkerForDb({ db });
    expect(n).toBe(0);
  });

  test("skips outlets with fewer than 3 peer employees", async () => {
    // Outlet 1 has only 2 employees — peer sample too small to flag.
    const db = makeStubDb([
      { rows: [{ enabled: true }] },
      { rows: [{ anomaly_z_score_threshold: 2.0 }] },
      {
        rows: [
          { employee_id: 11, outlet_id: 1, total_sales: 100, void_count: 20, gross_total: 10000, discount_total: 0 },
          { employee_id: 12, outlet_id: 1, total_sales: 100, void_count: 1,  gross_total: 10000, discount_total: 0 },
        ],
      },
      { rows: [] }, // no refunds
    ]);
    const n = await runAnomalyWorkerForDb({ db });
    expect(n).toBe(0);
  });

  test("flags outlier with z-score above threshold in 6-peer outlet", async () => {
    // Six employees: emp 11 has a 40% void rate, peers all sit at 2%.
    // With n=6 the max possible z-score is √5 ≈ 2.24, so the outlier has
    // enough samples to clear the default threshold of 2.0.
    const db = makeStubDb([
      { rows: [{ enabled: true }] },
      { rows: [{ anomaly_z_score_threshold: 2.0 }] },
      {
        rows: [
          { employee_id: 11, outlet_id: 1, total_sales: 100, void_count: 40, gross_total: 10000, discount_total: 0 },
          { employee_id: 12, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 13, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 14, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 15, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 16, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
        ],
      },
      { rows: [] }, // no refunds
      { rows: [{ id: 1 }] }, // insert for the one outlier
    ]);
    const n = await runAnomalyWorkerForDb({ db });
    expect(n).toBe(1);
    const insertCall = db.calls[db.calls.length - 1];
    expect(insertCall.sql).toMatch(/INSERT INTO retail_anomaly_flags/);
    expect(insertCall.params[0]).toBe(11);
    expect(insertCall.params[2]).toBe("voids_pct");
    expect(Number(insertCall.params[6])).toBeGreaterThan(2.0);
  });

  test("respects caller-supplied z-score threshold override", async () => {
    // Same data as the 6-peer test but threshold bumped to 10 → no flag.
    const db = makeStubDb([
      { rows: [{ enabled: true }] },
      { rows: [{ anomaly_z_score_threshold: 10.0 }] },
      {
        rows: [
          { employee_id: 11, outlet_id: 1, total_sales: 100, void_count: 40, gross_total: 10000, discount_total: 0 },
          { employee_id: 12, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 13, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 14, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 15, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
          { employee_id: 16, outlet_id: 1, total_sales: 100, void_count: 2,  gross_total: 10000, discount_total: 0 },
        ],
      },
      { rows: [] },
    ]);
    const n = await runAnomalyWorkerForDb({ db });
    expect(n).toBe(0);
  });

  test("includes refunds from the returns aggregate", async () => {
    const db = makeStubDb([
      { rows: [{ enabled: true }] },
      { rows: [{ anomaly_z_score_threshold: 2.0 }] },
      {
        rows: [
          { employee_id: 11, outlet_id: 1, total_sales: 100, void_count: 0, gross_total: 10000, discount_total: 0 },
          { employee_id: 12, outlet_id: 1, total_sales: 100, void_count: 0, gross_total: 10000, discount_total: 0 },
          { employee_id: 13, outlet_id: 1, total_sales: 100, void_count: 0, gross_total: 10000, discount_total: 0 },
          { employee_id: 14, outlet_id: 1, total_sales: 100, void_count: 0, gross_total: 10000, discount_total: 0 },
          { employee_id: 15, outlet_id: 1, total_sales: 100, void_count: 0, gross_total: 10000, discount_total: 0 },
          { employee_id: 16, outlet_id: 1, total_sales: 100, void_count: 0, gross_total: 10000, discount_total: 0 },
        ],
      },
      // Refunds: emp 11 has 50 refunds out of 100 sales; others have 0.
      {
        rows: [{ employee_id: 11, outlet_id: 1, refund_count: 50 }],
      },
      { rows: [{ id: 1 }] }, // insert for refunds_pct outlier
    ]);
    const n = await runAnomalyWorkerForDb({ db });
    expect(n).toBe(1);
    const insertCall = db.calls[db.calls.length - 1];
    expect(insertCall.params[2]).toBe("refunds_pct");
  });
});
