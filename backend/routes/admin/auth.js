/**
 * Admin authentication routes.
 *
 *   POST /api/admin/auth/login          — password step. When the admin has TOTP
 *                                          enabled, returns { totp_required, pending_token }
 *                                          instead of a full token.
 *   POST /api/admin/auth/totp           — second step: exchange pending_token + code
 *                                          (TOTP or recovery code) for a full admin token.
 *   POST /api/admin/auth/totp/setup     — (logged-in) generate a secret + QR for enrollment.
 *   POST /api/admin/auth/totp/verify    — (logged-in) confirm first code, enable 2FA,
 *                                          return one-time recovery codes.
 *   POST /api/admin/auth/totp/disable   — (logged-in) disable 2FA (requires a current code).
 *   GET  /api/admin/auth/totp/status    — (logged-in) { enabled }.
 */
const crypto = require("crypto");
const qrcode = require("qrcode");
const totp = require("../../services/admin-totp");
const loginAlert = require("../../services/admin-login-alert");
const { adminTotpLimiter } = require("../../middleware/rate-limit");

// Access tokens are short-lived (1h) and paired with a rotating refresh token
// (7d) stored hashed in public.admin_sessions. The frontend adminFetch silently
// refreshes on a 401 TOKEN_EXPIRED — mirrors the tenant AuthProvider flow.
const ADMIN_ACCESS_TTL = process.env.ADMIN_ACCESS_TTL || "1h";
const ADMIN_REFRESH_TTL = process.env.ADMIN_REFRESH_TTL || "7d";
const REFRESH_COOKIE = "adminRefreshToken";
const REFRESH_COOKIE_PATH = "/api/admin/auth";

function refreshSecret() {
  return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
}

