const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const DB_PATH = path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  // 0. Ensure outlets.is_active exists (original CREATE TABLE omitted it)
  db.run(
    "ALTER TABLE outlets ADD COLUMN is_active INTEGER DEFAULT 1",
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("migrate61 outlets.is_active:", err.message);
      }
    }
  );

  // 1. Companies table (seeded from company_profile singleton)
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      code        TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Seed baseline company from company_profile
  db.run(`
    INSERT OR IGNORE INTO companies (id, name, code, is_active)
      SELECT 1,
             COALESCE(cp.company_name, 'Default Company'),
             COALESCE(cp.trading_name, 'DEFAULT'),
             1
      FROM company_profile cp WHERE cp.id = 1
  `);

  // Fallback if company_profile is empty
  db.run(`
    INSERT OR IGNORE INTO companies (id, name, code, is_active)
      VALUES (1, 'Default Company', 'DEFAULT', 1)
  `);

  // 2. Employee-outlet junction table (many-to-many)
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_outlets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      outlet_id   INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
      is_primary  INTEGER NOT NULL DEFAULT 0,
      assigned_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(employee_id, outlet_id)
    )
  `);

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_eo_employee ON employee_outlets(employee_id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_eo_outlet ON employee_outlets(outlet_id)"
  );

  // 3. Ensure all outlets have valid company_id
  db.run("UPDATE outlets SET company_id = 1 WHERE company_id IS NULL");

  // 4. Seed employee_outlets: cross-join all employees x active outlets
  //    Preserves current zero-restriction behavior — every employee gets all outlets.
  //    First active outlet gets is_primary = 1.
  db.run(`
    INSERT OR IGNORE INTO employee_outlets (employee_id, outlet_id, is_primary)
      SELECT e.id, o.id,
             CASE WHEN o.id = (SELECT MIN(id) FROM outlets WHERE is_active = 1) THEN 1 ELSE 0 END
      FROM employees e
      CROSS JOIN outlets o
      WHERE o.is_active = 1
  `);

  // 5. Context-related feature flags
  db.run(`
    INSERT OR IGNORE INTO feature_flags (key, enabled, description)
      VALUES ('context_selection_required', 0, 'Require outlet/branch selection after login')
  `);
  db.run(`
    INSERT OR IGNORE INTO feature_flags (key, enabled, description)
      VALUES ('context_header_enforced', 0, 'Enforce x-company-id/x-outlet-id headers on API requests')
  `);
  db.run(`
    INSERT OR IGNORE INTO feature_flags (key, enabled, description)
      VALUES ('kiosk_context_locked', 0, 'Lock kiosk to inherited outlet context')
  `);

  console.log("migrate61: companies, employee_outlets, context flags — done");
});

db.close();
