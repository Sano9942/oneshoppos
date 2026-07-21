/**
 * Shared helpers, middleware, and constants for admin routes.
 */
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 10;

// ── Middleware factories ────────────────────────────────────────────────

function createRequireSuperAdmin(verifyAccessToken) {
  return function requireSuperAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization required" });
    }
    try {
      const decoded = verifyAccessToken(authHeader.slice(7), process.env.JWT_SECRET);
      if (decoded.role !== "super_admin") {
        return res.status(403).json({ error: "Super-admin access required" });
      }
      req.admin = { id: decoded.aid, email: decoded.email, sid: decoded.sid || null };
      next();
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

// ── Logging helpers ────────────────────────────────────────────────────

function createLoggers(db, masterDb) {
  async function auditLog(tenantId, action, details, actor) {
    await masterDb.query(
      "INSERT INTO tenant_audit_log (tenant_id, action, details, actor) VALUES ($1, $2, $3, $4)",
      [tenantId, action, details ? JSON.stringify(details) : null, actor]
    );
  }

  async function logAdminAction(email, action, targetType, targetId, details, ip) {
    try {
      await db.query(
        `INSERT INTO admin_activity_log (admin_email, action, target_type, target_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, action, targetType, String(targetId || ""), details ? JSON.stringify(details) : null, ip || null]
      );
    } catch (_) { /* non-critical — never block admin operations */ }
  }

  async function logSecurityEvent(eventType, email, ip, userAgent, details) {
    try {
      await db.query(
        `INSERT INTO admin_security_log (event_type, email, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventType, email, ip, userAgent, details ? JSON.stringify(details) : null]
      );
    } catch (_) { /* non-critical */ }
  }

  return { auditLog, logAdminAction, logSecurityEvent };
}

module.exports = {
  BCRYPT_ROUNDS,
  bcrypt,
  createRequireSuperAdmin,
  createLoggers,
};