function adminCookieOpts() {
  const prod = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? "None" : "Lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

module.exports = function registerAuthRoutes(app, deps) {
  const {
    db, masterDb, jwt, requireSuperAdmin,
    authLimiter, bcrypt, logSecurityEvent, logAdminAction,
  } = deps;

  // Mint the real super-admin access token. `sid` is the refresh session's jti,
  // so the sessions UI can identify (and preserve) the current session.
  function signAdminToken(admin, sid) {
    return jwt.sign(
      { tid: 0, eid: 0, rid: 0, oid: null, aid: admin.id, email: admin.email, role: "super_admin", scope: "admin", sid: sid || null },
      process.env.JWT_SECRET,
      { expiresIn: ADMIN_ACCESS_TTL }
    );
  }

  function signAdminRefresh(admin) {
    const jti = crypto.randomUUID();
    const token = jwt.sign({ aid: admin.id, type: "admin_refresh", jti }, refreshSecret(), { expiresIn: ADMIN_REFRESH_TTL });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(jwt.decode(token).exp * 1000).toISOString();
    return { token, hash, jti, expiresAt };
  }

  // Create a refresh-session row, set the cookie, and return a matching access token.
  async function issueAdminSession(admin, req, res) {
    const { token: refreshToken, hash, jti, expiresAt } = signAdminRefresh(admin);
    await db.query(
      `INSERT INTO admin_sessions (admin_id, token_hash, jti, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.id, hash, jti, (req.headers["user-agent"] || "").slice(0, 300) || null, req.ip || null, expiresAt]
    );
    res.cookie(REFRESH_COOKIE, refreshToken, adminCookieOpts());
    return signAdminToken(admin, jti);
  }

  // ── Step 1: password ────────────────────────────────────────────────────
  app.post("/api/admin/auth/login", authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT id, email, password_hash, name, totp_enabled_at FROM super_admins WHERE email = $1",
        [email.toLowerCase().trim()]
      );
      const admin = rows[0] || null;
      if (!admin) {
        logSecurityEvent("login_failed", email, req.ip, req.headers["user-agent"], { reason: "invalid_credentials" });
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const valid = await bcrypt.compare(String(password), admin.password_hash);
      if (!valid) {
        logSecurityEvent("login_failed", email, req.ip, req.headers["user-agent"], { reason: "invalid_credentials" });
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // 2FA enrolled → issue a short-lived, single-purpose pending token. It
      // carries no role, so requireSuperAdmin (role === 'super_admin') rejects it
      // on every other route; only /api/admin/auth/totp accepts it.
      if (admin.totp_enabled_at) {
        const pendingToken = jwt.sign(
          { aid: admin.id, email: admin.email, scope: "admin_totp_pending" },
          process.env.JWT_SECRET,
          { expiresIn: "5m" }
        );
        logSecurityEvent("totp_challenge", email, req.ip, req.headers["user-agent"], null);
        return res.json({ totp_required: true, pending_token: pendingToken });
      }

      // Anomaly check runs BEFORE we log this login_success, so the current
      // login can't count itself as "seen".
      const newIp = await loginAlert.isNewLoginIp(db, admin.email, req.ip);
      const token = await issueAdminSession(admin, req, res);
      logSecurityEvent("login_success", email, req.ip, req.headers["user-agent"], null);
      if (newIp) loginAlert.alertNewLoginIp({ email: admin.email, ip: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
      return res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Step 2: TOTP / recovery code ────────────────────────────────────────
  app.post("/api/admin/auth/totp", adminTotpLimiter, async (req, res) => {
    const { pending_token, code } = req.body || {};
    if (!pending_token || !code) {
      return res.status(400).json({ error: "pending_token and code are required" });
    }
    let decoded;
    try {
      decoded = jwt.verify(pending_token, process.env.JWT_SECRET);
    } catch (err) {
      const expired = err.name === "TokenExpiredError";
      return res.status(401).json({ error: expired ? "Session expired — sign in again" : "Invalid session", code: expired ? "PENDING_EXPIRED" : "PENDING_INVALID" });
    }
    if (decoded.scope !== "admin_totp_pending") {
      return res.status(401).json({ error: "Invalid session" });
    }
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT id, email, name, totp_secret, totp_enabled_at, recovery_codes FROM super_admins WHERE id = $1",
        [decoded.aid]
      );
      const admin = rows[0] || null;
      if (!admin || !admin.totp_enabled_at || !admin.totp_secret) {
        return res.status(401).json({ error: "2FA not configured" });
      }

      let ok = totp.verifyToken(code, admin.totp_secret);
      let usedRecovery = false;
      if (!ok) {
        const hashes = Array.isArray(admin.recovery_codes) ? admin.recovery_codes : [];
        const idx = await totp.verifyRecoveryCode(code, hashes);
        if (idx >= 0) {
          ok = true;
          usedRecovery = true;
          // Burn the single-use recovery code.
          const remaining = hashes.slice();
          remaining.splice(idx, 1);
          await db.query("UPDATE super_admins SET recovery_codes = $1 WHERE id = $2", [JSON.stringify(remaining), admin.id]);
        }
      }

      if (!ok) {
        logSecurityEvent("totp_failed", admin.email, req.ip, req.headers["user-agent"], null);
        return res.status(401).json({ error: "Invalid code" });
      }

      const newIp = await loginAlert.isNewLoginIp(db, admin.email, req.ip);
      const token = await issueAdminSession(admin, req, res);
      logSecurityEvent("totp_success", admin.email, req.ip, req.headers["user-agent"], usedRecovery ? { recovery: true } : null);
      logSecurityEvent("login_success", admin.email, req.ip, req.headers["user-agent"], usedRecovery ? { via: "recovery_code" } : { via: "totp" });
      if (newIp) loginAlert.alertNewLoginIp({ email: admin.email, ip: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
      return res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email }, used_recovery: usedRecovery });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Enrollment: generate secret + QR ────────────────────────────────────
  app.post("/api/admin/auth/totp/setup", requireSuperAdmin, async (req, res) => {
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT id, email, totp_enabled_at FROM super_admins WHERE id = $1",
        [req.admin.id]
      );
      const admin = rows[0];
      if (!admin) return res.status(404).json({ error: "Admin not found" });
      if (admin.totp_enabled_at) {
        return res.status(409).json({ error: "2FA already enabled — disable it first to re-enroll" });
      }
      const secret = totp.generateSecret();
      const uri = totp.keyUri(secret, admin.email);
      // Persist the pending secret so /verify can check the first code against it.
      // enabled_at stays NULL until verification succeeds.
      await db.query("UPDATE super_admins SET totp_secret = $1 WHERE id = $2", [secret, admin.id]);
      const qrDataUrl = await qrcode.toDataURL(uri);
      return res.json({ secret, otpauth_uri: uri, qr_data_url: qrDataUrl });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Enrollment: confirm first code, enable, return recovery codes ───────
  app.post("/api/admin/auth/totp/verify", requireSuperAdmin, async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required" });
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT id, email, totp_secret, totp_enabled_at FROM super_admins WHERE id = $1",
        [req.admin.id]
      );
      const admin = rows[0];
      if (!admin) return res.status(404).json({ error: "Admin not found" });
      if (admin.totp_enabled_at) return res.status(409).json({ error: "2FA already enabled" });
      if (!admin.totp_secret) return res.status(400).json({ error: "Run setup first" });
      if (!totp.verifyToken(code, admin.totp_secret)) {
        return res.status(400).json({ error: "Invalid code — check your authenticator app" });
      }
      const { plain, hashes } = await totp.generateRecoveryCodes();
      await db.query(
        "UPDATE super_admins SET totp_enabled_at = NOW(), recovery_codes = $1 WHERE id = $2",
        [JSON.stringify(hashes), admin.id]
      );
      logAdminAction(admin.email, "admin_totp_enabled", "super_admin", admin.id, null, req.ip);
      logSecurityEvent("totp_enabled", admin.email, req.ip, req.headers["user-agent"], null);
      return res.json({ enabled: true, recovery_codes: plain });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Disable 2FA (requires a current code) ───────────────────────────────
  app.post("/api/admin/auth/totp/disable", requireSuperAdmin, async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required" });
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT id, email, totp_secret, totp_enabled_at, recovery_codes FROM super_admins WHERE id = $1",
        [req.admin.id]
      );
      const admin = rows[0];
      if (!admin) return res.status(404).json({ error: "Admin not found" });
      if (!admin.totp_enabled_at) return res.status(400).json({ error: "2FA is not enabled" });

      let ok = totp.verifyToken(code, admin.totp_secret);
      if (!ok) {
        const hashes = Array.isArray(admin.recovery_codes) ? admin.recovery_codes : [];
        ok = (await totp.verifyRecoveryCode(code, hashes)) >= 0;
      }
      if (!ok) return res.status(400).json({ error: "Invalid code" });

      await db.query(
        "UPDATE super_admins SET totp_secret = NULL, totp_enabled_at = NULL, recovery_codes = NULL WHERE id = $1",
        [admin.id]
      );
      logAdminAction(admin.email, "admin_totp_disabled", "super_admin", admin.id, null, req.ip);
      logSecurityEvent("totp_disabled", admin.email, req.ip, req.headers["user-agent"], null);
      return res.json({ enabled: false });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Status (drives the /admin/security UI) ──────────────────────────────
  app.get("/api/admin/auth/totp/status", requireSuperAdmin, async (req, res) => {
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT totp_enabled_at, recovery_codes FROM super_admins WHERE id = $1",
        [req.admin.id]
      );
      const admin = rows[0] || {};
      const recovery = Array.isArray(admin.recovery_codes) ? admin.recovery_codes.length : 0;
      return res.json({ enabled: !!admin.totp_enabled_at, enabled_at: admin.totp_enabled_at || null, recovery_codes_remaining: recovery });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Session refresh (rotating) ──────────────────────────────────────────
  // Mirrors POST /api/auth/refresh: each refresh consumes the presented token
  // and issues a fresh one. A revoked token presented again is reuse — every
  // session for that admin is killed, forcing a full re-login.
  app.post("/api/admin/auth/refresh", async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) return res.status(401).json({ error: "Refresh token missing" });
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret());
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      const expired = err.name === "TokenExpiredError";
      return res.status(401).json({ error: expired ? "Refresh token expired" : "Invalid refresh token", code: expired ? "REFRESH_EXPIRED" : "REFRESH_INVALID" });
    }
    if (decoded.type !== "admin_refresh") {
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    try {
      await masterDb.init(db);
      const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      const { rows: [session] } = await db.query(
        "SELECT id, admin_id, revoked_at FROM admin_sessions WHERE token_hash = $1",
        [tokenHash]
      );
      if (!session) {
        res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        return res.status(401).json({ error: "Refresh token invalid" });
      }
      if (session.revoked_at) {
        // Reuse of a rotated token → revoke the whole family.
        await db.query(
          "UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = $1 AND revoked_at IS NULL",
          [session.admin_id]
        );
        res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        return res.status(401).json({ error: "Refresh token reuse detected — please sign in again", code: "REFRESH_REUSE" });
      }

      const { rows: [admin] } = await db.query(
        "SELECT id, email, name FROM super_admins WHERE id = $1",
        [session.admin_id]
      );
      if (!admin) {
        res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        return res.status(401).json({ error: "Admin not found" });
      }

      // Rotate: insert the new session, then mark the old one revoked.
      const token = await issueAdminSession(admin, req, res);
      await db.query("UPDATE admin_sessions SET revoked_at = NOW() WHERE id = $1", [session.id]);
      return res.json({ token });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Logout — revoke the current session + clear the cookie ──────────────
  app.post("/api/admin/auth/logout", requireSuperAdmin, async (req, res) => {
    try {
      await masterDb.init(db);
      if (req.admin.sid) {
        await db.query(
          "UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = $1 AND jti = $2 AND revoked_at IS NULL",
          [req.admin.id, req.admin.sid]
        );
      }
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Active sessions list ────────────────────────────────────────────────
  app.get("/api/admin/auth/sessions", requireSuperAdmin, async (req, res) => {
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        `SELECT id, jti, user_agent, ip_address, created_at, expires_at
           FROM admin_sessions
          WHERE admin_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
          ORDER BY created_at DESC`,
        [req.admin.id]
      );
      const sessions = rows.map((s) => ({
        id: s.id,
        user_agent: s.user_agent,
        ip_address: s.ip_address,
        created_at: s.created_at,
        expires_at: s.expires_at,
        current: s.jti === req.admin.sid,
      }));
      return res.json({ sessions });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Revoke all other sessions ───────────────────────────────────────────
  app.post("/api/admin/auth/sessions/revoke-others", requireSuperAdmin, async (req, res) => {
    try {
      await masterDb.init(db);
      const { rowCount } = await db.query(
        `UPDATE admin_sessions SET revoked_at = NOW()
          WHERE admin_id = $1 AND revoked_at IS NULL
            AND ($2::text IS NULL OR jti <> $2)`,
        [req.admin.id, req.admin.sid || null]
      );
      logAdminAction(req.admin.email, "admin_sessions_revoked_others", "super_admin", req.admin.id, { revoked: rowCount }, req.ip);
      return res.json({ revoked: rowCount });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
