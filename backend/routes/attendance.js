module.exports = function registerAttendanceRoutes(app, deps) {
  const { db } = deps;

// --- EMPLOYEE ATTENDANCE ---

  app.get("/api/attendance", (req, res) => {
    const { date_from, date_to, employee_id } = req.query;
    const where = [];
    const params = [];
    if (date_from) {
      where.push("date(ea.check_in,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(ea.check_in,'localtime') <= ?");
      params.push(date_to);
    }
    if (employee_id) {
      where.push("ea.employee_id = ?");
      params.push(employee_id);
    }
    const sql = `
    SELECT ea.*, e.name AS employee_name, e.role, o.name AS outlet_name
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

  app.post("/api/attendance/checkin", (req, res) => {
    const { employee_id, outlet_id } = req.body;
    if (!employee_id || !outlet_id)
      return res
        .status(400)
        .json({ error: "employee_id and outlet_id are required" });
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
          },
        );
      },
    );
  });

  app.post("/api/attendance/:id/checkout", (req, res) => {
    const { id } = req.params;
    db.get(
      "SELECT * FROM employee_attendance WHERE id = ?",
      [id],
      (err, record) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!record)
          return res.status(404).json({ error: "Attendance record not found" });
        if (record.check_out)
          return res.status(400).json({ error: "Already clocked out" });
        const now = new Date().toISOString().replace("T", " ").slice(0, 19);
        const hours = parseFloat(
          ((new Date() - new Date(record.check_in)) / 3600000).toFixed(2),
        );
        db.run(
          "UPDATE employee_attendance SET check_out = ?, hours = ? WHERE id = ?",
          [now, hours, id],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({
              message: "Clocked out successfully",
              hours,
              check_out: now,
            });
          },
        );
      },
    );
  });
};
