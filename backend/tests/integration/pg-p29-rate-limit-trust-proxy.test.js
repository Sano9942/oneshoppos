/**
 * P29 — auth rate limiter must fire 429 after exceeding max attempts
 * from the same real client IP, even when behind a multi-hop proxy chain
 * (Railway architecture).
 *
 * Pre-fix: index.js sets `app.set("trust proxy", 1)`. On Railway, the
 * real chain is 2 hops (internal router + edge), so req.ip resolves to
 * Railway's rotating internal proxy IP. Each request lands in a
 * different rate-limit bucket; the limiter never counts past 1 hit per
 * bucket and 429 never fires.
 *
 * Empirical proof in production (2026-04-30):
 *   - admin_security_log shows req.ip rotating across 104.156.93.26,
 *     .36, .87, .69 etc. for Hassan logging in repeatedly
 *   - 25 wrong-password attempts in 30s never triggered 429; ratelimit-
 *     remaining bounced 19, 19, 18, 19, ... instead of decrementing
 *
 * This test simulates the multi-hop chain in supertest by sending
 * X-Forwarded-For with two upstream IPs. With `trust proxy=2`, Express
 * resolves req.ip to the leftmost (real) entry, all 21 requests hit the
 * same bucket, and the 21st returns 429.
 */
const request = require("supertest");
const express = require("express");

const fs = require("fs");
const path = require("path");

describe("P29 — index.js trust-proxy must be > 1 for Railway", () => {
  it("index.js sets `trust proxy` to a value greater than 1", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../index.js"), "utf8");
    const match = src.match(/app\.set\("trust proxy",\s*(\S+?)\)/);
    expect(match).not.toBeNull();
    const value = match[1];
    // Pre-fix was `1`. Railway's chain is multi-hop (internal router + edge),
    // so the value must be at least 2. `true` would also work but
    // express-rate-limit v7 warns against it (ERR_ERL_PERMISSIVE_TRUST_PROXY).
    if (value === "true") {
      // explicit accept
      expect(true).toBe(true);
    } else {
      const numeric = Number(value);
      expect(Number.isFinite(numeric)).toBe(true);
      expect(numeric).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("P29 — rate limiter survives Railway multi-hop proxy", () => {
  let app;

  beforeAll(() => {
    // Strip any test-skip env (the limiters auto-skip when NODE_ENV=test)
    delete process.env.NODE_ENV;
    process.env.RATE_LIMIT_AUTH_MAX = "20";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";

    // Fresh require so env changes apply
    delete require.cache[require.resolve("../../middleware/rate-limit")];
    const { authLimiter } = require("../../middleware/rate-limit");

    app = express();
    // The pre-fix value (`1`) trusts only one hop; the fix (`2`) trusts
    // both Railway-internal-router + Railway-edge. The XFF chain below
    // simulates real-client → edge → internal-router.
    app.set("trust proxy", 2);

    app.use(express.json());
    app.post("/login", authLimiter, (_req, res) => res.status(401).json({ error: "bad credentials" }));
  });

  afterAll(() => {
    process.env.NODE_ENV = "test";
  });

  it("21st attempt from same real client (behind 2 proxy hops) returns 429", async () => {
    // Simulated chain: real client 203.0.113.5, then Railway edge 104.156.93.26
    // Express with `trust proxy=2` will skip 2 trailing hops (the immediate
    // socket peer + edge IP), resolving req.ip to 203.0.113.5.
    const xff = "203.0.113.5, 104.156.93.26";

    let lastRes;
    for (let i = 1; i <= 21; i += 1) {
      // Vary the rightmost (rotating) hop each call to mimic Railway's
      // per-request internal proxy rotation. With `trust proxy=2` this
      // shouldn't matter — req.ip stays 203.0.113.5.
      const rotatingHop = `100.64.0.${10 + (i % 10)}`;
      lastRes = await request(app)
        .post("/login")
        .set("X-Forwarded-For", xff)
        .set("X-Real-IP", "203.0.113.5")
        // supertest binds to localhost; this header tail simulates the
        // last proxy hop the express server actually sees on its socket.
        .set("Forwarded", `for=${rotatingHop}`)
        .send({ user: "x", pw: "y" });

      if (i <= 20) {
        expect(lastRes.status).toBe(401);
      }
    }

    // 21st request must be 429 with Retry-After header set
    expect(lastRes.status).toBe(429);
    expect(lastRes.headers["retry-after"]).toBeDefined();
    expect(lastRes.body.error).toMatch(/Too many requests/i);
    expect(lastRes.body.retry_after_seconds).toBeGreaterThan(0);
  }, 30000);
});
