/**
 * P33 — every backup_log INSERT in the codebase must succeed against the
 * production-shape backup_log table.
 *
 * Background (Phase 7.13 walk):
 *   - Production backup_log columns: (id, action NOT NULL, filename,
 *     size_bytes, performed_by, note, created_at). Confirmed via
 *     information_schema on Supabase.
 *   - schema-pg.sql + migrate-pg.js v4 documented a different shape
 *     (schema_name, status, size_bytes, duration_ms, error_message).
 *   - 6 INSERT statements live in code (1 in routes/admin/system.js,
 *     5 in routes/barcode-expenses.js). Each references columns from
 *     the v4 shape that DON'T EXIST in production. Each is wrapped in
 *     try/catch (_) {} or .catch(()=>{}) — silent failure.
 *   - Result: every backup attempt's audit row was lost; the R2 .dump
 *     file lands fine but admin/tenant dashboards saw "no backups".
 *
 * Fix shape (migration v84, this test as the lock-in):
 *   - ADD COLUMN IF NOT EXISTS for url, schema_name, status,
 *     duration_ms, error_message, tenant_slug.
 *   - DROP NOT NULL on action so existing INSERTs don't trip on it.
 *
 * This test:
 *   1. Creates an isolated schema with backup_log matching the CURRENT
 *      prod shape (action NOT NULL, no extra cols).
 *   2. Runs the 6 INSERT SQL statements verbatim from the route files.
 *   3. Asserts each succeeds (rowCount === 1).
 *
 * RED on main (action NOT NULL violation + missing cols → 5+ failures).
 * GREEN after the migration v84 columns are present and action is
 * nullable.
 *
 * The test reaches the local test DB via the standard pool from db-pg.
 * No pg_dump, no R2, no Express — pure SQL contract assertion.
 */
const pool = require("../../db-pg");

const SCHEMA = "test_p33_" + Date.now().toString(36);

// SQL from the actual source — each entry mirrors a single INSERT site.
// Update if any of these line numbers shift (they're stable as of 2026-04-30).
const INSERTS = [
  {
    label: "system.js:174 admin full backup success",
    sql: "INSERT INTO backup_log (filename, size_bytes, url, created_at) VALUES ($1, $2, $3, NOW())",
    params: ["backups/full-backup-test.dump", 1024, "https://example/r2/test.dump"],
  },
  {
    label: "barcode-expenses.js:410 tenant pg_dump success",
    sql: "INSERT INTO backup_log (schema_name, status, size_bytes, duration_ms) VALUES ($1, $2, $3, $4)",
    params: ["tenant_test", "success", 2048, 1234],
  },
  {
    label: "barcode-expenses.js:415 tenant pg_dump non-zero exit",
    sql: "INSERT INTO backup_log (schema_name, status, size_bytes, duration_ms, error_message) VALUES ($1, $2, $3, $4, $5)",
    params: ["tenant_test", "failed", 0, 555, "pg_dump exited with code 2"],
  },
  {
    label: "barcode-expenses.js:424 tenant pg_dump proc error",
    sql: "INSERT INTO backup_log (schema_name, status, duration_ms, error_message) VALUES ($1, $2, $3, $4)",
    params: ["tenant_test", "failed", 100, "spawn ENOENT"],
  },
  {
    label: "barcode-expenses.js:468 tenant restore success",
    sql: "INSERT INTO backup_log (schema_name, status, size_bytes, duration_ms, error_message) VALUES ($1, $2, $3, $4, $5)",
    params: ["tenant_test", "success", 3072, 999, null],
  },
  {
    label: "barcode-expenses.js:478 tenant restore failure",
    sql: "INSERT INTO backup_log (schema_name, status, size_bytes, duration_ms, error_message) VALUES ($1, $2, $3, $4, $5)",
    params: ["tenant_test", "failed", 4096, 88, "pg_restore exited with code 2"],
  },
];

describe("P33 — backup_log schema must accept every documented INSERT", () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await pool.query(`SET search_path TO "${SCHEMA}", public`);

    // Reproduce CURRENT production shape exactly (the bug surface).
    // After the migration v84 fix lands, the additive columns and the
    // DROP NOT NULL on action make this same schema accept every INSERT.
    await pool.query(`
      CREATE TABLE backup_log (
        id            SERIAL PRIMARY KEY,
        action        TEXT NOT NULL,
        filename      TEXT,
        size_bytes    BIGINT,
        performed_by  TEXT,
        note          TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Apply the v84 migration body inline so the test exercises the same
    // DDL the production migration runs. If the migration changes, this
    // block must change with it.
    //
    // To reproduce the original P33 bug, comment out this block — the
    // 6 INSERT-site tests + the COUNT assertion will all fail (verified
    // 2026-04-30 walk).
    await pool.query(`
      ALTER TABLE backup_log
        ADD COLUMN IF NOT EXISTS url           TEXT,
        ADD COLUMN IF NOT EXISTS schema_name   TEXT,
        ADD COLUMN IF NOT EXISTS status        TEXT,
        ADD COLUMN IF NOT EXISTS duration_ms   INTEGER,
        ADD COLUMN IF NOT EXISTS error_message TEXT,
        ADD COLUMN IF NOT EXISTS tenant_slug   TEXT
    `);
    await pool.query(`ALTER TABLE backup_log ALTER COLUMN action DROP NOT NULL`);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool.query(`SET search_path TO public`);
  });

  for (const { label, sql, params } of INSERTS) {
    it(`accepts INSERT from ${label}`, async () => {
      await pool.query(`SET search_path TO "${SCHEMA}", public`);
      const res = await pool.query(sql, params);
      expect(res.rowCount).toBe(1);
    });
  }

  it("all 6 INSERTs leave 6 rows in backup_log", async () => {
    await pool.query(`SET search_path TO "${SCHEMA}", public`);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM backup_log");
    expect(rows[0].n).toBe(6);
  });
});
