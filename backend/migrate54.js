/**
 * migrate54.js — Fix expenses table: shift_id FK pointed to non-existent
 * "shifts" table (actual table name is "cash_shifts").
 * SQLite does not support ALTER COLUMN so we rename + recreate.
 *
 * This migration is rerun-safe:
 * - if a previous partial run left `expenses_old`, it will recover cleanly
 * - if `expenses` already points to `cash_shifts`, it exits without changes
 */
const db = require("./db");

function closeSoon() {
  setTimeout(() => db.close(), 150);
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function tableExists(name) {
  const row = await getAsync(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name],
  );
  return Boolean(row);
}

async function expenseShiftFkIsCorrect() {
  const rows = await allAsync(`PRAGMA foreign_key_list(expenses)`);
  const shiftFk = rows.find((row) => String(row.from || "") === "shift_id");
  return !shiftFk || String(shiftFk.table || "") === "cash_shifts";
}

async function recreateExpensesFrom(sourceTable) {
  await runAsync(
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
  );

  await runAsync(
    `INSERT OR IGNORE INTO expenses
       SELECT id, category_id, outlet_id, shift_id, employee_id,
              amount, description, reference, expense_date, created_at
       FROM ${sourceTable}`,
  );
}

db.serialize(() => {
  (async () => {
    try {
      const hasExpenses = await tableExists("expenses");
      const hasExpensesOld = await tableExists("expenses_old");

      if (!hasExpenses && !hasExpensesOld) {
        console.log("migrate54: no expenses table present; nothing to do.");
        closeSoon();
        return;
      }

      if (hasExpenses && (await expenseShiftFkIsCorrect())) {
        if (hasExpensesOld) {
          await runAsync(`DROP TABLE IF EXISTS expenses_old`);
          console.log("migrate54: dropped stale expenses_old table.");
        }
        console.log("migrate54: expenses table already uses cash_shifts FK.");
        closeSoon();
        return;
      }

      if (!hasExpenses && hasExpensesOld) {
        await recreateExpensesFrom("expenses_old");
        await runAsync(`DROP TABLE IF EXISTS expenses_old`);
        console.log("migrate54: recovered from stale expenses_old table.");
        closeSoon();
        return;
      }

      if (hasExpensesOld) {
        await runAsync(`DROP TABLE IF EXISTS expenses_old`);
        console.log("migrate54: removed stale expenses_old before rebuild.");
      }

      await runAsync(`ALTER TABLE expenses RENAME TO expenses_old`);
      await recreateExpensesFrom("expenses_old");
      await runAsync(`DROP TABLE IF EXISTS expenses_old`);
      console.log("migrate54: expenses table recreated with correct FK.");
      closeSoon();
    } catch (err) {
      console.error("migrate54:", err.message);
      closeSoon();
    }
  })();
});
