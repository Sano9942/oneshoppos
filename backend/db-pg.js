// backend/db-pg.js
// PostgreSQL connection pool + query/transaction helpers.
// Connects via DATABASE_URL env var.

const { Pool } = require("pg");
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
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
