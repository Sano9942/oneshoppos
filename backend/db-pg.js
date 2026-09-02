// backend/db-pg.js
// PostgreSQL connection pool + query/transaction helpers.
// Connects via DATABASE_URL env var.
//
// Dotenv is NOT loaded here — callers must ensure .env is loaded before
// requiring this module. backend/index.js handles the main server path;
// standalone scripts (migrate-pg.js, jobs/cleanup-dead-tenants.js,
// seed-admin-pg.js, scripts/*) load dotenv themselves at line 1.
// Tests get env from the Vitest runner's own environment. This avoids
// re-injecting MULTI_TENANT after tests intentionally delete it for
// single-tenant-mode scenarios (Decision II from Batch 3B).

const { Pool } = require("pg");

// Pool size is env-tunable so the same image can run against a small instance.
// Default 5: this app shares a Supabase transaction pooler with pg-boss, which
// opens its own pool on the same DATABASE_URL, and a free-tier pool is ~15.
const POOL_MAX = Number(process.env.PG_POOL_MAX || 5);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  max: POOL_MAX,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 30000),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000),
});

pool.on("error", (err) => {
  console.error("[db-pg] Unexpected pool error:", err.message);
});

/**
 * Attach an error handler to a checked-out client.
 *
 * `pg` emits 'error' on the CLIENT, not the pool, when a connection dies while
 * checked out — so the pool.on("error") handler above never sees it. With no
 * listener on the client, Node treats it as an unhandled 'error' event and
 * terminates the process. That is exactly how a dropped pooler connection took
 * the whole server down ("Error: Connection terminated unexpectedly").
 *
 * The client is still broken afterwards; this only stops one dead connection
 * from killing the process. The in-flight query rejects as it already would.
 */
function guardClient(client) {
  if (client && !client.__errorGuarded) {
    client.__errorGuarded = true;
    client.on("error", (err) => {
      console.error("[db-pg] client error:", err.message);
    });
  }
  return client;
}

module.exports = {
  /**
   * Run a single query. Returns { rows, rowCount, ... }.
   */
  query: (sql, params) => pool.query(sql, params),

  /**
   * Check out a client for manual multi-statement work.
   * Caller MUST call client.release() when done.
   */
  getClient: async () => guardClient(await pool.connect()),

  /**
   * Run `fn(client)` inside BEGIN/COMMIT. Rolls back on error.
   * Returns whatever `fn` returns.
   */
  transaction: async (fn) => {
    const client = guardClient(await pool.connect());
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      // A ROLLBACK on an already-dead connection throws, which would replace
      // the real error with a confusing one. Swallow it and rethrow the cause.
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Shut down pool. Call on process exit.
   */
  end: () => pool.end(),

  /**
   * Expose pool for advanced usage (e.g., listen/notify).
   */
  pool,
};
