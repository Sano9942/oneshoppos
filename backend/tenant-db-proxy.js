/**
 * tenant-db-proxy.js — AsyncLocalStorage-based DB proxy for multi-tenant isolation.
 *
 * When MULTI_TENANT=1, this module's `dbProxy` replaces the singleton `db` in deps.
 * All route closures that captured `db` at boot time now transparently hit the
 * current request's tenant DB via AsyncLocalStorage.
 *
 * In single-tenant mode (MULTI_TENANT=0), this module is not used.
 */
const { AsyncLocalStorage } = require("async_hooks");

const asyncStore = new AsyncLocalStorage();

/**
 * Returns the tenant DB from the current async context.
 * Throws if called outside a request context (e.g., during module load).
 */
function getCurrentDb() {
  const store = asyncStore.getStore();
  if (!store || !store.db) {
    throw new Error("[tenant-db-proxy] No tenant DB in async context — request may not have been wrapped");
  }
  return store.db;
}

// sqlite3 methods that route handlers actually use (from codebase audit):
const PROXIED_METHODS = ["all", "get", "run", "serialize", "exec"];

/**
 * Creates a Proxy that looks like a sqlite3.Database but delegates every call
 * to the tenant's real DB resolved from AsyncLocalStorage.
 *
 * Special handling for `prepare()` — returns a proxied Statement.
 */
function createDbProxy() {
  const handler = {
    get(_target, prop) {
      // `prepare` returns a Statement — we need to proxy that too
      if (prop === "prepare") {
        return function proxyPrepare(sql) {
          const realDb = getCurrentDb();
          const realStmt = realDb.prepare(sql);
          return createStatementProxy(realStmt);
        };
      }

      if (PROXIED_METHODS.includes(prop)) {
        return function (...args) {
          const realDb = getCurrentDb();
          return realDb[prop](...args);
        };
      }

      // For any other property (e.g., `close`, `parallelize`, `each`),
      // delegate to the current tenant DB
      const realDb = getCurrentDb();
      const val = realDb[prop];
      return typeof val === "function" ? val.bind(realDb) : val;
    },
  };

  // The target is a dummy object — the Proxy handler ignores it entirely
  return new Proxy({}, handler);
}

/**
 * Wraps a real sqlite3.Statement so that `stmt.run()`, `stmt.finalize()`, etc.
 * work correctly. The Statement is already bound to the correct DB from `prepare()`,
 * so we just need to forward calls. No ALS lookup needed here — the real statement
 * was created from the correct tenant DB.
 */
function createStatementProxy(realStmt) {
  return new Proxy(realStmt, {
    get(target, prop) {
      const val = target[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

module.exports = { asyncStore, createDbProxy, getCurrentDb };
