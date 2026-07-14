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

  it("returns 403 when mode is not in the table", async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ mode: "appointments", enabled: true }],
    });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "restaurant" })
    );
  });

  // Fail-closed (PLAN-V2 "Post-Gate-2 D5 follow-up"). These two cases used to
  // assert the warn-and-pass fall-through; that posture is retired. Both are
  // now MODES_NOT_SEEDED refusals rather than a silent pass that would leave
  // feature flags as the sole gate.

  it("refuses when the tenant_modes table does not exist", async () => {
    // getModesMap swallows the missing-relation error into {}, so requireMode's
    // own "does not exist" catch never sees this — the empty-map branch does.
    // A failed per-tenant migration on a live tenant therefore 403-storms,
    // which is fail-closed working as intended.
    mockDb.query.mockRejectedValueOnce(
      new Error('relation "tenant_modes" does not exist')
    );

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "MODES_NOT_SEEDED", mode: "restaurant" })
    );
  });

  it("refuses when the modes map is empty (never seeded)", async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await featureFlags.requireMode("restaurant")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "MODES_NOT_SEEDED", mode: "restaurant" })
    );
  });

  it("an unseeded tenant carries a code; a mode that is merely off does not", async () => {
    // Both refusals are 403 — `code` is the only thing that lets ops tell a
    // seeding failure from a legitimate "this mode is off". That distinction is
    // the entire reason the code exists, so pin it.
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    const unseededRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await featureFlags.requireMode("restaurant")({}, unseededRes, vi.fn());

    featureFlags.invalidateModeCache();
    mockDb.query.mockResolvedValueOnce({
      rows: [{ mode: "restaurant", enabled: false }],
    });
    const offRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await featureFlags.requireMode("restaurant")({}, offRes, vi.fn());

    expect(unseededRes.status).toHaveBeenCalledWith(403);
    expect(offRes.status).toHaveBeenCalledWith(403);
    expect(unseededRes.json.mock.calls[0][0].code).toBe("MODES_NOT_SEEDED");
    expect(offRes.json.mock.calls[0][0].code).toBeUndefined();
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
