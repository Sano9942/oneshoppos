"use strict";

/**
 * Activation guard on POST /api/integrations/connect (PLAN-V3 Step W0a2).
 *
 * Why this exists: /connect hardcodes `is_active = true`. Once the Meta webhooks
 * became fail-closed, activating a Meta channel while the app secret is missing
 * produces the worst possible state — the connection looks healthy in the hub and
 * silently drops every inbound order/message, because each delivery 401s. The
 * guard refuses activation instead.
 *
 * Note the asymmetry this pins: the Meta secret is OURS (an app-level env var),
 * so the guard is a platform-config check. Providers whose secret is per-tenant
 * (foodpanda/Careem carry their own webhook_secret in the request) are NOT gated
 * here, and neither is any unsigned channel — asserting that keeps a future
 * "tighten the guard" change from accidentally blocking every provider.
 *
 * Mounted on a mini-express with stubbed deps (house pattern — see
 * routes-orders-transactions.test.js): no DB, no auth.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const registerCredentialRoutes = require("../../routes/integrations/credentials");

const ENV_KEYS = ["META_APP_SECRET", "WHATSAPP_APP_SECRET"];
let saved;
let inserted;

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  inserted = [];
  registerCredentialRoutes(router, {
    db: {
      query: async (sql, params) => {
        inserted.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    },
    requireAnyPerm: () => (req, res, next) => next(),
    requireFeature: () => (req, res, next) => next(),
    encryptSecret: (v) => `enc:v1:${v}`,
    decryptSecret: (v) => v,
    maskSecret: (v) => v,
  });

  app.use("/api/integrations", router);
  return app;
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("POST /connect — Meta activation guard", () => {
  for (const provider of ["facebook", "whatsapp"]) {
    it(`refuses to activate ${provider} when no app secret is configured`, async () => {
      const res = await request(buildApp())
        .post("/api/integrations/connect")
        .send({ provider, oauth_token: "tok-123" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("WEBHOOK_SECRET_NOT_CONFIGURED");
      // The load-bearing assertion: it must refuse BEFORE writing the row, or
      // the tenant ends up with is_active = true anyway.
      expect(inserted).toHaveLength(0);
    });

    it(`allows ${provider} once the app secret is configured`, async () => {
      process.env.META_APP_SECRET = "app-secret";
      const res = await request(buildApp())
        .post("/api/integrations/connect")
        .send({ provider, oauth_token: "tok-123" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: true, provider });
      expect(inserted.length).toBeGreaterThan(0);
    });
  }

  it("lets the WhatsApp-specific secret alone satisfy WhatsApp but not Facebook", async () => {
    process.env.WHATSAPP_APP_SECRET = "wa-secret";

    const wa = await request(buildApp())
      .post("/api/integrations/connect")
      .send({ provider: "whatsapp", oauth_token: "t" });
    expect(wa.status).toBe(200);

    const fb = await request(buildApp())
      .post("/api/integrations/connect")
      .send({ provider: "facebook", oauth_token: "t" });
    expect(fb.status).toBe(409);
  });

  it("does NOT gate providers whose webhook secret is per-tenant or unsigned", async () => {
    // No META_APP_SECRET set — these must still connect. A guard that catches
    // them would break foodpanda/Careem (they supply their own webhook_secret)
    // and every non-Meta channel.
    for (const provider of ["foodpanda", "careem", "daraz", "google_merchant"]) {
      const res = await request(buildApp())
        .post("/api/integrations/connect")
        .send({ provider, api_key: "k", webhook_secret: "s" });
      expect(res.status, `${provider} must not be gated by the Meta guard`).toBe(200);
    }
  });
});
