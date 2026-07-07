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
const qrcode = require("qrcode");
const totp = require("../../services/admin-totp");
const { adminTotpLimiter } = require("../../middleware/rate-limit");

module.exports = function registerAuthRoutes(app, deps) {
  const {
    db, masterDb, jwt, jwtDefaults, requireAllowedIp, requireSuperAdmin,
    authLimiter, bcrypt, logSecurityEvent, logAdminAction,
  } = deps;

  // Mint the real super-admin access token (shared by the password-only path and
  // the completed-TOTP path).
  function signAdminToken(admin) {
    return jwt.sign(
      { tid: 0, eid: 0, rid: 0, oid: null, aid: admin.id, email: admin.email, role: "super_admin", scope: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: jwtDefaults.accessExpiresIn }
    );
  }

  // ── Step 1: password ────────────────────────────────────────────────────
  app.post("/api/admin/auth/login", requireAllowedIp, authLimiter, async (req, res) => {
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

      const token = signAdminToken(admin);
      logSecurityEvent("login_success", email, req.ip, req.headers["user-agent"], null);
      return res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Step 2: TOTP / recovery code ────────────────────────────────────────
  app.post("/api/admin/auth/totp", requireAllowedIp, adminTotpLimiter, async (req, res) => {
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

      const token = signAdminToken(admin);
      logSecurityEvent("totp_success", admin.email, req.ip, req.headers["user-agent"], usedRecovery ? { recovery: true } : null);
      logSecurityEvent("login_success", admin.email, req.ip, req.headers["user-agent"], usedRecovery ? { via: "recovery_code" } : { via: "totp" });
      return res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email }, used_recovery: usedRecovery });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Enrollment: generate secret + QR ────────────────────────────────────
  app.post("/api/admin/auth/totp/setup", requireAllowedIp, requireSuperAdmin, async (req, res) => {
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
  app.post("/api/admin/auth/totp/verify", requireAllowedIp, requireSuperAdmin, async (req, res) => {
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
  app.post("/api/admin/auth/totp/disable", requireAllowedIp, requireSuperAdmin, async (req, res) => {
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
  app.get("/api/admin/auth/totp/status", requireAllowedIp, requireSuperAdmin, async (req, res) => {
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
};
