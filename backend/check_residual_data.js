const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("--- SHOPIFY INTEGRATION RESIDUAL DATA AUDIT ---");

const queries = [
  {
    name: "Unmapped Products/Variants",
    sql: `SELECT COUNT(*) as count FROM (
            SELECT p.id FROM products p 
            LEFT JOIN product_variants pv ON pv.product_id = p.id 
            EXCEPT 
            SELECT CASE WHEN variant_id IS NOT NULL THEN variant_id ELSE product_id END 
            FROM shopify_product_map 
            WHERE is_active = 1
          )`,
  },
  {
    name: "Unmapped Locations (Outlets)",
    sql: `SELECT COUNT(*) as count FROM (
            SELECT id FROM outlets 
            EXCEPT 
            SELECT outlet_id FROM shopify_location_map
          )`,
  },
  {
    name: "Pending Sync Events",
    sql: `SELECT COUNT(*) as count FROM external_sync_events WHERE status IN ('pending', 'retry')`,
  },
  {
    name: "Failed/Dead Sync Events",
    sql: `SELECT COUNT(*) as count FROM external_sync_events WHERE status IN ('failed', 'dead_letter', 'failed_mapping')`,
  },
  {
    name: "Open Web Orders",
    sql: `SELECT COUNT(*) as count FROM web_orders WHERE order_status != 'closed'`,
  },
  {
    name: "Unmapped Customers",
    sql: `SELECT COUNT(*) as count FROM (
            SELECT id FROM customers 
            EXCEPT 
            SELECT customer_id FROM shopify_customer_map
          )`,
  },
];

let completed = 0;
queries.forEach((q) => {
  db.get(q.sql, (err, row) => {
    if (err) {
      console.error(`Error in ${q.name}:`, err.message);
    } else {
      console.log(`${q.name.padEnd(30)}: ${row.count}`);
    }
    completed++;
    if (completed === queries.length) {
      db.close();
    }
  });
});
