#!/usr/bin/env node
/**
 * sqlite-to-pg.js — One-time data migration from SQLite to Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node backend/scripts/sqlite-to-pg.js [path/to/sanopos.db]
 *
 * Defaults to backend/sanopos.db if no path argument given.
 * Requires: npm install better-sqlite3 (synchronous reads for simplicity)
 */

const fs = require("fs");
const path = require("path");

// Table migration order — respects foreign key dependencies.
const TABLE_ORDER = [
  // Foundation (no FK deps)
  "categories",
  "taxes",
  "brands",
  "suppliers",
  "roles",
  "company_profile",

  // Depends on roles
  "role_permissions",

  // Depends on roles, categories
  "employees",

  // Depends on employees
  "employee_outlets",
  "employee_attendance",
  "attendance_sessions",

  // Depends on categories, brands, taxes
  "products",
  "product_variants",
  "product_images",
  "product_taxes",
  "attribute_sets",
  "attribute_set_values",

  // Outlets
  "outlets",
  "outlet_stock",

  // Customers
  "customers",
  "customer_wallet",
  "loyalty_points",
  "loyalty_transactions",

  // Sales
  "invoice_sequences",
  "cash_shifts",
  "sales",
  "sale_items",
  "sale_payments",
  "sale_commissions",
  "returns",
  "return_items",

  // Inventory
  "inventory_transfers",
  "transfer_items",
  "stock_adjustments",
  "adjustment_items",

  // Purchase orders
  "purchase_orders",
  "purchase_order_items",
  "goods_received_notes",
  "grn_items",
  "supplier_invoices",
  "supplier_payments",

  // Promotions
  "promotions",
  "promotion_categories",
  "promotion_products",
  "promotion_outlets",

  // Feature flags
  "feature_flags",

  // Shopify
  "shopify_connections",
  "shopify_location_map",
  "shopify_product_metadata",
  "external_sync_events",
  "web_orders",
  "web_order_items",

  // Reports & governance
  "report_schedules",
  "report_schedule_runs",
  "report_delivery_log",
  "saved_report_views",

  // Misc
  "action_history",
  "notifications",
  "parked_sales",
  "parked_sale_items",
  "barcode_templates",
  "receipt_templates",
  "printer_config",
  "email_config",
  "backup_log",
  "expenses",

  // Tier 4
  "crm_activities",
  "quotations",
  "quotation_items",
  "accounting_journal",
  "payroll_items",
  "approval_requests",
  "approval_steps",

  // Reconciliation
  "inventory_reconciliation",
  "reconciliation_items",
  "reconciliation_adjustments",

  // Serial numbers & gift cards
  "serial_numbers",
  "gift_cards",

  // Supplier returns
  "supplier_returns",
  "supplier_return_items",

  // Token revocation
  "revoked_tokens",

  // Schema version
  "schema_version",
];

// Boolean columns per table (SQLite stores as 0/1, Postgres needs true/false)
const BOOLEAN_COLUMNS = {
  categories: ["is_active"],
  taxes: ["is_default"],
  employees: ["is_active"],
  employee_outlets: ["is_primary"],
  products: ["is_active"],
  product_variants: ["is_active"],
  promotions: ["active", "auto_apply"],
  feature_flags: ["enabled"],
  shopify_connections: ["is_active"],
  receipt_templates: ["is_active", "show_barcode", "show_logo"],
  barcode_templates: ["show_name", "show_price", "show_barcode", "show_sku", "show_brand", "is_default"],
  printer_config: ["cash_drawer", "is_active"],
  email_config: ["enabled"],
  notifications: ["is_read"],
  web_orders: ["stock_applied"],
  company_profile: ["setup_complete"],
  outlets: ["is_active"],
  sales: ["is_exchange"],
  returns: ["voided"],
};

async function main() {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.error("ERROR: better-sqlite3 is required. Run: npm install better-sqlite3");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL env var is required.");
    process.exit(1);
  }

  const sqlitePath = process.argv[2] || path.join(__dirname, "..", "sanopos.db");
  if (!fs.existsSync(sqlitePath)) {
    console.error(`ERROR: SQLite DB not found at ${sqlitePath}`);
    process.exit(1);
  }

  const db = require("../db-pg");
  const schemaSql = fs.readFileSync(path.join(__dirname, "..", "schema-pg.sql"), "utf8");

  console.log(`[sqlite-to-pg] Source: ${sqlitePath}`);
  console.log(`[sqlite-to-pg] Target: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}\n`);

  // Step 1: Ensure Postgres schema exists
  console.log("[sqlite-to-pg] Applying schema-pg.sql...");
  await db.query(schemaSql);

  // Step 2: Open SQLite
  const sqlite = new Database(sqlitePath, { readonly: true });

  // Step 3: Get list of tables that actually exist in SQLite
  const sqliteTables = new Set(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );

  let totalRows = 0;
  let tablesProcessed = 0;

  for (const table of TABLE_ORDER) {
    if (!sqliteTables.has(table)) {
      console.log(`  [skip] ${table} — not in SQLite`);
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
    if (rows.length === 0) {
      console.log(`  [skip] ${table} — empty`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const boolCols = new Set(BOOLEAN_COLUMNS[table] || []);

    function convertValue(col, val) {
      if (val === null || val === undefined) return null;
      if (boolCols.has(col)) return val === 1 || val === true || val === "1";
      return val;
    }

    // Bulk insert in a transaction
    const placeholderRow = columns.map((_, i) => `$${i + 1}`).join(", ");
    const insertSql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholderRow}) ON CONFLICT DO NOTHING`;

    await db.transaction(async (client) => {
      for (const row of rows) {
        const values = columns.map((col) => convertValue(col, row[col]));
        await client.query(insertSql, values);
      }
    });

    // Reset sequence for SERIAL columns
    try {
      await db.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`
      );
    } catch {
      // Table may not have a serial 'id' column — ignore
    }

    totalRows += rows.length;
    tablesProcessed++;
    console.log(`  [done] ${table} — ${rows.length} rows`);
  }

  sqlite.close();
  console.log(`\n[sqlite-to-pg] Migration complete: ${tablesProcessed} tables, ${totalRows} rows`);

  // Insert schema version
  await db.query("INSERT INTO schema_version (version) VALUES (1) ON CONFLICT DO NOTHING");

  await db.end();
}

main().catch((err) => {
  console.error("[sqlite-to-pg] FATAL:", err.message);
  process.exit(1);
});
