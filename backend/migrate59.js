const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.resolve(__dirname, "oneshop.db"));

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
    const broken = await get(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('products', 'promotions')
         AND sql LIKE '%categories_old%'`,
    );
    if (!Number(broken?.count || 0)) {
      console.log("migrate59: category FK references already repaired.");
      return;
    }

    const schemaVersionRow = await get("PRAGMA schema_version");
    const nextSchemaVersion = Number(schemaVersionRow?.schema_version || 0) + 1;

    await run("PRAGMA writable_schema = ON");
    await run("BEGIN TRANSACTION");
    await run(
      `UPDATE sqlite_master
       SET sql = REPLACE(sql, '"categories_old"', 'categories')
       WHERE type = 'table'
         AND name IN ('products', 'promotions')
         AND sql LIKE '%\"categories_old\"%'`,
    );
    await run(
      `UPDATE sqlite_master
       SET sql = REPLACE(sql, 'categories_old', 'categories')
       WHERE type = 'table'
         AND name IN ('products', 'promotions')
         AND sql LIKE '%categories_old%'`,
    );
    await run(`PRAGMA schema_version = ${nextSchemaVersion}`);
    await run("COMMIT");
    await run("PRAGMA writable_schema = OFF");
    console.log(
      "migrate59: repaired products/promotions category foreign keys to reference categories.",
    );
  } catch (error) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // Ignore rollback failures after failed migration.
    }
    try {
      await run("PRAGMA writable_schema = OFF");
    } catch (_) {
      // Ignore pragma restore failures on fatal errors.
    }
    console.error("migrate59:", error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
