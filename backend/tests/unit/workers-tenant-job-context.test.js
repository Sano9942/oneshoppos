import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit test for workers/tenant-job-context.js.
//
// The helper is the foundation for Pattern A (background workers bypassing
// multi-tenant DB routing). These tests verify that:
//   1. search_path is set BEFORE the caller's function runs
//   2. search_path is always reset before the client is released
//   3. the client is released even when the callback throws
//   4. unsafe slugs are rejected before any SQL runs
//   5. the transaction() proxy correctly wraps BEGIN/COMMIT/ROLLBACK

const { withTenantContext, assertSafeSlug } = require("../../workers/tenant-job-context");

/**
 * Build a fake pg.Pool that records every query and exposes the client's
 * release state. Each call to pool.connect() returns the same tracked
 * client so the test can inspect what happened in order.
 */
function mockPool({ failOn = null } = {}) {
  const queries = [];
  let released = false;
  const client = {
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (failOn && sql.includes(failOn)) {
        throw new Error(`simulated failure on: ${failOn}`);
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(() => {
      released = true;
    }),
  };
  const pool = {
    connect: vi.fn(async () => client),
  };
  return { pool, client, queries, released: () => released };
}

describe("assertSafeSlug", () => {
  it("accepts normal tenant slugs", () => {
    expect(() => assertSafeSlug("packagesmall")).not.toThrow();
    expect(() => assertSafeSlug("handicraft")).not.toThrow();
    expect(() => assertSafeSlug("tenant_123")).not.toThrow();
    expect(() => assertSafeSlug("a_b_c_1_2")).not.toThrow();
  });

  it("rejects undefined, null, and empty", () => {
    expect(() => assertSafeSlug()).toThrow(/required/);
    expect(() => assertSafeSlug(null)).toThrow(/required/);
    expect(() => assertSafeSlug("")).toThrow(/required/);
  });

  it("rejects slugs with unsafe characters", () => {
    expect(() => assertSafeSlug("tenant-1")).toThrow(/unsafe/);
    expect(() => assertSafeSlug("tenant;drop")).toThrow(/unsafe/);
    expect(() => assertSafeSlug("ab cd")).toThrow(/unsafe/);
    expect(() => assertSafeSlug("UPPER")).toThrow(/unsafe/);
    expect(() => assertSafeSlug("ten'ant")).toThrow(/unsafe/);
  });
});

describe("withTenantContext — happy path", () => {
  let mock;

  beforeEach(() => {
    mock = mockPool();
  });

  it("sets search_path BEFORE running the callback", async () => {
    let queriesAtCallbackStart = null;
    await withTenantContext(mock.pool, "packagesmall", async (db) => {
      queriesAtCallbackStart = mock.queries.length;
      await db.query("SELECT 1", []);
    });
    // Before the callback body ran, exactly one query had fired:
    // the SET search_path.
    expect(queriesAtCallbackStart).toBe(1);
    expect(mock.queries[0].sql).toContain("SET search_path TO tenant_packagesmall");
  });

  it("resets search_path BEFORE releasing the client", async () => {
    await withTenantContext(mock.pool, "packagesmall", async (db) => {
      await db.query("SELECT 1", []);
    });
    // Last query must be the reset, and release must come after.
    const lastQuery = mock.queries[mock.queries.length - 1];
    expect(lastQuery.sql).toContain("SET search_path TO public");
    expect(mock.released()).toBe(true);
  });

  it("returns whatever the callback returns", async () => {
    const result = await withTenantContext(mock.pool, "packagesmall", async () => {
      return { answer: 42 };
    });
    expect(result).toEqual({ answer: 42 });
  });

  it("passes a db proxy with a query method the callback can use", async () => {
    await withTenantContext(mock.pool, "packagesmall", async (db) => {
      await db.query("SELECT * FROM customer_subscriptions WHERE id = $1", [7]);
    });
    // queries should contain: SET search_path, SELECT, SET search_path public
    const selectQuery = mock.queries.find((q) => q.sql.startsWith("SELECT"));
    expect(selectQuery).toBeDefined();
    expect(selectQuery.params).toEqual([7]);
  });
});

describe("withTenantContext — error paths", () => {
  it("releases the client and resets search_path even when callback throws", async () => {
    const mock = mockPool();
    await expect(
      withTenantContext(mock.pool, "packagesmall", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // Client was released.
    expect(mock.released()).toBe(true);
    // Final query was the reset (even though callback threw).
    const lastQuery = mock.queries[mock.queries.length - 1];
    expect(lastQuery.sql).toContain("SET search_path TO public");
  });

  it("releases the client even if the reset itself fails", async () => {
    const mock = mockPool({ failOn: "SET search_path TO public" });
    await withTenantContext(mock.pool, "packagesmall", async (db) => {
      await db.query("SELECT 1", []);
    });
    // The reset threw internally, but we still released.
    expect(mock.released()).toBe(true);
  });

  it("rejects unsafe slug without connecting", async () => {
    const mock = mockPool();
    await expect(
      withTenantContext(mock.pool, "bad-slug", async () => {})
    ).rejects.toThrow(/unsafe/);
    // No connection was ever attempted.
    expect(mock.pool.connect).not.toHaveBeenCalled();
  });
});

describe("withTenantContext — transaction proxy", () => {
  it("wraps BEGIN/COMMIT around the transaction callback on success", async () => {
    const mock = mockPool();
    await withTenantContext(mock.pool, "packagesmall", async (db) => {
      await db.transaction(async (client) => {
        await client.query("INSERT INTO foo VALUES (1)", []);
      });
    });
    const sqls = mock.queries.map((q) => q.sql);
    const beginIdx = sqls.findIndex((s) => s === "BEGIN");
    const commitIdx = sqls.findIndex((s) => s === "COMMIT");
    const insertIdx = sqls.findIndex((s) => s.startsWith("INSERT"));
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBe(beginIdx + 1);
    expect(commitIdx).toBe(insertIdx + 1);
  });

  it("ROLLS BACK when the transaction callback throws", async () => {
    const mock = mockPool();
    await expect(
      withTenantContext(mock.pool, "packagesmall", async (db) => {
        await db.transaction(async (client) => {
          await client.query("INSERT INTO foo VALUES (1)", []);
          throw new Error("tx body failed");
        });
      })
    ).rejects.toThrow("tx body failed");

    const sqls = mock.queries.map((q) => q.sql);
    expect(sqls).toContain("BEGIN");
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
  });
});
