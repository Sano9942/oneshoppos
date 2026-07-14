/**
 * pg-mode-gates.test.js — Verifies the 3-stage gate (mode → feature → perm)
 * added to rentals + rooms routes in wave-b. requireMode returns 403 (M29:
 * "mode off" is a permission-style refusal) with body.mode when a mode row is
 * disabled.
 *
 * requireMode is fail-closed (PLAN-V2 "Post-Gate-2 D5 follow-up"): an empty
 * tenant_modes map no longer falls through to the feature-flag + perm gates —
 * it refuses with 403 `code: "MODES_NOT_SEEDED"`, distinct from the plain
 * "mode is off" refusal so ops can tell a seeding failure from a normal one.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("wave-b mode gates — rentals + rooms", () => {
  let app, db, deps, cleanup;
  let featureFlags;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db });
    require("../../middleware/permissions");
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    require("../../routes/rentals")(app, deps);
    require("../../routes/rooms")(app, deps);
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const authHeaders = { "x-employee-id": "1" };

  async function clearModes() {
    await db.query("DELETE FROM tenant_modes");
    featureFlags.invalidateModeCache();
  }

  async function setMode(mode, enabled) {
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ($1, $2)
       ON CONFLICT (mode) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [mode, enabled]
    );
    featureFlags.invalidateModeCache();
  }

  it("a) fail-closed — empty tenant_modes → /api/rental-items returns 403 MODES_NOT_SEEDED", async () => {
    await clearModes();
    const res = await request(app).get("/api/rental-items").set(authHeaders);
    // Retires the D5 warn-and-pass fall-through: an unseeded tenant must refuse
    // rather than silently leave feature flags as the sole gate.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MODES_NOT_SEEDED");
    expect(res.body.mode).toBe("rentals");
  });

  it("a2) an unseeded tenant is distinguishable from a mode that is simply off", async () => {
    // The whole point of the distinct code: ops must be able to tell a seeding
    // failure from a legitimate refusal. Both are 403 — only `code` separates them.
    await clearModes();
    const unseeded = await request(app).get("/api/rental-items").set(authHeaders);

    await setMode("rentals", false);
    const modeOff = await request(app).get("/api/rental-items").set(authHeaders);

    expect(unseeded.status).toBe(modeOff.status);
    expect(unseeded.body.code).toBe("MODES_NOT_SEEDED");
    expect(modeOff.body.code).toBeUndefined();
  });

  it("b) mode disabled — rentals=false → /api/rental-items returns 403 with body.mode=rentals", async () => {
    await setMode("rentals", false);
    const res = await request(app).get("/api/rental-items").set(authHeaders);
    expect(res.status).toBe(403);
    expect(res.body.mode).toBe("rentals");
  });

  it("c) mode enabled — rentals=true → /api/rental-items returns 200", async () => {
    await setMode("rentals", true);
    const res = await request(app).get("/api/rental-items").set(authHeaders);
    expect(res.status).toBe(200);
  });

  it("d) rooms variant — mode room_management disabled → 403, enabled → 200", async () => {
    await clearModes();
    // Also re-seed rentals=true so the rentals route does not leak into rooms assertions.
    await setMode("rentals", true);
    await setMode("room_management", false);
    const disabled = await request(app).get("/api/room-types").set(authHeaders);
    expect(disabled.status).toBe(403);
    expect(disabled.body.mode).toBe("room_management");

    await setMode("room_management", true);
    const enabled = await request(app).get("/api/room-types").set(authHeaders);
    expect(enabled.status).toBe(200);
  });
});
