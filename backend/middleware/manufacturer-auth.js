/**
 * Manufacturer portal auth middleware (Tier 1.4).
 *
 * Mounted BEFORE the tenant middleware chain, so `req.employee` / `req.company`
 * are never set on portal requests. Tenant DB routing is handled per-request
 * via `resolvePublicTenantDb()` (same pattern as customer portal).
 *
 * The portal uses a dedicated JWT secret (`MANUFACTURER_PORTAL_JWT_SECRET`)
 * that falls back to `JWT_SECRET` with a warning. Tokens have
 * `scope: "manufacturer"` — anything else (staff, customer) is rejected so
 * scopes cannot cross-auth into the wrong routes.
 *
 * Access TTL is intentionally shorter than the customer portal (15m vs 30m):
 * manufacturer reports surface aggregate revenue + scheme data, which is
 * more sensitive than a customer's own purchase history.
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const ACCESS_TTL = process.env.MANUFACTURER_PORTAL_ACCESS_TTL || "15m";
const REFRESH_TTL = process.env.MANUFACTURER_PORTAL_REFRESH_TTL || "30d";

let _secretWarned = false;
function getSecret() {
  const explicit = process.env.MANUFACTURER_PORTAL_JWT_SECRET;
  if (explicit) return explicit;
  if (!_secretWarned) {
    _secretWarned = true;
    // eslint-disable-next-line no-console
    console.warn("[SECURITY] MANUFACTURER_PORTAL_JWT_SECRET unset, falling back to JWT_SECRET");
  }
  return process.env.JWT_SECRET || "dev-insecure-secret";
}

/**
 * Sign both access + refresh tokens for a manufacturer portal session.
 * Returns the raw refresh token (goes into httpOnly cookie) plus its SHA-256
 * hash (stored in DB for revocation lookups).
 */
function signManufacturerTokens(partner, tenant) {
  const secret = getSecret();
  const accessToken = jwt.sign(
    {
      mid: partner.id,
      tid: tenant.id,
      tslug: tenant.slug,
      scope: "manufacturer",
      jti: crypto.randomUUID(),
    },
    secret,
    { expiresIn: ACCESS_TTL }
  );

  const refreshToken = jwt.sign(
    {
      mid: partner.id,
      tid: tenant.id,
      tslug: tenant.slug,
      scope: "manufacturer",
      type: "refresh",
      jti: crypto.randomUUID(),
    },
    secret,
    { expiresIn: REFRESH_TTL }
  );
  const decoded = jwt.decode(refreshToken);
  const refreshHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const refreshExpiresAt = new Date(decoded.exp * 1000).toISOString();

  return { accessToken, refreshToken, refreshHash, refreshExpiresAt };
}

function verifyManufacturerToken(token) {
  return jwt.verify(token, getSecret());
}

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Factory — returns middleware that decodes the manufacturer access token,
 * resolves the tenant DB, and attaches req.manufacturerId / req.tenant / req.db.
 */
function loadManufacturerAuth(deps) {
  const { resolvePublicTenantDb } = require("../services/public-tenant-context");

  return async function manufacturerAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        return res.status(401).json({ error: "Missing bearer token" });
      }

      let payload;
      try {
        payload = verifyManufacturerToken(match[1]);
      } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      if (payload.scope !== "manufacturer") {
        return res.status(401).json({ error: "Invalid token scope" });
      }
      if (payload.type === "refresh") {
        return res.status(401).json({ error: "Refresh token cannot be used as access token" });
      }

      // Resolve tenant DB via public resolver. The resolver reads the slug
      // from ?tenant=... or x-tenant-slug header — we cross-check the token
      // to block replay against another tenant.
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) {
        return res.status(resolved.status || 400).json({ error: resolved.error });
      }
      const { db, tenant } = resolved;
      if (tenant && payload.tid && Number(payload.tid) !== Number(tenant.id)) {
        return res.status(401).json({ error: "Token does not match tenant" });
      }

      // Honour per-partner revocation cursor (set by password change / suspend).
      // Also block suspended partners outright.
      const { rows: [partner] } = await db.query(
        `SELECT id, status, portal_tokens_revoked_before
           FROM manufacturer_partners
          WHERE id = $1`,
        [payload.mid]
      );
      if (!partner) {
        return res.status(401).json({ error: "Manufacturer partner not found" });
      }
      if (partner.status === "suspended") {
        return res.status(403).json({ error: "Partner access suspended" });
      }
      if (partner.status !== "active") {
        return res.status(401).json({ error: "Partner not active" });
      }
      if (partner.portal_tokens_revoked_before) {
        const issuedAt = Number(payload.iat) * 1000;
        const cutoff = new Date(partner.portal_tokens_revoked_before).getTime();
        if (Number.isFinite(issuedAt) && issuedAt < cutoff) {
          return res.status(401).json({ error: "Session revoked" });
        }
      }

      req.manufacturerId = payload.mid;
      req.tenantId = tenant ? tenant.id : payload.tid;
      req.tenant = tenant || { id: payload.tid, slug: payload.tslug };
      req.db = db;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  loadManufacturerAuth,
  signManufacturerTokens,
  verifyManufacturerToken,
  hashRefreshToken,
  getSecret,
};
