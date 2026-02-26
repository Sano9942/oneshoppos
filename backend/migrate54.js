/**
 * migrate54.js — Fix expenses table: shift_id FK pointed to non-existent
 * "shifts" table (actual table name is "cash_shifts").
 * SQLite does not support ALTER COLUMN so we rename + recreate.
 */
const db = require("./db");

db.serialize(() => {
  db.run(`ALTER TABLE expenses RENAME TO expenses_old`, (err) => {
    if (err) {
      if (!err.message.includes("no such table")) {
        console.error("migrate54 rename:", err.message);
      }
      db.close();
      return;
    }

    db.run(
      `CREATE TABLE IF NOT EXISTS expenses (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id  INTEGER REFERENCES expense_categories(id),
        outlet_id    INTEGER REFERENCES outlets(id),
        shift_id     INTEGER REFERENCES cash_shifts(id),
        employee_id  INTEGER REFERENCES employees(id),
        amount       REAL NOT NULL,
        description  TEXT,
        reference    TEXT,
        expense_date TEXT NOT NULL DEFAULT (date('now','localtime')),
        created_at   TEXT DEFAULT (datetime('now','localtime'))
      )`,
      (err2) => {
        if (err2) {
          console.error("migrate54 create:", err2.message);
          db.close();
          return;
        }
        console.log("migrate54: expenses table recreated with correct FK.");

        db.run(
          `INSERT OR IGNORE INTO expenses
             SELECT id, category_id, outlet_id, shift_id, employee_id,
                    amount, description, reference, expense_date, created_at
             FROM expenses_old`,
          (err3) => {
            if (err3) console.error("migrate54 copy:", err3.message);
            else console.log("migrate54: data copied.");

            db.run(`DROP TABLE IF EXISTS expenses_old`, (err4) => {
              if (err4) console.error("migrate54 drop old:", err4.message);
              else console.log("migrate54: expenses_old dropped. Done.");
              setTimeout(() => db.close(), 200);
            });
          },
        );
      },
    );
  });
});
