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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  // max: 10 (was 20) — reduced to leave room for pg-boss's default max:10
  // pool + the brief connection overlap during Railway container handoff.
  // Supabase Free tier caps at 60 connections; previous 20+10+overlap could
  // exceed it and cause pg-boss to fail startup with
  // "Max client connections reached - in Session mode max clients are
  // limited to pool_size". Observed steady-state usage is ~26/60, so halving
  // the app pool is non-impacting. See 2026-04-11 session notes.
  max: 10,
});

pool.on("error", (err) => {
  console.error("[db-pg] Unexpected pool error:", err.message);
});

module.exports = {
  /**
   * Run a single query. Returns { rows, rowCount, ... }.
   */
  query: (sql, params) => pool.query(sql, params),

  /**
   * Check out a client for manual multi-statement work.
   * Caller MUST call client.release() when done.
   */
  getClient: () => pool.connect(),

  /**
   * Run `fn(client)` inside BEGIN/COMMIT. Rolls back on error.
   * Returns whatever `fn` returns.
   */
  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
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
