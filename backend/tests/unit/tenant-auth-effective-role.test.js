/**
 * Step 13 (D2a) — JWT-path invariants for per-outlet role resolution.
 *
 * Verifier finding #6: loadTenantAndPerms used to leave req.employee.role_id
 * as the token's rid. Because resolveEffectiveRole short-circuits when the
 * outlet override EQUALS the base role, a stale rid could silently skip a
 * RESTRICTING override: base role changed Cashier→Manager after login, a
 * Cashier override set at outlet B, and a pre-change token (rid = Cashier)
 * would run with full fresh-DB Manager perms AT B for up to the token TTL.
 * The fix makes the DB-fresh employees.role_id the base truth on req.employee.
 */
const jwt = require("jsonwebtoken");

const JWT_SECRET = "test-secret-key";
process.env.JWT_SECRET = JWT_SECRET;

const CASHIER_ROLE = 3;
const MANAGER_ROLE = 2;

function makeRes() {
  return {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(body) { this._body = body; return this; },
  };
}

function makeReq(token, outletContext) {
  return {
    headers: { authorization: `Bearer ${token}` },
    path: "/api/sales",
    method: "GET",
    outletContext,
    log: { error: () => {}, warn: () => {}, info: () => {} },
  };
}

describe("Step 13 — stale JWT rid cannot defeat a restricting override", () => {
  let middleware;
  let stubDb;
  const permsByRole = {
    [CASHIER_ROLE]: ["pos_discount", "pos_park", "view_sales_reports"],
    [MANAGER_ROLE]: ["manage_inventory", "manage_orders", "pos_discount"],
  };

  beforeEach(() => {
    delete require.cache[require.resolve("../../middleware/tenant-auth")];
    middleware = require("../../middleware/tenant-auth");

    stubDb = {
      query: vi.fn(async (sql, params) => {
        if (/FROM revoked_tokens/.test(sql)) return { rows: [] };
        if (/SELECT tokens_revoked_before/.test(sql)) return { rows: [{ tokens_revoked_before: null }] };
        if (/FROM employees WHERE id/.test(sql)) {
          // DB truth: the employee's base role is now Manager…
          return { rows: [{ role_id: MANAGER_ROLE, name: "Promoted", email: null }] };
        }
        if (/FROM role_permissions/.test(sql)) {
          return { rows: (permsByRole[params[0]] || []).map((p) => ({ permission: p })) };
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

  it("loadTenantAndPerms overwrites req.employee.role_id with the DB-fresh role", async () => {
    // …but the token was minted before the promotion (rid = Cashier).
    const token = jwt.sign(
      { tid: 1, eid: 7, rid: CASHIER_ROLE, oid: null, scope: "full" },
      JWT_SECRET, { expiresIn: "1h" }
    );
    const req = makeReq(token);
    const next = vi.fn();
    await middleware.loadTenantAndPerms(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.employee.role_id).toBe(MANAGER_ROLE);
    expect(req.employeePerms).toContain("manage_inventory");
  });

  it("a restricting override equal to the stale rid still swaps perms down", async () => {
    const token = jwt.sign(
      { tid: 1, eid: 7, rid: CASHIER_ROLE, oid: null, scope: "full" },
      JWT_SECRET, { expiresIn: "1h" }
    );
    const req = makeReq(token, {
      outletId: 2, source: "header",
      // A Cashier override at outlet 2 — numerically equal to the STALE rid.
      overrideRoleId: CASHIER_ROLE,
    });
    const res = makeRes();
    const next = vi.fn();
    await middleware.loadTenantAndPerms(req, res, next);
    await middleware.resolveEffectiveRole(req, res, vi.fn());

    // Pre-fix this ran with full Manager perms (short-circuit hit the stale
    // rid); post-fix the override applies and the request is Cashier-scoped.
    expect(req.employeePerms).toEqual(permsByRole[CASHIER_ROLE]);
    expect(req.baseEmployeePerms).toContain("manage_inventory");
    expect(req.employee.base_role_id).toBe(MANAGER_ROLE);
    expect(req.employee.effective_role_id).toBe(CASHIER_ROLE);
    expect(req.effectiveOverrideRoleId).toBe(CASHIER_ROLE);
  });

  it("no override → zero extra queries and effective = base", async () => {
    const token = jwt.sign(
      { tid: 1, eid: 7, rid: MANAGER_ROLE, oid: null, scope: "full" },
      JWT_SECRET, { expiresIn: "1h" }
    );
    const req = makeReq(token, { outletId: 1, source: "header", overrideRoleId: null });
    const res = makeRes();
    await middleware.loadTenantAndPerms(req, res, vi.fn());

    const queriesBefore = stubDb.query.mock.calls.length;
    await middleware.resolveEffectiveRole(req, res, vi.fn());
    expect(stubDb.query.mock.calls.length).toBe(queriesBefore);
    expect(req.employee.effective_role_id).toBe(MANAGER_ROLE);
    expect(req.effectiveOverrideRoleId).toBeUndefined();
    expect(req.employeePerms).toBe(req.baseEmployeePerms);
  });
});
