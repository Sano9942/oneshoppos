import { describe, it, expect, vi, beforeEach } from "vitest";

// Locks in the orphan-schema-scan worker's pure scan + cache write.
// In prod the inline scan was the worst single query at ~104s p100;
// the worker now persists results to public.infra_cache hourly so the
// admin endpoint reads from cache instead.

describe("orphan-schema-scan worker", () => {
  let runScan;
  let mockDb;

  beforeEach(async () => {
    vi.resetModules();
    mockDb = { query: vi.fn() };
    ({ runScan } = await import("../../workers/orphan-schema-scan-worker-boss.js"));
  });

  it("identifies orphan tenant_* schemas not in public.tenants and writes to infra_cache", async () => {
    mockDb.query.mockImplementation((sql, params) => {
      if (/information_schema\.schemata/.test(sql)) {
        return Promise.resolve({
          rows: [
            { schema_name: "tenant_alive_one" },
            { schema_name: "tenant_alive_two" },
            { schema_name: "tenant_orphan_one" },
            { schema_name: "tenant_orphan_two" },
          ],
        });
      }
      if (/SELECT slug FROM tenants/.test(sql)) {
        return Promise.resolve({
          rows: [{ slug: "alive_one" }, { slug: "alive_two" }],
        });
      }
      if (/pg_size_pretty/.test(sql)) {
        // Each orphan gets a size lookup. The argument is the schema name.
        const sizeFor = { tenant_orphan_one: "12 MB", tenant_orphan_two: "3 MB" };
        return Promise.resolve({ rows: [{ size: sizeFor[params[0]] || "0 bytes" }] });
      }
      if (/INSERT INTO public\.infra_cache/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await runScan(mockDb);

    expect(result.count).toBe(2);
    expect(result.orphans).toEqual([
      { schema: "tenant_orphan_one", size: "12 MB" },
      { schema: "tenant_orphan_two", size: "3 MB" },
    ]);
    expect(typeof result.durationMs).toBe("number");

    const insert = mockDb.query.mock.calls.find(([sql]) =>
      /INSERT INTO public\.infra_cache/.test(sql)
    );
    expect(insert, "infra_cache upsert was issued").toBeTruthy();
    const [, params] = insert;
    expect(params[0]).toBe("orphaned_schemas");
    const payload = JSON.parse(params[1]);
    expect(payload.count).toBe(2);
    expect(payload.orphans).toHaveLength(2);
    expect(typeof params[2]).toBe("number");
  });

  it("returns zero orphans when every schema has a matching tenant row", async () => {
    mockDb.query.mockImplementation((sql) => {
      if (/information_schema\.schemata/.test(sql)) {
        return Promise.resolve({
          rows: [{ schema_name: "tenant_only_alive" }],
        });
      }
      if (/SELECT slug FROM tenants/.test(sql)) {
        return Promise.resolve({ rows: [{ slug: "only_alive" }] });
      }
      if (/INSERT INTO public\.infra_cache/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await runScan(mockDb);
    expect(result.count).toBe(0);
    expect(result.orphans).toEqual([]);
    // pg_size_pretty should never have been called because no orphans
    const sizeQueries = mockDb.query.mock.calls.filter(([sql]) =>
      /pg_size_pretty/.test(sql)
    );
    expect(sizeQueries).toHaveLength(0);
  });
});
