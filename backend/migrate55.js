const db = require("./db");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS report_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      report_key TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'daily',
      run_hour INTEGER NOT NULL DEFAULT 6,
      run_minute INTEGER NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'local',
      recipient TEXT,
      export_format TEXT NOT NULL DEFAULT 'csv',
      filters_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("migrate55 report_schedules:", err.message);
    },
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS report_schedule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
      run_started_at TEXT DEFAULT (datetime('now','localtime')),
      run_finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      file_path TEXT,
      row_count INTEGER DEFAULT 0,
      error_message TEXT
    )`,
    (err) => {
      if (err) console.error("migrate55 report_schedule_runs:", err.message);
    },
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS report_delivery_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_run_id INTEGER REFERENCES report_schedule_runs(id) ON DELETE SET NULL,
      schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,
      channel TEXT NOT NULL DEFAULT 'file',
      recipient TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      message TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("migrate55 report_delivery_log:", err.message);
    },
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS saved_report_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_key TEXT NOT NULL,
      name TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'personal',
      employee_id INTEGER,
      role_id INTEGER,
      filters_json TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("migrate55 saved_report_views:", err.message);
    },
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS report_definition_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_key TEXT NOT NULL,
      version TEXT NOT NULL,
      query_signature TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(report_key, version)
    )`,
    (err) => {
      if (err) console.error("migrate55 report_definition_versions:", err.message);
    },
  );

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_report_schedules_active_next
     ON report_schedules(is_active, next_run_at)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_report_schedule_runs_schedule
     ON report_schedule_runs(schedule_id, run_started_at DESC)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_saved_report_views_key_scope
     ON saved_report_views(report_key, scope, employee_id, role_id)`,
  );
});

setTimeout(() => db.close(), 200);

