/**
 * 3-14: Inspect sale_items rows for INV-2026-00004 to check whether
 * per-line GST rate is preserved at the data layer (mixed-rate sale:
 * 1x Coffee Beans 17% + 2x Snack Bar 5%).
 *
 * Run: railway run --service oneshoppos node backend/scripts/3-14-inspect-sale-tax.js
 */

const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = 'tenant_livetest1';

  const sale = await pool.query(
    `SELECT * FROM ${schema}.sales WHERE invoice_number = 'INV-2026-00004'`
  );
  console.log('=== Sale ===');
  console.log(JSON.stringify(sale.rows, null, 2));

  const saleCols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'sales'
     ORDER BY ordinal_position`,
    [schema]
  );
  console.log('\n=== sales columns ===');
  saleCols.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  if (!sale.rows.length) {
    await pool.end();
    return;
  }

  const saleId = sale.rows[0].id;
  const items = await pool.query(
    `SELECT * FROM ${schema}.sale_items WHERE sale_id = $1 ORDER BY id`,
    [saleId]
  );
  console.log('\n=== Sale Items ===');
  console.log(JSON.stringify(items.rows, null, 2));

  // Also list column names so we can see what's actually persisted
  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'sale_items'
     ORDER BY ordinal_position`,
    [schema]
  );
  console.log('\n=== sale_items columns ===');
  cols.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  await pool.end();
})();
