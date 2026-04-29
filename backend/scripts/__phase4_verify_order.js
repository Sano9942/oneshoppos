require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const o = await p.query(
      `SELECT id, external_order_id, customer_name_snapshot, customer_email_snapshot,
              subtotal, tax_total, shipping_total, grand_total, currency,
              payment_status, fulfillment_status, order_status, ordered_at, public_order_token
         FROM tenant_livetest1.web_orders
        WHERE public_order_token = '88f0d2d9-0669-4b67-b5a5-42a4a14f33dc'`
    );
    console.log("web_orders row:");
    console.table(o.rows);
    if (o.rows[0]) {
      const items = await p.query(
        `SELECT product_id, sku, title, qty, unit_price, discount, tax, line_total
           FROM tenant_livetest1.web_order_items
          WHERE web_order_id = $1
          ORDER BY id`,
        [o.rows[0].id]
      );
      console.log("\nweb_order_items rows:");
      console.table(items.rows);
    }
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
