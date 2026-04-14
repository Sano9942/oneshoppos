/**
 * Customer portal auth endpoints (M8).
 *
 * Mounted at /api/portal/auth BEFORE the tenant middleware chain.
 * Tenant is resolved per-request via resolvePublicTenantDb() using
 * ?tenant=slug (or x-tenant-slug header).
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const { validate } = require("../../middleware/validate");
const { resolvePublicTenantDb } = require("../../services/public-tenant-context");
const {
  customerPortalAuthLimiter,
  customerPortalOtpLimiter,
} = require("../../middleware/rate-limit");
const {
  signCustomerTokens,
  verifyCustomerToken,
  hashRefreshToken,
} = require("../../middleware/customer-auth");
const {
  loginSchema,
  signupSchema,
  requestOtpSchema,
  verifyOtpSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} = require("../../schemas/customer-portal");

const OTP_TTL_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;
const REFRESH_COOKIE_NAME = "sanopos_portal_refresh";

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function setRefreshCookie(res, rawToken, expiresAt) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/portal/auth",
    expires: new Date(expiresAt),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/portal/auth",
  });
}

async function issueSession(db, customer, tenant, req, res) {
  const { accessToken, refreshToken, refreshHash, refreshExpiresAt } = signCustomerTokens(customer, tenant);
  await db.query(
    `INSERT INTO customer_portal_refresh_tokens
       (customer_id, token_hash, expires_at, user_agent, ip, last_used_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      customer.id,
      refreshHash,
      refreshExpiresAt,
      (req.headers["user-agent"] || "").slice(0, 400),
      req.ip || null,
    ]
  );
  await db.query(
    "UPDATE customers SET portal_last_login_at = NOW() WHERE id = $1",
    [customer.id]
  );
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  return {
    access_token: accessToken,
    expires_in: 30 * 60,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      mobile: customer.mobile || null,
      email_verified: !!customer.portal_email_verified_at,
    },
  };
}

async function enqueuePortalEmail(db, tenant, type, toEmail, data) {
  try {
    const { enqueueEmail } = require("../../services/email");
    await enqueueEmail(db, {
      tenantId: tenant.id,
      type,
      to: toEmail,
      tenant: { slug: tenant.slug, name: tenant.name || tenant.slug },
      data,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[portal-auth] enqueue ${type} failed:`, err.message);
  }
}

function tenantPortalUrl(tenant) {
  const base = (process.env.FRONTEND_URL || "https://sanopos.com").replace(/\/$/, "");
  return `${base}/portal/${encodeURIComponent(tenant.slug)}`;
}

module.exports = function registerCustomerPortalAuth(app, deps) {
  const router = express.Router();

  // Helper: resolve tenant + DB for every route (public endpoints).
  async function resolveOrFail(req, res) {
    const resolved = await resolvePublicTenantDb(req, deps);
    if (resolved.error) {
      res.status(resolved.status || 400).json({ error: resolved.error });
      return null;
    }
    return resolved;
  }

  // ── POST /login ───────────────────────────────────────────────────
  router.post("/login", customerPortalAuthLimiter, validate(loginSchema), async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db, tenant } = resolved;
      const { email, password } = req.body;

      const { rows: [customer] } = await db.query(
        `SELECT id, name, email, mobile, portal_password_hash, portal_enabled_at, portal_email_verified_at
         FROM customers
         WHERE LOWER(email) = LOWER($1) AND portal_enabled_at IS NOT NULL AND deleted_at IS NULL
         LIMIT 1`,
        [email]
      );
      if (!customer || !customer.portal_password_hash) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const valid = await bcrypt.compare(password, customer.portal_password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const session = await issueSession(db, customer, tenant, req, res);
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /signup ──────────────────────────────────────────────────
  // Creates OR attaches to an existing un-enabled customer row.
  // The portal is not usable until /verify-email succeeds.
  router.post("/signup", customerPortalAuthLimiter, validate(signupSchema), async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db, tenant } = resolved;
      const { email, password, name, mobile } = req.body;

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // If a customer exists with this email who already has portal enabled, refuse.
      const { rows: [existingEnabled] } = await db.query(
        `SELECT id FROM customers
         WHERE LOWER(email) = LOWER($1) AND portal_enabled_at IS NOT NULL AND deleted_at IS NULL
         LIMIT 1`,
        [email]
      );
      if (existingEnabled) {
        return res.status(409).json({ error: "An account already exists for this email" });
      }

      // Otherwise attach to an unenabled row, or create a new one.
      const { rows: [existingRow] } = await db.query(
        `SELECT id FROM customers
         WHERE LOWER(email) = LOWER($1) AND portal_enabled_at IS NULL AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1`,
        [email]
      );

      let customerId;
      if (existingRow) {
        customerId = existingRow.id;
        await db.query(
          `UPDATE customers
             SET name = COALESCE(NULLIF($2,''), name),
                 mobile = COALESCE($3, mobile),
                 portal_password_hash = $4
           WHERE id = $1`,
          [customerId, name, mobile || null, passwordHash]
        );
      } else {
        const { rows: [created] } = await db.query(
          `INSERT INTO customers (name, email, mobile, portal_password_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [name, email, mobile || null, passwordHash]
        );
        customerId = created.id;
      }

      // Fire email-verify OTP.
      const code = generateOtp();
      await db.query(
        `INSERT INTO customer_portal_otps (customer_id, email, code_hash, purpose, expires_at, ip)
         VALUES ($1, $2, $3, 'email_verify', NOW() + INTERVAL '15 minutes', $4)`,
        [customerId, email, hashOtp(code), req.ip || null]
      );

      await enqueuePortalEmail(db, tenant, "customer_portal_email_verify", email, {
        storeName: tenant.name || tenant.slug,
        customerName: name,
        code,
        portalUrl: tenantPortalUrl(tenant),
      });

      res.status(201).json({
        status: "verify_email_sent",
        message: "Check your email for the verification code.",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /verify-email ────────────────────────────────────────────
  // Consumes an email_verify OTP, flips portal_enabled_at, issues session.
  router.post("/verify-email", customerPortalOtpLimiter, validate(verifyEmailSchema), async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db, tenant } = resolved;
      const { email, code } = req.body;

      const { rows: [otp] } = await db.query(
        `SELECT id, customer_id FROM customer_portal_otps
         WHERE LOWER(email) = LOWER($1) AND purpose = 'email_verify'
           AND used_at IS NULL AND expires_at > NOW() AND code_hash = $2
         ORDER BY id DESC LIMIT 1`,
        [email, hashOtp(code)]
      );
      if (!otp) return res.status(400).json({ error: "Invalid or expired code" });

      await db.query("UPDATE customer_portal_otps SET used_at = NOW() WHERE id = $1", [otp.id]);

      const { rows: [customer] } = await db.query(
        `UPDATE customers
            SET portal_enabled_at = COALESCE(portal_enabled_at, NOW()),
                portal_email_verified_at = NOW()
          WHERE id = $1
          RETURNING id, name, email, mobile, portal_email_verified_at`,
        [otp.customer_id]
      );
      if (!customer) return res.status(404).json({ error: "Customer not found" });

      // Send welcome email now that portal is enabled.
      await enqueuePortalEmail(db, tenant, "customer_portal_welcome", customer.email, {
        storeName: tenant.name || tenant.slug,
        customerName: customer.name,
        portalUrl: tenantPortalUrl(tenant),
      });

      const session = await issueSession(db, customer, tenant, req, res);
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /request-otp ─────────────────────────────────────────────
  // Login or verify codes — silently succeeds for unknown emails.
  router.post("/request-otp", customerPortalOtpLimiter, validate(requestOtpSchema), async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db, tenant } = resolved;
      const { email, purpose } = req.body;

      const { rows: [customer] } = await db.query(
        `SELECT id, name FROM customers
         WHERE LOWER(email) = LOWER($1) AND portal_enabled_at IS NOT NULL AND deleted_at IS NULL
         LIMIT 1`,
        [email]
      );

      if (customer) {
        const code = generateOtp();
        await db.query(
          `INSERT INTO customer_portal_otps (customer_id, email, code_hash, purpose, expires_at, ip)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '15 minutes', $5)`,
          [customer.id, email, hashOtp(code), purpose, req.ip || null]
        );
        const templateType =
          purpose === "password_reset"
            ? "customer_portal_password_reset"
            : "customer_portal_otp_login";
        await enqueuePortalEmail(db, tenant, templateType, email, {
          storeName: tenant.name || tenant.slug,
          customerName: customer.name,
          code,
          portalUrl: tenantPortalUrl(tenant),
        });
      }

      // Always respond success to prevent enumeration.
      res.json({ status: "sent" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /verify-otp ──────────────────────────────────────────────
  // Consumes a login OTP and returns a session (password-less login).
  router.post("/verify-otp", customerPortalOtpLimiter, validate(verifyOtpSchema), async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db, tenant } = resolved;
      const { email, code, purpose } = req.body;

      if (purpose !== "login") {
        return res.status(400).json({ error: "Use /verify-email or /reset-password for this purpose" });
      }

      const { rows: [otp] } = await db.query(
        `SELECT id, customer_id FROM customer_portal_otps
         WHERE LOWER(email) = LOWER($1) AND purpose = 'login'
           AND used_at IS NULL AND expires_at > NOW() AND code_hash = $2
         ORDER BY id DESC LIMIT 1`,
        [email, hashOtp(code)]
      );
      if (!otp) return res.status(400).json({ error: "Invalid or expired code" });
      await db.query("UPDATE customer_portal_otps SET used_at = NOW() WHERE id = $1", [otp.id]);

      const { rows: [customer] } = await db.query(
        `SELECT id, name, email, mobile, portal_email_verified_at
         FROM customers WHERE id = $1 AND deleted_at IS NULL`,
        [otp.customer_id]
      );
      if (!customer) return res.status(404).json({ error: "Customer not found" });

      const session = await issueSession(db, customer, tenant, req, res);
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /refresh ─────────────────────────────────────────────────
  // Rotates the refresh token (old hash is revoked, new one stored).
  router.post("/refresh", async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db, tenant } = resolved;

      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (!rawToken) return res.status(401).json({ error: "Missing refresh token" });

      let payload;
      try {
        payload = verifyCustomerToken(rawToken);
      } catch {
        return res.status(401).json({ error: "Invalid refresh token" });
      }
      if (payload.type !== "refresh" || payload.scope !== "customer") {
        return res.status(401).json({ error: "Invalid token type" });
      }
      if (Number(payload.tid) !== Number(tenant.id)) {
        return res.status(401).json({ error: "Token does not match tenant" });
      }

      const hash = hashRefreshToken(rawToken);
      const { rows: [stored] } = await db.query(
        `SELECT id, customer_id, revoked_at, expires_at
         FROM customer_portal_refresh_tokens WHERE token_hash = $1`,
        [hash]
      );
      if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
        return res.status(401).json({ error: "Refresh token revoked or expired" });
      }

      // Revoke the old row.
      await db.query(
        "UPDATE customer_portal_refresh_tokens SET revoked_at = NOW() WHERE id = $1",
        [stored.id]
      );

      const { rows: [customer] } = await db.query(
        `SELECT id, name, email, mobile, portal_email_verified_at
         FROM customers WHERE id = $1 AND deleted_at IS NULL`,
        [stored.customer_id]
      );
      if (!customer) return res.status(401).json({ error: "Customer not found" });

      const session = await issueSession(db, customer, tenant, req, res);
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /logout ──────────────────────────────────────────────────
  router.post("/logout", async (req, res) => {
    try {
      const resolved = await resolveOrFail(req, res);
      if (!resolved) return;
      const { db } = resolved;
      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (rawToken) {
        const hash = hashRefreshToken(rawToken);
        await db.query(
          "UPDATE customer_portal_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
          [hash]
        );
      }
      clearRefreshCookie(res);
      res.json({ status: "logged_out" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /request-password-reset ──────────────────────────────────
  router.post(
    "/request-password-reset",
    customerPortalOtpLimiter,
    validate(requestPasswordResetSchema),
    async (req, res) => {
      try {
        const resolved = await resolveOrFail(req, res);
        if (!resolved) return;
        const { db, tenant } = resolved;
        const { email } = req.body;

        const { rows: [customer] } = await db.query(
          `SELECT id, name FROM customers
           WHERE LOWER(email) = LOWER($1) AND portal_enabled_at IS NOT NULL AND deleted_at IS NULL
           LIMIT 1`,
          [email]
        );

        if (customer) {
          const rawToken = crypto.randomBytes(24).toString("hex");
          const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
          const expiresAt = new Date(Date.now() + RESET_TTL_MS);
          await db.query(
            `INSERT INTO customer_portal_reset_tokens (customer_id, token_hash, expires_at)
             VALUES ($1, $2, $3)`,
            [customer.id, tokenHash, expiresAt]
          );
          const resetUrl = `${tenantPortalUrl(tenant)}/reset?token=${rawToken}`;
          await enqueuePortalEmail(db, tenant, "customer_portal_password_reset", email, {
            storeName: tenant.name || tenant.slug,
            customerName: customer.name,
            resetUrl,
            expiresInMinutes: Math.round(RESET_TTL_MS / 60000),
          });
        }

        res.json({ status: "sent" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── POST /reset-password ──────────────────────────────────────────
  router.post(
    "/reset-password",
    customerPortalAuthLimiter,
    validate(resetPasswordSchema),
    async (req, res) => {
      try {
        const resolved = await resolveOrFail(req, res);
        if (!resolved) return;
        const { db } = resolved;
        const { token, password } = req.body;

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const { rows: [row] } = await db.query(
          `SELECT id, customer_id, used_at, expires_at
           FROM customer_portal_reset_tokens WHERE token_hash = $1`,
          [tokenHash]
        );
        if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
          return res.status(400).json({ error: "Reset link is invalid or expired" });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await db.query(
          `UPDATE customers
             SET portal_password_hash = $2,
                 portal_tokens_revoked_before = NOW()
           WHERE id = $1`,
          [row.customer_id, passwordHash]
        );
        await db.query(
          "UPDATE customer_portal_reset_tokens SET used_at = NOW() WHERE id = $1",
          [row.id]
        );
        await db.query(
          `UPDATE customer_portal_refresh_tokens
              SET revoked_at = NOW()
            WHERE customer_id = $1 AND revoked_at IS NULL`,
          [row.customer_id]
        );

        res.json({ status: "password_reset" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.use("/api/portal/auth", router);
};
