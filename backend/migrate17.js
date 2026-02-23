const db = require("./db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_attendance (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      outlet_id   INTEGER NOT NULL REFERENCES outlets(id),
      check_in    DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      check_out   DATETIME,
      hours       REAL,
      status      TEXT NOT NULL DEFAULT 'present',
      comment     TEXT
    )
  `, (err) => {
    if (err) console.error("Failed to create employee_attendance:", err.message);
    else console.log("employee_attendance table ready.");
    db.close();
  });
});
