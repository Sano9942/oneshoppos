/**
 * pg-mode-gates.test.js — Verifies the 3-stage gate (mode → feature → perm)
 * added to rentals + rooms routes in wave-b. requireMode returns 403 (M29:
 * "mode off" is a permission-style refusal) with body.mode when a mode row is
 * disabled. Empty tenant_modes still falls through to feature-flag + perm gates
 * (D5 / PLAN-V2 Step 5 warn-and-pass posture — no longer expected for a live
 * tenant, but retained for one release).
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

  it("a) backward compat — empty tenant_modes → /api/rental-items does NOT return 503 mode error", async () => {
    await clearModes();
    const res = await request(app).get("/api/rental-items").set(authHeaders);
    // Must not be the 503-with-mode-error shape (either 200, or a different error)
    if (res.status === 503) {
      expect(res.body.mode).toBeUndefined();
    } else {
      expect(res.status).toBe(200);
    }
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
