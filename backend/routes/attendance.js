module.exports = function registerAttendanceRoutes(app, deps) {
  const { db, requirePerm } = deps;

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

  // Helper: today's date as YYYY-MM-DD in local time
  const todayLocal = () => new Date().toLocaleDateString("sv-SE");

  // Helper: current datetime as "YYYY-MM-DD HH:MM:SS" in local time
  const nowLocal = () => new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 19);

  function isEmployeeAssignedToOutlet(employeeId, outletId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 1
         FROM employee_outlets
         WHERE employee_id = ? AND outlet_id = ?
         LIMIT 1`,
        [Number(employeeId), Number(outletId)],
        (err, row) => {
          if (err) return reject(err);
          resolve(Boolean(row));
        },
      );
    });
  }

  function getEmployeeStatusForToday(employeeId, outletId = null) {
    const today = todayLocal();
    const outletClause = outletId ? " AND outlet_id = ?" : "";
    const outletParams = outletId ? [Number(outletId)] : [];

    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM attendance_sessions
         WHERE employee_id = ? AND session_end IS NULL
           AND date(session_start) = ?${outletClause}
         ORDER BY session_start DESC
         LIMIT 1`,
        [Number(employeeId), today, ...outletParams],
        (err, openSession) => {
          if (err) return reject(err);

          db.get(
            `SELECT
               COALESCE(SUM(CASE WHEN session_type = 'work' THEN duration_hours ELSE 0 END), 0) AS net_work_hours,
               COALESCE(SUM(CASE WHEN session_type = 'break' THEN duration_hours ELSE 0 END), 0) AS break_hours
             FROM attendance_sessions
             WHERE employee_id = ? AND date(session_start) = ?${outletClause}
               AND session_end IS NOT NULL`,
            [Number(employeeId), today, ...outletParams],
            (totalsErr, totals) => {
              if (totalsErr) return reject(totalsErr);

              if (openSession) {
                return resolve({
                  status:
                    openSession.session_type === "work" ? "clocked_in" : "on_break",
                  current_session: openSession,
                  net_work_hours_today: totals?.net_work_hours || 0,
                  total_break_hours_today: totals?.break_hours || 0,
                });
              }

              db.get(
                `SELECT COUNT(*) AS cnt
                 FROM attendance_sessions
                 WHERE employee_id = ? AND date(session_start) = ?${outletClause}`,
                [Number(employeeId), today, ...outletParams],
                (countErr, countRow) => {
                  if (countErr) return reject(countErr);
                  resolve({
                    status: Number(countRow?.cnt || 0) > 0 ? "clocked_out" : "not_clocked_in",
                    current_session: null,
                    net_work_hours_today: totals?.net_work_hours || 0,
                    total_break_hours_today: totals?.break_hours || 0,
                  });
                },
              );
            },
          );
        },
      );
    });
  }

  // ---------------------------------------------------------------------------
  // GET /api/attendance — manager list of day-level records (with session counts)
  // ---------------------------------------------------------------------------
  app.get("/api/attendance", (req, res) => {
    const { date_from, date_to, employee_id } = req.query;
    const where = [];
    const params = [];
    // check_in stores local time — compare using date() with plain YYYY-MM-DD strings
    if (date_from) {
      where.push("date(ea.check_in) >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(ea.check_in) <= ?");
      params.push(date_to);
    }
    if (employee_id) {
      where.push("ea.employee_id = ?");
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
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ records: rows });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/attendance/sessions — manager list of individual session records
  // ---------------------------------------------------------------------------
  app.get("/api/attendance/sessions", (req, res) => {
    const { date_from, date_to, employee_id, session_type } = req.query;
    const where = [];
    const params = [];
    // session_start stores local time — compare using date() with plain YYYY-MM-DD strings
    if (date_from) {
      where.push("date(s.session_start) >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.session_start) <= ?");
      params.push(date_to);
    }
    if (employee_id) {
      where.push("s.employee_id = ?");
      params.push(employee_id);
    }
    if (session_type) {
      where.push("s.session_type = ?");
      params.push(session_type);
    }
    const sql = `
      SELECT s.*, e.name AS employee_name, o.name AS outlet_name
      FROM attendance_sessions s
      JOIN employees e ON s.employee_id = e.id
      JOIN outlets o ON s.outlet_id = o.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY s.session_start DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sessions: rows });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/pin-status — kiosk: look up employee status by PIN
  // Intentionally unauthenticated — PIN is the authentication
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/pin-status", (req, res) => {
    const { pin_code, outlet_id = null } = req.body || {};
    if (!pin_code) return res.status(400).json({ error: "pin_code is required" });

    db.get(
      "SELECT id, name FROM employees WHERE pin_code = ?",
      [pin_code],
      async (err, emp) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!emp) return res.status(401).json({ error: "Invalid PIN" });

        const outletId = outlet_id ? Number(outlet_id) : null;
        if (outletId) {
          try {
            const assigned = await isEmployeeAssignedToOutlet(emp.id, outletId);
            if (!assigned) {
              return res.status(403).json({
                error: "You are not assigned to this store. Contact an administrator.",
              });
            }
          } catch (assignErr) {
            return res.status(500).json({ error: assignErr.message });
          }
        }

        const today = todayLocal();
        const outletClause = outletId ? " AND outlet_id = ?" : "";
        const outletParams = outletId ? [outletId] : [];

        // Find open session (if any)
        db.get(
          `SELECT * FROM attendance_sessions
           WHERE employee_id = ? AND session_end IS NULL
             AND date(session_start) = ?${outletClause}`,
          [emp.id, today, ...outletParams],
          (err2, openSession) => {
            if (err2) return res.status(500).json({ error: err2.message });

            // Sum all completed sessions today
            db.get(
              `SELECT
                 COALESCE(SUM(CASE WHEN session_type = 'work' THEN duration_hours ELSE 0 END), 0) AS net_work_hours,
                 COALESCE(SUM(CASE WHEN session_type = 'break' THEN duration_hours ELSE 0 END), 0) AS break_hours
               FROM attendance_sessions
               WHERE employee_id = ? AND date(session_start) = ?${outletClause}
                 AND session_end IS NOT NULL`,
              [emp.id, today, ...outletParams],
              (err3, totals) => {
                if (err3) return res.status(500).json({ error: err3.message });

                if (openSession) {
                  const status =
                    openSession.session_type === "work" ? "clocked_in" : "on_break";
                  return res.json({
                    employee: { id: emp.id, name: emp.name },
                    status,
                    current_session: openSession,
                    net_work_hours_today: totals.net_work_hours,
                    total_break_hours_today: totals.break_hours,
                  });
                }

                // No open session — check if they had any sessions today
                db.get(
                  `SELECT COUNT(*) AS cnt FROM attendance_sessions
                   WHERE employee_id = ? AND date(session_start) = ?${outletClause}`,
                  [emp.id, today, ...outletParams],
                  (err4, countRow) => {
                    if (err4) return res.status(500).json({ error: err4.message });
                    const status = countRow.cnt > 0 ? "clocked_out" : "not_clocked_in";
                    res.json({
                      employee: { id: emp.id, name: emp.name },
                      status,
                      current_session: null,
                      net_work_hours_today: totals.net_work_hours,
                      total_break_hours_today: totals.break_hours,
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });

  app.get("/api/attendance/my-status", (req, res) => {
    const employeeId = req.headers["x-employee-id"];
    const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    db.get(
      "SELECT id, name FROM employees WHERE id = ?",
      [Number(employeeId)],
      async (err, emp) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!emp) return res.status(401).json({ error: "Unauthorized" });
        try {
          const status = await getEmployeeStatusForToday(emp.id, outletId);
          res.json({
            employee: { id: emp.id, name: emp.name },
            ...status,
          });
        } catch (statusErr) {
          res.status(500).json({ error: statusErr.message });
        }
      },
    );
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/pin-checkin — kiosk: clock in or return from break
  // Intentionally unauthenticated — PIN is the authentication
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/pin-checkin", (req, res) => {
    const { pin_code, outlet_id } = req.body || {};
    if (!pin_code || !outlet_id)
      return res.status(400).json({ error: "pin_code and outlet_id are required" });

    db.get(
      "SELECT id, name FROM employees WHERE pin_code = ?",
      [pin_code],
      async (err, emp) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!emp) return res.status(401).json({ error: "Invalid PIN" });

        try {
          const assigned = await isEmployeeAssignedToOutlet(emp.id, outlet_id);
          if (!assigned) {
            return res.status(403).json({
              error: "You are not assigned to this store. Contact an administrator.",
            });
          }
        } catch (assignErr) {
          return res.status(500).json({ error: assignErr.message });
        }

        const today = todayLocal();
        const now = nowLocal();

        // F1: Auto-close any stale open sessions from previous days
        db.run(
          `UPDATE attendance_sessions
           SET session_end = session_start, session_type = 'auto_closed'
           WHERE employee_id = ? AND session_end IS NULL AND date(session_start) < ?`,
          [emp.id, today],
          () => {} // fire-and-forget; errors are non-critical
        );

        db.get(
          `SELECT * FROM attendance_sessions
           WHERE employee_id = ? AND session_end IS NULL
             AND date(session_start) = ?`,
          [emp.id, today],
          (err2, openSession) => {
            if (err2) return res.status(500).json({ error: err2.message });

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

            // Insert a new work session, then return it
            const insertWorkSession = (attendanceId) => {
              db.run(
                `INSERT INTO attendance_sessions (attendance_id, employee_id, outlet_id, session_type)
                 VALUES (?, ?, ?, 'work')`,
                [attendanceId, emp.id, outlet_id],
                function (err4) {
                  if (err4) return res.status(500).json({ error: err4.message });
                  db.get(
                    "SELECT * FROM attendance_sessions WHERE id = ?",
                    [this.lastID],
                    (err5, session) => {
                      if (err5) return res.status(500).json({ error: err5.message });
                      res.json({
                        employee: { id: emp.id, name: emp.name },
                        session,
                        attendance_id: attendanceId,
                        message: `Welcome${openSession ? " back" : ""}, ${emp.name}!`,
                      });
                    }
                  );
                }
              );
            };

            // If returning from break, close the break session first
            const maybeCloseBreak = (attendanceId) => {
              if (!openSession) return insertWorkSession(attendanceId);
              const breakDuration = calcHours(openSession.session_start, now);
              db.run(
                `UPDATE attendance_sessions SET session_end = ?, duration_hours = ? WHERE id = ?`,
                [now, breakDuration, openSession.id],
                (err3) => {
                  if (err3) return res.status(500).json({ error: err3.message });
                  insertWorkSession(attendanceId);
                }
              );
            };

            // Find or create today's day-level attendance record
            db.get(
              `SELECT id FROM employee_attendance
               WHERE employee_id = ? AND outlet_id = ?
                 AND date(check_in) = ?`,
              [emp.id, outlet_id, today],
              (err3, dayRecord) => {
                if (err3) return res.status(500).json({ error: err3.message });
                if (dayRecord) {
                  // If the day record was already checked out, reopen it for the new session
                  db.run(
                    `UPDATE employee_attendance SET check_out = NULL, hours = NULL, status = 'present' WHERE id = ? AND check_out IS NOT NULL`,
                    [dayRecord.id],
                    (err4) => {
                      if (err4) return res.status(500).json({ error: err4.message });
                      maybeCloseBreak(dayRecord.id);
                    }
                  );
                } else {
                  db.run(
                    `INSERT INTO employee_attendance (employee_id, outlet_id, status) VALUES (?, ?, 'present')`,
                    [emp.id, outlet_id],
                    function (err4) {
                      if (err4) return res.status(500).json({ error: err4.message });
                      maybeCloseBreak(this.lastID);
                    }
                  );
                }
              }
            );
          }
        );
      }
    );
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/pin-checkout — kiosk: go on break or end of day
  // Intentionally unauthenticated — PIN is the authentication
  // break_reason: 'lunch'|'prayer'|'bathroom'|'personal'|'other'|null (null = end of day)
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/pin-checkout", (req, res) => {
    const { pin_code, break_reason = null, outlet_id = null } = req.body || {};
    if (!pin_code) return res.status(400).json({ error: "pin_code is required" });

    const VALID_REASONS = ["lunch", "prayer", "bathroom", "personal", "other"];
    if (break_reason && !VALID_REASONS.includes(break_reason)) {
      return res.status(400).json({
        error: `break_reason must be one of: ${VALID_REASONS.join(", ")} or null`,
      });
    }

    db.get(
      "SELECT id, name FROM employees WHERE pin_code = ?",
      [pin_code],
      async (err, emp) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!emp) return res.status(401).json({ error: "Invalid PIN" });

        if (outlet_id) {
          try {
            const assigned = await isEmployeeAssignedToOutlet(emp.id, outlet_id);
            if (!assigned) {
              return res.status(403).json({
                error: "You are not assigned to this store. Contact an administrator.",
              });
            }
          } catch (assignErr) {
            return res.status(500).json({ error: assignErr.message });
          }
        }

        const today = todayLocal();
        const now = nowLocal();

        db.get(
          `SELECT * FROM attendance_sessions
           WHERE employee_id = ? AND session_type = 'work' AND session_end IS NULL
             AND date(session_start) = ?`,
          [emp.id, today],
          (err2, openWork) => {
            if (err2) return res.status(500).json({ error: err2.message });
            if (!openWork)
              return res.status(400).json({ error: "Not clocked in", status: "not_clocked_in" });
            if (outlet_id && Number(openWork.outlet_id) !== Number(outlet_id)) {
              return res.status(409).json({
                error: "Selected store does not match your active work session.",
              });
            }

            const workDuration = calcHours(openWork.session_start, now);

            // Close the open work session
            db.run(
              `UPDATE attendance_sessions SET session_end = ?, duration_hours = ? WHERE id = ?`,
              [now, workDuration, openWork.id],
              (err3) => {
                if (err3) return res.status(500).json({ error: err3.message });

                // Calculate net work hours for today (all completed work sessions)
                db.get(
                  `SELECT COALESCE(SUM(duration_hours), 0) AS net_work_hours
                   FROM attendance_sessions
                   WHERE employee_id = ? AND session_type = 'work'
                     AND date(session_start) = ?
                     AND session_end IS NOT NULL`,
                  [emp.id, today],
                  (err4, totals) => {
                    if (err4) return res.status(500).json({ error: err4.message });
                    const netHours = totals.net_work_hours;
                    const isEndOfDay = !break_reason;

                    const sendResponse = () => {
                      const msg = isEndOfDay
                        ? `Goodbye, ${emp.name}! You worked ${fmtDuration(netHours)} today.`
                        : `Break started (${break_reason}). You've worked ${fmtDuration(netHours)} today.`;
                      res.json({
                        employee: { id: emp.id, name: emp.name },
                        net_work_hours_today: netHours,
                        is_end_of_day: isEndOfDay,
                        message: msg,
                      });
                    };

                    if (isEndOfDay) {
                      // Stamp the day-level record with check_out, net hours, and status
                      db.run(
                        `UPDATE employee_attendance
                         SET check_out = ?, hours = ?, status = 'checked_out'
                         WHERE employee_id = ? AND outlet_id = ?
                           AND date(check_in) = ?`,
                        [now, netHours, emp.id, openWork.outlet_id, today],
                        (err5) => {
                          if (err5) return res.status(500).json({ error: err5.message });
                          sendResponse();
                        }
                      );
                    } else {
                      // Start the break session immediately
                      db.run(
                        `INSERT INTO attendance_sessions
                         (attendance_id, employee_id, outlet_id, session_type, break_reason)
                         VALUES (?, ?, ?, 'break', ?)`,
                        [openWork.attendance_id, emp.id, openWork.outlet_id, break_reason],
                        (err5) => {
                          if (err5) return res.status(500).json({ error: err5.message });
                          sendResponse();
                        }
                      );
                    }
                  }
                );
              }
            );
          }
        );
      }
    );
  });

  // ---------------------------------------------------------------------------
  // PUT /api/attendance/:id — manager manually corrects a day-level record
  // ---------------------------------------------------------------------------
  app.put("/api/attendance/:id", requirePerm("all_access"), (req, res) => {
    const { id } = req.params;
    const { check_in, check_out, status, comment } = req.body || {};

    db.get("SELECT * FROM employee_attendance WHERE id = ?", [id], (err, record) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!record) return res.status(404).json({ error: "Record not found" });

      const newCheckIn = check_in || record.check_in;
      const newCheckOut = check_out || record.check_out;
      const hours =
        newCheckIn && newCheckOut ? calcHours(newCheckIn, newCheckOut) : record.hours;

      db.run(
        `UPDATE employee_attendance
         SET check_in = ?, check_out = ?, hours = ?,
             status = COALESCE(?, status), comment = COALESCE(?, comment)
         WHERE id = ?`,
        [newCheckIn, newCheckOut, hours, status || null, comment || null, id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ message: "Record updated", hours });
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/employees/:id/attendance-config
  // ---------------------------------------------------------------------------
  app.get(
    "/api/employees/:id/attendance-config",
    requirePerm("all_access"),
    (req, res) => {
      db.get(
        "SELECT id, work_hours_per_day, monthly_leave_allowance FROM employees WHERE id = ?",
        [req.params.id],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!row) return res.status(404).json({ error: "Employee not found" });
          res.json({
            employee_id: row.id,
            work_hours_per_day: row.work_hours_per_day ?? 8,
            monthly_leave_allowance: row.monthly_leave_allowance ?? 2,
          });
        }
      );
    }
  );

  // ---------------------------------------------------------------------------
  // PUT /api/employees/:id/attendance-config
  // ---------------------------------------------------------------------------
  app.put(
    "/api/employees/:id/attendance-config",
    requirePerm("all_access"),
    (req, res) => {
      const { work_hours_per_day, monthly_leave_allowance } = req.body || {};
      db.run(
        `UPDATE employees
         SET work_hours_per_day        = COALESCE(?, work_hours_per_day),
             monthly_leave_allowance   = COALESCE(?, monthly_leave_allowance)
         WHERE id = ?`,
        [
          work_hours_per_day != null ? Number(work_hours_per_day) : null,
          monthly_leave_allowance != null ? Number(monthly_leave_allowance) : null,
          req.params.id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Employee not found" });
          res.json({ message: "Attendance config updated" });
        }
      );
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/attendance/checkin — legacy admin check-in (kept for compatibility)
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/checkin", (req, res) => {
    const { employee_id, outlet_id } = req.body;
    if (!employee_id || !outlet_id)
      return res.status(400).json({ error: "employee_id and outlet_id are required" });
    db.run(
      "INSERT INTO employee_attendance (employee_id, outlet_id, status) VALUES (?, ?, 'present')",
      [employee_id, outlet_id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        db.get(
          "SELECT * FROM employee_attendance WHERE id = ?",
          [this.lastID],
          (err2, row) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ attendance: row });
          }
        );
      }
    );
  });

  // ---------------------------------------------------------------------------
  // POST /api/attendance/:id/checkout — legacy admin check-out (kept for compatibility)
  // ---------------------------------------------------------------------------
  app.post("/api/attendance/:id/checkout", (req, res) => {
    const { id } = req.params;
    db.get("SELECT * FROM employee_attendance WHERE id = ?", [id], (err, record) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!record) return res.status(404).json({ error: "Attendance record not found" });
      if (record.check_out) return res.status(400).json({ error: "Already clocked out" });
      const now = nowLocal();
      const hours = calcHours(record.check_in, now);
      db.run(
        "UPDATE employee_attendance SET check_out = ?, hours = ?, status = 'checked_out' WHERE id = ?",
        [now, hours, id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ message: "Clocked out successfully", hours, check_out: now });
        }
      );
    });
  });
};
