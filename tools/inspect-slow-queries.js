#!/usr/bin/env node
// Read-only slow-query inspector. Connects to DATABASE_URL, queries
// pg_stat_statements (must be enabled on the server), prints the top-N
// slowest queries by total time. Safe to run against production.
//
// Usage:
//   DATABASE_URL=postgres://... node tools/inspect-slow-queries.js [limit]
//
// Default limit: 20.
//
// On Supabase: pg_stat_statements is enabled in the dashboard under
// Database > Extensions. If the extension is missing the script prints
// instructions and exits 1 instead of crashing.

const { Pool } = require("pg");

const limit = Math.max(1, Math.min(parseInt(process.argv[2], 10) || 20, 100));
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set. Export it before running.");
  process.exit(2);
}

const pool = new Pool({ connectionString: url, max: 2 });

function fmtMs(ms) {
  if (ms == null) return "-";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(2)} ms`;
}

function truncate(s, n) {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "\u2026" : flat;
}

async function main() {
  const ext = await pool.query(
    "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'"
  );
  if (ext.rowCount === 0) {
    console.error(
      "pg_stat_statements is not installed on this database.\n" +
        "Enable it (Supabase: Database > Extensions > pg_stat_statements),\n" +
        "wait a few minutes for query data to accumulate, then re-run."
    );
    process.exit(1);
  }

  // Column names changed between PG versions. PG13+ uses total_exec_time;
  // older uses total_time. Try the new name first, fall back to legacy.
  const sqlNew = `
    SELECT
      calls,
      total_exec_time      AS total_ms,
      mean_exec_time       AS mean_ms,
      max_exec_time        AS max_ms,
      rows,
      query
    FROM pg_stat_statements
    WHERE query NOT ILIKE '%pg_stat_statements%'
      AND query NOT ILIKE 'EXPLAIN%'
      AND query NOT ILIKE 'BEGIN%'
      AND query NOT ILIKE 'COMMIT%'
      AND query NOT ILIKE 'ROLLBACK%'
    ORDER BY total_exec_time DESC
    LIMIT $1
  `;
  const sqlLegacy = sqlNew
    .replace("total_exec_time", "total_time")
    .replace("mean_exec_time", "mean_time")
    .replace("max_exec_time", "max_time")
    .replace("ORDER BY total_exec_time", "ORDER BY total_time");

  let result;
  try {
    result = await pool.query(sqlNew, [limit]);
  } catch (err) {
    if (err && err.code === "42703") {
      result = await pool.query(sqlLegacy, [limit]);
    } else {
      throw err;
    }
  }

  if (result.rowCount === 0) {
    console.log("pg_stat_statements is empty. Wait for traffic and re-run.");
    return;
  }

  console.log(`Top ${result.rowCount} slow queries by total time:\n`);
  result.rows.forEach((row, i) => {
    console.log(`#${i + 1}  calls=${row.calls}  total=${fmtMs(Number(row.total_ms))}  mean=${fmtMs(Number(row.mean_ms))}  max=${fmtMs(Number(row.max_ms))}  rows=${row.rows}`);
    console.log(`     ${truncate(row.query, 220)}`);
    console.log("");
  });
}

main()
  .catch((err) => {
    console.error("inspect-slow-queries failed:", err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
