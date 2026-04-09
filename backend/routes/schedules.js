module.exports = function registerScheduleRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  const feat = requireFeature("phase2_scheduling");

  // List scheduled shifts
  app.get("/api/schedules", feat, async (req, res) => {
    try {
      const { outlet_id, employee_id, from, to, status } = req.query;
      let sql = `
        SELECT ss.*, e.name AS employee_name, o.name AS outlet_name, cb.name AS created_by_name
        FROM scheduled_shifts ss
        JOIN employees e ON ss.employee_id = e.id
        JOIN outlets o ON ss.outlet_id = o.id
        LEFT JOIN employees cb ON ss.created_by = cb.id
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;
      if (outlet_id) { sql += ` AND ss.outlet_id = $${idx++}`; params.push(outlet_id); }
      if (employee_id) { sql += ` AND ss.employee_id = $${idx++}`; params.push(employee_id); }
      if (from) { sql += ` AND ss.shift_date >= $${idx++}`; params.push(from); }
      if (to) { sql += ` AND ss.shift_date <= $${idx++}`; params.push(to); }
      if (status) { sql += ` AND ss.status = $${idx++}`; params.push(status); }
      sql += " ORDER BY ss.shift_date ASC, ss.start_time ASC";
      const { rows } = await db.query(sql, params);
      res.json({ shifts: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create draft shift
  app.post("/api/schedules", feat, requirePerm("all_access"), async (req, res) => {
    const { employee_id, outlet_id, shift_date, start_time, end_time, break_minutes, notes } = req.body;
    if (!employee_id || !outlet_id || !shift_date || !start_time || !end_time) {
      return res.status(400).json({ error: "employee_id, outlet_id, shift_date, start_time, and end_time are required" });
    }
    const createdBy = Number(req.headers["x-employee-id"] || 0) || null;
    try {
      // Check overlap
      const { rows: overlaps } = await db.query(
        `SELECT id FROM scheduled_shifts
         WHERE employee_id = $1 AND shift_date = $2 AND status != 'cancelled'
           AND start_time < $4 AND end_time > $3`,
        [employee_id, shift_date, start_time, end_time]
      );
      if (overlaps.length > 0) {
        return res.status(409).json({ error: "Overlapping shift exists for this employee on this date" });
      }

      const { rows } = await db.query(
        `INSERT INTO scheduled_shifts (employee_id, outlet_id, shift_date, start_time, end_time, break_minutes, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [employee_id, outlet_id, shift_date, start_time, end_time, break_minutes || 0, notes || null, createdBy]
      );
      res.status(201).json({ shift: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update draft shift
  app.put("/api/schedules/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { employee_id, outlet_id, shift_date, start_time, end_time, break_minutes, notes } = req.body;
    try {
      // Only allow editing drafts
      const { rows: existing } = await db.query("SELECT status FROM scheduled_shifts WHERE id = $1", [id]);
      if (!existing.length) return res.status(404).json({ error: "Shift not found" });
      if (existing[0].status !== "draft") {
        return res.status(400).json({ error: "Only draft shifts can be edited" });
      }

      // Check overlap if employee/date/time changed
      if (employee_id && shift_date && start_time && end_time) {
        const { rows: overlaps } = await db.query(
          `SELECT id FROM scheduled_shifts
           WHERE employee_id = $1 AND shift_date = $2 AND status != 'cancelled' AND id != $3
             AND start_time < $5 AND end_time > $4`,
          [employee_id, shift_date, id, start_time, end_time]
        );
        if (overlaps.length > 0) {
          return res.status(409).json({ error: "Overlapping shift exists for this employee on this date" });
        }
      }

      const { rows, rowCount } = await db.query(
        `UPDATE scheduled_shifts
         SET employee_id = COALESCE($1, employee_id),
             outlet_id = COALESCE($2, outlet_id),
             shift_date = COALESCE($3, shift_date),
             start_time = COALESCE($4, start_time),
             end_time = COALESCE($5, end_time),
             break_minutes = COALESCE($6, break_minutes),
             notes = $7,
             updated_at = NOW()
         WHERE id = $8 AND status = 'draft'
         RETURNING *`,
        [employee_id || null, outlet_id || null, shift_date || null, start_time || null, end_time || null,
         break_minutes != null ? break_minutes : null, notes !== undefined ? notes : null, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Shift not found or not editable" });
      res.json({ shift: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cancel shift
  app.delete("/api/schedules/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query(
        "UPDATE scheduled_shifts SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status != 'cancelled'",
        [id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Shift not found" });
      res.json({ message: "Shift cancelled" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk publish
  app.post("/api/schedules/publish", feat, requirePerm("all_access"), async (req, res) => {
    const { shift_ids, notify } = req.body;
    if (!Array.isArray(shift_ids) || shift_ids.length === 0) {
      return res.status(400).json({ error: "shift_ids array is required" });
    }
    try {
      // Check for leave conflicts (warn only)
      const { rows: conflicts } = await db.query(
        `SELECT ss.id AS shift_id, ss.employee_id, e.name AS employee_name, lr.start_date, lr.end_date
         FROM scheduled_shifts ss
         JOIN employees e ON ss.employee_id = e.id
         JOIN leave_requests lr ON lr.employee_id = ss.employee_id
           AND lr.status = 'approved'
           AND ss.shift_date BETWEEN lr.start_date AND lr.end_date
         WHERE ss.id = ANY($1) AND ss.status = 'draft'`,
        [shift_ids]
      );

      const { rowCount } = await db.query(
        `UPDATE scheduled_shifts
         SET status = 'published', published_at = NOW(),
             publish_notification = $2, updated_at = NOW()
         WHERE id = ANY($1) AND status = 'draft'`,
        [shift_ids, notify || "affected"]
      );

      res.json({
        published: rowCount,
        leave_conflicts: conflicts.length > 0 ? conflicts : undefined,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Open shifts (published, no employee — future use for shift bidding)
  app.get("/api/schedules/open-shifts", feat, async (req, res) => {
    try {
      const { outlet_id, from, to } = req.query;
      let sql = `
        SELECT ss.*, o.name AS outlet_name
        FROM scheduled_shifts ss
        JOIN outlets o ON ss.outlet_id = o.id
        WHERE ss.status = 'published' AND ss.employee_id IS NULL
      `;
      const params = [];
      let idx = 1;
      if (outlet_id) { sql += ` AND ss.outlet_id = $${idx++}`; params.push(outlet_id); }
      if (from) { sql += ` AND ss.shift_date >= $${idx++}`; params.push(from); }
      if (to) { sql += ` AND ss.shift_date <= $${idx++}`; params.push(to); }
      sql += " ORDER BY ss.shift_date ASC, ss.start_time ASC";
      const { rows } = await db.query(sql, params);
      res.json({ shifts: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
