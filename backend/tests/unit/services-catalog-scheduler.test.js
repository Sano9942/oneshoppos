import { describe, it, expect, vi } from "vitest";

// Unit tests for services/catalog-scheduler.js.
//
// The service's applyScheduledChange(db, change) was extracted in the
// Phase 2 C3 fix (commit ef1dc76) out of boot/workers.js, which had an
// SQL injection bug at line 232: change.field_name was interpolated
// directly into `UPDATE products SET ${field_name} = $1 WHERE id = $2`.
//
// These tests exercise the single-row apply logic directly via a fake
// db, with special attention to:
//   - allowlisted field_name → emits the UPDATE + marks 'applied'
//   - non-allowlisted field_name → does NOT emit the UPDATE, marks 'failed'
//   - injection-shaped field_name → does NOT emit the UPDATE, marks 'failed'
//   - unknown entity_type → marks 'failed'
//   - UPDATE error → rolls back transaction, marks 'failed' via fresh query
//
// Pattern mirrors Pattern A's services-booking-reminders.test.js: inject a
// fake db, assert on the recorded query strings. No vi.mock() on services
// (unreliable with CJS require() in this repo).

const { applyScheduledChange } = require("../../services/catalog-scheduler");

/**
 * Build a fake tenant-scoped db that records every query made via either
 * `db.query()` or the transaction client. A single `queries` array
 * captures both so tests can assert on the full SQL log ordering.
 *
 * Options:
 *   updateShouldThrow: simulate a target UPDATE failure (used to cover
 *                      the transaction-rollback → mark-failed path).
 */
function fakeDb({ updateShouldThrow = false } = {}) {
  const queries = [];
  const db = {
    queries,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params, via: "pool" });
      return { rows: [], rowCount: 0 };
    }),
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql, params) => {
          queries.push({ sql, params, via: "client" });
          if (updateShouldThrow && sql.startsWith("UPDATE products") || (updateShouldThrow && sql.startsWith("UPDATE product_variants"))) {
            throw new Error("simulated UPDATE failure");
          }
          return { rows: [], rowCount: 1 };
        }),
      };
      // Mirror the real db-pg transaction helper: if the callback throws,
      // rethrow after emitting a conceptual ROLLBACK (the fake doesn't
      // actually track BEGIN/COMMIT/ROLLBACK, just lets the error propagate).
      return await fn(client);
    }),
  };
  return db;
}

describe("applyScheduledChange", () => {
  it("applies a valid product row: UPDATE products SET price = $1 + marks applied", async () => {
    const db = fakeDb();
    const change = {
      id: 1,
      entity_type: "product",
      entity_id: 42,
      field_name: "price",
      new_value: "799",
    };

    const result = await applyScheduledChange(db, change);

    expect(result).toEqual({ status: "applied" });

    // Transaction client saw: UPDATE products + UPDATE scheduled_catalog_changes
    const clientQueries = db.queries.filter((q) => q.via === "client");
    expect(clientQueries).toHaveLength(2);
    expect(clientQueries[0].sql).toBe("UPDATE products SET price = $1 WHERE id = $2");
    expect(clientQueries[0].params).toEqual(["799", 42]);
    expect(clientQueries[1].sql).toContain("UPDATE scheduled_catalog_changes SET status = 'applied'");
    expect(clientQueries[1].params).toEqual([1]);
  });

  it("applies a valid variant row: UPDATE product_variants SET stock = $1", async () => {
    const db = fakeDb();
    const change = {
      id: 2,
      entity_type: "variant",
      entity_id: 7,
      field_name: "stock",
      new_value: "50",
    };

    const result = await applyScheduledChange(db, change);

    expect(result).toEqual({ status: "applied" });
    const clientQueries = db.queries.filter((q) => q.via === "client");
    expect(clientQueries[0].sql).toBe("UPDATE product_variants SET stock = $1 WHERE id = $2");
    expect(clientQueries[0].params).toEqual(["50", 7]);
  });

  it("rejects a product row with non-allowlisted field_name (e.g. 'deleted_at')", async () => {
    const db = fakeDb();
    const change = {
      id: 3,
      entity_type: "product",
      entity_id: 42,
      field_name: "deleted_at",
      new_value: "NOW()",
    };

    const result = await applyScheduledChange(db, change);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("allowlist");

    // No transaction, no UPDATE products — only the pool-level "mark failed".
    expect(db.transaction).not.toHaveBeenCalled();
    const poolQueries = db.queries.filter((q) => q.via === "pool");
    expect(poolQueries).toHaveLength(1);
    expect(poolQueries[0].sql).toContain("UPDATE scheduled_catalog_changes SET status = 'failed'");
    expect(poolQueries[0].params).toEqual([3]);

    // Nothing ran on the client — no UPDATE products.
    const clientQueries = db.queries.filter((q) => q.via === "client");
    expect(clientQueries).toHaveLength(0);
  });

  it("rejects an injection-shaped field_name — never touches the target table", async () => {
    const db = fakeDb();
    const change = {
      id: 4,
      entity_type: "product",
      entity_id: 42,
      // Classic PG multi-statement injection attempt.
      field_name: "price = 0, deleted_at = NOW()",
      new_value: "anything",
    };

    const result = await applyScheduledChange(db, change);

    expect(result.status).toBe("failed");

    // The whole point of the allowlist: this string must NEVER appear
    // in any UPDATE against `products`. Scan every recorded query to
    // prove that.
    for (const q of db.queries) {
      expect(q.sql).not.toContain("deleted_at = NOW()");
      expect(q.sql).not.toContain("UPDATE products");
    }
  });

  it("rejects a variant row with a field_name that's valid for product but not variant", async () => {
    // 'status' is in PRODUCT_FIELDS but NOT in VARIANT_FIELDS. Proves the
    // cross-field check: allowlist membership is per-entity, not global.
    const db = fakeDb();
    const change = {
      id: 5,
      entity_type: "variant",
      entity_id: 7,
      field_name: "status",
      new_value: "inactive",
    };

    const result = await applyScheduledChange(db, change);

    expect(result.status).toBe("failed");
    expect(db.transaction).not.toHaveBeenCalled();
    const clientQueries = db.queries.filter((q) => q.via === "client");
    expect(clientQueries).toHaveLength(0);
  });

  it("rejects an unknown entity_type", async () => {
    const db = fakeDb();
    const change = {
      id: 6,
      entity_type: "bogus",
      entity_id: 1,
      field_name: "price",
      new_value: "1",
    };

    const result = await applyScheduledChange(db, change);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("entity_type");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("marks the row failed (and does not throw) when the target UPDATE errors", async () => {
    const db = fakeDb({ updateShouldThrow: true });
    const change = {
      id: 7,
      entity_type: "product",
      entity_id: 99999, // pretend non-existent id triggers simulated failure
      field_name: "price",
      new_value: "100",
    };

    // Should resolve, not throw — one bad row shouldn't kill the worker batch.
    const result = await applyScheduledChange(db, change);

    expect(result.status).toBe("failed");

    // Transaction was attempted once...
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // ...then the pool-level "mark failed" query ran (not on the rolled-back client).
    const poolQueries = db.queries.filter((q) => q.via === "pool");
    expect(poolQueries).toHaveLength(1);
    expect(poolQueries[0].sql).toContain("UPDATE scheduled_catalog_changes SET status = 'failed'");
    expect(poolQueries[0].params).toEqual([7]);
  });
});
