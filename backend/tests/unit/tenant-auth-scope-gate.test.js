/**
 * PLAN-V3 Step 4.3 — loadTenantAndPerms must reject non-employee token scopes
 * BEFORE attaching any tenant/employee context.
 *
 * loadTenantAndPerms runs on every authenticated request and verifies tokens
 * with JWT_SECRET. A manufacturer- or customer-portal token shares JWT_SECRET
 * when its dedicated portal secret is unset, so it verifies here. It has no
 * `eid`, so guarded routes 403 — but req.tenantId WAS being set from its `tid`,
 * attaching tenant DB context and leaving any UNGUARDED tenant route reachable
 * with a portal token.
 *
 * The fix rejects any explicit non-"full" scope with 401 INVALID_TOKEN_SCOPE
 * before req.tenantId/req.employee are set. Employee + impersonation tokens
 * carry scope "full" and must be unaffected; a scope-less legacy token is
 * tolerated as employee.
 */
const jwt = require("jsonwebtoken");

const JWT_SECRET = "test-secret-key-scope-gate";
process.env.JWT_SECRET = JWT_SECRET;

function makeRes() {
  return {
    statusCode: 200,
    _body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(body) { this._body = body; return this; },
  };
}

function makeReq(token) {
  return {
    headers: { authorization: `Bearer ${token}` },
    path: "/api/parked-sales", // an example tenant route with no per-route guard
    method: "GET",
    log: { error: () => {}, warn: () => {}, info: () => {} },
  };
}

describe("Step 4.3 — loadTenantAndPerms scope gate", () => {
  let middleware;
  let stubDb;

  beforeEach(() => {
    // Fresh require — the module is stateful (init writes to closure vars).
    delete require.cache[require.resolve("../../middleware/tenant-auth")];
    middleware = require("../../middleware/tenant-auth");

    // Stub permDb — returns realistic shapes for the employee happy path.
    stubDb = {
      query: vi.fn(async (sql) => {
        if (/FROM revoked_tokens/.test(sql)) return { rows: [] };
        if (/FROM public\.impersonation_sessions/.test(sql)) return { rows: [] };
        if (/SELECT tokens_revoked_before/.test(sql)) return { rows: [{ tokens_revoked_before: null }] };
        if (/FROM employees WHERE id/.test(sql)) return { rows: [{ role_id: 1, name: "Hassan", email: "h@example.com" }] };
        if (/FROM role_permissions/.test(sql)) return { rows: [{ permission: "all_access" }] };
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

  it("rejects a manufacturer-scope token BEFORE tenant context attaches", async () => {
    // The real manufacturer token shape — no eid, scope "manufacturer" — but
    // signed with the EMPLOYEE secret to simulate the unset-portal-secret case.
    const token = jwt.sign(
      { mid: 7, tid: 95, tslug: "acme", scope: "manufacturer", jti: "j-1" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const req = makeReq(token);
    const res = makeRes();
    const nextSpy = vi.fn();

    // Drop the init()-time single-tenant warm-cache queries (company_profile +
    // context flag) so this assertion measures only what loadTenantAndPerms does.
    stubDb.query.mockClear();
    await middleware.loadTenantAndPerms(req, res, nextSpy);

    expect(res.statusCode).toBe(401);
    expect(res._body).toEqual({ error: "Invalid token scope", code: "INVALID_TOKEN_SCOPE" });
    expect(nextSpy).not.toHaveBeenCalled();
    // The load-bearing assertion: tenant context is NEVER attached, so an
    // unguarded tenant route can't run with a manufacturer token.
    expect(req.tenantId).toBeUndefined();
    expect(req.employee).toBeUndefined();
    // And no permDb query ran — rejection happens before any tenant DB access.
    expect(stubDb.query).not.toHaveBeenCalled();
  });

  it("rejects a customer-scope token the same way", async () => {
    const token = jwt.sign(
      { cid: 3, tid: 95, tslug: "acme", scope: "customer", jti: "j-2" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const req = makeReq(token);
    const res = makeRes();
    const nextSpy = vi.fn();

    await middleware.loadTenantAndPerms(req, res, nextSpy);

    expect(res.statusCode).toBe(401);
    expect(res._body.code).toBe("INVALID_TOKEN_SCOPE");
    expect(req.tenantId).toBeUndefined();
    expect(nextSpy).not.toHaveBeenCalled();
  });

  it("rejects an admin-scope token presented to a tenant route", async () => {
    const token = jwt.sign(
      { aid: 1, scope: "admin", jti: "j-3" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const req = makeReq(token);
    const res = makeRes();
    const nextSpy = vi.fn();

    await middleware.loadTenantAndPerms(req, res, nextSpy);

    expect(res.statusCode).toBe(401);
    expect(res._body.code).toBe("INVALID_TOKEN_SCOPE");
    expect(req.tenantId).toBeUndefined();
  });

  it("passes a normal employee token (scope 'full') unchanged", async () => {
    const token = jwt.sign(
      { tid: 95, eid: 1, rid: 1, oid: null, scope: "full" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const req = makeReq(token);
    const res = makeRes();
    const nextSpy = vi.fn();

    await middleware.loadTenantAndPerms(req, res, nextSpy);

    expect(nextSpy).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(req.tenantId).toBe(95);
    expect(req.employee.id).toBe(1);
    expect(req.employeePerms).toContain("all_access");
  });

  it("passes an impersonation token (scope 'full', impersonating) unchanged", async () => {
    const token = jwt.sign(
      {
        tid: 95, eid: 1, rid: 1, oid: null, scope: "full",
        impersonating: true,
        realIdentity: { id: 9, name: "Super Admin", email: "sa@example.com" },
        jti: "imp-1",
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const req = makeReq(token);
    const res = makeRes();
    const nextSpy = vi.fn();

    await middleware.loadTenantAndPerms(req, res, nextSpy);

    expect(nextSpy).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(req.tenantId).toBe(95);
    expect(req.isImpersonating).toBe(true);
    expect(req.impersonatedBy).toEqual({ id: 9, name: "Super Admin", email: "sa@example.com" });
  });

  it("tolerates a legacy token with no scope claim (treated as employee)", async () => {
    const token = jwt.sign(
      { tid: 95, eid: 1, rid: 1, oid: null }, // no scope
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    // jsonwebtoken doesn't add scope, so decoded.scope is undefined here.
    const req = makeReq(token);
    const res = makeRes();
    const nextSpy = vi.fn();

    await middleware.loadTenantAndPerms(req, res, nextSpy);

    expect(nextSpy).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(req.tenantId).toBe(95);
  });
});
