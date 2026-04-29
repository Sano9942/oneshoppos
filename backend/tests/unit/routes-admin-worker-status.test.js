import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Unit test for routes/admin/system.js — GET /api/admin/worker-status.
//
// Pattern A Commit 4 — Phase 1 H2: the endpoint used to read only 3
// worker heartbeats (email, fbr, cleanup) even though the reservation,
// marketplace-sync, and booking-reminder workers already set their own
// globals. Super-admins could not see whether those workers were running.
//
// Commit 4 adds the 3 missing reads. Each new field in the response
// follows the existing workerInfo() shape so admin UI handling is uniform.

const registerSystemRoutes = require("../../routes/admin/system");

function buildApp() {
  const app = express();
  app.use(express.json());
  const deps = {
    db: { query: vi.fn() },
    // Auth middlewares are no-ops — we're testing the endpoint body, not auth.
    requireAllowedIp: (req, res, next) => next(),
    requireSuperAdmin: (req, res, next) => next(),
    logAdminAction: vi.fn(),
  };
  registerSystemRoutes(app, deps);
  return app;
}

// Capture + restore worker heartbeat globals around each test.
// Phase 5 P15 added subscription_grace + catalog_scheduler.
const GLOBAL_KEYS = [
  "__emailWorkerStatus",
  "__fbrWorkerStatus",
  "__cleanupWorkerStatus",
  "__reservationWorkerStatus",
  "__marketplaceSyncWorkerStatus",
  "__bookingReminderWorkerStatus",
  "__subscriptionGraceWorkerStatus",
  "__catalogSchedulerStatus",
];

let savedGlobals;

beforeEach(() => {
  savedGlobals = {};
  for (const k of GLOBAL_KEYS) {
    savedGlobals[k] = global[k];
    delete global[k];
  }
});

afterEach(() => {
  for (const k of GLOBAL_KEYS) {
    global[k] = savedGlobals[k];
  }
});

describe("GET /api/admin/worker-status", () => {
  it("returns all worker slots, all disabled when no globals set", async () => {
    const res = await request(buildApp()).get("/api/admin/worker-status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("email");
    expect(res.body).toHaveProperty("fbr");
    expect(res.body).toHaveProperty("cleanup");
    expect(res.body).toHaveProperty("reservation");
    expect(res.body).toHaveProperty("marketplace_sync");
    expect(res.body).toHaveProperty("booking_reminder");
    // Phase 5 P15 added these two — previously running but invisible.
    expect(res.body).toHaveProperty("subscription_grace");
    expect(res.body).toHaveProperty("catalog_scheduler");

    // Every slot is { enabled: false, running: false } when its heartbeat
    // global is unset.
    for (const key of Object.keys(res.body)) {
      expect(res.body[key]).toEqual({ enabled: false, running: false });
    }
  });

  it("reports subscription_grace as running when heartbeat is fresh", async () => {
    global.__subscriptionGraceWorkerStatus = {
      lastPollAt: Date.now() - 60_000, // 1 min ago — within hourly * 2.5 window
      processedToday: 1,
      queueDepth: 0,
    };
    const res = await request(buildApp()).get("/api/admin/worker-status");
    expect(res.body.subscription_grace.enabled).toBe(true);
    expect(res.body.subscription_grace.running).toBe(true);
    expect(res.body.subscription_grace.processed_today).toBe(1);
  });

  it("reports catalog_scheduler with 60s freshness window", async () => {
    global.__catalogSchedulerStatus = {
      lastPollAt: Date.now() - 30_000, // 30s ago — within 60s * 2.5
      processedToday: 0,
      queueDepth: 0,
    };
    const res = await request(buildApp()).get("/api/admin/worker-status");
    expect(res.body.catalog_scheduler.enabled).toBe(true);
    expect(res.body.catalog_scheduler.running).toBe(true);
  });

  it("reports reservation worker as running when its heartbeat is fresh", async () => {
    global.__reservationWorkerStatus = {
      lastPollAt: Date.now() - 10_000, // 10 seconds ago — well within 60s * 2.5
      processedToday: 5,
      queueDepth: 2,
    };
    const res = await request(buildApp()).get("/api/admin/worker-status");
    expect(res.status).toBe(200);
    expect(res.body.reservation.enabled).toBe(true);
    expect(res.body.reservation.running).toBe(true);
    expect(res.body.reservation.processed_today).toBe(5);
    expect(res.body.reservation.queue_depth).toBe(2);
    expect(res.body.reservation.last_poll_ago_seconds).toBeLessThanOrEqual(11);
  });

  it("reports marketplace_sync as not running when heartbeat is stale", async () => {
    // 5-minute poll interval × 2.5 = 750s freshness window.
    // Set lastPollAt to 2 hours ago to guarantee stale.
    global.__marketplaceSyncWorkerStatus = {
      lastPollAt: Date.now() - 2 * 60 * 60 * 1000,
      processedToday: 0,
      queueDepth: 0,
    };
    const res = await request(buildApp()).get("/api/admin/worker-status");
    expect(res.body.marketplace_sync.enabled).toBe(true);
    expect(res.body.marketplace_sync.running).toBe(false);
  });

  it("reports booking_reminder with correct freshness (5-minute poll)", async () => {
    global.__bookingReminderWorkerStatus = {
      lastPollAt: Date.now() - 60_000, // 60s ago — within 5min * 2.5
      processedToday: 3,
      queueDepth: 0,
    };
    const res = await request(buildApp()).get("/api/admin/worker-status");
    expect(res.body.booking_reminder.enabled).toBe(true);
    expect(res.body.booking_reminder.running).toBe(true);
    expect(res.body.booking_reminder.processed_today).toBe(3);
  });

  it("reports all three pre-existing workers alongside the new ones", async () => {
    global.__emailWorkerStatus = { lastPollAt: Date.now(), processedToday: 10, queueDepth: 1 };
    global.__fbrWorkerStatus = { lastPollAt: Date.now(), processedToday: 20, queueDepth: 0 };
    global.__cleanupWorkerStatus = { lastPollAt: Date.now(), processedToday: 0, queueDepth: 0 };
    global.__reservationWorkerStatus = { lastPollAt: Date.now(), processedToday: 7, queueDepth: 0 };
    global.__marketplaceSyncWorkerStatus = { lastPollAt: Date.now(), processedToday: 12, queueDepth: 0 };
    global.__bookingReminderWorkerStatus = { lastPollAt: Date.now(), processedToday: 4, queueDepth: 0 };

    const res = await request(buildApp()).get("/api/admin/worker-status");
    expect(res.status).toBe(200);
    // All six should report as running.
    expect(res.body.email.running).toBe(true);
    expect(res.body.fbr.running).toBe(true);
    expect(res.body.cleanup.running).toBe(true);
    expect(res.body.reservation.running).toBe(true);
    expect(res.body.marketplace_sync.running).toBe(true);
    expect(res.body.booking_reminder.running).toBe(true);
  });
});
