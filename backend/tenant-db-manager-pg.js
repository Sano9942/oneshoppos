/**
 * tenant-db-manager-pg.js — Postgres schema-based multi-tenant DB manager.
 *
 * Instead of separate SQLite files per tenant, all tenants share one Postgres
 * instance with separate schemas (tenant_<slug>). Per-request isolation is
 * achieved via SET search_path.
 *
 * This module provides a thin wrapper that creates schema-scoped "db" objects
 * which prepend SET search_path before every query.
 */

const masterDbPg = require("./master-db-pg");

let _pool = null;

// Cache of tenantId → { slug, status, deleted_at }
const _tenantCache = new Map();
const CACHE_TTL_MS = 60_000;
const _cacheTimestamps = new Map();

/**
 * Initialize with the shared pg.Pool wrapper (db-pg.js).
 */
function init(db) {
  _pool = db;
}

/**
 * Returns a scoped DB object for a tenant that prepends SET search_path
 * to every transaction/query. The returned object has the same API as db-pg.js:
 *   { query, transaction, getClient }
 */
async function getDb(tenantId) {
  if (!_pool) throw new Error("[tenant-db-manager-pg] Not initialized — call init(db) first");

  // Resolve tenant slug (with cache)
  const cached = _tenantCache.get(tenantId);
  const now = Date.now();
  let tenant;

  if (cached && (now - (_cacheTimestamps.get(tenantId) || 0)) < CACHE_TTL_MS) {
    tenant = cached;
  } else {
    tenant = await masterDbPg.getTenantById(tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    _tenantCache.set(tenantId, tenant);
    _cacheTimestamps.set(tenantId, now);
  }

  if (tenant.status === "suspended") throw new Error(`Tenant ${tenantId} is suspended`);
  if (tenant.status === "deleted" || tenant.deleted_at) throw new Error(`Tenant ${tenantId} is deleted`);

  const schemaName = `tenant_${tenant.slug}`;

  // Return a scoped db-like object
  return {
    query: async (sql, params) => {
      const client = await _pool.pool.connect();
      try {
        // Wrap SET + query in a transaction so PgBouncer (transaction mode)
        // keeps them on the same backend connection.
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO '${schemaName}', public`);
        const result = await client.query(sql, params);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    transaction: async (fn) => {
      const client = await _pool.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO '${schemaName}', public`);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    getClient: async () => {
      const client = await _pool.pool.connect();
      await client.query(`SET search_path TO '${schemaName}', public`);
      return client;
    },
  };
}

/**
 * Health check for a tenant schema.
 */
async function healthCheck(tenantId) {
  const db = await getDb(tenantId);
  const { rows } = await db.query("SELECT 1 AS alive");
  if (!rows[0]) throw new Error(`Health check failed for tenant ${tenantId}`);
  return { ok: true, tenantId };
}

/**
 * Clear tenant cache (e.g., after suspend/activate).
 */
function clearCache(tenantId) {
  if (tenantId) {
    _tenantCache.delete(tenantId);
    _cacheTimestamps.delete(tenantId);
  } else {
    _tenantCache.clear();
    _cacheTimestamps.clear();
  }
}

/**
 * No-op for Postgres — the shared pool is managed by db-pg.js.
 * Provided for API compatibility with the SQLite tenant-db-manager.
 */
function closeDb() { return Promise.resolve(); }
function closeAll() { return Promise.resolve(); }

module.exports = { init, getDb, healthCheck, clearCache, closeDb, closeAll };
