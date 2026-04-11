/**
 * tenant-job-context.js — tenant scoping helper for pg-boss job handlers.
 *
 * Background: route handlers get their tenant DB via the AsyncLocalStorage
 * proxy in tenant-db-proxy-pg.js. That mechanism is request-lifecycle bound
 * and doesn't reach pg-boss workers, which run outside any HTTP context.
 * The FBR worker works around this by interpolating `tenant_<slug>.` into
 * every SQL string — workable but error-prone and doesn't compose with
 * service functions that were written for the proxy model.
 *
 * This helper gives pg-boss workers a "tenant-scoped db" that service
 * functions like processRenewal(db, ...) can use unchanged. It acquires
 * a dedicated client from the pool, sets search_path to the tenant schema,
 * runs the caller's function, and always resets search_path + releases
 * the client — even on error — so the pool client doesn't leak tenant
 * scoping to the next consumer.
 *
 * Usage:
 *   await withTenantContext(pool, tenantSlug, async (db) => {
 *     await processRenewal(db, boss, tenantSlug, subscriptionId);
 *   });
 *
 * The `db` parameter passed to the callback is a tenant-scoped proxy
 * with `query(sql, params)` and `transaction(fn)` — matching the shape
 * that route handlers see via the AsyncLocalStorage proxy.
 */

// Safe identifier regex: only the characters we use in tenant slugs.
// Postgres identifiers can be much broader, but our provisioner restricts
// slugs to [a-z0-9_] and we must match that here since `SET search_path`
// cannot use parameterized placeholders.
const SLUG_PATTERN = /^[a-z0-9_]+$/;

function assertSafeSlug(tenantSlug) {
  if (typeof tenantSlug !== "string" || !tenantSlug) {
    throw new Error("tenantSlug is required for tenant-scoped jobs");
  }
  if (!SLUG_PATTERN.test(tenantSlug)) {
    throw new Error(
      `tenantSlug "${tenantSlug}" contains unsafe characters (allowed: a-z 0-9 _)`
    );
  }
}

/**
 * Runs `fn(db)` with a tenant-scoped db proxy.
 *
 * @param {import('pg').Pool} pool - raw pg.Pool (NOT the db-pg.js wrapper)
 * @param {string} tenantSlug - validated against SLUG_PATTERN before interpolation
 * @param {(db: {query: Function, transaction: Function}) => Promise<any>} fn
 * @returns {Promise<any>} whatever `fn` returns
 */
async function withTenantContext(pool, tenantSlug, fn) {
  assertSafeSlug(tenantSlug);

  const schema = `tenant_${tenantSlug}`;
  const client = await pool.connect();

  try {
    // Use a format that matches existing migration SET search_path calls.
    // schema name is validated above so interpolation is safe.
    await client.query(`SET search_path TO ${schema}, public`);

    const db = {
      query: (sql, params) => client.query(sql, params),
      transaction: async (txFn) => {
        await client.query("BEGIN");
        try {
          const result = await txFn(client);
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      },
    };

    return await fn(db);
  } finally {
    // Always reset search_path before releasing the client back to the pool.
    // Without this, the next consumer of the pool inherits tenant scoping
    // and gets silent cross-tenant reads. Best-effort — if the reset fails
    // (e.g. client is already broken), the client is still released.
    try {
      await client.query("SET search_path TO public");
    } catch {
      // If the reset fails the client is probably dead anyway;
      // pg pool will discard it on release.
    }
    client.release();
  }
}

module.exports = { withTenantContext, assertSafeSlug };
