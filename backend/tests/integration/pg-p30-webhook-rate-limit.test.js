/**
 * P30 — webhook routes must apply webhookLimiter
 *
 * Pre-fix: webhookLimiter is exported from middleware/rate-limit and
 * passed to registerWebhookRoutes via deps, but none of the four
 * webhook handlers (xpay/meta/whatsapp/daraz) actually wire it. A bad
 * actor can flood any of them with bogus payloads, burning HMAC-verify
 * CPU. Empirical proof in production (2026-04-30): 122 fake-sig POSTs
 * to /api/webhooks/xpay all returned 400 with no 429 — limiter never
 * fired.
 *
 * This test asserts the webhookLimiter passed in deps is invoked on
 * each of the four webhook routes. We mock the limiter as a counter
 * that returns 429 after N hits, and confirm the route honors it.
 */
const request = require("supertest");
const express = require("express");

describe("P30 — webhook routes apply webhookLimiter", () => {
  let app;
  let limiterCalls;

  beforeAll(() => {
    app = express();
    app.use(express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }));

    // Mock limiter — sends 429 after 3 hits
    limiterCalls = { xpay: 0, meta: 0, whatsapp: 0, daraz: 0 };
    const mockLimiter = (req, res, next) => {
      const path = req.path.split("/").pop();
      limiterCalls[path] = (limiterCalls[path] || 0) + 1;
      if (limiterCalls[path] > 3) {
        return res.status(429).json({ error: "Too many requests" });
      }
      next();
    };

    require("../../routes/webhooks")(app, {
      webhookLimiter: mockLimiter,
    });
  });

  for (const route of ["xpay", "meta", "whatsapp", "daraz"]) {
    it(`/api/webhooks/${route} invokes webhookLimiter on every request`, async () => {
      // 4th call should trip the mock limiter
      let lastRes;
      for (let i = 0; i < 4; i += 1) {
        // GET routes for meta/whatsapp don't have the limiter; only POST
        lastRes = await request(app)
          .post(`/api/webhooks/${route}`)
          .set("Content-Type", "application/json")
          .send({ event: "test", id: `p30-${i}` });
      }
      expect(limiterCalls[route]).toBeGreaterThanOrEqual(4);
      expect(lastRes.status).toBe(429);
    }, 10000);
  }
});
