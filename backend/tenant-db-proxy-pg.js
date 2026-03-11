/**
 * tenant-db-proxy-pg.js — AsyncLocalStorage-based DB proxy for Postgres multi-tenant.
 *
 * When MULTI_TENANT=1 and DATABASE_URL is set, this module's `dbProxy` replaces
 * the singleton `db` in deps. All route closures that captured `db` at boot time
 * now transparently hit the current request's tenant-scoped DB via AsyncLocalStorage.
 */
const { AsyncLocalStorage } = require("async_hooks");

const asyncStore = new AsyncLocalStorage();

/**
 * Returns the tenant-scoped DB object from the current async context.
 * Throws if called outside a request context.
 */
function getCurrentDb() {
  const store = asyncStore.getStore();
  if (!store || !store.db) {
    throw new Error("[tenant-db-proxy-pg] No tenant DB in async context");
  }
  return store.db;
}

// Postgres db-pg.js methods that route handlers use:
const PROXIED_METHODS = ["query", "transaction", "getClient"];

/**
 * Creates a Proxy that looks like a db-pg.js pool wrapper but delegates
 * every call to the tenant's scoped DB from AsyncLocalStorage.
 */
function createDbProxy() {
  const handler = {
    get(_target, prop) {
      if (PROXIED_METHODS.includes(prop)) {
        return function (...args) {
          const realDb = getCurrentDb();
          return realDb[prop](...args);
        };
      }
      // For any other property, delegate to current tenant DB
      const realDb = getCurrentDb();
      const val = realDb[prop];
      return typeof val === "function" ? val.bind(realDb) : val;
    },
  };

  return new Proxy({}, handler);
}

module.exports = { asyncStore, createDbProxy, getCurrentDb };
