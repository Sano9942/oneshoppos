'use strict';

/**
 * reset-production.js
 *
 * Wipes ALL data from sanopos.db and re-seeds the bare minimum:
 *   - 2 employees (Hassan + Admin User)
 *   - 2 roles (Administrator + Manager)
 *   - 1 outlet (Main Store)
 *   - 1 category (General)
 *   - 3 taxes (Exempt, GST 17%, GST 18%)
 *   - 1 blank receipt template
 *   - 1 blank company profile
 *
 * Usage: node backend/reset-production.js
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'sanopos.db')
  : path.resolve(__dirname, 'sanopos.db');

console.log('DB path:', DB_PATH);

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(Object.assign(err, { sql: sql.slice(0, 120) }));
      else resolve(this.lastID);
    });
  });
}

// ── Tables to wipe (order matters for FK constraints) ────────────────────────

const WIPE_TABLES = [
  // Sales
  'sale_payments', 'sale_items', 'sales',
  // Returns
  'return_items', 'returns',
  // Shifts
  'shift_denominations', 'cash_shifts',
  // Parked
  'parked_sale_items', 'parked_sales',
  // Inventory
  'outlet_stock', 'stock_adjustments', 'inventory_transfers',
  'product_media', 'variant_option_values', 'product_variants', 'products',
  // Purchasing
  'grn_items', 'goods_received_notes',
  'purchase_order_items', 'purchase_orders',
  'supplier_invoices', 'supplier_payments',
  'supplier_return_items', 'supplier_returns',
  'suppliers',
  // Customers
  'customer_wallet_ledger', 'customers',
  // Catalog
  'brands', 'categories',
  // Attendance & HR
  'attendance_sessions', 'employee_attendance',
  'leave_requests', 'payroll_lines', 'payroll_periods',
  // Expenses
  'expenses', 'expense_categories',
  // Promotions
  'promotions',
  // Approvals
  'approval_actions', 'approval_requests',
  // Employees & auth
  'employee_outlets', 'employees',
  // Roles
  'role_permissions', 'roles',
  // Outlets
  'outlets',
  // Company
  'company_profile', 'companies',
  // Config
  'receipt_templates', 'printer_config', 'email_config',
  // Attributes
  'attribute_options', 'attributes', 'attribute_sets',
  // Taxes
  'taxes',
  // Shopify
  'shopify_connections', 'shopify_customer_map', 'shopify_location_map',
  'shopify_order_map', 'shopify_product_map', 'shopify_product_metadata',
  'shopify_sync_runs', 'external_sync_events',
  // Orders/quotations
  'web_order_fulfillments', 'web_order_items', 'web_order_transactions', 'web_orders',
  'quotation_items', 'quotations',
  // Reports
  'report_schedule_runs', 'report_schedules', 'saved_report_views',
  'report_delivery_log', 'report_definition_versions',
  // Barcode
  'barcode_print_jobs', 'barcode_templates',
  // Misc
  'action_history', 'notifications', 'backup_log',
  'inventory_reconciliation', 'invoice_sequences',
  'accounting_periods', 'crm_activities', 'crm_leads',
  'feature_flags', 'barcode_templates',
];

async function main() {
  await run('PRAGMA foreign_keys = OFF');
  await run('PRAGMA journal_mode = WAL');

  console.log('\n🗑️  Wiping all tables…');
  for (const table of WIPE_TABLES) {
    try {
      await run(`DELETE FROM ${table}`);
      console.log(`   ✓ ${table}`);
    } catch (e) {
      console.log(`   ⚠ ${table} — ${e.message}`);
    }
  }

  // Reset all auto-increment counters
  await run(`DELETE FROM sqlite_sequence`);
  console.log('   ✓ sqlite_sequence (IDs reset to 1)');

  // ── Roles ──────────────────────────────────────────────────────────────────
  console.log('\n👔 Seeding roles…');
  await run(`INSERT INTO roles (id, name, description) VALUES (1, 'Administrator', 'Full access to all features')`);
  await run(`INSERT INTO roles (id, name, description) VALUES (2, 'Manager', 'Access to most features except admin settings')`);
  await run(`INSERT INTO roles (id, name, description) VALUES (3, 'Cashier', 'Access to POS and basic features')`);
  console.log('   ✓ Administrator, Manager, Cashier');

  // ── Company & Outlet ───────────────────────────────────────────────────────
  console.log('\n🏢 Seeding company & outlet…');
  await run(`INSERT INTO company_profile (id, company_name, timezone) VALUES (1, 'My Store', 'Asia/Karachi')`);
  await run(`INSERT INTO outlets (id, name, address, phone, company_id, is_active) VALUES (1, 'Main Store', '', '', 1, 1)`);
  console.log('   ✓ company_profile, Main Store outlet');

  // ── Employees ──────────────────────────────────────────────────────────────
  console.log('\n👥 Seeding employees…');
  await run(`INSERT INTO employees (id, name, pin_code, role, role_id, salary_type, work_hours_per_day) VALUES (1, 'Hassan', '2580', 'Administrator', 1, 'monthly', 8)`);
  await run(`INSERT INTO employees (id, name, pin_code, role, role_id, salary_type, work_hours_per_day) VALUES (2, 'Admin User', '1234', 'Manager', 2, 'monthly', 8)`);
  await run(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (1, 1, 1)`);
  await run(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (2, 1, 1)`);
  console.log('   ✓ Hassan (2580), Admin User (1234)');

  // ── Taxes ──────────────────────────────────────────────────────────────────
  console.log('\n💰 Seeding taxes…');
  await run(`INSERT INTO taxes (id, name, rate, is_default) VALUES (1, 'Tax Exempt', 0, 1)`);
  await run(`INSERT INTO taxes (id, name, rate, is_default) VALUES (2, 'GST 17%', 17, 0)`);
  await run(`INSERT INTO taxes (id, name, rate, is_default) VALUES (3, 'GST 18%', 18, 0)`);
  console.log('   ✓ Tax Exempt, GST 17%, GST 18%');

  // ── Category ───────────────────────────────────────────────────────────────
  console.log('\n🗂️  Seeding category…');
  await run(`INSERT INTO categories (id, name, description, parent_id, is_active) VALUES (1, 'General', 'Default category', NULL, 1)`);
  console.log('   ✓ General');

  // ── Receipt template ───────────────────────────────────────────────────────
  console.log('\n🧾 Seeding receipt template…');
  await run(`INSERT INTO receipt_templates (id, name, header_text, footer_text, show_barcode, show_logo, is_active) VALUES (1, 'Default', 'Thank you for shopping!', 'Please come again.', 0, 0, 1)`);
  console.log('   ✓ Default receipt template');

  await run('PRAGMA foreign_keys = ON');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅  RESET COMPLETE — production DB is clean');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Employees : Hassan (2580), Admin User (1234)');
  console.log('  Outlet    : Main Store');
  console.log('  Category  : General');
  console.log('  Taxes     : Exempt, GST 17%, GST 18%');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  db.close();
}

main().catch(err => {
  console.error('\n❌ Reset failed:', err.message);
  if (err.sql) console.error('   SQL:', err.sql);
  db.close();
  process.exit(1);
});
