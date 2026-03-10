const path = require("path");
const Database = require("sqlite3").verbose().Database;

const DB_PATH = path.resolve(__dirname, "sanopos.db");
const db = new Database(DB_PATH);

db.serialize(() => {
  // 1. Create revoked_tokens table
  db.run(
    `CREATE TABLE IF NOT EXISTS revoked_tokens (
      id INTEGER PRIMARY KEY,
      token_jti TEXT UNIQUE NOT NULL,
      employee_id INTEGER,
      revoked_by INTEGER,
      reason TEXT,
      revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    (err) => {
      if (err) console.error("Error creating revoked_tokens:", err.message);
      else console.log("migrate74: revoked_tokens table created (or already exists)");
    }
  );

  // 2. Create index on token_jti
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(token_jti)",
    (err) => {
      if (err) console.error("Error creating index:", err.message);
    }
  );

  // 3. Add tokens_revoked_before column to employees
  db.run(
    "ALTER TABLE employees ADD COLUMN tokens_revoked_before DATETIME DEFAULT NULL",
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("Error adding tokens_revoked_before:", err.message);
      } else if (!err) {
        console.log("Added tokens_revoked_before to employees");
      } else {
        console.log("employees.tokens_revoked_before already exists — skipping");
      }

      // Close DB after all operations
      db.close((closeErr) => {
        if (closeErr) console.error("Close error:", closeErr.message);
        else console.log("migrate74: token revocation schema applied.");
      });
    }
  );
});
