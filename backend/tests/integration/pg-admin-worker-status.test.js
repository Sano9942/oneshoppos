/**
 * pg-admin-worker-status.test.js
 *
 * GET /api/admin/worker-status — env-gate drift detection.
 *
 * Verifies that the endpoint merges the boot-time worker gate registry
 * (global.__workerRegistry, built by boot/workers.js recordGate) into each
 * worker's status so the panel can distinguish:
 *   - env_var_missing      (code gate exists, env var never set)
 *   - enabled_but_stopped  (env on, no heartbeat/completion in 2.5× interval)
 *   - register_failed      (env on, pg-boss registration threw)
 * plus the recordGate() semantics themselves (default-on, opt-out).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const request = require("supertest");
const express = require("express");
const dbPg = require("../../db-pg");
const { recordGate } = require("../../boot/workers");

const requireAllowedIp = (req, res, next) => next();
const requireSuperAdmin = (req, res, next) => {
  if (req.headers["x-admin-test"] === "ok") return next();
  return res.status(401).json({ error: "Super-admin required" });
};

let app;
let savedRegistry;
let savedEmailStatus;

beforeAll(async () => {
  savedRegistry = global.__workerRegistry;
  savedEmailStatus = global.__emailWorkerStatus;

  app = express();
  app.use(express.json());
  require("../../routes/admin/system")(app, {
    db: dbPg,
    requireAllowedIp,
    requireSuperAdmin,
    logAdminAction: () => {},
  });
});

afterAll(async () => {
  global.__workerRegistry = savedRegistry;
  global.__emailWorkerStatus = savedEmailStatus;
  await dbPg.end();
});

describe("recordGate semantics", () => {
  beforeEach(() => {
    global.__workerRegistry = {};
  });

  test("opt-in gate: unset env var → disabled, env_value null", () => {
    delete process.env.__TEST_GATE_A;
    expect(recordGate("gate_a", "__TEST_GATE_A")).toBe(false);
    const entry = global.__workerRegistry.gate_a;
    expect(entry.env_enabled).toBe(false);
    expect(entry.env_value).toBe(null);
    expect(entry.registered).toBe(false);
  });

  test("opt-in gate: '1' enables", () => {
    process.env.__TEST_GATE_B = "1";
    expect(recordGate("gate_b", "__TEST_GATE_B")).toBe(true);
    delete process.env.__TEST_GATE_B;
  });

  test("default-on gate: unset → enabled, '0' disables", () => {
    delete process.env.__TEST_GATE_C;
    expect(recordGate("gate_c", "__TEST_GATE_C", { defaultOn: true })).toBe(true);
    process.env.__TEST_GATE_C = "0";
    expect(recordGate("gate_c", "__TEST_GATE_C", { defaultOn: true })).toBe(false);
    delete process.env.__TEST_GATE_C;
  });

  test("opt-out gate: unset → enabled, '1' disables", () => {
    delete process.env.__TEST_GATE_D;
    expect(recordGate("gate_d", "__TEST_GATE_D", { optOut: true })).toBe(true);
    process.env.__TEST_GATE_D = "1";
    expect(recordGate("gate_d", "__TEST_GATE_D", { optOut: true })).toBe(false);
    delete process.env.__TEST_GATE_D;
  });
});

describe("GET /api/admin/worker-status", () => {
  beforeEach(() => {
    global.__workerRegistry = {
      email: {
        env_var: "EMAIL_WORKER_ENABLED", env_value: "1", env_enabled: true,
        default_on: false, opt_out: false, kind: "pg-boss",
        registered: true, register_error: null,
      },
      shift_auto_close: {
        env_var: "SHIFT_AUTO_CLOSE_WORKER_ENABLED", env_value: null, env_enabled: false,
        default_on: false, opt_out: false, kind: "pg-boss",
        registered: false, register_error: null,
      },
      recall: {
        env_var: "RECALL_WORKER_ENABLED", env_value: "1", env_enabled: true,
        default_on: false, opt_out: false, kind: "pg-boss",
        registered: true, register_error: null,
      },
      fbr: {
        env_var: "FBR_WORKER_ENABLED", env_value: "1", env_enabled: true,
        default_on: false, opt_out: false, kind: "pg-boss",
        registered: false, register_error: "boom",
      },
    };
    global.__emailWorkerStatus = { lastPollAt: Date.now(), processedToday: 7, queueDepth: 2 };
    global.__recallWorkerStatus = null;
    global.__fbrWorkerStatus = null;
  });

  test("requires super-admin auth", async () => {
    const res = await request(app).get("/api/admin/worker-status");
    expect(res.status).toBe(401);
  });

  test("healthy worker: enabled + running + env fields from registry", async () => {
    const res = await request(app).get("/api/admin/worker-status").set("x-admin-test", "ok");
    expect(res.status).toBe(200);
    const email = res.body.email;
    expect(email.enabled).toBe(true);
    expect(email.running).toBe(true);
    expect(email.env_var).toBe("EMAIL_WORKER_ENABLED");
    expect(email.registered).toBe(true);
    expect(email.alert).toBe(null);
    expect(email.processed_today).toBe(7);
  });

  test("env var never set → alert env_var_missing, enabled false", async () => {
    const res = await request(app).get("/api/admin/worker-status").set("x-admin-test", "ok");
    const w = res.body.shift_auto_close;
    expect(w.enabled).toBe(false);
    expect(w.env_var).toBe("SHIFT_AUTO_CLOSE_WORKER_ENABLED");
    expect(w.alert).toBe("env_var_missing");
  });

  test("enabled but no heartbeat/completion → alert enabled_but_stopped", async () => {
    const res = await request(app).get("/api/admin/worker-status").set("x-admin-test", "ok");
    const w = res.body.recall;
    expect(w.enabled).toBe(true);
    expect(w.running).toBe(false);
    // recall may have real completed pgboss jobs when running against a shared
    // DB; only assert the alert when no completion exists.
    if (!w.last_poll_at) expect(w.alert).toBe("enabled_but_stopped");
  });

  test("registration threw → alert register_failed", async () => {
    const res = await request(app).get("/api/admin/worker-status").set("x-admin-test", "ok");
    const w = res.body.fbr;
    // register_failed takes precedence over enabled_but_stopped and is
    // independent of heartbeat state.
    expect(w.alert).toBe("register_failed");
    expect(w.register_error).toBe("boom");
  });

  test("includes previously invisible workers", async () => {
    const res = await request(app).get("/api/admin/worker-status").set("x-admin-test", "ok");
    expect(res.body).toHaveProperty("orphan_schema_scan");
    expect(res.body).toHaveProperty("shopify_sync");
    expect(res.body).toHaveProperty("report_schedule");
  });

  test("workers absent from registry (old-boot fallback) keep legacy inference", async () => {
    const res = await request(app).get("/api/admin/worker-status").set("x-admin-test", "ok");
    const w = res.body.catalog_scheduler; // not in the fake registry
    expect(w).toHaveProperty("enabled");
    expect(w.env_var).toBe(null);
    expect(w.alert).toBe(null);
  });
});
