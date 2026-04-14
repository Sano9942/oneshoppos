/**
 * Customer portal auth middleware (M8).
 *
 * Mounted BEFORE the tenant middleware chain, so `req.employee` / `req.company`
 * are never set on portal requests. Tenant DB routing is handled per-request
 * via `resolvePublicTenantDb()` (same pattern as storefront / public bookings).
 *
 * The portal uses a dedicated JWT secret (`CUSTOMER_PORTAL_JWT_SECRET`) that
 * falls back to `JWT_SECRET` with a warning. Tokens have `scope: "customer"` —
 * anything else is rejected so staff tokens cannot cross-auth into portal
 * routes and vice versa.
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const ACCESS_TTL = process.env.CUSTOMER_PORTAL_ACCESS_TTL || "30m";
const REFRESH_TTL = process.env.CUSTOMER_PORTAL_REFRESH_TTL || "30d";

let _secretWarned = false;
function getSecret() {
  const explicit = process.env.CUSTOMER_PORTAL_JWT_SECRET;
  if (explicit) return explicit;
  if (!_secretWarned) {
    _secretWarned = true;
    // eslint-disable-next-line no-console
    console.warn("[SECURITY] CUSTOMER_PORTAL_JWT_SECRET unset, falling back to JWT_SECRET");
  }
  return process.env.JWT_SECRET || "dev-insecure-secret";
}

/**
 * Sign both access + refresh tokens for a customer session.
 * The refresh token hash is returned for DB storage; the raw token goes into
 * the httpOnly cookie.
 */
function signCustomerTokens(customer, tenant) {
  const secret = getSecret();
  const accessToken = jwt.sign(
    {
      cid: customer.id,
      tid: tenant.id,
      tslug: tenant.slug,
      scope: "customer",
      jti: crypto.randomUUID(),
    },
    secret,
    { expiresIn: ACCESS_TTL }
  );

  const refreshToken = jwt.sign(
    {
      cid: customer.id,
      tid: tenant.id,
      tslug: tenant.slug,
      scope: "customer",
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

function verifyCustomerToken(token) {
  return jwt.verify(token, getSecret());
}

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Factory — returns middleware that decodes the customer access token,
 * resolves the tenant DB, and attaches req.customerId / req.tenant / req.db.
 */
function loadCustomerAuth(deps) {
  const { resolvePublicTenantDb } = require("../services/public-tenant-context");

  return async function customerAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        return res.status(401).json({ error: "Missing bearer token" });
      }

      let payload;
      try {
        payload = verifyCustomerToken(match[1]);
      } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      if (payload.scope !== "customer") {
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

      // Honour per-customer revocation cursor (set by password-reset / logout-all).
      const { rows: [cust] } = await db.query(
        "SELECT id, portal_tokens_revoked_before FROM customers WHERE id = $1 AND deleted_at IS NULL",
        [payload.cid]
      );
      if (!cust) {
        return res.status(401).json({ error: "Customer not found" });
      }
      if (cust.portal_tokens_revoked_before) {
        // JWT `iat` is in seconds; compare to revocation cursor.
        const issuedAt = Number(payload.iat) * 1000;
        const cutoff = new Date(cust.portal_tokens_revoked_before).getTime();
        if (Number.isFinite(issuedAt) && issuedAt < cutoff) {
          return res.status(401).json({ error: "Session revoked" });
        }
      }

      req.customerId = payload.cid;
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
  loadCustomerAuth,
  signCustomerTokens,
  verifyCustomerToken,
  hashRefreshToken,
  getSecret,
};
