/**
 * 2-G.13 — Per-device Quick Grid.
 *
 * Covers:
 *  1. /api/pos-devices/register is idempotent on device_uuid, returns surrogate id
 *  2. POST /api/pos-layouts with scope_type='device' persists
 *  3. GET /api/pos-layouts cascade: device > employee > role > outlet > global
 *  4. Device-scoped layout does not leak to another outlet's device
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");

let app, db, deps, cleanup, req;

async function setFlag(key, enabled) {
  await db.query(
    "INSERT INTO feature_flags (key, enabled) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
    [key, enabled],
  );
  invalidateFeatureFlagCache();
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  // Apply the v72 DDL deltas directly — the test schema uses seed DDL from
  // schema-pg.sql, so pos_layouts already exists with the old CHECK.
  await db.query(`ALTER TABLE pos_layouts DROP CONSTRAINT IF EXISTS pos_layouts_scope_type_check`);
  await db.query(`
    ALTER TABLE pos_layouts
      ADD CONSTRAINT pos_layouts_scope_type_check
      CHECK (scope_type IN ('global','outlet','role','employee','device'))
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pos_device_registry (
      id SERIAL PRIMARY KEY,
      device_uuid TEXT UNIQUE NOT NULL,
      outlet_id INTEGER REFERENCES outlets(id),
      label TEXT,
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  require("../../routes/pos-layouts")(app, deps);
  require("../../routes/pos-devices")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  await setFlag("phase2_pos_layouts", true);
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("2-G.13 Per-device Quick Grid", () => {
  test("register is idempotent on device_uuid", async () => {
    const uuid = "dev-test-uuid-1";
    const first = await req.post("/api/pos-devices/register").send({
      device_uuid: uuid, outlet_id: 1, label: "Till 1",
    });
    expect(first.status).toBe(200);
    expect(first.body.device.id).toBeGreaterThan(0);
    const firstId = first.body.device.id;

    const second = await req.post("/api/pos-devices/register").send({
      device_uuid: uuid, outlet_id: 1,
    });
    expect(second.status).toBe(200);
    expect(second.body.device.id).toBe(firstId); // same surrogate
  });

  test("POST pos_layout with scope_type='device' persists", async () => {
    const dev = await req.post("/api/pos-devices/register").send({
      device_uuid: "dev-scope-test", outlet_id: 1, label: "Till 2",
    });
    const deviceId = dev.body.device.id;

    const res = await req.post("/api/pos-layouts").send({
      name: "Device tiles",
      scope_type: "device",
      scope_id: deviceId,
      layout_json: [{ product_id: 1, label: "Widget", color: "#FFAA00" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.layout.scope_type).toBe("device");
    expect(res.body.layout.scope_id).toBe(deviceId);
    expect(res.body.layout.layout_json).toEqual([
      { product_id: 1, label: "Widget", color: "#FFAA00" },
    ]);
  });

  test("cascade: device > employee > role > outlet > global", async () => {
    // Clear any existing layouts
    await db.query("DELETE FROM pos_layouts");

    // seed global + outlet + device layouts
    await db.query(
      `INSERT INTO pos_layouts (name, scope_type, scope_id, layout_json)
       VALUES ('global', 'global', NULL, '[{"label":"G"}]')`,
    );
    await db.query(
      `INSERT INTO pos_layouts (name, scope_type, scope_id, layout_json)
       VALUES ('outlet-1', 'outlet', 1, '[{"label":"O"}]')`,
    );

    const dev = await req.post("/api/pos-devices/register").send({
      device_uuid: "dev-cascade-test", outlet_id: 1,
    });
    const deviceId = dev.body.device.id;
    await db.query(
      `INSERT INTO pos_layouts (name, scope_type, scope_id, layout_json)
       VALUES ('device-one', 'device', $1, '[{"label":"D"}]')`,
      [deviceId],
    );

    // device hit → returns device layout
    const hit = await req.get(`/api/pos-layouts?outlet_id=1&device_id=${deviceId}`);
    expect(hit.status).toBe(200);
    expect(hit.body.layout.scope_type).toBe("device");
    expect(hit.body.layout.layout_json).toEqual([{ label: "D" }]);

    // no device_id → falls through to outlet
    const outletOnly = await req.get("/api/pos-layouts?outlet_id=1");
    expect(outletOnly.body.layout.scope_type).toBe("outlet");

    // outlet_id=2 with no device → global only
    const globalOnly = await req.get("/api/pos-layouts?outlet_id=2");
    expect(globalOnly.body.layout.scope_type).toBe("global");
  });

  test("device at outlet 1 does not leak to a device at outlet 2", async () => {
    await db.query("DELETE FROM pos_layouts");

    const dev1 = (await req.post("/api/pos-devices/register").send({
      device_uuid: "iso-outlet-1", outlet_id: 1,
    })).body.device;
    const dev2 = (await req.post("/api/pos-devices/register").send({
      device_uuid: "iso-outlet-2", outlet_id: 2,
    })).body.device;

    await db.query(
      `INSERT INTO pos_layouts (name, scope_type, scope_id, layout_json)
       VALUES ('dev1-tiles', 'device', $1, '[{"label":"one"}]')`,
      [dev1.id],
    );

    // Query as device 2 — must NOT see dev1's layout.
    const r2 = await req.get(`/api/pos-layouts?outlet_id=2&device_id=${dev2.id}`);
    expect(r2.status).toBe(200);
    // no device layout for dev2, no outlet/global either → null
    expect(r2.body.layout).toBeNull();

    // Query as device 1 — does see its own layout.
    const r1 = await req.get(`/api/pos-layouts?outlet_id=1&device_id=${dev1.id}`);
    expect(r1.body.layout.scope_type).toBe("device");
    expect(r1.body.layout.layout_json).toEqual([{ label: "one" }]);
  });

  test("GET /api/pos-devices lists registered devices", async () => {
    const res = await req.get("/api/pos-devices");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);
    // at least the devices we registered above
    expect(res.body.devices.length).toBeGreaterThanOrEqual(1);
  });
});
