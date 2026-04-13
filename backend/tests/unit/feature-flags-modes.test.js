import { describe, it, expect, vi, beforeEach } from "vitest";

describe("requireMode middleware", () => {
  let featureFlags;
  let mockDb;

  beforeEach(async () => {
    vi.resetModules();
    mockDb = { query: vi.fn() };
    featureFlags = await import("../../middleware/feature-flags.js");
    featureFlags.init({ db: mockDb, IS_MULTI_TENANT: false });
    featureFlags.invalidateModeCache();
  });

  it("calls next() when mode is enabled", async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ mode: "restaurant", enabled: true }],
    });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 503 when mode is not in the table", async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ mode: "appointments", enabled: true }],
    });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "restaurant" })
    );
  });

  it("falls through when tenant_modes table does not exist (backward compat)", async () => {
    mockDb.query.mockRejectedValueOnce(
      new Error('relation "tenant_modes" does not exist')
    );

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("falls through when modes map is empty (no modes configured)", async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("caches mode lookups", async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ mode: "restaurant", enabled: true }],
    });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    await featureFlags.requireMode("restaurant")(req, res, next);

    // Only one DB call — second hit used cache
    expect(mockDb.query).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("invalidateModeCache clears cache", async () => {
    mockDb.query.mockResolvedValue({
      rows: [{ mode: "restaurant", enabled: true }],
    });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    featureFlags.invalidateModeCache();
    await featureFlags.requireMode("restaurant")(req, res, next);

    // Two DB calls — cache was busted
    expect(mockDb.query).toHaveBeenCalledTimes(2);
  });
});
