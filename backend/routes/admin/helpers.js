/**
 * Shared helpers, middleware, and constants for admin routes.
 */
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 10;

// ── IP Allowlist helpers ────────────────────────────────────────────────

function ipToInt(ip) {
  const clean = ip.replace(/^::ffff:/, "");
  const parts = clean.split(".");
  if (parts.length !== 4) return null;
  return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function ipInCidr(ip, cidr) {
  const [network, bitsStr] = cidr.includes("/") ? cidr.split("/") : [cidr, "32"];
  const bits = parseInt(bitsStr, 10);
  if (bits < 0 || bits > 32) return false;

  const ipInt = ipToInt(ip);
  const netInt = ipToInt(network);
  if (ipInt === null || netInt === null) return false;

  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function parseAllowedIps() {
  const raw = (process.env.ADMIN_ALLOWED_IPS || "").trim();
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ── Middleware factories ────────────────────────────────────────────────

function createRequireAllowedIp() {
  return function requireAllowedIp(req, res, next) {
    const allowedIps = parseAllowedIps();
    if (!allowedIps) return next();

    const clientIp = req.ip || "";
    const matches = allowedIps.some((entry) => ipInCidr(clientIp, entry));
    if (!matches) {
      return res.status(403).json({ error: "IP not allowed" });
    }
    next();
  };
}

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
      req.admin = { id: decoded.aid, email: decoded.email };
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
  ipToInt,
  ipInCidr,
  parseAllowedIps,
  createRequireAllowedIp,
  createRequireSuperAdmin,
  createLoggers,
};
