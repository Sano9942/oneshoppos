import { describe, it, expect, vi, beforeEach } from "vitest";

// /api/admin/infra is the heaviest admin endpoint in production
// (combined ~957s of total DB time across 3 introspection queries
// in the prod snapshot taken 2026-04-17). It now caches results
// in-process for 5 minutes. These tests lock in the cache behavior
// without standing up a full Express app.

describe("/api/admin/infra cache", () => {
  let app;
  let routes;
  let registerMonitoringRoutes;
  let mockDb;
  let infraHandler;

  beforeEach(async () => {
    vi.resetModules();
    routes = [];
    app = {
      get: (path, ...handlers) => {
        routes.push({ path, handlers });
      },
      post: (path, ...handlers) => {
        routes.push({ path, handlers });
      },
    };

    mockDb = { query: vi.fn() };

    // Default Promise.all responses for the seven introspection queries
    // in the order they appear in the handler.
    mockDb.query.mockImplementation((sql) => {
      if (/COUNT\(\*\) FILTER \(WHERE state = 'active'\)/.test(sql)) {
        return Promise.resolve({ rows: [{ active: 1, idle: 2, idle_in_tx: 0, total: 3 }] });
      }
      if (/max_connections/.test(sql)) {
        return Promise.resolve({ rows: [{ max: 60 }] });
      }
      if (/pg_database_size/.test(sql)) {
        return Promise.resolve({ rows: [{ bytes: 196 * 1024 * 1024, name: "postgres" }] });
      }
      if (/query_start < now\(\) - interval/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/heap_blks_hit/.test(sql)) {
        return Promise.resolve({ rows: [{ hit_ratio: "99.50" }] });
      }
      if (/n_dead_tup AS dead_tuples/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/pg_total_relation_size/.test(sql)) {
        return Promise.resolve({ rows: [{ schema: "public", size_mb: "12.30" }] });
      }
      if (/pg_stat_statements/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const passThrough = (_req, _res, next) => next();
    registerMonitoringRoutes = (await import("../../routes/admin/monitoring.js")).default
      || require("../../routes/admin/monitoring.js");
    registerMonitoringRoutes(app, {
      db: mockDb,
      masterDb: mockDb,
      requireAllowedIp: passThrough,
      requireSuperAdmin: passThrough,
      tenantDbManager: { getDb: vi.fn() },
      logAdminAction: vi.fn(),
    });

    const infraRoute = routes.find((r) => r.path === "/api/admin/infra");
    expect(infraRoute, "infra route registered").toBeTruthy();
    infraHandler = infraRoute.handlers[infraRoute.handlers.length - 1];
  });

  function makeReqRes(query = {}) {
    const req = { query };
    let body = null;
    let status = 200;
    const headers = {};
    const res = {
      status: (code) => {
        status = code;
        return res;
      },
      json: (data) => {
        body = data;
        return res;
      },
      set: (name, value) => {
        headers[name] = value;
        return res;
      },
    };
    return { req, res, get body() { return body; }, get status() { return status; }, headers };
  }

  it("first call is a cache miss and populates the cache", async () => {
    const ctx = makeReqRes();
    await infraHandler(ctx.req, ctx.res);
    expect(ctx.headers["X-Infra-Cache"]).toBe("miss");
    expect(ctx.body).toBeTruthy();
    expect(ctx.body.cached_at).toBeTruthy();
    expect(ctx.body.cache_ttl_seconds).toBe(300);
    // 7 db.query calls in Promise.all + 1 pg_stat_statements call = 8
    expect(mockDb.query.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it("second call within TTL is a cache hit and does not re-query", async () => {
    const first = makeReqRes();
    await infraHandler(first.req, first.res);
    const callsAfterFirst = mockDb.query.mock.calls.length;

    const second = makeReqRes();
    await infraHandler(second.req, second.res);
    expect(second.headers["X-Infra-Cache"]).toBe("hit");
    expect(mockDb.query.mock.calls.length).toBe(callsAfterFirst);
    expect(second.body).toEqual(first.body);
  });

  it("force=1 bypasses the cache and re-queries", async () => {
    const first = makeReqRes();
    await infraHandler(first.req, first.res);
    const callsAfterFirst = mockDb.query.mock.calls.length;

    const forced = makeReqRes({ force: "1" });
    await infraHandler(forced.req, forced.res);
    expect(forced.headers["X-Infra-Cache"]).toBe("miss");
    expect(mockDb.query.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
