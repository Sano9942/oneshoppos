const nodemailer = require("nodemailer");
const { toUtcStart, toUtcEnd } = require("../../utils/tz");
const { uploadToR2 } = require("../../utils/r2");
const { buildDigestEmailHtml } = require("../../utils/digestEmail");

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

    if (reportKey === "eod-digest") {
      // Fetch dashboard data needed for the digest email.
      // Returns an object (not an array of rows) — runSingleSchedule handles this specially.
      const tz = filters.timezone || "UTC";
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      const todayStart = toUtcStart(todayStr, tz);
      const todayEnd = toUtcEnd(todayStr, tz);
      const twentyNineDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 29 * 24 * 3600 * 1000));
      const twentyNineDaysAgoStart = toUtcStart(twentyNineDaysAgoStr, tz);

      // Collect results with a simple counter pattern
      const result = {};
      let pending = 5;
      let error = null;

      function done(key, val) {
        if (error) return;
        result[key] = val;
        pending -= 1;
        if (pending === 0) cb(null, result);
      }
      function fail(err) {
        if (error) return;
        error = err;
        cb(err);
      }

      // zReport — payment breakdown today
      db.all(
        `SELECT COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
                ROUND(SUM(COALESCE(sp.amount, s.total_amount)), 2) AS total
         FROM sales s
         LEFT JOIN sale_payments sp ON s.id = sp.sale_id
         WHERE s.voided = 0 AND s.timestamp >= ? AND s.timestamp < ?
         GROUP BY payment_method ORDER BY total DESC`,
        [todayStart, todayEnd],
        (err, rows) => {
          if (err) return fail(err);
          const zReport = rows || [];
          const totalRevenueToday = zReport.reduce((s, r) => s + Number(r.total || 0), 0);
          const paymentContribution = zReport.map((r) => ({
            ...r,
            contribution_pct: totalRevenueToday > 0
              ? Number(((Number(r.total || 0) / totalRevenueToday) * 100).toFixed(2))
              : 0,
          }));
          result.zReport = paymentContribution;
          result.totalRevenueToday = Number(totalRevenueToday.toFixed(2));
          pending -= 1; // counts as one of the 5 slots
          if (pending === 0) cb(null, result);
        }
      );

      // saleCount + averageBill
      db.get(
        `SELECT COUNT(id) AS count FROM sales WHERE voided = 0 AND timestamp >= ? AND timestamp < ?`,
        [todayStart, todayEnd],
        (err, row) => {
          if (err) return fail(err);
          result.saleCount = Number(row?.count || 0);
          result.averageBill = result.saleCount > 0 && result.totalRevenueToday != null
            ? Number((result.totalRevenueToday / result.saleCount).toFixed(2))
            : 0;
          done("_saleCount", true);
        }
      );

      // todayProfit (gross profit - expenses)
      db.get(
        `SELECT
           ROUND(COALESCE(SUM(
             CASE WHEN t.id IS NOT NULL
               THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
               ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0))
             END
           ), 0), 2) AS tax_exclusive,
           ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS total_cost
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         JOIN products p ON si.product_id = p.id
         LEFT JOIN taxes t ON p.tax_id = t.id
         WHERE s.voided = 0 AND s.timestamp >= ? AND s.timestamp < ?`,
        [todayStart, todayEnd],
        (err, profitRow) => {
          if (err) return fail(err);
          const grossProfit = Number(profitRow?.tax_exclusive || 0) - Number(profitRow?.total_cost || 0);
          db.get(
            `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS total FROM expenses WHERE expense_date = ?`,
            [todayStr],
            (err2, expRow) => {
              if (err2) return fail(err2);
              result.todayProfit = Number((grossProfit - Number(expRow?.total || 0)).toFixed(2));
              done("_profit", true);
            }
          );
        }
      );

      // exceptions (refunds, voids, discounts)
      db.get(
        `SELECT COUNT(DISTINCT r.id) AS refund_count,
                ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0), 2) AS refund_value
         FROM returns r LEFT JOIN return_items ri ON ri.return_id = r.id
         WHERE r.timestamp >= ? AND r.timestamp < ?`,
        [todayStart, todayEnd],
        (err, refRow) => {
          if (err) return fail(err);
          db.get(
            `SELECT COUNT(*) AS void_count, ROUND(COALESCE(SUM(total_amount), 0), 2) AS void_value
             FROM sales WHERE voided = 1 AND timestamp >= ? AND timestamp < ?`,
            [todayStart, todayEnd],
            (err2, voidRow) => {
              if (err2) return fail(err2);
              db.get(
                `SELECT COUNT(*) AS discount_count, ROUND(COALESCE(SUM(discount_amount), 0), 2) AS discount_value
                 FROM sales WHERE voided = 0 AND COALESCE(discount_amount, 0) > 0 AND timestamp >= ? AND timestamp < ?`,
                [todayStart, todayEnd],
                (err3, discRow) => {
                  if (err3) return fail(err3);
                  const rev = result.totalRevenueToday || 0;
                  const cnt = result.saleCount || 0;
                  result.refundsToday = {
                    count: Number(refRow?.refund_count || 0),
                    value: Number(refRow?.refund_value || 0),
                    pct_of_sales: rev > 0 ? Number(((Number(refRow?.refund_value || 0) / rev) * 100).toFixed(1)) : 0,
                    pct_of_orders: cnt > 0 ? Number(((Number(refRow?.refund_count || 0) / cnt) * 100).toFixed(1)) : 0,
                  };
                  result.voidsToday = {
                    count: Number(voidRow?.void_count || 0),
                    value: Number(voidRow?.void_value || 0),
                    pct_of_sales: rev > 0 ? Number(((Number(voidRow?.void_value || 0) / rev) * 100).toFixed(1)) : 0,
                    pct_of_orders: cnt > 0 ? Number(((Number(voidRow?.void_count || 0) / cnt) * 100).toFixed(1)) : 0,
                  };
                  result.discountsToday = {
                    count: Number(discRow?.discount_count || 0),
                    value: Number(discRow?.discount_value || 0),
                    pct_of_sales: rev > 0 ? Number(((Number(discRow?.discount_value || 0) / rev) * 100).toFixed(1)) : 0,
                    pct_of_orders: cnt > 0 ? Number(((Number(discRow?.discount_count || 0) / cnt) * 100).toFixed(1)) : 0,
                  };
                  done("_exceptions", true);
                }
              );
            }
          );
        }
      );

      // topSelling + lowStock
      db.all(
        `SELECT p.name, SUM(si.quantity) AS total_sold
         FROM sale_items si JOIN products p ON si.product_id = p.id JOIN sales s ON si.sale_id = s.id
         WHERE s.voided = 0 AND s.timestamp >= ?
         GROUP BY p.name ORDER BY total_sold DESC, p.name ASC LIMIT 5`,
        [twentyNineDaysAgoStart],
        (err, topRows) => {
          if (err) return fail(err);
          result.topSelling = topRows || [];
          db.all(
            `SELECT p.name, COALESCE(SUM(os.quantity), 0) AS stock
             FROM products p LEFT JOIN outlet_stock os ON p.id = os.product_id
             GROUP BY p.id
             HAVING stock <= CASE WHEN COALESCE(MAX(p.min_qty), 0) > 0 THEN MAX(p.min_qty) ELSE 10 END
             ORDER BY stock ASC, p.name ASC LIMIT 8`,
            [],
            (err2, stockRows) => {
              if (err2) return fail(err2);
              result.lowStock = stockRows || [];
              done("_inventory", true);
            }
          );
        }
      );

      return; // early return — cb called asynchronously above
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

            // eod-digest: rows is a plain data object, not an array
            const isDigest = schedule.report_key === "eod-digest";
            const rowArray = isDigest ? [] : (rows || []);

            const tz = filters.timezone || "UTC";
            const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

            const fileName = isDigest
              ? `digest_${schedule.id}_${Date.now()}.html`
              : `report_${schedule.report_key}_${schedule.id}_${Date.now()}.csv`;
            const r2Key = `reports/${fileName}`;

            let fileContent, mimeType;
            if (isDigest) {
              fileContent = Buffer.from(
                buildDigestEmailHtml(rows, filters.company_name || "SanoPOS", dateStr),
                "utf8"
              );
              mimeType = "text/html";
            } else {
              fileContent = Buffer.from(
                toCsvLines(rowArray, columnsForScheduleReport(schedule.report_key), filters),
                "utf8"
              );
              mimeType = "text/csv";
            }

            uploadToR2(fileContent, r2Key, mimeType)
              .then((fileUrl) => {
                db.run(
                  `UPDATE report_schedule_runs
                   SET status='success', run_finished_at=datetime('now','localtime'),
                       file_path=?, row_count=?
                   WHERE id=?`,
                  [fileUrl, rowArray.length, runId],
                );
                db.run(
                  "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'file', ?, 'sent', ?)",
                  [runId, schedule.id, schedule.recipient || null, `Generated file: ${fileName}`],
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

                // Send digest email if recipient is set and this is an eod-digest schedule
                if (isDigest && schedule.recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(schedule.recipient)) {
                  db.get("SELECT * FROM email_config WHERE id = 1", (emailErr, cfg) => {
                    if (emailErr || !cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
                      // Email not configured — log as skipped, still return success
                      db.run(
                        "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'email', ?, 'skipped', ?)",
                        [runId, schedule.id, schedule.recipient, "Email not configured or disabled"],
                      );
                      return cb(null, { run_id: runId, file_path: fileUrl, row_count: 0 });
                    }

                    const transport = nodemailer.createTransport({
                      host: cfg.smtp_host,
                      port: Number(cfg.smtp_port || 587),
                      secure: Number(cfg.smtp_port) === 465,
                      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
                    });

                    const html = buildDigestEmailHtml(rows, filters.company_name || cfg.from_name || "SanoPOS", dateStr);

                    transport.sendMail({
                      from: `"${cfg.from_name || "SanoPOS"}" <${cfg.smtp_user}>`,
                      to: schedule.recipient,
                      subject: `End-of-Day Digest — ${dateStr}`,
                      html,
                    }).then(() => {
                      db.run(
                        "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'email', ?, 'sent', ?)",
                        [runId, schedule.id, schedule.recipient, `Digest email sent for ${dateStr}`],
                      );
                      return cb(null, { run_id: runId, file_path: fileUrl, row_count: 0 });
                    }).catch((mailErr) => {
                      db.run(
                        "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'email', ?, 'failed', ?)",
                        [runId, schedule.id, schedule.recipient, mailErr.message],
                      );
                      // Email failure does not fail the whole schedule run
                      return cb(null, { run_id: runId, file_path: fileUrl, row_count: 0 });
                    });
                  });
                } else {
                  return cb(null, { run_id: runId, file_path: fileUrl, row_count: rowArray.length });
                }
              })
              .catch((e) => {
                db.run(
                  "UPDATE report_schedule_runs SET status='failed', run_finished_at=datetime('now','localtime'), error_message=? WHERE id=?",
                  [e.message, runId],
                );
                db.run(
                  "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES (?, ?, 'file', ?, 'failed', ?)",
                  [runId, schedule.id, schedule.recipient || null, e.message],
                );
                return cb(e);
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
