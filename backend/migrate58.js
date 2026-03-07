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

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function main() {
  try {
    const duplicateSibling = await get(
      `SELECT parent_id, lower(name) AS normalized_name, COUNT(*) AS count
       FROM categories
       GROUP BY COALESCE(parent_id, -1), lower(name)
       HAVING COUNT(*) > 1
       LIMIT 1`,
    );
    if (duplicateSibling) {
      throw new Error(
        "migrate58: duplicate sibling category names exist; fix them before applying sibling-unique categories.",
      );
    }

    await run("PRAGMA foreign_keys = OFF");
    await run("BEGIN TRANSACTION");
    await run(`DROP INDEX IF EXISTS idx_categories_parent_name_unique`);
    await run(`ALTER TABLE categories RENAME TO categories_old`);
    await run(`CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )`);
    await run(
      `INSERT INTO categories (id, name, description, parent_id, sort_order, is_active)
       SELECT id, name, description, parent_id, sort_order, is_active
       FROM categories_old`,
    );
    await run(`DROP TABLE categories_old`);
    await run(
      `CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`,
    );
    await run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_parent_name_unique
       ON categories(COALESCE(parent_id, -1), lower(name))`,
    );
    await run("COMMIT");
    await run("PRAGMA foreign_keys = ON");
    console.log(
      "migrate58: categories rebuilt with sibling-level unique names instead of global unique names.",
    );
  } catch (error) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // Ignore rollback failures after a failed transaction.
    }
    try {
      await run("PRAGMA foreign_keys = ON");
    } catch (_) {
      // Ignore restore failures on fatal migration errors.
    }
    console.error("migrate58:", error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
