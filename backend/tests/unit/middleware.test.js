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
//
// WHY require.cache injection instead of vi.doMock():
//
// plan-limits.js calls require("../master-db-pg") and require("../tenant-db-manager-pg")
// INLINE inside the middleware closure bodies — not at module top-level.  Those inline
// require() calls hit Node's native CJS module cache at runtime, which is invisible to
// Vitest's ESM mock registry.  vi.doMock() + dynamic import() only intercepts Vite's
// ESM transform layer; it cannot redirect a CJS inline require() that fires inside an
// already-loaded function closure.
//
// The require.cache injection pattern below directly replaces the CJS cache entry so
// that the inline require() inside the closure picks up our stub.  This is the only
// reliable approach without rewriting plan-limits.js to hoist its requires.

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

// ── feature-flags middleware ──────────────────────────────────────────────────
//
// feature-flags.js uses module.exports (CJS) with an init() dependency injection
// pattern.  We load it via createRequire, call init() with a mock db, then call
// invalidateFeatureFlagCache() before each test so the per-tenant in-memory
// cache cannot bleed between tests.

const FEATURE_FLAGS_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  "../../..",
  "middleware/feature-flags.js"
);

describe("requireFeature", () => {
  let requireFeature;
  let invalidateFeatureFlagCache;
  let DEFAULT_FEATURE_FLAGS;
  let mockDbQuery;

  beforeEach(() => {
    // Always reload the module fresh so module-level cache state is clean
    removeCjsMock(FEATURE_FLAGS_PATH);
    delete _require.cache[FEATURE_FLAGS_PATH];
    ({
      requireFeature,
      invalidateFeatureFlagCache,
      DEFAULT_FEATURE_FLAGS,
    } = _require(FEATURE_FLAGS_PATH));

    // Inject a mock db that returns no rows (feature_flags table empty — defaults apply)
    mockDbQuery = vi.fn().mockResolvedValue({ rows: [] });
    // init() injects the db dependency
    _require(FEATURE_FLAGS_PATH).init({ db: { query: mockDbQuery }, IS_MULTI_TENANT: false });

    // Clear the in-memory cache so defaults are recalculated each test
    invalidateFeatureFlagCache();
  });

  afterEach(() => {
    delete _require.cache[FEATURE_FLAGS_PATH];
  });

  it("calls next() when flag is enabled by default (accounting_core = true)", async () => {
    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireFeature("accounting_core")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when flag is disabled by default (phase2_outlet_pricing = false)", async () => {
    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireFeature("phase2_outlet_pricing")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ flag: "phase2_outlet_pricing" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for a completely unknown flag key (not in DEFAULT_FEATURE_FLAGS)", async () => {
    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireFeature("nonexistent_flag")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when DB row overrides a default-false flag to true", async () => {
    // Simulate DB returning phase2_outlet_pricing = true
    mockDbQuery.mockResolvedValue({
      rows: [{ key: "phase2_outlet_pricing", enabled: true }],
    });
    invalidateFeatureFlagCache(); // ensure fresh DB fetch

    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireFeature("phase2_outlet_pricing")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("DEFAULT_FEATURE_FLAGS exports are all booleans", () => {
    for (const [key, val] of Object.entries(DEFAULT_FEATURE_FLAGS)) {
      expect(typeof val, `DEFAULT_FEATURE_FLAGS["${key}"] should be boolean`).toBe("boolean");
    }
  });

  it("invalidateFeatureFlagCache() clears all cached entries", async () => {
    // Prime the cache with one call
    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireFeature("accounting_core")(req, res, next);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);

    // Second call should hit cache (no additional DB query)
    const next2 = vi.fn();
    await requireFeature("accounting_core")(req, { status: vi.fn().mockReturnThis(), json: vi.fn() }, next2);
    expect(mockDbQuery).toHaveBeenCalledTimes(1); // still 1

    // After invalidation, next call should re-query DB
    invalidateFeatureFlagCache();
    const next3 = vi.fn();
    await requireFeature("accounting_core")(req, { status: vi.fn().mockReturnThis(), json: vi.fn() }, next3);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });
});

// ── upload-validation middleware ──────────────────────────────────────────────

const UPLOAD_VALIDATION_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  "../../..",
  "middleware/upload-validation.js"
);

const {
  imageFileFilter,
  safeExtension,
  ALLOWED_IMAGE_MIMES,
} = _require(UPLOAD_VALIDATION_PATH);

describe("imageFileFilter", () => {
  function makeFile(mimetype, originalname = "photo.jpg") {
    return { mimetype, originalname };
  }

  it("accepts image/jpeg", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/jpeg", "test.jpg"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("accepts image/png", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/png", "test.png"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("accepts image/webp", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/webp", "test.webp"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("accepts image/gif", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/gif", "test.gif"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("accepts image/svg+xml", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/svg+xml", "logo.svg"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("rejects application/pdf", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("application/pdf", "doc.pdf"), cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][0].message).toMatch(/image/i);
  });

  it("rejects a mismatched extension (.exe on image/jpeg)", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/jpeg", "virus.exe"), cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][0].message).toContain(".exe");
  });

  it("rejects null file", () => {
    const cb = vi.fn();
    imageFileFilter({}, null, cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][0].message).toContain("Invalid file");
  });

  it("rejects file with no mimetype", () => {
    const cb = vi.fn();
    imageFileFilter({}, { originalname: "test.jpg" }, cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("accepts jpeg with no extension (empty originalname)", () => {
    // ext will be "" — the extension check is skipped (ext is falsy), MIME passes
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/jpeg", "noextension"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });
});

describe("safeExtension", () => {
  it("returns original .jpg extension when it is in the allowlist", () => {
    expect(safeExtension("photo.jpg", "image/jpeg")).toBe(".jpg");
  });

  it("returns original .png extension when it is in the allowlist", () => {
    expect(safeExtension("logo.png", "image/png")).toBe(".png");
  });

  it("returns original .webp extension when it is in the allowlist", () => {
    expect(safeExtension("banner.webp", "image/webp")).toBe(".webp");
  });

  it("falls back to MIME-derived .jpg when filename has no extension", () => {
    expect(safeExtension("filename", "image/jpeg")).toBe(".jpg");
  });

  it("falls back to MIME-derived .webp when originalname is empty string", () => {
    expect(safeExtension("", "image/webp")).toBe(".webp");
  });

  it("falls back to .png for an unknown MIME type", () => {
    expect(safeExtension("file.bin", "application/octet-stream")).toBe(".png");
  });

  it("falls back to MIME-derived ext when extension is not in allowlist (.dat)", () => {
    // .dat is not in ALLOWED_IMAGE_EXTS, so falls back to MIME map
    expect(safeExtension("upload.dat", "image/gif")).toBe(".gif");
  });
});

describe("ALLOWED_IMAGE_MIMES", () => {
  it("is a Set", () => {
    expect(ALLOWED_IMAGE_MIMES).toBeInstanceOf(Set);
  });

  it("contains the standard web image types", () => {
    expect(ALLOWED_IMAGE_MIMES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_IMAGE_MIMES.has("image/png")).toBe(true);
    expect(ALLOWED_IMAGE_MIMES.has("image/webp")).toBe(true);
    expect(ALLOWED_IMAGE_MIMES.has("image/gif")).toBe(true);
  });

  it("does not contain application/pdf", () => {
    expect(ALLOWED_IMAGE_MIMES.has("application/pdf")).toBe(false);
  });
});
