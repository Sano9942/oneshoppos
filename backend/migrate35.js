const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 35: expense_categories + expenses");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating expense_categories:", err.message);
      else console.log("expense_categories table ready.");
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES expense_categories(id),
      outlet_id INTEGER REFERENCES outlets(id),
      shift_id INTEGER REFERENCES shifts(id),
      employee_id INTEGER REFERENCES employees(id),
      amount REAL NOT NULL,
      description TEXT,
      reference TEXT,
      expense_date TEXT NOT NULL DEFAULT (date('now','localtime')),
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating expenses:", err.message);
      else console.log("expenses table ready.");
    }
  );

  // Seed common expense categories
  const cats = ["Rent", "Utilities", "Salaries", "Marketing", "Supplies", "Maintenance", "Other"];
  cats.forEach((name) => {
    db.run("INSERT OR IGNORE INTO expense_categories (name) VALUES (?)", [name]);
  });

  setTimeout(() => {
    db.close(() => console.log("Migration 35 complete."));
  }, 500);
});
