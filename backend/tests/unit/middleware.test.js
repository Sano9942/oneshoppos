import { describe, it, expect, vi } from "vitest";
import { validate } from "../../middleware/validate.js";
import { LoginSchema } from "../../schemas/auth.js";
import { requirePerm, requireAnyPerm } from "../../middleware/permissions.js";

// Helper: build a mock Express req/res/next triple
function mockHttp(body = {}) {
  const req = { body };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

// ── validate middleware ───────────────────────────────────────────────────────

describe("validate — with LoginSchema", () => {
  it("calls next() for valid input (password)", () => {
    const { req, res, next } = mockHttp({ username: "alice", password: "secret" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when pin is provided instead of password", () => {
    const { req, res, next } = mockHttp({ username: "alice", pin: "1234" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when username is missing", () => {
    const { req, res, next } = mockHttp({ password: "secret" });
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when both password and pin are missing", () => {
    const { req, res, next } = mockHttp({ username: "alice" });
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for empty body", () => {
    const { req, res, next } = mockHttp({});
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("coerces outlet_id from string to number in req.body", () => {
    const { req, res, next } = mockHttp({ username: "alice", password: "pw", outlet_id: "3" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.outlet_id).toBe(3);
  });
});

// ── permissions middleware ────────────────────────────────────────────────────

describe("requirePerm", () => {
  it("calls next() when employee has the exact permission", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports", "manage_inventory"];
    requirePerm("manage_inventory")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() when employee has all_access (administrator)", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["all_access"];
    requirePerm("manage_inventory")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when permission is missing", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports"];
    requirePerm("manage_inventory")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when employeePerms is empty", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = [];
    requirePerm("view_reports")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when employeePerms is undefined", () => {
    const { req, res, next } = mockHttp();
    // req.employeePerms not set — defaults to []
    requirePerm("view_reports")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireAnyPerm", () => {
  it("calls next() when employee has any one of the required permissions", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() when employee has all_access", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["all_access"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when employee has none of the required permissions", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["pos_discount"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── plan-limits middleware ────────────────────────────────────────────────────
// plan-limits.js uses CJS with inline require() calls.
// We mock via require.cache so the inline require() picks up our stubs.

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const _require = createRequire(import.meta.url);

// Resolve absolute paths to CJS modules so require.cache keys match
const MASTER_DB_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  "../../..",
  "master-db-pg.js"
);
const TENANT_DB_MGR_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  "../../..",
  "tenant-db-manager-pg.js"
);
const PLAN_LIMITS_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  "../../..",
  "middleware/plan-limits.js"
);

function injectCjsMock(absPath, mockExports) {
  _require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports: mockExports,
    children: [],
    paths: [],
  };
}

function removeCjsMock(absPath) {
  delete _require.cache[absPath];
}

describe("requirePlanLimit — employees", () => {
  let requirePlanLimit;
  let mockMasterQuery;
  let mockTenantQuery;

  beforeEach(() => {
    mockMasterQuery = vi.fn();
    mockTenantQuery = vi.fn();

    injectCjsMock(MASTER_DB_PATH, { query: mockMasterQuery });
    injectCjsMock(TENANT_DB_MGR_PATH, {
      getDb: vi.fn().mockResolvedValue({ query: mockTenantQuery }),
    });

    // Force fresh load of plan-limits so it picks up the mocked deps
    removeCjsMock(PLAN_LIMITS_PATH);
    ({ requirePlanLimit } = _require(PLAN_LIMITS_PATH));
  });

  afterEach(() => {
    removeCjsMock(MASTER_DB_PATH);
    removeCjsMock(TENANT_DB_MGR_PATH);
    removeCjsMock(PLAN_LIMITS_PATH);
    delete process.env.MULTI_TENANT;
  });

  it("skips check when MULTI_TENANT is not '1'", async () => {
    delete process.env.MULTI_TENANT;
    const req = { tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requirePlanLimit("employees")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockMasterQuery).not.toHaveBeenCalled();
  });

  it("calls next() when plan limit is 0 (unlimited)", async () => {
    process.env.MULTI_TENANT = "1";
    mockMasterQuery.mockResolvedValue({ rows: [{ planLimit: 0 }] });

    const req = { tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requirePlanLimit("employees")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockTenantQuery).not.toHaveBeenCalled();
  });

  it("calls next() when current count is below the limit", async () => {
    process.env.MULTI_TENANT = "1";
    mockMasterQuery.mockResolvedValue({ rows: [{ planLimit: 3 }] });
    mockTenantQuery.mockResolvedValue({ rows: [{ cnt: "2" }] });

    const req = { tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requirePlanLimit("employees")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 403 with PLAN_LIMIT_REACHED when count equals limit", async () => {
    process.env.MULTI_TENANT = "1";
    mockMasterQuery.mockResolvedValue({ rows: [{ planLimit: 3 }] });
    mockTenantQuery.mockResolvedValue({ rows: [{ cnt: "3" }] });

    const req = { tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requirePlanLimit("employees")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PLAN_LIMIT_REACHED" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("throws on unknown resource name at factory time", () => {
    expect(() => requirePlanLimit("widgets")).toThrow("Unknown plan-limit resource");
  });
});

describe("requireActiveSubscription", () => {
  let requireActiveSubscription;
  let mockMasterQuery;

  beforeEach(() => {
    mockMasterQuery = vi.fn();
    injectCjsMock(MASTER_DB_PATH, { query: mockMasterQuery });
    removeCjsMock(PLAN_LIMITS_PATH);
    ({ requireActiveSubscription } = _require(PLAN_LIMITS_PATH));
    process.env.MULTI_TENANT = "1";
  });

  afterEach(() => {
    removeCjsMock(MASTER_DB_PATH);
    removeCjsMock(PLAN_LIMITS_PATH);
    delete process.env.MULTI_TENANT;
  });

  it("skips check for GET requests", async () => {
    const req = { method: "GET", path: "/api/sales", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockMasterQuery).not.toHaveBeenCalled();
  });

  it("skips check for /api/auth/ routes", async () => {
    const req = { method: "POST", path: "/api/auth/login", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockMasterQuery).not.toHaveBeenCalled();
  });

  it("returns 403 with SUBSCRIPTION_EXPIRED when status is 'expired'", async () => {
    mockMasterQuery.mockResolvedValue({ rows: [{ payment_status: "expired" }] });
    const req = { method: "POST", path: "/api/sales", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SUBSCRIPTION_EXPIRED" })
    );
  });

  it("calls next() when subscription is active (trial)", async () => {
    mockMasterQuery.mockResolvedValue({ rows: [{ payment_status: "trial" }] });
    const req = { method: "POST", path: "/api/sales", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
