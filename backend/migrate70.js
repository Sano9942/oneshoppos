// migrate70.js — Close stale open attendance sessions from previous days
// Sessions left open (no session_end) from days before today are data artifacts
// caused by the double-localtime bug fixed in the attendance routes.
// This one-time cleanup sets session_end = session_start and duration_hours = 0
// for all such sessions so they no longer block clock-in on future days.
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error("Failed to open DB:", err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(
    `UPDATE attendance_sessions
     SET session_end = session_start, duration_hours = 0
     WHERE session_end IS NULL
       AND date(session_start) < date('now', 'localtime')`,
    function (err) {
      if (err) {
        console.error("[migrate70] Error:", err.message);
      } else {
        console.log(`[migrate70] Done — closed ${this.changes} stale open session(s).`);
      }
      db.close((closeErr) => {
        if (closeErr) console.error("[migrate70] Close error:", closeErr.message);
      });
    }
  );
});
