const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.resolve(__dirname, "sanopos.db"));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function main() {
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS shopify_product_metadata (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        shopify_product_id    TEXT NOT NULL,
        shopify_handle        TEXT,
        shopify_status        TEXT,
        shopify_product_type  TEXT,
        shopify_vendor        TEXT,
        shopify_tags          TEXT,
        shopify_published_at  TEXT,
        shopify_updated_at    TEXT,
        last_imported_at      TEXT DEFAULT (datetime('now','localtime')),
        created_at            TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(product_id),
        UNIQUE(shopify_product_id)
      )
    `);

    await run(`
      CREATE INDEX IF NOT EXISTS idx_spm_shopify_product_id
        ON shopify_product_metadata(shopify_product_id)
    `);

    console.log("migrate60: shopify_product_metadata table ready.");
  } catch (error) {
    console.error("migrate60:", error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
