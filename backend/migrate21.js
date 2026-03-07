const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 21: roles and role_permissions tables");

db.serialize(() => {
  // 1. Create Roles Table
  db.run(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Insert Default Roles
  db.run(`
    INSERT OR IGNORE INTO roles (name, description) VALUES 
    ('Administrator', 'Full access to all system features'),
    ('Manager', 'Access to reporting, stock management, and POS overrides'),
    ('Cashier', 'Standard POS register access')
  `);

  // 3. Create Role Permissions Table
  db.run(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      permission TEXT NOT NULL,
      UNIQUE(role_id, permission)
    )
  `);

  // 4. Insert Default Permissions for Administrator
  db.run(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission) 
    SELECT id, 'all_access' FROM roles WHERE name = 'Administrator'
  `);

  // 5. Add role_id to employees table, default to Cashier (id 3)
  db.run(
    `ALTER TABLE employees ADD COLUMN role_id INTEGER REFERENCES roles(id) DEFAULT 3`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("Error adding role_id:", err.message);
      }
    },
  );

  // 6. Migrate existing string 'role' to 'role_id' mapping
  db.run(
    `UPDATE employees SET role_id = (SELECT id FROM roles WHERE roles.name = employees.role)`,
    (err) => {
      if (err) {
        console.error("Error migrating string roles:", err.message);
      } else {
        console.log("Migration 21 completed successfully.");
      }
      db.close();
    },
  );
});
