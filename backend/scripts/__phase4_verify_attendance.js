require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const r = await p.query(
      `SELECT id, employee_id, outlet_id, session_start, session_end
         FROM tenant_livetest1.attendance_sessions
        WHERE employee_id = 2
        ORDER BY id DESC LIMIT 3`
    );
    console.log("Test Cashier 2 (id=2) attendance_sessions:");
    console.table(r.rows);
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
