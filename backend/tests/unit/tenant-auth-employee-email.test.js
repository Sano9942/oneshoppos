/**
 * P28 — loadTenantAndPerms must populate req.employee.email
 *
 * Pre-fix: middleware SELECTed only (role_id, name) from employees and
 * assigned (id, role_id, name) onto req.employee. Routes that read
 * req.employee.email — only routes/support.js does, for the
 * "support_received" confirmation email — saw undefined and silently
 * skipped the email entirely. No support confirmation email has ever
 * been delivered to any tenant.
 */
// Vitest auto-globals (describe, it, expect, beforeEach, vi) are available
// without import in this project's vitest config — match the pattern used by
// other backend unit tests (e.g. tests/unit/middleware.test.js).
const jwt = require("jsonwebtoken");

const JWT_SECRET = "test-secret-key";
process.env.JWT_SECRET = JWT_SECRET;

// Stub the dynamic require for jwt-auth so we can use the real verify
// without bringing the whole bcrypt/refresh-token chain.

describe("P28 — loadTenantAndPerms hydrates req.employee.email", () => {
  let middleware;
  let stubDb;

  beforeEach(() => {
    // Fresh require — the module is stateful (init writes to closure vars)
    delete require.cache[require.resolve("../../middleware/tenant-auth")];
    middleware = require("../../middleware/tenant-auth");

    // Stub permDb that loadTenantAndPerms calls. Returns realistic shapes.
    stubDb = {
      query: vi.fn(async (sql) => {
        if (/FROM revoked_tokens/.test(sql)) return { rows: [] };
        if (/SELECT tokens_revoked_before/.test(sql)) return { rows: [{ tokens_revoked_before: null }] };
        if (/FROM employees WHERE id/.test(sql)) {
          // The fix MUST add `email` to the SELECT — return all candidate
          // columns; the assertion below only fires if the middleware
          // actually surfaces email onto req.employee.
          return { rows: [{ role_id: 1, name: "Hassan", email: "oneshop349@gmail.com" }] };
        }
        if (/FROM role_permissions/.test(sql)) {
          return { rows: [{ permission: "all_access" }] };
        }
        return { rows: [] };
      }),
    };

    middleware.init({
      db: stubDb,
      IS_MULTI_TENANT: false,
      dbProxy: stubDb,
      tenantDbManager: { getDb: async () => stubDb },
      asyncStore: { run: (_ctx, fn) => fn() },
    });
  });

  it("assigns req.employee.email after a successful auth", async () => {
    const token = jwt.sign(
      { tid: 95, eid: 1, rid: 1, oid: null, scope: "full" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const req = {
      headers: { authorization: `Bearer ${token}` },
      path: "/api/support/tickets",
      method: "POST",
      log: { error: () => {}, warn: () => {}, info: () => {} },
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { this._body = body; return this; },
    };
    const nextSpy = vi.fn();

    await middleware.loadTenantAndPerms(req, res, nextSpy);

    expect(nextSpy).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(req.employee).toBeTruthy();
    expect(req.employee.id).toBe(1);
    expect(req.employee.name).toBe("Hassan");
    // P28 — this assertion FAILS pre-fix because the SELECT doesn't
    // include `email` and req.employee never receives it.
    expect(req.employee.email).toBe("oneshop349@gmail.com");
  });
});
