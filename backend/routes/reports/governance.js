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
      where.push(`${col} = $${params.length + 1}`);
      params.push(ids[0]);
    } else if (ids.length > 1) {
      where.push(`${col} IN (${ids.map((_, i) => `$${params.length + i + 1}`).join(",")})`);
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

  async function getRowsForScheduleReport(reportKey, filters) {
    const tz = filters.timezone || "UTC";
    if (reportKey === "profit-by-product") {
      const where = ["s.voided = false"];
      const params = [];
      if (filters.date_from) {
        where.push(`s.timestamp >= $${params.length + 1}`);
        params.push(toUtcStart(filters.date_from, tz));
      }
      if (filters.date_to) {
        where.push(`s.timestamp < $${params.length + 1}`);
        params.push(toUtcEnd(filters.date_to, tz));
      }
      applyOutletFilter(where, params, filters.outlet_id);
      const sql = `
      SELECT p.name AS product_name, p.barcode,
             ROUND(SUM(si.quantity * si.price_at_sale)::numeric, 2) AS revenue,
             ROUND(SUM(si.quantity * si.cost_price_at_sale)::numeric, 2) AS cogs,
             ROUND(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale)::numeric, 2) AS gross_profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, p.name, p.barcode
      ORDER BY gross_profit DESC
      LIMIT 1000
    `;
      const { rows } = await db.query(sql, params);
      return rows;
    }

    if (reportKey === "stock-aging") {
      const sql = `
      SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
             os.quantity AS stock_qty,
             MAX(s.timestamp) AS last_sold_at,
             CAST(EXTRACT(EPOCH FROM (NOW() - MAX(s.timestamp))) / 86400.0 AS INTEGER) AS days_since_sale
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = false
      WHERE os.quantity > 0
      GROUP BY p.id, p.name, p.barcode, o.id, o.name, os.quantity
      ORDER BY COALESCE(CAST(EXTRACT(EPOCH FROM (NOW() - MAX(s.timestamp))) / 86400.0 AS INTEGER), 99999) DESC
      LIMIT 1000
    `;
      const { rows } = await db.query(sql, []);
      return rows;
    }

    if (reportKey === "stockout-risk") {
      const lookbackDays = Math.max(
        7,
        Math.min(365, parseInt(filters.lookback_days || 28, 10)),
      );
      const sql = `
          SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
                 COALESCE(SUM(si.quantity), 0) / $1 AS avg_daily_units,
                 COALESCE(os.quantity, 0) AS on_hand_qty,
                 CASE WHEN COALESCE(SUM(si.quantity), 0) > 0
                      THEN COALESCE(os.quantity, 0) / (COALESCE(SUM(si.quantity), 0) / $2)
                      ELSE NULL END AS days_of_cover
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          JOIN outlets o ON o.id = s.outlet_id
          LEFT JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = o.id
          WHERE s.voided = false AND s.timestamp >= NOW() - make_interval(days => $3)
          GROUP BY p.id, p.name, p.barcode, o.id, o.name, os.quantity
          ORDER BY avg_daily_units DESC
          LIMIT 1000
        `;
      const { rows } = await db.query(sql, [lookbackDays, lookbackDays, lookbackDays]);
      return rows;
    }

    if (reportKey === "eod-digest") {
      const tz = filters.timezone || "UTC";
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      const todayStart = toUtcStart(todayStr, tz);
      const todayEnd = toUtcEnd(todayStr, tz);
      const twentyNineDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 29 * 24 * 3600 * 1000));
      const twentyNineDaysAgoStart = toUtcStart(twentyNineDaysAgoStr, tz);

      const result = {};

      // zReport — payment breakdown today
      const { rows: zReportRows } = await db.query(
        `SELECT COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
                ROUND(SUM(COALESCE(sp.amount, s.total_amount))::numeric, 2) AS total
         FROM sales s
         LEFT JOIN sale_payments sp ON s.id = sp.sale_id
         WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2
         GROUP BY COALESCE(sp.payment_method, s.payment_method, 'Unknown') ORDER BY total DESC`,
        [todayStart, todayEnd],
      );
      const zReport = zReportRows || [];
      const totalRevenueToday = zReport.reduce((s, r) => s + Number(r.total || 0), 0);
      const paymentContribution = zReport.map((r) => ({
        ...r,
        contribution_pct: totalRevenueToday > 0
          ? Number(((Number(r.total || 0) / totalRevenueToday) * 100).toFixed(2))
          : 0,
      }));
      result.zReport = paymentContribution;
      result.totalRevenueToday = Number(totalRevenueToday.toFixed(2));

      // saleCount + averageBill
      const { rows: [saleCountRow] } = await db.query(
        `SELECT COUNT(id) AS count FROM sales WHERE voided = false AND timestamp >= $1 AND timestamp < $2`,
        [todayStart, todayEnd],
      );
      result.saleCount = Number(saleCountRow?.count || 0);
      result.averageBill = result.saleCount > 0 && result.totalRevenueToday != null
        ? Number((result.totalRevenueToday / result.saleCount).toFixed(2))
        : 0;

      // todayProfit (gross profit - expenses)
      const { rows: [profitRow] } = await db.query(
        `SELECT
           ROUND(COALESCE(SUM(
             CASE WHEN t.id IS NOT NULL
               THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
               ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0))
             END
           ), 0)::numeric, 2) AS tax_exclusive,
           ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0)::numeric, 2) AS total_cost
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         JOIN products p ON si.product_id = p.id
         LEFT JOIN taxes t ON p.tax_id = t.id
         WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2`,
        [todayStart, todayEnd],
      );
      const grossProfit = Number(profitRow?.tax_exclusive || 0) - Number(profitRow?.total_cost || 0);
      const { rows: [expRow] } = await db.query(
        `SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2) AS total FROM expenses WHERE expense_date = $1`,
        [todayStr],
      );
      result.todayProfit = Number((grossProfit - Number(expRow?.total || 0)).toFixed(2));

      // exceptions (refunds, voids, discounts)
      const { rows: [refRow] } = await db.query(
        `SELECT COUNT(DISTINCT r.id) AS refund_count,
                ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0)::numeric, 2) AS refund_value
         FROM returns r LEFT JOIN return_items ri ON ri.return_id = r.id
         WHERE r.timestamp >= $1 AND r.timestamp < $2`,
        [todayStart, todayEnd],
      );
      const { rows: [voidRow] } = await db.query(
        `SELECT COUNT(*) AS void_count, ROUND(COALESCE(SUM(total_amount), 0)::numeric, 2) AS void_value
         FROM sales WHERE voided = true AND timestamp >= $1 AND timestamp < $2`,
        [todayStart, todayEnd],
      );
      const { rows: [discRow] } = await db.query(
        `SELECT COUNT(*) AS discount_count, ROUND(COALESCE(SUM(discount_amount), 0)::numeric, 2) AS discount_value
         FROM sales WHERE voided = false AND COALESCE(discount_amount, 0) > 0 AND timestamp >= $1 AND timestamp < $2`,
        [todayStart, todayEnd],
      );
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

      // topSelling + lowStock
      const { rows: topRows } = await db.query(
        `SELECT p.name, SUM(si.quantity) AS total_sold
         FROM sale_items si JOIN products p ON si.product_id = p.id JOIN sales s ON si.sale_id = s.id
         WHERE s.voided = false AND s.timestamp >= $1
         GROUP BY p.name ORDER BY total_sold DESC, p.name ASC LIMIT 5`,
        [twentyNineDaysAgoStart],
      );
      result.topSelling = topRows || [];

      const { rows: stockRows } = await db.query(
        `SELECT p.name, COALESCE(SUM(os.quantity), 0) AS stock
         FROM products p LEFT JOIN outlet_stock os ON p.id = os.product_id
         GROUP BY p.id, p.name
         HAVING COALESCE(SUM(os.quantity), 0) <= CASE WHEN COALESCE(MAX(p.min_qty), 0) > 0 THEN MAX(p.min_qty) ELSE 10 END
         ORDER BY stock ASC, p.name ASC LIMIT 8`,
        [],
      );
      result.lowStock = stockRows || [];

      return result;
    }

    const sql = `
    SELECT s.id AS sale_id, s.timestamp, COALESCE(o.name,'\u2014') AS outlet_name,
           COALESCE(e.name,'\u2014') AS employee_name,
           ROUND(COALESCE(s.total_amount,0)::numeric,2) AS total_amount,
           ROUND(COALESCE(s.discount_amount,0)::numeric,2) AS discount_amount
    FROM sales s
    LEFT JOIN outlets o ON o.id = s.outlet_id
    LEFT JOIN employees e ON e.id = s.employee_id
    WHERE s.voided = false AND COALESCE(s.discount_amount,0) > 0
    ORDER BY s.discount_amount DESC
    LIMIT 1000
    `;
    const { rows } = await db.query(sql, []);
    return rows;
  }

  // Custom report builder definitions (Phase 2B)
  if (reportKey.startsWith("builder:")) {
    const defId = parseInt(reportKey.split(":")[1], 10);
    const { rows: defRows } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [defId]);
    if (!defRows.length) throw new Error(`Builder definition ${defId} not found`);
    const def = defRows[0];
    const { buildQuery } = require("../report-builder");
    const parsedFilters = typeof def.filters_json === "string" ? JSON.parse(def.filters_json || "{}") : (def.filters_json || {});
    const { sql: builderSql, params: builderParams } = buildQuery(def.dataset, def.dimensions, def.measures, parsedFilters, def.sort_by, def.sort_order);
    const { rows: builderRows } = await db.query(builderSql, builderParams);
    return builderRows;
  }

  async function runSingleSchedule(schedule) {
    const filters = parseJsonObject(schedule.filters_json);
    const { rows: [{ id: runId }] } = await db.query(
      "INSERT INTO report_schedule_runs (schedule_id, status) VALUES ($1, 'running') RETURNING id",
      [schedule.id],
    );

    let rows;
    try {
      rows = await getRowsForScheduleReport(schedule.report_key, filters);
    } catch (rowsErr) {
      await db.query(
        "UPDATE report_schedule_runs SET status='failed', run_finished_at=NOW(), error_message=$1 WHERE id=$2",
        [rowsErr.message, runId],
      );
      await db.query(
        "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES ($1, $2, 'file', $3, 'failed', $4)",
        [runId, schedule.id, schedule.recipient || null, rowsErr.message],
      );
      throw rowsErr;
    }

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
        "utf8",
      );
      mimeType = "text/html";
    } else {
      fileContent = Buffer.from(
        toCsvLines(rowArray, columnsForScheduleReport(schedule.report_key), filters),
        "utf8",
      );
      mimeType = "text/csv";
    }

    let fileUrl;
    try {
      fileUrl = await uploadToR2(fileContent, r2Key, mimeType);
    } catch (e) {
      await db.query(
        "UPDATE report_schedule_runs SET status='failed', run_finished_at=NOW(), error_message=$1 WHERE id=$2",
        [e.message, runId],
      );
      await db.query(
        "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES ($1, $2, 'file', $3, 'failed', $4)",
        [runId, schedule.id, schedule.recipient || null, e.message],
      );
      throw e;
    }

    await db.query(
      `UPDATE report_schedule_runs
       SET status='success', run_finished_at=NOW(),
           file_path=$1, row_count=$2
       WHERE id=$3`,
      [fileUrl, rowArray.length, runId],
    );
    await db.query(
      "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES ($1, $2, 'file', $3, 'sent', $4)",
      [runId, schedule.id, schedule.recipient || null, `Generated file: ${fileName}`],
    );
    const nextRun = nextRunAtIso(
      schedule.frequency,
      schedule.run_hour,
      schedule.run_minute,
    );
    await db.query(
      "UPDATE report_schedules SET last_run_at=NOW(), next_run_at=$1, updated_at=NOW() WHERE id=$2",
      [nextRun, schedule.id],
    );

    // Send digest email if recipient is set and this is an eod-digest schedule
    if (isDigest && schedule.recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(schedule.recipient)) {
      const { rows: [cfg] } = await db.query("SELECT * FROM email_config WHERE id = 1");
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        // Email not configured — log as skipped, still return success
        await db.query(
          "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES ($1, $2, 'email', $3, 'skipped', $4)",
          [runId, schedule.id, schedule.recipient, "Email not configured or disabled"],
        );
        return { run_id: runId, file_path: fileUrl, row_count: 0 };
      }

      const transport = nodemailer.createTransport({
        host: cfg.smtp_host,
        port: Number(cfg.smtp_port || 587),
        secure: Number(cfg.smtp_port) === 465,
        auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
      });

      const html = buildDigestEmailHtml(rows, filters.company_name || cfg.from_name || "SanoPOS", dateStr);

      try {
        await transport.sendMail({
          from: `"${cfg.from_name || "SanoPOS"}" <${cfg.smtp_user}>`,
          to: schedule.recipient,
          subject: `End-of-Day Digest \u2014 ${dateStr}`,
          html,
        });
        await db.query(
          "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES ($1, $2, 'email', $3, 'sent', $4)",
          [runId, schedule.id, schedule.recipient, `Digest email sent for ${dateStr}`],
        );
      } catch (mailErr) {
        await db.query(
          "INSERT INTO report_delivery_log (schedule_run_id, schedule_id, channel, recipient, status, message) VALUES ($1, $2, 'email', $3, 'failed', $4)",
          [runId, schedule.id, schedule.recipient, mailErr.message],
        );
        // Email failure does not fail the whole schedule run
      }
      return { run_id: runId, file_path: fileUrl, row_count: 0 };
    }

    return { run_id: runId, file_path: fileUrl, row_count: rowArray.length };
  }

  async function processPendingReportSchedules(limit = 5) {
    const { rows: schedules } = await db.query(
      `SELECT * FROM report_schedules
       WHERE is_active = true
         AND (next_run_at IS NULL OR next_run_at <= NOW())
       ORDER BY COALESCE(next_run_at, created_at) ASC
       LIMIT $1`,
      [limit],
    );
    const list = schedules || [];
    if (!list.length) return { processed: 0 };
    let processed = 0;
    for (const schedule of list) {
      try {
        await runSingleSchedule(schedule);
      } catch (_) {
        // errors already logged inside runSingleSchedule
      }
      processed += 1;
    }
    return { processed };
  }

  app.get(
    "/api/reports/schedules",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT * FROM report_schedules ORDER BY created_at DESC",
        );
        res.json({ schedules: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/reports/schedules",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
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
      try {
        const { rows: [{ id }] } = await db.query(
          `INSERT INTO report_schedules (name, report_key, frequency, run_hour, run_minute, recipient, export_format, filters_json, next_run_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
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
        );
        res.json({ schedule: { id, next_run_at: nextRun }, id, next_run_at: nextRun });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/reports/schedules/:id",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
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
      try {
        const { rowCount } = await db.query(
          `UPDATE report_schedules
         SET name = COALESCE($1, name), report_key = COALESCE($2, report_key), frequency = COALESCE($3, frequency),
             run_hour = COALESCE($4, run_hour), run_minute = COALESCE($5, run_minute), recipient = $6,
             export_format = COALESCE($7, export_format), filters_json = COALESCE($8, filters_json),
             is_active = COALESCE($9, is_active), next_run_at = $10, updated_at = NOW()
         WHERE id = $11`,
          [
            name || null,
            report_key || null,
            frequency || null,
            Number.isInteger(run_hour) ? run_hour : null,
            Number.isInteger(run_minute) ? run_minute : null,
            recipient ?? null,
            export_format || null,
            filters ? JSON.stringify(filters) : null,
            typeof is_active === "boolean" ? is_active : null,
            nextRun,
            id,
          ],
        );
        if (!rowCount)
          return res.status(404).json({ error: "Schedule not found" });
        res.json({ ok: true, next_run_at: nextRun });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.delete(
    "/api/reports/schedules/:id",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      try {
        const { rowCount } = await db.query(
          "DELETE FROM report_schedules WHERE id = $1",
          [req.params.id],
        );
        if (!rowCount)
          return res.status(404).json({ error: "Schedule not found" });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/reports/schedules/:id/run-now",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      try {
        const { rows: [schedule] } = await db.query(
          "SELECT * FROM report_schedules WHERE id = $1",
          [req.params.id],
        );
        if (!schedule)
          return res.status(404).json({ error: "Schedule not found" });
        const payload = await runSingleSchedule(schedule);
        res.json({ ok: true, run: payload });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.get(
    "/api/reports/schedules/:id/runs",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT * FROM report_schedule_runs WHERE schedule_id = $1 ORDER BY run_started_at DESC LIMIT 100",
          [req.params.id],
        );
        res.json({ runs: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.get(
    "/api/reports/delivery-log",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT * FROM report_delivery_log ORDER BY created_at DESC LIMIT 200",
        );
        res.json({ log: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.get(
    "/api/reports/saved-views",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      const reportKey = req.query.report_key || null;
      const employeeId = req.headers["x-employee-id"] || null;
      const params = [employeeId, employeeId];
      let sql = `
      SELECT * FROM saved_report_views
      WHERE scope = 'global'
         OR (scope = 'role' AND role_id = (SELECT role_id FROM employees WHERE id = $1))
         OR (scope = 'personal' AND employee_id = $2)
    `;
      if (reportKey) {
        sql += ` AND report_key = $${params.length + 1}`;
        params.push(reportKey);
      }
      sql += " ORDER BY scope DESC, created_at DESC";
      try {
        const { rows } = await db.query(sql, params);
        res.json({ views: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/reports/saved-views",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
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
      try {
        const { rows: [{ id }] } = await db.query(
          `INSERT INTO saved_report_views (report_key, name, scope, employee_id, role_id, filters_json, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            report_key,
            name,
            scope,
            scope === "personal" ? req.headers["x-employee-id"] || null : null,
            scope === "role" ? role_id || null : null,
            JSON.stringify(filters || {}),
            is_default,
          ],
        );
        res.json({ view: { id }, id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/reports/saved-views/:id",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      const { id } = req.params;
      const { name, filters, is_default } = req.body || {};
      try {
        const { rowCount } = await db.query(
          `UPDATE saved_report_views SET name = COALESCE($1, name), filters_json = COALESCE($2, filters_json),
             is_default = COALESCE($3, is_default), updated_at = NOW()
         WHERE id = $4`,
          [
            name || null,
            filters ? JSON.stringify(filters) : null,
            typeof is_default === "boolean" ? is_default : null,
            id,
          ],
        );
        if (!rowCount)
          return res.status(404).json({ error: "Saved view not found" });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.delete(
    "/api/reports/saved-views/:id",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      try {
        const { rowCount } = await db.query(
          "DELETE FROM saved_report_views WHERE id = $1",
          [req.params.id],
        );
        if (!rowCount)
          return res.status(404).json({ error: "Saved view not found" });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.get(
    "/api/reports/governance/definitions",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT * FROM report_definition_versions ORDER BY report_key ASC, created_at DESC",
        );
        res.json({ definitions: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/reports/governance/definitions",
    requirePerm("manage_employees"),
    requireFeature("reports_scheduled_exports"),
    async (req, res) => {
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
      try {
        const { rows: [{ id }] } = await db.query(
          `INSERT INTO report_definition_versions (report_key, version, query_signature, notes, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            report_key,
            version,
            query_signature,
            notes,
            req.headers["x-employee-id"] || null,
          ],
        );
        res.json({ id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  return { processPendingReportSchedules };
};
