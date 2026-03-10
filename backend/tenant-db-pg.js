// backend/tenant-db-pg.js
// Schema-per-tenant proxy via AsyncLocalStorage.
// Replaces both tenant-db-manager.js and tenant-db-proxy.js for Postgres.
//
// Usage in middleware:
//   await runWithTenant(db, slug, async () => { ... route handler ... });
// Inside route handlers:
//   const proxy = getProxy();
//   const { rows } = await proxy.query("SELECT ...", [params]);

const { AsyncLocalStorage } = require("async_hooks");

const asyncStore = new AsyncLocalStorage();

/**
 * Returns the current async context store.
 * Throws if called outside a runWithTenant() context.
 */
function getStore() {
  const store = asyncStore.getStore();
  if (!store || !store.client) {
    throw new Error("[tenant-db-pg] No tenant client in async context");
  }
  return store;
}

/**
 * Returns a db-like object scoped to the current tenant schema.
 * Has `query(sql, params)` and `transaction(fn)` methods.
 */
function getProxy() {
  const store = getStore();
  return {
    query: (sql, params) => store.client.query(sql, params),
    transaction: async (fn) => {
      await store.client.query("BEGIN");
      try {
        const result = await fn(store.client);
        await store.client.query("COMMIT");
        return result;
      } catch (err) {
        await store.client.query("ROLLBACK");
        throw err;
      }
    },
  };
}

/**
 * Runs `fn` with a pooled client whose search_path is set to `tenant_<slug>`.
 * The client is released back to the pool after fn completes.
 *
 * @param {object} db - The db-pg pool wrapper
 * @param {string} slug - Tenant slug (schema = tenant_<slug>)
 * @param {Function} fn - Async function to run in tenant context
 */
async function runWithTenant(db, slug, fn) {
  const client = await db.getClient();
  try {
    await client.query(`SET search_path = 'tenant_${slug}'`);
    return await asyncStore.run({ client, slug }, fn);
  } finally {
    // Reset search_path before returning client to pool
    await client.query("SET search_path = 'public'").catch(() => {});
    client.release();
  }
}

module.exports = { asyncStore, getProxy, getStore, runWithTenant };
