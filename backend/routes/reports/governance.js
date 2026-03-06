const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requirePerm, requireAnyPerm, requireFeature, path, fs } = deps;
  const { parseJsonObject, nextRunAtIso, toCsvLines } = helpers;

  function applyOutletFilter(where, params, rawId, col = "s.outlet_id") {
    if (!rawId) return;
    const ids = String(rawId).split(",").map(Number).filter(Boolean);
    if (ids.length === 1) {
      where.push(`${col} = ?`);
      params.push(ids[0]);
    } else if (ids.length > 1) {
      where.push(`${col} IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }

  const REPORT_EXPORT_DIR = path.resolve(
    __dirname,
    "..",
    "..",
    "exports",
    "reports",
  );
  if (!fs.existsSync(REPORT_EXPORT_DIR)) {
    fs.mkdirSync(REPORT_EXPORT_DIR, { recursive: true });
  }

  function columnsForScheduleReport(reportKey) {
    if (reportKey === "profit-by-product") {
      return [
        { header: "Product", key: "product_name" },
        { header: "Barcode", key: "barcode" },
        { header: "Revenue", key: "revenue" },
        { header: "COGS", key: "cogs" },
        { header: "Gross Profit", key: "gross_profit" },
      ];
    }
    if (reportKey === "stock-aging") {
      return [
        { header: "Product", key: "product_name" },
        { header: "Barcode", key: "barcode" },
        { header: "Outlet", key: "outlet_name" },
        { header: "Stock Qty", key: "stock_qty" },
        { header: "Last Sold At", key: "last_sold_at" },
        { header: "Days Since Sale", key: "days_since_sale" },
      ];
    }
    if (reportKey === "stockout-risk") {
      return [
        { header: "Product", key: "product_name" },
        { header: "Barcode", key: "barcode" },
        { header: "Outlet", key: "outlet_name" },
        { header: "On Hand", key: "on_hand_qty" },
        { header: "Avg Daily Units", key: "avg_daily_units" },
        { header: "Days Of Cover", key: "days_of_cover" },
      ];
    }
    return [
      { header: "Sale ID", key: "sale_id" },
      { header: "Timestamp", key: "timestamp" },
      { header: "Outlet", key: "outlet_name" },
      { header: "Employee", key: "employee_name" },
      { header: "Total", key: "total_amount" },
      { header: "Discount", key: "discount_amount" },
    ];
  }

  function getRowsForScheduleReport(reportKey, filters, cb) {
    const tz = filters.timezone || "UTC";
    if (reportKey === "profit-by-product") {
      const where = ["s.voided = 0"];
      const params = [];
      if (filters.date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(filters.date_from, tz));
      }
      if (filters.date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(filters.date_to, tz));
      }
      applyOutletFilter(where, params, filters.outlet_id);
      const sql = `
      SELECT p.name AS product_name, p.barcode,
             ROUND(SUM(si.quantity * si.price_at_sale),2) AS revenue,
             ROUND(SUM(si.quantity * si.cost_price_at_sale),2) AS cogs,
             ROUND(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale),2) AS gross_profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id
      ORDER BY gross_profit DESC
      LIMIT 1000
    `;
      return db.all(sql, params, (err, rows) => cb(err, rows || []));
    }

    if (reportKey === "stock-aging") {
      const sql = `
      SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
             os.quantity AS stock_qty,
             MAX(s.timestamp) AS last_sold_at,
             CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS days_since_sale
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE os.quantity > 0
      GROUP BY p.id, o.id
      ORDER BY COALESCE(days_since_sale, 99999) DESC
      LIMIT 1000
    `;
      return db.all(sql, [], (err, rows) => cb(err, rows || []));
    }

    if (reportKey === "stockout-risk") {
      // Need to require buildForecastRows from inventory?
      // Or just re-implement a simpler version here as it was in original reports.js
      // Original code used buildForecastRows if available or re-calculated.
      // I'll re-implement the subset needed here for scheduling to avoid circular deps.
      const lookbackDays = Math.max(
        7,
        Math.min(365, parseInt(filters.lookback_days || 28, 10)),
      );
      const sql = `
          SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
                 COALESCE(SUM(si.quantity), 0) / ? AS avg_daily_units,
                 COALESCE(os.quantity, 0) AS on_hand_qty,
                 CASE WHEN COALESCE(SUM(si.quantity), 0) > 0
                      THEN COALESCE(os.quantity, 0) / (COALESCE(SUM(si.quantity), 0) / ?)
                      ELSE NULL END AS days_of_cover
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          JOIN outlets o ON o.id = s.outlet_id
          LEFT JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = o.id
          WHERE s.voided = 0 AND s.timestamp >= datetime('now', '-' || ? || ' days')
          GROUP BY p.id, o.id
          ORDER BY avg_daily_units DESC
          LIMIT 1000
        `;
      return db.all(
        sql,
        [lookbackDays, lookbackDays, lookbackDays],
        (err, rows) => cb(err, rows || []),
      );
    }

    const sql = `
    SELECT s.id AS sale_id, s.timestamp, COALESCE(o.name,'—') AS outlet_name,
           COALESCE(e.name,'—') AS employee_name,
           ROUND(COALESCE(s.total_amount,0),2) AS total_amount,
           ROUND(COALESCE(s.discount_amount,0),2) AS discount_amount
    FROM sales s
    LEFT JOIN outlets o ON o.id = s.outlet_id
    LEFT JOIN employees e ON e.id = s.employee_id
    WHERE s.voided = 0 AND COALESCE(s.discount_amount,0) > 0
    ORDER BY s.discount_amount DESC
    LIMIT 1000
    `;
    return db.all(sql, [], (err, rows) => cb(err, rows || []));
  }

  function runSingleSchedule(schedule, cb) {
    const filters = parseJsonObject(schedule.filters_json);
    db.run(
      "INSERT INTO report_schedule_runs (schedule_id, status) VALUES (?, 'running')",
      [schedule.id],
      function (insertErr) {
        if (insertErr) return cb(insertErr);
        const runId = this.lastID;
        getRowsForScheduleReport(
          schedule.report_key,
          filters,
          (rowsErr, rows) => {
            if (rowsErr) {
              db.run(
                "UPDATE report_schedule_runs SET status='failed', run_finished_at=datetime('now','localtime'), error_message=? WHERE id=?",
                [rowsErr.message, runId],
              );
              db.run(
                "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'file', ?, 'failed', ?)",
                [
                  runId,
                  schedule.id,
                  schedule.recipient || null,
                  rowsErr.message,
                ],
              );
              return cb(rowsErr);
            }

            const fileName = `report_${schedule.report_key}_${schedule.id}_${Date.now()}.csv`;
            const filePath = path.join(REPORT_EXPORT_DIR, fileName);
            const csv = toCsvLines(
              rows,
              columnsForScheduleReport(schedule.report_key),
              filters,
            );
            try {
              fs.writeFileSync(filePath, csv, "utf8");
            } catch (e) {
              db.run(
                "UPDATE report_schedule_runs SET status='failed', run_finished_at=datetime('now','localtime'), error_message=? WHERE id=?",
                [e.message, runId],
              );
              db.run(
                "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'file', ?, 'failed', ?)",
                [runId, schedule.id, schedule.recipient || null, e.message],
              );
              return cb(e);
            }

            db.run(
              `UPDATE report_schedule_runs
               SET status='success', run_finished_at=datetime('now','localtime'),
                   file_path=?, row_count=?
               WHERE id=?`,
              [filePath, rows.length, runId],
            );
            db.run(
              "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'file', ?, 'sent', ?)",
              [
                runId,
                schedule.id,
                schedule.recipient || null,
                `Generated file: ${fileName}`,
              ],
            );
            const nextRun = nextRunAtIso(
              schedule.frequency,
              schedule.run_hour,
              schedule.run_minute,
            );
            db.run(
              "UPDATE report_schedules SET last_run_at=datetime('now','localtime'), next_run_at=?, updated_at=datetime('now','localtime') WHERE id=?",
              [nextRun, schedule.id],
            );
            return cb(null, {
              run_id: runId,
              file_path: filePath,
              row_count: rows.length,
            });
          },
        );
      },
    );
  }

  function processPendingReportSchedules(limit = 5, done = () => {}) {
    db.all(
      `SELECT * FROM report_schedules
       WHERE is_active = 1
         AND (next_run_at IS NULL OR datetime(next_run_at) <= datetime('now','localtime'))
       ORDER BY datetime(COALESCE(next_run_at, created_at)) ASC
       LIMIT ?`,
      [limit],
      (err, schedules) => {
        if (err) return done(err);
        const list = schedules || [];
        if (!list.length) return done(null, { processed: 0 });
        let idx = 0;
        let processed = 0;
        const next = () => {
          if (idx >= list.length) return done(null, { processed });
          runSingleSchedule(list[idx], () => {
            processed += 1;
            idx += 1;
            next();
          });
        };
        next();
      },
    );
  }

  app.get(
    "/api/reports/schedules",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      db.all(
        "SELECT * FROM report_schedules ORDER BY created_at DESC",
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ schedules: rows || [] });
        },
      );
    },
  );

  app.post(
    "/api/reports/schedules",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      const {
        name,
        report_key,
        frequency = "daily",
        run_hour = 6,
        run_minute = 0,
        recipient = null,
        export_format = "csv",
        filters = {},
      } = req.body || {};
      if (!name || !report_key)
        return res
          .status(400)
          .json({ error: "name and report_key are required" });
      const nextRun = nextRunAtIso(frequency, run_hour, run_minute);
      db.run(
        `INSERT INTO report_schedules (name, report_key, frequency, run_hour, run_minute, recipient, export_format, filters_json, next_run_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          report_key,
          frequency,
          run_hour,
          run_minute,
          recipient,
          export_format,
          JSON.stringify(filters || {}),
          nextRun,
          req.headers["x-employee-id"] || null,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID, next_run_at: nextRun });
        },
      );
    },
  );

  app.put(
    "/api/reports/schedules/:id",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      const { id } = req.params;
      const {
        name,
        report_key,
        frequency,
        run_hour,
        run_minute,
        recipient,
        export_format,
        filters,
        is_active,
      } = req.body || {};
      const nextRun = nextRunAtIso(
        frequency || "daily",
        run_hour || 6,
        run_minute || 0,
      );
      db.run(
        `UPDATE report_schedules
       SET name = COALESCE(?, name), report_key = COALESCE(?, report_key), frequency = COALESCE(?, frequency),
           run_hour = COALESCE(?, run_hour), run_minute = COALESCE(?, run_minute), recipient = ?,
           export_format = COALESCE(?, export_format), filters_json = COALESCE(?, filters_json),
           is_active = COALESCE(?, is_active), next_run_at = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`,
        [
          name || null,
          report_key || null,
          frequency || null,
          Number.isInteger(run_hour) ? run_hour : null,
          Number.isInteger(run_minute) ? run_minute : null,
          recipient ?? null,
          export_format || null,
          filters ? JSON.stringify(filters) : null,
          typeof is_active === "boolean" ? (is_active ? 1 : 0) : null,
          nextRun,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (!this.changes)
            return res.status(404).json({ error: "Schedule not found" });
          res.json({ ok: true, next_run_at: nextRun });
        },
      );
    },
  );

  app.delete(
    "/api/reports/schedules/:id",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      db.run(
        "DELETE FROM report_schedules WHERE id = ?",
        [req.params.id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (!this.changes)
            return res.status(404).json({ error: "Schedule not found" });
          res.json({ ok: true });
        },
      );
    },
  );

  app.post(
    "/api/reports/schedules/:id/run-now",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      db.get(
        "SELECT * FROM report_schedules WHERE id = ?",
        [req.params.id],
        (err, schedule) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!schedule)
            return res.status(404).json({ error: "Schedule not found" });
          runSingleSchedule(schedule, (runErr, payload) => {
            if (runErr) return res.status(500).json({ error: runErr.message });
            res.json({ ok: true, run: payload });
          });
        },
      );
    },
  );

  app.get(
    "/api/reports/schedules/:id/runs",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      db.all(
        "SELECT * FROM report_schedule_runs WHERE schedule_id = ? ORDER BY run_started_at DESC LIMIT 100",
        [req.params.id],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ runs: rows || [] });
        },
      );
    },
  );

  app.get(
    "/api/reports/delivery-log",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      db.all(
        "SELECT * FROM report_delivery_log ORDER BY created_at DESC LIMIT 200",
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ log: rows || [] });
        },
      );
    },
  );

  app.get(
    "/api/reports/saved-views",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      const reportKey = req.query.report_key || null;
      const employeeId = req.headers["x-employee-id"] || null;
      const params = [employeeId, employeeId];
      let sql = `
      SELECT * FROM saved_report_views
      WHERE scope = 'global'
         OR (scope = 'role' AND role_id = (SELECT role_id FROM employees WHERE id = ?))
         OR (scope = 'personal' AND employee_id = ?)
    `;
      if (reportKey) {
        sql += " AND report_key = ?";
        params.push(reportKey);
      }
      sql += " ORDER BY scope DESC, created_at DESC";
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ views: rows || [] });
      });
    },
  );

  app.post(
    "/api/reports/saved-views",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      const {
        report_key,
        name,
        scope = "personal",
        role_id = null,
        filters = {},
        is_default = false,
      } = req.body || {};
      if (!report_key || !name)
        return res
          .status(400)
          .json({ error: "report_key and name are required" });
      db.run(
        `INSERT INTO saved_report_views (report_key, name, scope, employee_id, role_id, filters_json, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          report_key,
          name,
          scope,
          scope === "personal" ? req.headers["x-employee-id"] || null : null,
          scope === "role" ? role_id || null : null,
          JSON.stringify(filters || {}),
          is_default ? 1 : 0,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID });
        },
      );
    },
  );

  app.put(
    "/api/reports/saved-views/:id",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      const { id } = req.params;
      const { name, filters, is_default } = req.body || {};
      db.run(
        `UPDATE saved_report_views SET name = COALESCE(?, name), filters_json = COALESCE(?, filters_json),
           is_default = COALESCE(?, is_default), updated_at = datetime('now','localtime')
       WHERE id = ?`,
        [
          name || null,
          filters ? JSON.stringify(filters) : null,
          typeof is_default === "boolean" ? (is_default ? 1 : 0) : null,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (!this.changes)
            return res.status(404).json({ error: "Saved view not found" });
          res.json({ ok: true });
        },
      );
    },
  );

  app.delete(
    "/api/reports/saved-views/:id",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      db.run(
        "DELETE FROM saved_report_views WHERE id = ?",
        [req.params.id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (!this.changes)
            return res.status(404).json({ error: "Saved view not found" });
          res.json({ ok: true });
        },
      );
    },
  );

  app.get(
    "/api/reports/governance/definitions",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      db.all(
        "SELECT * FROM report_definition_versions ORDER BY report_key ASC, created_at DESC",
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ definitions: rows || [] });
        },
      );
    },
  );

  app.post(
    "/api/reports/governance/definitions",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    (req, res) => {
      const {
        report_key,
        version,
        query_signature = null,
        notes = null,
      } = req.body || {};
      if (!report_key || !version)
        return res
          .status(400)
          .json({ error: "report_key and version are required" });
      db.run(
        `INSERT INTO report_definition_versions (report_key, version, query_signature, notes, created_by)
       VALUES (?, ?, ?, ?, ?)`,
        [
          report_key,
          version,
          query_signature,
          notes,
          req.headers["x-employee-id"] || null,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID });
        },
      );
    },
  );

  return { processPendingReportSchedules };
};
