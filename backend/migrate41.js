const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 41: Shopify alignment foundation");

function runSafe(sql, okMessage) {
  db.run(sql, (err) => {
    if (err && !String(err.message || "").includes("duplicate column")) {
      console.error("Migration 41 error:", err.message);
    } else if (okMessage) {
      console.log(okMessage);
    }
  });
}

db.serialize(() => {
  // Product parity columns
  runSafe(
    "ALTER TABLE products ADD COLUMN description_html TEXT",
    "products.description_html ready",
  );
  runSafe(
    "ALTER TABLE products ADD COLUMN compare_at_price REAL DEFAULT 0",
    "products.compare_at_price ready",
  );
  runSafe(
    "ALTER TABLE products ADD COLUMN product_type TEXT",
    "products.product_type ready",
  );
  runSafe(
    "ALTER TABLE products ADD COLUMN vendor TEXT",
    "products.vendor ready",
  );
  runSafe(
    "ALTER TABLE products ADD COLUMN tags TEXT",
    "products.tags ready",
  );
  runSafe(
    "ALTER TABLE products ADD COLUMN status TEXT DEFAULT 'active'",
    "products.status ready",
  );

  // Variant parity columns
  runSafe(
    "ALTER TABLE product_variants ADD COLUMN weight REAL DEFAULT 0",
    "product_variants.weight ready",
  );
  runSafe(
    "ALTER TABLE product_variants ADD COLUMN weight_unit TEXT DEFAULT 'kg'",
    "product_variants.weight_unit ready",
  );
  runSafe(
    "ALTER TABLE product_variants ADD COLUMN compare_at_price REAL DEFAULT 0",
    "product_variants.compare_at_price ready",
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS product_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      url TEXT NOT NULL,
      alt_text TEXT,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_product_media_product_id ON product_media(product_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_product_media_variant_id ON product_media(variant_id)",
  );

  // Mapping tables
  db.run(
    `CREATE TABLE IF NOT EXISTS shopify_product_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      shopify_product_id TEXT,
      shopify_variant_id TEXT,
      shopify_inventory_item_id TEXT,
      is_active INTEGER DEFAULT 1,
      last_verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(product_id, variant_id),
      UNIQUE(shopify_product_id, shopify_variant_id)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS shopify_location_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outlet_id INTEGER NOT NULL REFERENCES outlets(id),
      shopify_location_id TEXT NOT NULL,
      shopify_location_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(outlet_id, shopify_location_id)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS shopify_customer_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      shopify_customer_id TEXT NOT NULL UNIQUE,
      last_synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
  );

  // Website orders staging
  db.run(
    `CREATE TABLE IF NOT EXISTS web_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'shopify',
      external_order_id TEXT NOT NULL,
      external_order_number TEXT,
      customer_id INTEGER REFERENCES customers(id),
      outlet_id INTEGER REFERENCES outlets(id),
      currency TEXT DEFAULT 'PKR',
      subtotal REAL DEFAULT 0,
      discount_total REAL DEFAULT 0,
      tax_total REAL DEFAULT 0,
      shipping_total REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
      fulfillment_status TEXT DEFAULT 'unfulfilled',
      order_status TEXT DEFAULT 'open',
      ordered_at TEXT,
      raw_payload TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(source, external_order_id)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS web_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      sku TEXT,
      barcode TEXT,
      title TEXT,
      qty INTEGER NOT NULL,
      unit_price REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      line_total REAL DEFAULT 0
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS web_order_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
      external_txn_id TEXT,
      gateway TEXT,
      kind TEXT,
      status TEXT,
      amount REAL DEFAULT 0,
      processed_at TEXT,
      raw_payload TEXT
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS web_order_fulfillments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
      external_fulfillment_id TEXT,
      status TEXT,
      carrier TEXT,
      tracking_number TEXT,
      tracking_url TEXT,
      fulfilled_at TEXT,
      raw_payload TEXT
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS shopify_order_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_order_id INTEGER REFERENCES web_orders(id),
      sale_id INTEGER REFERENCES sales(id),
      shopify_order_id TEXT NOT NULL UNIQUE,
      shopify_order_number TEXT,
      last_synced_at TEXT
    )`,
  );

  // Sync/reconciliation foundation
  db.run(
    `CREATE TABLE IF NOT EXISTS external_sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      processed_at TEXT
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS inventory_reconciliation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      outlet_id INTEGER REFERENCES outlets(id),
      external_location_id TEXT,
      local_qty REAL DEFAULT 0,
      external_qty REAL DEFAULT 0,
      diff REAL DEFAULT 0,
      status TEXT DEFAULT 'mismatch',
      checked_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Migration 41 error:", err.message);
      else console.log("Migration 41 complete.");
      db.close();
    },
  );
});
