/**
 * Shared public tenant resolver — extracted from storefront.js.
 * Used by storefront, QR ordering, public bookings.
 */

const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";

async function resolvePublicTenantDb(req, deps) {
  if (!IS_MULTI_TENANT) return { db: deps.db };

  const tenantSlug = req.query.tenant || req.headers["x-tenant-slug"];
  if (!tenantSlug) {
    return { error: "tenant query param or x-tenant-slug header is required", status: 400 };
  }

  const masterDb = require("../master-db-pg");
  const tenantDbMgr = deps.tenantDbManager || require("../tenant-db-manager-pg");

  const {
    rows: [tenant],
  } = await masterDb.query(
    "SELECT id, slug, name, status FROM tenants WHERE slug = $1 AND status = 'active'",
    [String(tenantSlug).trim()]
  );
  if (!tenant) {
    return { error: "Store not found", status: 404 };
  }

  const db = await tenantDbMgr.getDb(tenant.id);
  return { db, tenant };
}

module.exports = { resolvePublicTenantDb };
