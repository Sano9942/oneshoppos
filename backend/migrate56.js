const db = require("./db");

db.serialize(() => {
  // Add working hours per day to employees (default 8h/day)
  db.run(
    `ALTER TABLE employees ADD COLUMN work_hours_per_day REAL DEFAULT 8`,
    (err) => {
      if (err && !err.message.includes("duplicate column"))
        console.error("migrate56 work_hours_per_day:", err.message);
    }
  );

  // Add monthly leave allowance to employees (default 2 days/month)
  db.run(
    `ALTER TABLE employees ADD COLUMN monthly_leave_allowance INTEGER DEFAULT 2`,
    (err) => {
      if (err && !err.message.includes("duplicate column"))
        console.error("migrate56 monthly_leave_allowance:", err.message);
    }
  );

  // Session-level attendance tracking — each contiguous work or break segment
  // session_type: 'work' | 'break'
  // break_reason: 'lunch'|'prayer'|'bathroom'|'personal'|'other' (NULL on work sessions)
  // attendance_id links to the parent employee_attendance day record
  db.run(
    `CREATE TABLE IF NOT EXISTS attendance_sessions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_id  INTEGER REFERENCES employee_attendance(id) ON DELETE SET NULL,
      employee_id    INTEGER NOT NULL REFERENCES employees(id),
      outlet_id      INTEGER NOT NULL REFERENCES outlets(id),
      session_type   TEXT NOT NULL DEFAULT 'work',
      break_reason   TEXT,
      session_start  DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      session_end    DATETIME,
      duration_hours REAL,
      created_at     TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("migrate56 attendance_sessions:", err.message);
    }
  );

  // Index for fast lookup by employee + session_start
  // Note: SQLite forbids non-deterministic functions (date()) in index definitions
  // Filtering by date() in WHERE clauses is fine — this index still accelerates those queries
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_att_sessions_emp_date
     ON attendance_sessions(employee_id, session_start)`,
    (err) => {
      if (err) console.error("migrate56 idx_att_sessions_emp_date:", err.message);
    }
  );
});
