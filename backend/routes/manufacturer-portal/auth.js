/**
 * Manufacturer portal auth endpoints (Tier 1.4).
 *
 * Mounted at /api/manufacturer-portal/auth BEFORE the tenant middleware chain.
 * Tenant is resolved per-request via resolvePublicTenantDb() using
 * ?tenant=slug (or x-tenant-slug header).
 *
 * Onboarding flow:
 *   1. Distributor admin creates a manufacturer_partner row + brand mapping
 *      via /api/manufacturer-partners (tenant-scoped admin route).
 *   2. Backend generates signup_token + sets signup_token_expires_at (7d)
 *      and enqueues `manufacturer_partner_invite` email containing a magic
 *      link: /manufacturer-portal/setup?token=<signup_token>&tenant=<slug>.
 *   3. Manufacturer clicks link, POSTs to /auth/setup with { token, password }.
 *      Backend hashes password, sets status='active', clears signup_token,
 *      issues access + refresh tokens.
 *   4. Subsequent visits: POST /auth/login with { email, password }.
 *
 * No OTP, no email verification — the signup-link click IS the verification.
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const express = require("express");

const { validate } = require("../../middleware/validate");
const { resolvePublicTenantDb } = require("../../services/public-tenant-context");
const {
  manufacturerPortalAuthLimiter,
} = require("../../middleware/rate-limit");
const {
  signManufacturerTokens,
  verifyManufacturerToken,
  hashRefreshToken,
} = require("../../middleware/manufacturer-auth");
const {
  setupSchema,
  loginSchema,
} = require("../../schemas/manufacturer-portal");

const BCRYPT_ROUNDS = 10;
const REFRESH_COOKIE_NAME = "sanopos_mfg_portal_refresh";

function setRefreshCookie(res, rawToken, expiresAt) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/manufacturer-portal/auth",
    expires: new Date(expiresAt),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/manufacturer-portal/auth",
  });
}

async function issueSession(db, partner, tenant, req, res) {
  const { accessToken, refreshToken, refreshHash, refreshExpiresAt } =
    signManufacturerTokens(partner, tenant);
  await db.query(
    `INSERT INTO manufacturer_portal_refresh_tokens
       (manufacturer_partner_id, token_hash, expires_at, user_agent, ip, last_used_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      partner.id,
      refreshHash,
      refreshExpiresAt,
      (req.headers["user-agent"] || "").slice(0, 400),
      req.ip || null,
    ]
  );
  await db.query(
    "UPDATE manufacturer_partners SET last_login_at = NOW() WHERE id = $1",
    [partner.id]
  );
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  return {
    access_token: accessToken,
    expires_in: 15 * 60,
    partner: {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      contact_name: partner.contact_name || null,
    },
  };
}

module.exports = function registerManufacturerPortalAuth(app, deps) {
  const router = express.Router();

  async function resolveOrFail(req, res) {
    const resolved = await resolvePublicTenantDb(req, deps);
    if (resolved.error) {
      res.status(resolved.status || 400).json({ error: resolved.error });
      return null;
    }
    return resolved;
  }

  // ── POST /setup ────────────────────────────────────────────────────
  // Claim a signup_token, set password, activate, issue session.
  router.post(
    "/setup",
    manufacturerPortalAuthLimiter,
    validate(setupSchema),
    async (req, res) => {
      try {
        const resolved = await resolveOrFail(req, res);
        if (!resolved) return;
        const { db, tenant } = resolved;
        const { token, password } = req.body;

        const { rows: [partner] } = await db.query(
          `SELECT id, name, email, contact_name, status, signup_token_expires_at
             FROM manufacturer_partners
            WHERE signup_token = $1
            LIMIT 1`,
          [token]
        );
        if (!partner) {
          return res.status(400).json({ error: "Invalid or expired setup link" });
        }
        if (
          partner.signup_token_expires_at &&
          new Date(partner.signup_token_expires_at) < new Date()
        ) {
          return res.status(400).json({ error: "Setup link has expired" });
        }
        if (partner.status === "suspended") {
          return res.status(403).json({ error: "Partner access suspended" });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const { rows: [updated] } = await db.query(
          `UPDATE manufacturer_partners
              SET password_hash = $2,
                  status = 'active',
                  email_verified_at = COALESCE(email_verified_at, NOW()),
                  signup_token = NULL,
                  signup_token_expires_at = NULL,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, email, contact_name`,
          [partner.id, passwordHash]
        );

        const session = await issueSession(db, updated, tenant, req, res);
        res.status(201).json(session);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── POST /login ────────────────────────────────────────────────────
  router.post(
    "/login",
    manufacturerPortalAuthLimiter,
    validate(loginSchema),
    async (req, res) => {
      try {
        const resolved = await resolveOrFail(req, res);
        if (!resolved) return;
        const { db, tenant } = resolved;
        const { email, password } = req.body;

        const { rows: [partner] } = await db.query(
          `SELECT id, name, email, contact_name, password_hash, status
             FROM manufacturer_partners
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1`,
          [email]
        );
        if (!partner || !partner.password_hash) {
          return res.status(401).json({ error: "Invalid email or password" });
        }
        const valid = await bcrypt.compare(password, partner.password_hash);
        if (!valid) {
          return res.status(401).json({ error: "Invalid email or password" });
        }
        if (partner.status === "suspended") {
          return res.status(403).json({ error: "Partner access suspended" });
        }
        if (partner.status !== "active") {
          return res
            .status(401)
            .json({ error: "Setup not complete. Use your invite link first." });
        }

        const session = await issueSession(db, partner, tenant, req, res);
        res.json(session);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── POST /refresh ──────────────────────────────────────────────────
  // Rotates the refresh token: old hash revoked, new pair issued + stored.
  router.post("/refresh", async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db, tenant } = resolved;

      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (!rawToken) return res.status(401).json({ error: "Missing refresh token" });

      let payload;
      try {
        payload = verifyManufacturerToken(rawToken);
      } catch {
        return res.status(401).json({ error: "Invalid refresh token" });
      }
      if (payload.type !== "refresh" || payload.scope !== "manufacturer") {
        return res.status(401).json({ error: "Invalid token type" });
      }
      if (Number(payload.tid) !== Number(tenant.id)) {
        return res.status(401).json({ error: "Token does not match tenant" });
      }

      const hash = hashRefreshToken(rawToken);
      const { rows: [stored] } = await db.query(
        `SELECT id, manufacturer_partner_id, revoked_at, expires_at
           FROM manufacturer_portal_refresh_tokens
          WHERE token_hash = $1`,
        [hash]
      );
      if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
        return res.status(401).json({ error: "Refresh token revoked or expired" });
      }

      await db.query(
        "UPDATE manufacturer_portal_refresh_tokens SET revoked_at = NOW() WHERE id = $1",
        [stored.id]
      );

      const { rows: [partner] } = await db.query(
        `SELECT id, name, email, contact_name, status
           FROM manufacturer_partners
          WHERE id = $1`,
        [stored.manufacturer_partner_id]
      );
      if (!partner) {
        return res.status(401).json({ error: "Partner not found" });
      }
      if (partner.status !== "active") {
        return res.status(403).json({ error: "Partner not active" });
      }

      const session = await issueSession(db, partner, tenant, req, res);
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /logout ───────────────────────────────────────────────────
  router.post("/logout", async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db } = resolved;
      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (rawToken) {
        const hash = hashRefreshToken(rawToken);
        await db.query(
          `UPDATE manufacturer_portal_refresh_tokens
              SET revoked_at = NOW()
            WHERE token_hash = $1 AND revoked_at IS NULL`,
          [hash]
        );
      }
      clearRefreshCookie(res);
      res.json({ status: "logged_out" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use("/api/manufacturer-portal/auth", router);
};
