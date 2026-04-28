module.exports = function registerAttendanceRoutes(app, deps) {
  const { db, requirePerm } = deps;
  const bcrypt = require("bcryptjs");
  const { validate } = require("../middleware/validate");
  const {
    PinStatusSchema,
    PinCheckinSchema,
    PinCheckoutSchema,
  } = require("../schemas/attendance");

  // Resolve an employee from a kiosk PIN.
  //
  // Migration v14 deprecated plaintext PIN storage: the setup wizard,
  // tenant provisioner, and admin "Add Employee" form all write `pin_hash`
  // (bcrypt) and leave `pin_code` NULL. The kiosk endpoints used to query
  // `WHERE pin_code = $1`, which silently broke clock-in for every tenant
  // provisioned after v14 (livetest1 hit this on 2026-04-28; a legacy
  // pre-v14 tenant like packagesmall still had pin_code populated and
  // worked, masking the regression).
  //
  // Strategy: scan candidate rows and bcrypt-compare against pin_hash.
  // Fall back to plaintext pin_code equality for pre-v14 tenants and the
  // handful of legacy test fixtures that still seed pin_code only. The
  // employee count per tenant is small (Free=3, Pro=unlimited but in
  // practice tens), so the linear scan is fine for kiosk traffic.
  async function resolveEmployeeByPin(pin) {
    if (!pin) return null;
    const { rows } = await db.query(
      "SELECT id, name, pin_hash, pin_code FROM employees WHERE pin_hash IS NOT NULL OR pin_code IS NOT NULL"
    );
    for (const row of rows) {
      if (row.pin_hash) {
        try {
          if (await bcrypt.compare(String(pin), row.pin_hash)) {
            return { id: row.id, name: row.name };
          }
        } catch (_) { /* ignore malformed hash, try next */ }
      }
      if (row.pin_code && String(row.pin_code) === String(pin)) {
        return { id: row.id, name: row.name };
      }
    }
    return null;
  }

  // Helper: format decimal hours to "Xh Ym" string
  const fmtDuration = (hours) => {
    if (!hours) return "0h 0m";
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  // Helper: compute hours between two datetime strings, rounded to 2dp
  const calcHours = (start, end) =>
    parseFloat(((new Date(end) - new Date(start)) / 3600000).toFixed(2));

  async function isEmployeeAssignedToOutlet(employeeId, outletId) {
    const { rows: [row] } = await db.query(
      `SELECT 1
       FROM employee_outlets
       WHERE employee_id = $1 AND outlet_id = $2
       LIMIT 1`,
      [Number(employeeId), Number(outletId)]
    );
    return Boolean(row);
  }

  async function getEmployeeStatusForToday(employeeId, outletId = null) {
    const today = new Date().toISOString().slice(0, 10);
    let paramIdx = 2;
    const outletClause = outletId ? ` AND outlet_id = $${++paramIdx}` : "";
    const outletParams = outletId ? [Number(outletId)] : [];

    const { rows: [openSession] } = await db.query(
      `SELECT * FROM attendance_sessions
       WHERE employee_id = $1 AND session_end IS NULL
         AND session_start::date = $2${outletClause}
       ORDER BY session_start DESC
       LIMIT 1`,
      [Number(employeeId), today, ...outletParams]
    );

    // Reset paramIdx for second query
    paramIdx = 2;
    const outletClause2 = outletId ? ` AND outlet_id = $${++paramIdx}` : "";

    const { rows: [totals] } = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN session_type = 'work' THEN duration_hours ELSE 0 END), 0) AS net_work_hours,
         COALESCE(SUM(CASE WHEN session_type = 'break' THEN duration_hours ELSE 0 END), 0) AS break_hours
       FROM attendance_sessions
       WHERE employee_id = $1 AND session_start::date = $2${outletClause2}
         AND session_end IS NOT NULL`,
      [Number(employeeId), today, ...outletParams]
    );

    if (openSession) {
      return {
        status: openSession.session_type === "work" ? "clocked_in" : "on_break",
        current_session: openSession,
        net_work_hours_today: totals?.net_work_hours || 0,
        total_break_hours_today: totals?.break_hours || 0,
      };
    }

    paramIdx = 2;
    const outletClause3 = outletId ? ` AND outlet_id = $${++paramIdx}` : "";

    const { rows: [countRow] } = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM attendance_sessions
       WHERE employee_id = $1 AND session_start::date = $2${outletClause3}`,
      [Number(employeeId), today, ...outletParams]
    );

    return {
      status: Number(countRow?.cnt || 0) > 0 ? "clocked_out" : "not_clocked_in",
      current_session: null,
      net_work_hours_today: totals?.net_work_hours || 0,
      total_break_hours_today: totals?.break_hours || 0,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /api/attendance — manager list of day-level records (with session counts)
  // ---------------------------------------------------------------------------
  app.get("/api/attendance", async (req, res) => {
    try {
      const { date_from, date_to, employee_id } = req.query;
      const where = [];
      const params = [];
      let idx = 0;
      if (date_from) {
        where.push(`ea.check_in::date >= $${++idx}`);
        params.push(date_from);
      }
      if (date_to) {
        where.push(`ea.check_in::date <= $${++idx}`);
        params.push(date_to);
      }
      if (employee_id) {
        where.push(`ea.employee_id = $${++idx}`);
        params.push(employee_id);
      }
      const sql = `
        SELECT ea.*,
          e.name AS employee_name, e.role, o.name AS outlet_name,
          (SELECT COUNT(*) FROM attendance_sessions
           WHERE attendance_id = ea.id AND session_type = 'work') AS work_sessions,
          (SELECT COALESCE(SUM(duration_hours), 0) FROM attendance_sessions
           WHERE attendance_id = ea.id AND session_type = 'break') AS break_hours
        FROM employee_attendance ea
        JOIN employees e ON ea.employee_id = e.id
        JOIN outlets o ON ea.outlet_id = o.id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY ea.check_in DESC`;
      const { rows } = await db.query(sql, params);
      res.json({ records: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/attendance/sessions — manager list of individual session records
  // ---------------------------------------------------------------------------
  app.get("/api/attendance/sessions", async (req, res) => {
    try {
      const { date_from, date_to, employee_id, session_type } = req.query;
      const where = [];
      const params = [];
      let idx = 0;
      if (date_from) {
        where.push(`s.session_start::date >= $${++idx}`);
        params.push(date_from);
      }
      if (date_to) {
        where.push(`s.session_start::date <= $${++idx}`);
        params.push(date_to);
      }
      if (employee_id) {
        where.push(`s.employee_id = $${++idx}`);
        params.push(employee_id);
      }
      if (session_type) {
        where.push(`s.session_type = $${++idx}`);
        params.push(session_type);
      }
      const sql = `
        SELECT s.*, e.name AS employee_name, o.name AS outlet_name
        FROM attendance_sessions s
        JOIN employees e ON s.employee_id = e.id
        JOIN outlets o ON s.outlet_id = o.id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY s.session_start DESC`;
      const { rows } = await db.query(sql, params);
      res.json({ sessions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/pin-status — kiosk: look up employee status by PIN
  // Intentionally unauthenticated — PIN is the authentication
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/pin-status", validate(PinStatusSchema), async (req, res) => {
    try {
      const { pin_code, outlet_id = null } = req.body || {};

      const emp = await resolveEmployeeByPin(pin_code);
      if (!emp) return res.status(401).json({ error: "Invalid PIN" });

      const outletId = outlet_id ? Number(outlet_id) : null;
      if (outletId) {
        const assigned = await isEmployeeAssignedToOutlet(emp.id, outletId);
        if (!assigned) {
          return res.status(403).json({
            error: "You are not assigned to this store. Contact an administrator.",
          });
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const outletClause = outletId ? " AND outlet_id = $3" : "";
      const outletParams = outletId ? [outletId] : [];

      // Find open session (if any)
      const { rows: [openSession] } = await db.query(
        `SELECT * FROM attendance_sessions
         WHERE employee_id = $1 AND session_end IS NULL
           AND session_start::date = $2${outletClause}`,
        [emp.id, today, ...outletParams]
      );

      // Sum all completed sessions today
      const { rows: [totals] } = await db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN session_type = 'work' THEN duration_hours ELSE 0 END), 0) AS net_work_hours,
           COALESCE(SUM(CASE WHEN session_type = 'break' THEN duration_hours ELSE 0 END), 0) AS break_hours
         FROM attendance_sessions
         WHERE employee_id = $1 AND session_start::date = $2${outletClause}
           AND session_end IS NOT NULL`,
        [emp.id, today, ...outletParams]
      );

      if (openSession) {
        const status = openSession.session_type === "work" ? "clocked_in" : "on_break";
        return res.json({
          employee: { id: emp.id, name: emp.name },
          status,
          current_session: openSession,
          net_work_hours_today: totals.net_work_hours,
          total_break_hours_today: totals.break_hours,
        });
      }

      // No open session — check if they had any sessions today
      const { rows: [countRow] } = await db.query(
        `SELECT COUNT(*) AS cnt FROM attendance_sessions
         WHERE employee_id = $1 AND session_start::date = $2${outletClause}`,
        [emp.id, today, ...outletParams]
      );
      const status = Number(countRow.cnt) > 0 ? "clocked_out" : "not_clocked_in";
      res.json({
        employee: { id: emp.id, name: emp.name },
        status,
        current_session: null,
        net_work_hours_today: totals.net_work_hours,
        total_break_hours_today: totals.break_hours,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/attendance/my-status", async (req, res) => {
    try {
      const employeeId = req.headers["x-employee-id"];
      const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;
      if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

      const { rows: [emp] } = await db.query(
        "SELECT id, name FROM employees WHERE id = $1",
        [Number(employeeId)]
      );
      if (!emp) return res.status(401).json({ error: "Unauthorized" });

      const status = await getEmployeeStatusForToday(emp.id, outletId);
      res.json({
        employee: { id: emp.id, name: emp.name },
        ...status,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/pin-checkin — kiosk: clock in or return from break
  // Intentionally unauthenticated — PIN is the authentication
  // ---------------------------------------------------------------------------
  // Haversine distance helper (meters)
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  app.post("/api/attendance/pin-checkin", validate(PinCheckinSchema), async (req, res) => {
    try {
      const { pin_code, outlet_id, latitude, longitude } = req.body || {};

      const emp = await resolveEmployeeByPin(pin_code);
      if (!emp) return res.status(401).json({ error: "Invalid PIN" });

      const assigned = await isEmployeeAssignedToOutlet(emp.id, outlet_id);
      if (!assigned) {
        return res.status(403).json({
          error: "You are not assigned to this store. Contact an administrator.",
        });
      }

      // Geofence validation (if outlet has geofence configured and coords provided)
      if (latitude != null && longitude != null) {
        try {
          const { rows: [outlet] } = await db.query(
            "SELECT latitude, longitude, geofence_radius_meters FROM outlets WHERE id = $1",
            [outlet_id]
          );
          if (outlet && outlet.latitude != null && outlet.longitude != null && outlet.geofence_radius_meters != null) {
            const dist = haversineDistance(
              Number(latitude), Number(longitude),
              Number(outlet.latitude), Number(outlet.longitude)
            );
            if (dist > outlet.geofence_radius_meters) {
              return res.status(403).json({
                error: "You are outside the allowed geofence radius for this outlet",
                allowed: false,
                geofence_error: true,
                distance_meters: Math.round(dist),
                radius_meters: outlet.geofence_radius_meters,
              });
            }
          }
        } catch (_) { /* geofence columns may not exist yet */ }
      }

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      // F1: Auto-close any stale open sessions from previous days (fire-and-forget)
      await db.query(
        `UPDATE attendance_sessions
         SET session_end = session_start, session_type = 'auto_closed'
         WHERE employee_id = $1 AND session_end IS NULL AND session_start::date < $2`,
        [emp.id, today]
      ).catch(() => {}); // non-critical

      const { rows: [openSession] } = await db.query(
        `SELECT * FROM attendance_sessions
         WHERE employee_id = $1 AND session_end IS NULL
           AND session_start::date = $2`,
        [emp.id, today]
      );

      if (openSession && openSession.session_type === "work") {
        return res.status(400).json({ error: "Already clocked in", status: "clocked_in" });
      }
      if (
        openSession &&
        openSession.session_type === "break" &&
        Number(openSession.outlet_id) !== Number(outlet_id)
      ) {
        return res.status(409).json({
          error: "Return from break at the same store where the break started.",
        });
      }

      // Find or create today's day-level attendance record
      const { rows: [dayRecord] } = await db.query(
        `SELECT id FROM employee_attendance
         WHERE employee_id = $1 AND outlet_id = $2
           AND check_in::date = $3`,
        [emp.id, outlet_id, today]
      );

      let attendanceId;
      if (dayRecord) {
        // If the day record was already checked out, reopen it for the new session
        await db.query(
          `UPDATE employee_attendance SET check_out = NULL, hours = NULL, status = 'present' WHERE id = $1 AND check_out IS NOT NULL`,
          [dayRecord.id]
        );
        attendanceId = dayRecord.id;
      } else {
        const { rows: [newDay] } = await db.query(
          `INSERT INTO employee_attendance (employee_id, outlet_id, status) VALUES ($1, $2, 'present') RETURNING id`,
          [emp.id, outlet_id]
        );
        attendanceId = newDay.id;
      }

      // If returning from break, close the break session first
      if (openSession) {
        const breakDuration = calcHours(openSession.session_start, now);
        await db.query(
          `UPDATE attendance_sessions SET session_end = $1, duration_hours = $2 WHERE id = $3`,
          [now, breakDuration, openSession.id]
        );
      }

      // Insert a new work session
      const { rows: [newSession] } = await db.query(
        `INSERT INTO attendance_sessions (attendance_id, employee_id, outlet_id, session_type)
         VALUES ($1, $2, $3, 'work') RETURNING *`,
        [attendanceId, emp.id, outlet_id]
      );

      res.json({
        employee: { id: emp.id, name: emp.name },
        session: newSession,
        attendance_id: attendanceId,
        message: `Welcome${openSession ? " back" : ""}, ${emp.name}!`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/pin-checkout — kiosk: go on break or end of day
  // Intentionally unauthenticated — PIN is the authentication
  // break_reason: 'lunch'|'prayer'|'bathroom'|'personal'|'other'|null (null = end of day)
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/pin-checkout", validate(PinCheckoutSchema), async (req, res) => {
    try {
      const { pin_code, break_reason = null, outlet_id = null } = req.body || {};

      const emp = await resolveEmployeeByPin(pin_code);
      if (!emp) return res.status(401).json({ error: "Invalid PIN" });

      if (outlet_id) {
        const assigned = await isEmployeeAssignedToOutlet(emp.id, outlet_id);
        if (!assigned) {
          return res.status(403).json({
            error: "You are not assigned to this store. Contact an administrator.",
          });
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      const { rows: [openWork] } = await db.query(
        `SELECT * FROM attendance_sessions
         WHERE employee_id = $1 AND session_type = 'work' AND session_end IS NULL
           AND session_start::date = $2`,
        [emp.id, today]
      );
      if (!openWork)
        return res.status(400).json({ error: "Not clocked in", status: "not_clocked_in" });
      if (outlet_id && Number(openWork.outlet_id) !== Number(outlet_id)) {
        return res.status(409).json({
          error: "Selected store does not match your active work session.",
        });
      }

      const workDuration = calcHours(openWork.session_start, now);

      // Close the open work session
      await db.query(
        `UPDATE attendance_sessions SET session_end = $1, duration_hours = $2 WHERE id = $3`,
        [now, workDuration, openWork.id]
      );

      // Calculate net work hours for today (all completed work sessions)
      const { rows: [totals] } = await db.query(
        `SELECT COALESCE(SUM(duration_hours), 0) AS net_work_hours
         FROM attendance_sessions
         WHERE employee_id = $1 AND session_type = 'work'
           AND session_start::date = $2
           AND session_end IS NOT NULL`,
        [emp.id, today]
      );
      const netHours = totals.net_work_hours;
      const isEndOfDay = !break_reason;

      if (isEndOfDay) {
        // Stamp the day-level record with check_out, net hours, and status
        await db.query(
          `UPDATE employee_attendance
           SET check_out = $1, hours = $2, status = 'checked_out'
           WHERE employee_id = $3 AND outlet_id = $4
             AND check_in::date = $5`,
          [now, netHours, emp.id, openWork.outlet_id, today]
        );
      } else {
        // Start the break session immediately
        await db.query(
          `INSERT INTO attendance_sessions
           (attendance_id, employee_id, outlet_id, session_type, break_reason)
           VALUES ($1, $2, $3, 'break', $4)`,
          [openWork.attendance_id, emp.id, openWork.outlet_id, break_reason]
        );
      }

      const msg = isEndOfDay
        ? `Goodbye, ${emp.name}! You worked ${fmtDuration(netHours)} today.`
        : `Break started (${break_reason}). You've worked ${fmtDuration(netHours)} today.`;
      res.json({
        employee: { id: emp.id, name: emp.name },
        net_work_hours_today: netHours,
        is_end_of_day: isEndOfDay,
        message: msg,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /api/attendance/:id — manager manually corrects a day-level record
  // ---------------------------------------------------------------------------
  app.put("/api/attendance/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { id } = req.params;
      const { check_in, check_out, status, comment } = req.body || {};

      const { rows: [record] } = await db.query(
        "SELECT * FROM employee_attendance WHERE id = $1",
        [id]
      );
      if (!record) return res.status(404).json({ error: "Record not found" });

      const newCheckIn = check_in || record.check_in;
      const newCheckOut = check_out || record.check_out;
      const hours =
        newCheckIn && newCheckOut ? calcHours(newCheckIn, newCheckOut) : record.hours;

      await db.query(
        `UPDATE employee_attendance
         SET check_in = $1, check_out = $2, hours = $3,
             status = COALESCE($4, status), comment = COALESCE($5, comment)
         WHERE id = $6`,
        [newCheckIn, newCheckOut, hours, status || null, comment || null, id]
      );
      res.json({ message: "Record updated", hours });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/employees/:id/attendance-config
  // ---------------------------------------------------------------------------
  app.get(
    "/api/employees/:id/attendance-config",
    requirePerm("all_access"),
    async (req, res) => {
      try {
        const { rows: [row] } = await db.query(
          "SELECT id, work_hours_per_day, monthly_leave_allowance FROM employees WHERE id = $1",
          [req.params.id]
        );
        if (!row) return res.status(404).json({ error: "Employee not found" });
        res.json({
          employee_id: row.id,
          work_hours_per_day: row.work_hours_per_day ?? 8,
          monthly_leave_allowance: row.monthly_leave_allowance ?? 2,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // PUT /api/employees/:id/attendance-config
  // ---------------------------------------------------------------------------
  app.put(
    "/api/employees/:id/attendance-config",
    requirePerm("all_access"),
    async (req, res) => {
      try {
        const { work_hours_per_day, monthly_leave_allowance } = req.body || {};
        const { rowCount } = await db.query(
          `UPDATE employees
           SET work_hours_per_day        = COALESCE($1, work_hours_per_day),
               monthly_leave_allowance   = COALESCE($2, monthly_leave_allowance)
           WHERE id = $3`,
          [
            work_hours_per_day != null ? Number(work_hours_per_day) : null,
            monthly_leave_allowance != null ? Number(monthly_leave_allowance) : null,
            req.params.id,
          ]
        );
        if (rowCount === 0)
          return res.status(404).json({ error: "Employee not found" });
        res.json({ message: "Attendance config updated" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/attendance/checkin — legacy admin check-in (kept for compatibility)
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/checkin", async (req, res) => {
    try {
      const { employee_id, outlet_id } = req.body;
      if (!employee_id || !outlet_id)
        return res.status(400).json({ error: "employee_id and outlet_id are required" });
      const { rows: [inserted] } = await db.query(
        "INSERT INTO employee_attendance (employee_id, outlet_id, status) VALUES ($1, $2, 'present') RETURNING *",
        [employee_id, outlet_id]
      );
      res.json({ attendance: inserted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/:id/checkout — legacy admin check-out (kept for compatibility)
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/:id/checkout", async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [record] } = await db.query(
        "SELECT * FROM employee_attendance WHERE id = $1",
        [id]
      );
      if (!record) return res.status(404).json({ error: "Attendance record not found" });
      if (record.check_out) return res.status(400).json({ error: "Already clocked out" });
      const now = new Date().toISOString();
      const hours = calcHours(record.check_in, now);
      await db.query(
        "UPDATE employee_attendance SET check_out = $1, hours = $2, status = 'checked_out' WHERE id = $3",
        [now, hours, id]
      );
      res.json({ message: "Clocked out successfully", hours, check_out: now });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
