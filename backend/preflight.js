const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

const REQUIRED_TABLES = [
  "sales",
  "sale_items",
  "sale_payments",
  "backup_log",
  "invoice_sequences",
  "feature_flags",
];

const REQUIRED_COLUMNS = [
  { table: "sales", column: "invoice_number" },
];

const REQUIRED_INDEXES = [
  "idx_sales_invoice_number",
  "uq_sales_invoice_number",
  "idx_sales_timestamp",
  "idx_sale_items_sale_id",
  "idx_sale_payments_sale_id",
];

function getAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function run() {
  try {
    const tableRows = await getAll(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${REQUIRED_TABLES
        .map(() => "?")
        .join(",")})`,
      REQUIRED_TABLES
    );
    const existingTables = new Set(tableRows.map((r) => r.name));
    const missingTables = REQUIRED_TABLES.filter((t) => !existingTables.has(t));

    const missingColumns = [];
    for (const tc of REQUIRED_COLUMNS) {
      // PRAGMA table_info does not support parameter binding in sqlite3.
      // The table names here are hard-coded constants.
      const cols = await getAll(`PRAGMA table_info(${tc.table})`);
      const hasColumn = cols.some((c) => c.name === tc.column);
      if (!hasColumn) missingColumns.push(`${tc.table}.${tc.column}`);
    }

    const indexRows = await getAll(
      `SELECT name FROM sqlite_master WHERE type='index' AND name IN (${REQUIRED_INDEXES
        .map(() => "?")
        .join(",")})`,
      REQUIRED_INDEXES
    );
    const existingIndexes = new Set(indexRows.map((r) => r.name));
    const missingIndexes = REQUIRED_INDEXES.filter((i) => !existingIndexes.has(i));

    const quickCheck = await getAll("PRAGMA quick_check");
    const quickCheckValue = quickCheck?.[0] ? Object.values(quickCheck[0])[0] : "unknown";
    const dbOk = String(quickCheckValue).toLowerCase() === "ok";

    console.log("=== PRE-FLIGHT CHECK ===");
    console.log("Database:", dbPath);
    console.log("Integrity:", quickCheckValue);
    console.log("Missing tables:", missingTables.length ? missingTables.join(", ") : "none");
    console.log("Missing columns:", missingColumns.length ? missingColumns.join(", ") : "none");
    console.log("Missing indexes:", missingIndexes.length ? missingIndexes.join(", ") : "none");

    if (!dbOk || missingTables.length || missingColumns.length || missingIndexes.length) {
      process.exitCode = 1;
    } else {
      console.log("Preflight passed.");
    }
  } catch (err) {
    console.error("Preflight failed:", err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

run();
