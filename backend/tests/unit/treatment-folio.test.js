import { describe, it, expect, vi } from "vitest";

const svc = require("../../services/treatment-plan-service.js");

/**
 * Unit tests for the pure + near-pure folio helpers.
 *
 * Pattern: feed a fake db with a query() that returns canned rows per
 * SQL fragment. No real Postgres. Keeps the math deterministic and
 * fast under CI.
 */

function fakeDb(queryMap) {
  const queries = [];
  return {
    queries,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      for (const [needle, result] of queryMap) {
        if (sql.includes(needle)) {
          return typeof result === "function" ? result(sql, params) : result;
        }
      }
      return { rows: [] };
    }),
  };
}

// ── upsertFolioForPlan idempotency ──────────────────────────────────

describe("upsertFolioForPlan", () => {
  it("returns the existing open folio when one exists (no insert)", async () => {
    const db = fakeDb([
      ["SELECT * FROM treatment_folios WHERE plan_id = $1 AND status = 'open'", { rows: [{ id: 7, plan_id: 42, status: "open" }] }],
    ]);
    const folio = await svc.upsertFolioForPlan(db, 42);
    expect(folio.id).toBe(7);
    // No INSERT issued
    const inserts = db.queries.filter((q) => q.sql.includes("INSERT INTO treatment_folios"));
    expect(inserts.length).toBe(0);
  });

  it("creates a new folio when none exists (idempotent first call)", async () => {
    const db = fakeDb([
      ["SELECT * FROM treatment_folios WHERE plan_id = $1 AND status = 'open'", { rows: [] }],
      ["INSERT INTO treatment_folios", { rows: [{ id: 99, plan_id: 42, status: "open" }] }],
    ]);
    const folio = await svc.upsertFolioForPlan(db, 42);
    expect(folio.id).toBe(99);
  });

  it("prefers the most recent open folio when multiple exist (LIMIT 1)", async () => {
    // The query is ordered DESC by created_at and LIMIT 1 — fake returns first row.
    const db = fakeDb([
      ["SELECT * FROM treatment_folios WHERE plan_id = $1 AND status = 'open'", { rows: [{ id: 20, plan_id: 42, status: "open", created_at: "2026-04-15" }] }],
    ]);
    const folio = await svc.upsertFolioForPlan(db, 42);
    expect(folio.id).toBe(20);
  });
});

// ── recalcFolioTotals computation ───────────────────────────────────

describe("recalcFolioTotals", () => {
  it("issues the aggregation query and the UPDATE", async () => {
    const db = fakeDb([
      ["COALESCE(SUM(CASE WHEN line_type = 'session_fee'", {
        rows: [{
          session_total: "150.00",
          pos_total: "80.00",
          manual_total: "20.00",
          tax_total: "0",
          discount_total: "0",
        }],
      }],
    ]);
    await svc.recalcFolioTotals(db, 1);
    const update = db.queries.find((q) => q.sql.includes("UPDATE treatment_folios"));
    expect(update).toBeTruthy();
    // $1 sessionTotal, $2 posTotal (pos+manual), $3 taxTotal, $4 grand, $5 folioId
    expect(update.params[0]).toBe(150);
    expect(update.params[1]).toBe(100); // 80 + 20
    expect(update.params[2]).toBe(0);
    expect(update.params[3]).toBe(250); // grand
    expect(update.params[4]).toBe(1);
  });

  it("handles zero-row folios", async () => {
    const db = fakeDb([
      ["COALESCE(SUM(CASE WHEN line_type = 'session_fee'", {
        rows: [{ session_total: "0", pos_total: "0", manual_total: "0", tax_total: "0", discount_total: "0" }],
      }],
    ]);
    await svc.recalcFolioTotals(db, 5);
    const update = db.queries.find((q) => q.sql.includes("UPDATE treatment_folios"));
    expect(update.params[3]).toBe(0); // grand total
  });

  it("discounts reduce the grand total (negative line_total convention)", async () => {
    // V05 folio-tax column shape: legacy 'tax'-type lines stay additive;
    // per-line snapshot tax adds to grand only when stamped exclusive.
    const db = fakeDb([
      ["COALESCE(SUM(CASE WHEN line_type = 'session_fee'", {
        rows: [{
          session_total: "100.00",
          pos_total: "50.00",
          manual_total: "0",
          legacy_tax: "15.00",
          snapshot_tax: "0",
          exclusive_tax: "0",
          discount_total: "-10.00",
        }],
      }],
    ]);
    await svc.recalcFolioTotals(db, 3);
    const update = db.queries.find((q) => q.sql.includes("UPDATE treatment_folios"));
    // grand = session + pos + manual + discount + legacy tax = 100 + 50 + 0 − 10 + 15 = 155
    expect(update.params[3]).toBe(155);
  });

  it("V05: exclusive snapshot tax adds on top; inclusive stays inside", async () => {
    const db = fakeDb([
      ["COALESCE(SUM(CASE WHEN line_type = 'session_fee'", {
        rows: [{
          session_total: "1000.00",
          pos_total: "550.00",   // sale gross incl. its own 50 tax
          manual_total: "0",
          legacy_tax: "0",
          snapshot_tax: "150.00", // 100 exclusive (session) + 50 inclusive (pos_sale)
          exclusive_tax: "100.00",
          discount_total: "0",
        }],
      }],
    ]);
    await svc.recalcFolioTotals(db, 7);
    const update = db.queries.find((q) => q.sql.includes("UPDATE treatment_folios"));
    expect(update.params[2]).toBe(150);  // tax_total = all snapshots
    expect(update.params[3]).toBe(1650); // 1000 + 550 + 100 exclusive on top
  });
});

// ── resolveNextSessionNumber ────────────────────────────────────────

describe("resolveNextSessionNumber", () => {
  it("returns 1 for a plan with no sessions", async () => {
    const db = fakeDb([
      ["SELECT COALESCE(MAX(session_number), 0) + 1 AS next", { rows: [{ next: 1 }] }],
    ]);
    const next = await svc.resolveNextSessionNumber(db, 42);
    expect(next).toBe(1);
  });

  it("returns MAX + 1 for a plan with existing sessions", async () => {
    const db = fakeDb([
      ["SELECT COALESCE(MAX(session_number), 0) + 1 AS next", { rows: [{ next: 4 }] }],
    ]);
    const next = await svc.resolveNextSessionNumber(db, 42);
    expect(next).toBe(4);
  });
});

// ── generatePlanNumber format ───────────────────────────────────────

describe("generatePlanNumber", () => {
  it("formats as TP-YYYY-NNNN with zero-padding", async () => {
    const db = fakeDb([
      ["SELECT COUNT(*) AS cnt FROM treatment_plans", { rows: [{ cnt: 41 }] }],
    ]);
    const num = await svc.generatePlanNumber(db);
    const year = new Date().getFullYear();
    expect(num).toBe(`TP-${year}-0042`);
  });

  it("starts at 0001 for an empty year", async () => {
    const db = fakeDb([
      ["SELECT COUNT(*) AS cnt FROM treatment_plans", { rows: [{ cnt: 0 }] }],
    ]);
    const num = await svc.generatePlanNumber(db);
    expect(num).toMatch(/^TP-\d{4}-0001$/);
  });
});
