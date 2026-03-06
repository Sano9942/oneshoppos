// backend/schema-full.js
// Extracts the full schema from the live sanopos.db.
// Returns a SQL string ready to be exec'd against a fresh SQLite DB.

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function extractSchema() {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(__dirname, 'sanopos.db');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`Cannot open sanopos.db: ${err.message}`));

      db.all(
        `SELECT sql FROM sqlite_master
         WHERE type IN ('table', 'index')
           AND sql IS NOT NULL
           AND name NOT LIKE 'sqlite_%'
         ORDER BY type DESC, name ASC`,
        [],
        (err, rows) => {
          db.close((closeErr) => {
            if (closeErr) console.error('[schema-full] db close error:', closeErr.message);
          });
          if (err) return reject(err);
          const sql = rows.map(r => r.sql + ';').join('\n\n');
          resolve(sql);
        }
      );
    });
  });
}

module.exports = { extractSchema };
