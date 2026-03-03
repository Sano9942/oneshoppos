const {
  fetchEnrichedCategories,
  getDescendantLeafIds,
} = require("../category-tree");

module.exports = function registerReportsRoutes(app, deps) {
  const {
    db,
    requirePerm,
    requireAnyPerm,
    requireFeature,
    createNotification,
    path,
    fs,
    UPLOADS_DIR,
  } = deps;

  async function buildCategoryMetaMap() {
    const categories = await fetchEnrichedCategories(db);
    return new Map(categories.map((row) => [Number(row.id), row]));
  }

  function withCategoryPaths(rows, categoryMeta, sourceKey = "category_id") {
    return (rows || []).map((row) => {
      const categoryId = row[sourceKey] == null ? null : Number(row[sourceKey]);
      const category = categoryId != null ? categoryMeta.get(categoryId) : null;
      return {
        ...row,
        category: category?.path_label || row.category || "Uncategorized",
        category_path_label:
          category?.path_label || row.category || "Uncategorized",
      };
    });
  }

  // --- REPORTS DASHBOARD ---

  app.get("/api/reports/dashboard", async (req, res) => {
    try {
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      // 1. Z-Report: Today's Revenue by Payment Method (handles split tenders & backward compatibility)
      const zReport = await getQuery(`
            SELECT COALESCE(sp.payment_method, s.payment_method) as payment_method, 
                   SUM(COALESCE(sp.amount, s.total_amount)) as total
            FROM sales s
            LEFT JOIN sale_payments sp ON s.id = sp.sale_id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
            GROUP BY COALESCE(sp.payment_method, s.payment_method)
        `);
      const totalRevenueToday = zReport.reduce(
        (sum, row) => sum + row.total,
        0,
      );

      // Calculate Tax Exclusive Revenue vs Inclusive
      // We calculate this mathematically based on the products sold today and their live GST profile (or the stored gst)
      const revenueMetrics = await getQuery(`
            SELECT 
                SUM(si.quantity * si.price_at_sale) as tax_inclusive,
                SUM(
                  CASE 
                    WHEN p.tax_id IS NOT NULL THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100))
                    ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100))
                  END
                ) as tax_exclusive,
                SUM(si.quantity * si.cost_price_at_sale) as total_cost
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN taxes t ON p.tax_id = t.id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
        `);

      const taxInclusive = revenueMetrics[0]?.tax_inclusive || 0;
      const taxExclusive = revenueMetrics[0]?.tax_exclusive || 0;
      const totalCost = revenueMetrics[0]?.total_cost || 0;
      const todayProfit = taxExclusive - totalCost; // Profit is on exclusive revenue

      // Count of sales today
      const saleCountRow = await getQuery(
        `SELECT COUNT(id) as count FROM sales WHERE date(timestamp, 'localtime') = date('now', 'localtime')`,
      );
      const saleCount = saleCountRow[0]?.count || 0;

      // 3. Top Selling Items (All time)
      const topSelling = await getQuery(`
            SELECT p.name, SUM(si.quantity) as total_sold
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            GROUP BY p.name
            ORDER BY total_sold DESC
            LIMIT 5
        `);

      // 4. Low Stock Alert (Threshold: 10 or less) — using outlet_stock as source of truth
      const lowStock = await getQuery(`
            SELECT p.name, p.barcode, p.price, p.cost_price, COALESCE(SUM(os.quantity), 0) as stock
            FROM products p
            LEFT JOIN outlet_stock os ON p.id = os.product_id
            GROUP BY p.id
            HAVING stock <= 10
            ORDER BY stock ASC
        `);

      // 5. Estimated Inventory Value — using outlet_stock as source of truth
      const inventoryValueRow = await getQuery(`
            SELECT 
                SUM(os.quantity * p.price) as retail_value,
                SUM(os.quantity * p.cost_price) as cost_value
            FROM outlet_stock os
            JOIN products p ON os.product_id = p.id
            WHERE os.quantity > 0
        `);

      // 6. Last 7 days sales trend (for chart)
      const salesTrend = await getQuery(`
      SELECT date(timestamp,'localtime') as day,
             ROUND(SUM(total_amount),2) as revenue,
             COUNT(id) as sale_count
      FROM sales
      WHERE voided = 0
        AND date(timestamp,'localtime') >= date('now','-6 days','localtime')
      GROUP BY day
      ORDER BY day ASC
    `);

      // 7. Today's expenses total (deducted from net profit)
      const expenseRows = await getQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date = date('now','localtime')`,
      );
      const todayExpenses = expenseRows[0]?.total || 0;
      const netProfitToday = todayProfit - todayExpenses;

      // 8. Attendance today — clocked in, on break, clocked out, not started
      const attendanceToday = await getQuery(`
        SELECT
          e.id,
          e.name,
          s.session_type,
          s.break_reason,
          COALESCE(
            (SELECT COALESCE(SUM(duration_hours),0)
             FROM attendance_sessions
             WHERE employee_id = e.id
               AND session_type = 'work'
               AND session_end IS NOT NULL
               AND date(session_start,'localtime') = date('now','localtime')
            ), 0
          ) AS net_work_hours
        FROM employees e
        LEFT JOIN attendance_sessions s
          ON s.employee_id = e.id
          AND s.session_end IS NULL
          AND date(s.session_start,'localtime') = date('now','localtime')
        GROUP BY e.id
      `);

      const attendanceSummary = {
        clocked_in: attendanceToday.filter((r) => r.session_type === "work")
          .length,
        on_break: attendanceToday.filter((r) => r.session_type === "break")
          .length,
        clocked_out: attendanceToday.filter(
          (r) => r.session_type === null && r.net_work_hours > 0,
        ).length,
        not_started: attendanceToday.filter(
          (r) => r.session_type === null && r.net_work_hours === 0,
        ).length,
        total_employees: attendanceToday.length,
        details: attendanceToday.map((r) => ({
          id: r.id,
          name: r.name,
          status:
            r.session_type === "work"
              ? "clocked_in"
              : r.session_type === "break"
                ? "on_break"
                : r.net_work_hours > 0
                  ? "clocked_out"
                  : "not_started",
          break_reason: r.break_reason || null,
          net_work_hours: r.net_work_hours,
        })),
      };

      res.json({
        zReport,
        totalRevenueToday,
        taxInclusive,
        taxExclusive,
        todayProfit: netProfitToday,
        todayGrossProfit: todayProfit,
        todayExpenses,
        saleCount,
        topSelling,
        lowStock,
        salesTrend,
        inventoryValue: inventoryValueRow[0] || {
          retail_value: 0,
          cost_value: 0,
        },
        attendanceSummary,
      });
    } catch (err) {
      console.error("Report Error:", err);
      res.status(500).json({ error: "Failed to generate reports" });
    }
  });

  // --- REPORTS DASHBOARD ADVANCED (Trends & Heatmaps) ---

  app.get("/api/reports/comparative-trends", async (req, res) => {
    try {
      const { outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let outletFilter = "";
      const params = [];
      if (outlet_id) {
        outletFilter = " AND s.outlet_id = ?";
        params.push(outlet_id);
      }

      // We want to compare Today, Yesterday, Same Day Last Week
      const periods = await getQuery(`
        SELECT 
            'today' as period, SUM(total_amount) as revenue, COUNT(id) as orders
        FROM sales s WHERE voided = 0 AND date(timestamp, 'localtime') = date('now', 'localtime') ${outletFilter}
        UNION ALL
        SELECT 
            'yesterday' as period, SUM(total_amount) as revenue, COUNT(id) as orders
        FROM sales s WHERE voided = 0 AND date(timestamp, 'localtime') = date('now', '-1 day', 'localtime') ${outletFilter}
        UNION ALL
        SELECT 
            'last_week_same_day' as period, SUM(total_amount) as revenue, COUNT(id) as orders
        FROM sales s WHERE voided = 0 AND date(timestamp, 'localtime') = date('now', '-7 days', 'localtime') ${outletFilter}
      `, [...params, ...params, ...params]);

      const data = {
        today: { revenue: 0, orders: 0 },
        yesterday: { revenue: 0, orders: 0 },
        last_week_same_day: { revenue: 0, orders: 0 }
      };

      periods.forEach(row => {
        if(row.period && data[row.period]) {
            data[row.period] = { revenue: row.revenue || 0, orders: row.orders || 0 };
        }
      });

      // Calculate % changes safely
      const safePct = (current, previous) => previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : 0;

      res.json({
        data,
        comparisons: {
          day_over_day_revenue_pct: safePct(data.today.revenue, data.yesterday.revenue),
          day_over_day_orders_pct: safePct(data.today.orders, data.yesterday.orders),
          week_over_week_revenue_pct: safePct(data.today.revenue, data.last_week_same_day.revenue),
          week_over_week_orders_pct: safePct(data.today.orders, data.last_week_same_day.orders),
        }
      });

    } catch (err) {
      console.error("Comparative Trends Error:", err);
      res.status(500).json({ error: "Failed to load comparative trends" });
    }
  });

  app.get("/api/reports/heatmaps", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["voided = 0"];
      const params = [];

      if (date_from) {
        where.push("date(timestamp, 'localtime') >= ?");
        params.push(date_from);
      } else {
        // default to last 30 days if no date provided
        where.push("date(timestamp, 'localtime') >= date('now', '-30 days', 'localtime')")
      }

      if (date_to) {
        where.push("date(timestamp, 'localtime') <= ?");
        params.push(date_to);
      }

      if (outlet_id) {
        where.push("outlet_id = ?");
        params.push(outlet_id);
      }

      // SQLite strftime: %w = day of week (0-6, Sunday is 0), %H = hour (00-24)
      const heatmapData = await getQuery(`
        SELECT 
            CAST(strftime('%w', timestamp, 'localtime') AS INTEGER) as day_of_week,
            CAST(strftime('%H', timestamp, 'localtime') AS INTEGER) as hour_of_day,
            COUNT(id) as transaction_count,
            SUM(total_amount) as revenue
        FROM sales
        WHERE ${where.join(" AND ")}
        GROUP BY day_of_week, hour_of_day
        ORDER BY day_of_week ASC, hour_of_day ASC
      `, params);

      // Initialize full matrix (7 days x 24 hours) with 0s to guarantee shape for frontend
      const matrix = [];
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          matrix.push({
            day_of_week: d,
            day_name: days[d],
            hour_of_day: h,
            transaction_count: 0,
            revenue: 0,
            label: `${h === 0 ? 12 : (h > 12 ? h - 12 : h)} ${h >= 12 ? 'PM' : 'AM'}`
          });
        }
      }

      // Overlay real data
      heatmapData.forEach(row => {
          const index = matrix.findIndex(m => m.day_of_week === row.day_of_week && m.hour_of_day === row.hour_of_day);
          if(index !== -1) {
              matrix[index].transaction_count = row.transaction_count;
              matrix[index].revenue = row.revenue;
          }
      });

      res.json({ heatmap: matrix });

    } catch (err) {
      console.error("Heatmap Error:", err);
      res.status(500).json({ error: "Failed to load heatmap data" });
    }
  });

  // Top Salespeople report
  app.get("/api/reports/top-salespeople", (req, res) => {
    const { date_from, date_to } = req.query;
    const where = ["s.voided = 0", "s.employee_id IS NOT NULL"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT e.name AS employee_name,
           COUNT(DISTINCT s.id) AS transactions,
           ROUND(SUM(s.total_amount), 2) AS revenue,
           SUM(si.quantity) AS items_sold,
           ROUND(SUM(s.total_amount) / COUNT(DISTINCT s.id), 2) AS avg_basket
    FROM sales s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.employee_id
    ORDER BY revenue DESC
  `;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ salespeople: rows });
    });
  });

  // Labor Performance: Hours Worked vs Sales Generated
  app.get("/api/reports/labor-performance", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let saleWhere = ["s.voided = 0", "s.employee_id IS NOT NULL"];
      let attendWhere = ["session_type = 'work'"];
      const saleParams = [];
      const attendParams = [];

      if (date_from) {
        saleWhere.push("date(s.timestamp, 'localtime') >= ?");
        saleParams.push(date_from);
        attendWhere.push("date(session_start, 'localtime') >= ?");
        attendParams.push(date_from);
      } else {
        saleWhere.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')");
        attendWhere.push("date(session_start, 'localtime') >= date('now', '-30 days', 'localtime')");
      }

      if (date_to) {
        saleWhere.push("date(s.timestamp, 'localtime') <= ?");
        saleParams.push(date_to);
        attendWhere.push("date(session_start, 'localtime') <= ?");
        attendParams.push(date_to);
      }

      if (outlet_id) {
        saleWhere.push("s.outlet_id = ?");
        saleParams.push(outlet_id);
        attendWhere.push("outlet_id = ?");
        attendParams.push(outlet_id);
      }

      const sql = `
        WITH EmployeeSales AS (
          SELECT employee_id, SUM(total_amount) as total_revenue
          FROM sales s
          WHERE ${saleWhere.join(" AND ")}
          GROUP BY employee_id
        ),
        EmployeeHours AS (
          SELECT employee_id, SUM(duration_hours) as total_hours
          FROM attendance_sessions
          WHERE ${attendWhere.join(" AND ")}
          GROUP BY employee_id
        )
        SELECT 
          e.id as employee_id,
          e.name as employee_name,
          COALESCE(eh.total_hours, 0) as total_hours,
          COALESCE(es.total_revenue, 0) as total_revenue,
          CASE WHEN COALESCE(eh.total_hours, 0) > 0 
               THEN ROUND(COALESCE(es.total_revenue, 0) / eh.total_hours, 2) 
               ELSE 0 
          END as revenue_per_hour
        FROM employees e
        LEFT JOIN EmployeeSales es ON e.id = es.employee_id
        LEFT JOIN EmployeeHours eh ON e.id = eh.employee_id
        WHERE es.total_revenue > 0 OR eh.total_hours > 0
        ORDER BY revenue_per_hour DESC
      `;

      const rows = await getQuery(sql, [...saleParams, ...attendParams]);
      res.json({ labor_performance: rows });

    } catch (err) {
      console.error("Labor Performance Error:", err);
      res.status(500).json({ error: "Failed to load labor performance data" });
    }
  });

  // Loss Prevention: Team Performance Metrics (Refunds/Voids)
  app.get("/api/reports/loss-prevention", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let voidWhere = ["s.voided = 1", "s.employee_id IS NOT NULL"];
      let refundWhere = ["r.employee_id IS NOT NULL"];
      let saleWhere = ["s.voided = 0", "s.employee_id IS NOT NULL"];
      const voidParams = [];
      const refundParams = [];
      const saleParams = [];

      if (date_from) {
        voidWhere.push("date(s.timestamp, 'localtime') >= ?"); voidParams.push(date_from);
        refundWhere.push("date(r.timestamp, 'localtime') >= ?"); refundParams.push(date_from);
        saleWhere.push("date(s.timestamp, 'localtime') >= ?"); saleParams.push(date_from);
      } else {
        voidWhere.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')");
        refundWhere.push("date(r.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')");
        saleWhere.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')");
      }

      if (date_to) {
        voidWhere.push("date(s.timestamp, 'localtime') <= ?"); voidParams.push(date_to);
        refundWhere.push("date(r.timestamp, 'localtime') <= ?"); refundParams.push(date_to);
        saleWhere.push("date(s.timestamp, 'localtime') <= ?"); saleParams.push(date_to);
      }

      if (outlet_id) {
        voidWhere.push("s.outlet_id = ?"); voidParams.push(outlet_id);
        refundWhere.push("r.outlet_id = ?"); refundParams.push(outlet_id);
        saleWhere.push("s.outlet_id = ?"); saleParams.push(outlet_id);
      }

      const sql = `
        WITH Voids AS (
          SELECT employee_id, COUNT(id) as void_count, SUM(total_amount) as void_value
          FROM sales s WHERE ${voidWhere.join(" AND ")} GROUP BY employee_id
        ),
        Refunds AS (
          SELECT employee_id, COUNT(id) as refund_count, SUM(total_refund) as refund_value
          FROM returns r WHERE ${refundWhere.join(" AND ")} GROUP BY employee_id
        ),
        ValidSales AS (
          SELECT employee_id, COUNT(id) as sale_count, SUM(total_amount) as total_revenue
          FROM sales s WHERE ${saleWhere.join(" AND ")} GROUP BY employee_id
        )
        SELECT 
          e.id as employee_id,
          e.name as employee_name,
          COALESCE(vs.total_revenue, 0) as total_revenue,
          COALESCE(vs.sale_count, 0) as sale_count,
          COALESCE(v.void_count, 0) as void_count,
          COALESCE(v.void_value, 0) as void_value,
          COALESCE(r.refund_count, 0) as refund_count,
          COALESCE(r.refund_value, 0) as refund_value,
          ROUND(CASE WHEN COALESCE(vs.total_revenue, 0) > 0 THEN (COALESCE(v.void_value, 0) + COALESCE(r.refund_value, 0)) / vs.total_revenue * 100 ELSE 0 END, 2) as risk_ratio_pct
        FROM employees e
        LEFT JOIN ValidSales vs ON e.id = vs.employee_id
        LEFT JOIN Voids v ON e.id = v.employee_id
        LEFT JOIN Refunds r ON e.id = r.employee_id
        WHERE v.void_count > 0 OR r.refund_count > 0 OR vs.sale_count > 0
        ORDER BY risk_ratio_pct DESC
      `;

      const rows = await getQuery(sql, [...voidParams, ...refundParams, ...saleParams]);
      res.json({ loss_prevention: rows });

    } catch (err) {
      console.error("Loss Prevention Error:", err);
      res.status(500).json({ error: "Failed to load loss prevention data" });
    }
  });

  // --- CASH MANAGEMENT ---

  // GET all shifts (newest first, with outlet + employee names)
  app.get("/api/shifts", (req, res) => {
    const { outlet_id } = req.query;
    let query = `
    SELECT cs.*, o.name as outlet_name, e.name as employee_name
    FROM cash_shifts cs
    JOIN outlets o ON cs.outlet_id = o.id
    LEFT JOIN employees e ON cs.employee_id = e.id
  `;
    const params = [];
    if (outlet_id) {
      query += " WHERE cs.outlet_id = ?";
      params.push(outlet_id);
    }
    query += " ORDER BY cs.opened_at DESC";

    db.all(query, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ shifts: rows });
    });
  });

  // GET active shift for an outlet (used by POS to check before checkout)
  app.get("/api/shifts/active", (req, res) => {
    const { outlet_id } = req.query;
    if (!outlet_id)
      return res.status(400).json({ error: "outlet_id is required" });

    db.get(
      `SELECT cs.*, o.name as outlet_name, e.name as employee_name
     FROM cash_shifts cs
     JOIN outlets o ON cs.outlet_id = o.id
     LEFT JOIN employees e ON cs.employee_id = e.id
     WHERE cs.outlet_id = ? AND cs.status = 'open'
     ORDER BY cs.opened_at DESC LIMIT 1`,
      [outlet_id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ shift: row || null });
      },
    );
  });

  // POST open a new shift
  app.post("/api/shifts/open", (req, res) => {
    const { outlet_id, employee_id, opening_float } = req.body;

    if (!outlet_id || opening_float === undefined) {
      return res
        .status(400)
        .json({ error: "outlet_id and opening_float are required" });
    }

    // Check if there's already an open shift for this outlet
    db.get(
      "SELECT id FROM cash_shifts WHERE outlet_id = ? AND status = 'open'",
      [outlet_id],
      (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing) {
          return res.status(400).json({
            error: "A shift is already open for this outlet. Close it first.",
          });
        }

        db.run(
          "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float) VALUES (?, ?, ?)",
          [outlet_id, employee_id || null, opening_float],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            createNotification(
              "shift_open",
              "Shift Opened",
              `Shift opened at outlet #${outlet_id}`,
              "/cash-management",
            );
            res.json({
              message: "Shift opened successfully",
              shift_id: this.lastID,
            });
          },
        );
      },
    );
  });

  // POST close a shift — auto-calculates expected cash from cash sales during shift period
  app.post("/api/shifts/:id/close", (req, res) => {
    const { id } = req.params;
    const {
      closing_cash,
      notes,
      variance_reason,
      variance_approved_by,
      denominations,
    } = req.body;

    if (closing_cash === undefined) {
      return res.status(400).json({ error: "closing_cash is required" });
    }

    // Get the shift first
    db.get(
      "SELECT * FROM cash_shifts WHERE id = ? AND status = 'open'",
      [id],
      (err, shift) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!shift)
          return res.status(404).json({ error: "Open shift not found" });

        // Sum all cash payments for this outlet during this shift period
        db.get(
          `SELECT COALESCE(SUM(sp.amount), 0) as cash_sales
       FROM sale_payments sp
       JOIN sales s ON sp.sale_id = s.id
       WHERE s.outlet_id = ?
         AND s.voided = 0
         AND sp.payment_method = 'Cash'
         AND s.timestamp >= ?`,
          [shift.outlet_id, shift.opened_at],
          (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            const cashSales = row?.cash_sales || 0;

            db.get(
              `SELECT COALESCE(SUM(total_refund), 0) as cash_refunds
             FROM returns
             WHERE outlet_id = ?
               AND refund_method = 'Cash'
               AND timestamp >= ?`,
              [shift.outlet_id, shift.opened_at],
              (err, refundRow) => {
                if (err) return res.status(500).json({ error: err.message });

                const cashRefunds = refundRow?.cash_refunds || 0;
                const netCashSales = cashSales - cashRefunds;
                const expectedCash =
                  parseFloat(shift.opening_float) + netCashSales;
                const variance = parseFloat(closing_cash) - expectedCash;
                const closedAt = new Date()
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19);

                db.run(
                  `UPDATE cash_shifts
               SET status = 'closed', closing_cash = ?, expected_cash = ?, variance = ?,
                   closed_at = ?, notes = ?, variance_reason = ?, variance_approved_by = ?
               WHERE id = ?`,
                  [
                    closing_cash,
                    expectedCash,
                    variance,
                    closedAt,
                    notes || null,
                    variance_reason || null,
                    variance_approved_by || null,
                    id,
                  ],
                  function (err) {
                    if (err)
                      return res.status(500).json({ error: err.message });
                    // Store denomination breakdown if provided
                    if (denominations && denominations.length > 0) {
                      const stmt = db.prepare(
                        "INSERT INTO shift_denominations (shift_id, denomination, count) VALUES (?,?,?)",
                      );
                      denominations.forEach((d) => {
                        if (d.count > 0)
                          stmt.run([id, d.denomination, d.count]);
                      });
                      stmt.finalize();
                    }
                    createNotification(
                      "shift_close",
                      "Shift Closed",
                      `Shift #${id} closed. Variance: ${Number(variance || 0).toFixed(2)}`,
                      "/cash-management",
                    );
                    res.json({
                      message: "Shift closed successfully",
                      opening_float: shift.opening_float,
                      cash_sales: cashSales,
                      cash_refunds: cashRefunds,
                      net_cash_sales: netCashSales,
                      expected_cash: expectedCash,
                      closing_cash,
                      variance,
                      variance_reason: variance_reason || null,
                    });
                  },
                );
              },
            );
          },
        );
      },
    );
  });

  // GET denomination breakdown for a shift
  app.get("/api/shifts/:id/denominations", (req, res) => {
    db.all(
      "SELECT denomination, count, subtotal FROM shift_denominations WHERE shift_id = ? ORDER BY denomination DESC",
      [req.params.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ denominations: rows });
      },
    );
  });

  // GET variance reason codes (static list)
  app.get("/api/variance-reasons", (req, res) => {
    res.json({
      reasons: [
        "Counting error",
        "Till refund not recorded",
        "Change given incorrectly",
        "Currency denomination mix-up",
        "Tip/gratuity retained",
        "Manager override",
        "Other",
      ],
    });
  });

  // --- EXTENDED REPORTS ---

  // Sales Summary: per-sale header with outlet, employee, customer, payment methods
  app.get("/api/reports/sales-summary", (req, res) => {
    const { date_from, date_to, search } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    if (search) {
      where.push("(CAST(s.id AS TEXT) LIKE ? OR COALESCE(c.name,'') LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const sql = `
    SELECT s.id, s.timestamp, s.total_amount,
           COALESCE(c.name,'Walk-in') AS customer_name,
           COALESCE(e.name,'—') AS employee_name,
           COALESCE(o.name,'—') AS outlet_name,
           GROUP_CONCAT(DISTINCT COALESCE(sp.payment_method, s.payment_method)) AS payment_methods
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN employees e ON s.employee_id = e.id
    LEFT JOIN outlets o ON s.outlet_id = o.id
    LEFT JOIN sale_payments sp ON s.id = sp.sale_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id
    ORDER BY s.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sales: rows });
    });
  });

  // Sales Detail: flat line-item list with parent sale info
  app.get("/api/reports/sales-detail", (req, res) => {
    const { date_from, date_to, search } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    if (search) {
      where.push("(p.name LIKE ? OR CAST(s.id AS TEXT) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const sql = `
    SELECT s.id AS sale_id, s.timestamp, COALESCE(c.name,'Walk-in') AS customer_name,
           p.name AS product_name, p.barcode,
           si.quantity, si.price_at_sale, si.cost_price_at_sale,
           (si.quantity * si.price_at_sale) AS line_total
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE ${where.join(" AND ")}
    ORDER BY s.timestamp DESC, si.id ASC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // Sales & Stock: product with all-time sales + current stock
  app.get("/api/reports/sales-stock", (req, res) => {
    const sql = `
    SELECT p.id, p.name, p.barcode, COALESCE(cat.name,'—') AS category,
           p.category_id,
           COALESCE(SUM(DISTINCT os.quantity),0) AS total_stock,
           COALESCE(SUM(si.quantity),0) AS units_sold,
           COALESCE(SUM(si.quantity * si.price_at_sale),0) AS revenue
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN outlet_stock os ON p.id = os.product_id
    LEFT JOIN sale_items si ON p.id = si.product_id
    GROUP BY p.id
    ORDER BY units_sold DESC`;
    db.all(sql, [], async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ rows: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // Inventory Dump: stock per product per outlet with full product info
  app.get("/api/reports/inventory-dump", (req, res) => {
    const { outlet_id } = req.query;
    let where = [];
    const params = [];
    if (outlet_id) {
      where.push("os.outlet_id = ?");
      params.push(outlet_id);
    }
    const sql = `
    SELECT o.name AS outlet_name, p.name AS product_name, p.barcode,
           COALESCE(cat.name,'—') AS category, p.category_id, COALESCE(b.name,'—') AS brand,
           p.price, p.cost_price, os.quantity,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY o.name, p.name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ rows: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // Category Wise: sales grouped by product category
  app.get("/api/reports/category-wise", async (req, res) => {
    const { date_from, date_to, category_id } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    if (category_id) {
      const leafIds = await getDescendantLeafIds(db, Number(category_id));
      if (!leafIds.length) return res.json({ data: [] });
      if (leafIds.length === 1) {
        where.push("p.category_id = ?");
        params.push(Number(leafIds[0]));
      } else {
        where.push(`p.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    const sql = `
    SELECT p.category_id,
           COALESCE(cat.name,'Uncategorized') AS category,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS profit
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.category_id
    ORDER BY revenue DESC`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const total = rows.reduce((s, r) => s + r.revenue, 0);
      const categoryMeta = await buildCategoryMetaMap();
      const data = withCategoryPaths(rows, categoryMeta).map((r) => ({
        ...r,
        pct: total > 0 ? ((r.revenue / total) * 100).toFixed(1) : "0.0",
      }));
      res.json({ data });
    });
  });

  // Revenue Leaks: Deep Dive on Discounts, Comps, and Voids
  app.get("/api/reports/revenue-leaks", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = [];
      const params = [];

      if (date_from) {
        where.push("date(s.timestamp, 'localtime') >= ?");
        params.push(date_from);
      } else {
        where.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')")
      }

      if (date_to) {
        where.push("date(s.timestamp, 'localtime') <= ?");
        params.push(date_to);
      }

      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }
      
      const filterStr = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

      const sql = `
        SELECT 
            SUM(total_amount) as total_gross_sales,
            SUM(CASE WHEN voided = 1 THEN total_amount ELSE 0 END) as total_voided_value,
            SUM(CASE WHEN voided = 0 AND COALESCE(discount_amount, 0) > 0 THEN discount_amount ELSE 0 END) as total_discounts,
            COUNT(id) as total_transactions,
            SUM(CASE WHEN voided = 1 THEN 1 ELSE 0 END) as voided_transactions,
            SUM(CASE WHEN voided = 0 AND COALESCE(discount_amount, 0) > 0 THEN 1 ELSE 0 END) as discounted_transactions
        FROM sales s
        ${filterStr}
      `;

      const rows = await getQuery(sql, params);
      const data = rows[0] || {};
      
      const summary = {
          gross_sales: data.total_gross_sales || 0,
          voids: data.total_voided_value || 0,
          discounts: data.total_discounts || 0,
          leakage_total: (data.total_voided_value || 0) + (data.total_discounts || 0)
      };
      
      // Breakdown by Employee
      let empWhere = ["COALESCE(s.discount_amount, 0) > 0 OR s.voided = 1", "s.employee_id IS NOT NULL"];
      empWhere = empWhere.concat(where);
      
      const empSql = `
        SELECT 
            e.id as employee_id,
            e.name as employee_name,
            SUM(CASE WHEN s.voided = 1 THEN s.total_amount ELSE 0 END) as void_value,
            SUM(CASE WHEN s.voided = 0 THEN COALESCE(s.discount_amount, 0) ELSE 0 END) as discount_value,
            SUM(CASE WHEN s.voided = 1 THEN s.total_amount ELSE 0 END) + SUM(CASE WHEN s.voided = 0 THEN COALESCE(s.discount_amount, 0) ELSE 0 END) as total_leakage
        FROM sales s
        JOIN employees e ON s.employee_id = e.id
        WHERE ${empWhere.join(" AND ")}
        GROUP BY e.id
        ORDER BY total_leakage DESC
        LIMIT 10
      `;
      
      const top_leak_employees = await getQuery(empSql, params.concat(params).slice(0, params.length)); // We just need params once, but the array is rebuilt securely by the sqlite engine, params array length matches `where` array length

      res.json({ 
          summary, 
          transactions: {
              total: data.total_transactions || 0,
              voided: data.voided_transactions || 0,
              discounted: data.discounted_transactions || 0
          },
          top_leak_employees 
      });

    } catch (err) {
      console.error("Revenue Leaks Error:", err);
      res.status(500).json({ error: "Failed to load revenue leaks data" });
    }
  });

  // Product Mix Analysis (Market Basket) - What items sell together often
  app.get("/api/reports/product-mix", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id, limit = 20 } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
      const params = [];

      if (date_from) {
        where.push("date(s.timestamp, 'localtime') >= ?");
        params.push(date_from);
      } else {
        where.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')")
      }

      if (date_to) {
        where.push("date(s.timestamp, 'localtime') <= ?");
        params.push(date_to);
      }

      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      // We want to find pairs of items bought in the same transaction
      // To do this efficiently without massive self-joins locking up SQLite, 
      // we'll get the top co-occurring categories or products
      
      const sql = `
        WITH SharedTransactions AS (
          SELECT si1.sale_id, si1.product_id as pid1, p1.name as pname1, 
                 si2.product_id as pid2, p2.name as pname2
          FROM sale_items si1
          JOIN sale_items si2 ON si1.sale_id = si2.sale_id AND si1.product_id < si2.product_id
          JOIN sales s ON si1.sale_id = s.id
          JOIN products p1 ON si1.product_id = p1.id
          JOIN products p2 ON si2.product_id = p2.id
          WHERE ${where.join(" AND ")}
        )
        SELECT 
           pid1, pname1, pid2, pname2, COUNT(sale_id) as co_occurrences
        FROM SharedTransactions
        GROUP BY pid1, pid2
        ORDER BY co_occurrences DESC
        LIMIT ?
      `;

      const rows = await getQuery(sql, [...params, limit]);
      res.json({ product_mix: rows });

    } catch (err) {
      console.error("Product Mix Error:", err);
      res.status(500).json({ error: "Failed to load product mix data" });
    }
  });

  // Product Specification: full product table with all FK names
  app.get("/api/reports/product-spec", (req, res) => {
    const { search } = req.query;
    let where = [];
    const params = [];
    if (search) {
      where.push("(p.name LIKE ? OR p.barcode LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const sql = `
    SELECT p.id, p.barcode, p.name, p.price, p.cost_price,
           COALESCE(cat.name,'—') AS category, p.category_id, COALESCE(b.name,'—') AS brand,
           COALESCE(sup.name,'—') AS supplier,
           COALESCE(t.name,'—') AS tax_name, COALESCE(t.rate, p.gst, 0) AS tax_rate
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    LEFT JOIN taxes t ON p.tax_id = t.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ rows: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // On Hand Inventory: current stock per product per outlet
  app.get("/api/reports/on-hand", (req, res) => {
    const { outlet_id } = req.query;
    let where = [];
    const params = [];
    if (outlet_id) {
      where.push("os.outlet_id = ?");
      params.push(outlet_id);
    }
    const sql = `
    SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
           os.quantity, p.price, p.cost_price,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name, o.name`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Item Wise: sales grouped by product
  app.get("/api/reports/item-wise", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY units_sold DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Product Performance: same as item-wise but sorted by margin %
  app.get("/api/reports/product-performance", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit,
           CASE WHEN SUM(si.quantity * si.price_at_sale) > 0
                THEN ROUND(((SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale))
                     / SUM(si.quantity * si.price_at_sale)) * 100, 1)
                ELSE 0 END AS margin_pct
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY margin_pct DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Retail Matrix / Menu Engineering (Stars, Plowhorses, Puzzles, Dogs)
  app.get("/api/reports/retail-matrix", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
      const params = [];

      if (date_from) {
        where.push("date(s.timestamp, 'localtime') >= ?");
        params.push(date_from);
      } else {
        where.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')")
      }

      if (date_to) {
        where.push("date(s.timestamp, 'localtime') <= ?");
        params.push(date_to);
      }

      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      // 1. Get average volume and average margin across ALL items sold in this period
      const averagesSql = `
        WITH ProductStats AS (
          SELECT 
            p.id,
            SUM(si.quantity) as volume,
            ROUND(SUM(si.quantity * (si.price_at_sale - si.cost_price_at_sale)) / SUM(si.quantity), 2) as avg_unit_margin
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE ${where.join(" AND ")}
          GROUP BY p.id
        )
        SELECT 
          AVG(volume) as threshold_volume,
          AVG(avg_unit_margin) as threshold_margin
        FROM ProductStats
      `;

      const averages = await getQuery(averagesSql, params);
      const thresholdVolume = averages[0]?.threshold_volume || 0;
      const thresholdMargin = averages[0]?.threshold_margin || 0;

      // 2. Map every product to a quadrant based on the calculated averages
      const matrixSql = `
        WITH ProductStats AS (
          SELECT 
            p.id as product_id,
            p.name as product_name,
            p.barcode,
            SUM(si.quantity) as volume,
            SUM(si.quantity * si.price_at_sale) as total_revenue,
            ROUND(SUM(si.quantity * (si.price_at_sale - si.cost_price_at_sale)) / SUM(si.quantity), 2) as avg_unit_margin
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE ${where.join(" AND ")}
          GROUP BY p.id
        )
        SELECT 
          *,
          CASE
            WHEN volume >= ? AND avg_unit_margin >= ? THEN 'Star'
            WHEN volume >= ? AND avg_unit_margin < ? THEN 'Plowhorse'
            WHEN volume < ? AND avg_unit_margin >= ? THEN 'Puzzle'
            ELSE 'Dog'
          END as matrix_category
        FROM ProductStats
        ORDER BY total_revenue DESC
      `;

      const rows = await getQuery(matrixSql, [
          ...params, 
          thresholdVolume, thresholdMargin, // Star (High Vol, High Margin)
          thresholdVolume, thresholdMargin, // Plowhorse (High Vol, Low Margin)
          thresholdVolume, thresholdMargin  // Puzzle (Low Vol, High Margin), else Dog is implicit
      ]);

      res.json({ 
          thresholds: {
              volume: thresholdVolume,
              margin: thresholdMargin
          },
          matrix: rows 
      });

    } catch (err) {
      console.error("Retail Matrix Error:", err);
      res.status(500).json({ error: "Failed to calculate retail matrix data" });
    }
  });

  // Inventory Loss: stock adjustments with negative quantity
  app.get("/api/reports/inventory-loss", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["sa.quantity_change < 0"];
    const params = [];
    if (date_from) {
      where.push("date(sa.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(sa.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Wastage: stock adjustments for Damaged or Expired reasons
  app.get("/api/reports/wastage", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["sa.reason IN ('Damaged','Expired')"];
    const params = [];
    if (date_from) {
      where.push("date(sa.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(sa.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Replenishment: products at or below threshold per outlet
  app.get("/api/reports/replenishment", (req, res) => {
    const threshold = parseInt(req.query.threshold) || 10;
    const sql = `
    SELECT p.id AS product_id, p.name AS product_name, p.barcode,
           p.cost_price, p.min_qty, p.supplier_id,
           COALESCE(s.name, 'No Supplier') AS supplier_name,
           o.id AS outlet_id, o.name AS outlet_name, os.quantity
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE os.quantity <= ?
    ORDER BY supplier_name ASC, os.quantity ASC, p.name ASC`;
    db.all(sql, [threshold], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows, threshold });
    });
  });

  // Customer RFM data — raw recency/frequency/monetary values, scoring done on frontend
  app.get("/api/reports/customer-rfm", (req, res) => {
    const sql = `
    SELECT c.id, c.name, c.mobile, c.email,
           COUNT(DISTINCT s.id) AS order_count,
           COALESCE(SUM(s.total_amount), 0) AS total_spent,
           CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS recency_days,
           MAX(s.timestamp) AS last_order_at
    FROM customers c
    INNER JOIN sales s ON s.customer_id = c.id AND s.voided = 0
    GROUP BY c.id
    HAVING order_count > 0
    ORDER BY total_spent DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ customers: rows });
    });
  });

  app.get("/api/reports/customer-retention", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
      const params = [];

      if (date_from) {
        where.push("date(s.timestamp, 'localtime') >= ?");
        params.push(date_from);
      } else {
        where.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')")
      }

      if (date_to) {
        where.push("date(s.timestamp, 'localtime') <= ?");
        params.push(date_to);
      }

      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      const sql = `
        WITH CustomerFirstPurchase AS (
          SELECT customer_id, MIN(date(timestamp, 'localtime')) as first_purchase_date
          FROM sales
          WHERE voided = 0 AND customer_id IS NOT NULL
          GROUP BY customer_id
        )
        SELECT 
          date(s.timestamp, 'localtime') as sale_date,
          CASE 
            WHEN s.customer_id IS NULL THEN 'walk_in'
            WHEN date(s.timestamp, 'localtime') = cfp.first_purchase_date THEN 'new_customer'
            ELSE 'returning_customer'
          END as customer_type,
          SUM(s.total_amount) as revenue,
          COUNT(s.id) as orders
        FROM sales s
        LEFT JOIN CustomerFirstPurchase cfp ON s.customer_id = cfp.customer_id
        WHERE ${where.join(" AND ")}
        GROUP BY sale_date, customer_type
        ORDER BY sale_date ASC
      `;

      const rows = await getQuery(sql, params);
      
      const summary = {
        walk_in: { revenue: 0, orders: 0 },
        new_customer: { revenue: 0, orders: 0 },
        returning_customer: { revenue: 0, orders: 0 }
      };

      // Aggregate for pie charts/summary
      rows.forEach(row => {
          if (summary[row.customer_type]) {
              summary[row.customer_type].revenue += row.revenue;
              summary[row.customer_type].orders += row.orders;
          }
      });

      res.json({ timeline: rows, summary });

    } catch (err) {
      console.error("Customer Retention Error:", err);
      res.status(500).json({ error: "Failed to load customer retention data" });
    }
  });

  app.get("/api/reports/customer-capture-rate", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
      const params = [];

      if (date_from) {
        where.push("date(s.timestamp, 'localtime') >= ?");
        params.push(date_from);
      } else {
        where.push("date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')")
      }

      if (date_to) {
        where.push("date(s.timestamp, 'localtime') <= ?");
        params.push(date_to);
      }

      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      // Group by Staff to see which staff members have the highest capture rate
      const sql = `
        SELECT 
            COALESCE(e.name, 'Unknown Staff') as employee_name,
            e.id as employee_id,
            COUNT(s.id) as total_transactions,
            SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) as profiled_transactions,
            SUM(CASE WHEN s.customer_id IS NULL THEN 1 ELSE 0 END) as walk_in_transactions,
            ROUND(CAST(SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(s.id) * 100, 1) as capture_rate_pct,
            SUM(s.total_amount) as total_revenue,
            SUM(CASE WHEN s.customer_id IS NOT NULL THEN s.total_amount ELSE 0 END) as profiled_revenue
        FROM sales s
        LEFT JOIN employees e ON s.employee_id = e.id
        WHERE ${where.join(" AND ")}
        GROUP BY e.id
        ORDER BY capture_rate_pct DESC
      `;

      const rows = await getQuery(sql, params);
      
      const totals = rows.reduce((acc, row) => {
          acc.total_transactions += row.total_transactions;
          acc.profiled_transactions += row.profiled_transactions;
          return acc;
      }, { total_transactions: 0, profiled_transactions: 0 });

      const store_capture_rate = totals.total_transactions > 0 
        ? Number(((totals.profiled_transactions / totals.total_transactions) * 100).toFixed(1)) 
        : 0;

      res.json({ staff_breakdown: rows, store_capture_rate, total_transactions: totals.total_transactions });

    } catch (err) {
      console.error("Capture Rate Error:", err);
      res.status(500).json({ error: "Failed to load capture rate data" });
    }
  });

  // Outlet comparison — revenue, orders, avg basket, unique customers per outlet
  app.get("/api/reports/outlet-comparison", (req, res) => {
    const { date_from, date_to } = req.query;
    const conditions = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      conditions.push("DATE(s.timestamp) >= ?");
      params.push(date_from);
    }
    if (date_to) {
      conditions.push("DATE(s.timestamp) <= ?");
      params.push(date_to);
    }
    const saleWhere = conditions.join(" AND ");
    const sql = `
    SELECT o.id, o.name,
           COALESCE(t.order_count, 0)       AS order_count,
           COALESCE(t.revenue, 0)            AS revenue,
           COALESCE(t.avg_basket, 0)         AS avg_basket,
           COALESCE(t.unique_customers, 0)   AS unique_customers
    FROM outlets o
    LEFT JOIN (
      SELECT outlet_id,
             COUNT(DISTINCT id)       AS order_count,
             SUM(total_amount)        AS revenue,
             AVG(total_amount)        AS avg_basket,
             COUNT(DISTINCT customer_id) AS unique_customers
      FROM sales
      WHERE ${saleWhere}
      GROUP BY outlet_id
    ) t ON t.outlet_id = o.id
    ORDER BY revenue DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ outlets: rows });
    });
  });

  // Supplier Wise: PO spending aggregated per supplier
  app.get("/api/reports/supplier-wise", (req, res) => {
    const sql = `
    SELECT s.id, s.name AS supplier_name, s.contact_person, s.phone,
           COUNT(DISTINCT po.id) AS total_pos,
           COALESCE(SUM(poi.quantity),0) AS total_items,
           COALESCE(SUM(poi.quantity * poi.cost_price),0) AS total_cost
    FROM suppliers s
    LEFT JOIN purchase_orders po ON s.id = po.supplier_id
    LEFT JOIN purchase_order_items poi ON po.id = poi.po_id
    GROUP BY s.id
    ORDER BY total_cost DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  async function buildReportFilterParts(req, aliases = {}) {
    const {
      sale = "s",
      product = "p",
      item = "si",
      outlet = "o",
      employee = "e",
    } = aliases;
    const { date_from, date_to, outlet_id, employee_id, category_id } =
      req.query || {};
    const where = [];
    const params = [];

    if (sale) where.push(`${sale}.voided = 0`);
    if (date_from && sale) {
      where.push(`date(${sale}.timestamp,'localtime') >= ?`);
      params.push(date_from);
    }
    if (date_to && sale) {
      where.push(`date(${sale}.timestamp,'localtime') <= ?`);
      params.push(date_to);
    }
    if (outlet_id) {
      if (sale) {
        where.push(`${sale}.outlet_id = ?`);
      } else if (outlet) {
        where.push(`${outlet}.id = ?`);
      }
      params.push(outlet_id);
    }
    if (employee_id && sale && employee) {
      where.push(`${sale}.employee_id = ?`);
      params.push(employee_id);
    }
    if (category_id && product) {
      const leafIds = await getDescendantLeafIds(db, Number(category_id));
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push(`${product}.category_id = ?`);
        params.push(Number(leafIds[0]));
      } else {
        where.push(`${product}.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    if (item) where.push(`${item}.quantity > 0`);

    return { where, params };
  }

  function parsePaging(req) {
    const limit = Math.max(
      1,
      Math.min(500, parseInt(req.query.limit || 100, 10)),
    );
    const offset = Math.max(0, parseInt(req.query.offset || 0, 10));
    return { limit, offset };
  }

  app.get(
    "/api/reports/profit-summary",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
      const { where, params } = await buildReportFilterParts(req);
      const sql = `
      SELECT
        COUNT(DISTINCT s.id) AS orders,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS gross_sales,
        ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS cogs,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit,
        ROUND(COALESCE(SUM(COALESCE(s.discount_amount, 0)), 0), 2) AS discount_amount,
        ROUND(0, 2) AS promo_discount,
        ROUND(
          COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0)
          - COALESCE(SUM(COALESCE(s.discount_amount, 0)), 0)
          - 0,
          2
        ) AS net_profit
      FROM sales s
      JOIN sale_items si ON s.id = si.sale_id
      JOIN products p ON si.product_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `;
      db.get(sql, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const grossSales = Number(row?.gross_sales || 0);
        const grossProfit = Number(row?.gross_profit || 0);
        const netProfit = Number(row?.net_profit || 0);
        res.json({
          summary: {
            ...row,
            margin_pct:
              grossSales > 0
                ? Number(((grossProfit / grossSales) * 100).toFixed(2))
                : 0,
            net_margin_pct:
              grossSales > 0
                ? Number(((netProfit / grossSales) * 100).toFixed(2))
                : 0,
          },
        });
      });
    },
  );

  app.get(
    "/api/reports/profit-by-product",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
      const sortable = new Set([
        "revenue",
        "gross_profit",
        "margin_pct",
        "units_sold",
        "product_name",
      ]);
      const sort = sortable.has(String(req.query.sort || ""))
        ? req.query.sort
        : "gross_profit";
      const order =
        String(req.query.order || "desc").toLowerCase() === "asc"
          ? "ASC"
          : "DESC";
      const { limit, offset } = parsePaging(req);
      const { where, params } = await buildReportFilterParts(req);
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        p.category_id,
        COALESCE(cat.name, 'Uncategorized') AS category,
        ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
        ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS cogs,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit,
        ROUND(
          CASE
            WHEN COALESCE(SUM(si.quantity * si.price_at_sale), 0) > 0
              THEN (COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0) * 100.0)
                 / COALESCE(SUM(si.quantity * si.price_at_sale), 1)
            ELSE 0
          END,
          2
        ) AS margin_pct
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY p.id
      ORDER BY ${sort} ${order}
      LIMIT ? OFFSET ?
    `;
      db.all(sql, [...params, limit, offset], async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        res.json({
          rows: withCategoryPaths(rows, categoryMeta),
          paging: { limit, offset },
        });
      });
    },
  );

  app.get(
    "/api/reports/profit-by-outlet",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
      const { where, params } = await buildReportFilterParts(req, {
        sale: "s",
        product: "p",
        item: "si",
        outlet: "o",
        employee: "e",
      });
      const sql = `
      SELECT
        o.id AS outlet_id,
        o.name AS outlet_name,
        COUNT(DISTINCT s.id) AS orders,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
        ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS cogs,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit,
        ROUND(
          CASE
            WHEN COALESCE(SUM(si.quantity * si.price_at_sale), 0) > 0
              THEN (COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0) * 100.0)
                 / COALESCE(SUM(si.quantity * si.price_at_sale), 1)
            ELSE 0
          END,
          2
        ) AS margin_pct
      FROM sales s
      JOIN outlets o ON s.outlet_id = o.id
      JOIN sale_items si ON s.id = si.sale_id
      JOIN products p ON si.product_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY o.id
      ORDER BY gross_profit DESC
    `;
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rows });
      });
    },
  );

  app.get(
    "/api/reports/discount-leakage",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
      const { where, params } = await buildReportFilterParts(req, {
        sale: "s",
        product: "p",
        item: "si",
      });
      const sql = `
      SELECT
        s.id AS sale_id,
        s.timestamp,
        COALESCE(o.name, '—') AS outlet_name,
        COALESCE(e.name, '—') AS employee_name,
        ROUND(COALESCE(s.total_amount, 0), 2) AS total_amount,
        ROUND(COALESCE(s.discount_amount, 0), 2) AS discount_amount,
        ROUND(0, 2) AS promo_discount,
        ROUND(COALESCE(s.discount_amount, 0), 2) AS total_discount
      FROM sales s
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN employees e ON s.employee_id = e.id
      JOIN sale_items si ON s.id = si.sale_id
      JOIN products p ON si.product_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY s.id
      HAVING total_discount > 0
      ORDER BY total_discount DESC, s.timestamp DESC
      LIMIT 200
    `;
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const totals = rows.reduce(
          (acc, r) => {
            acc.total_discount += Number(r.total_discount || 0);
            acc.total_sales += Number(r.total_amount || 0);
            return acc;
          },
          { total_discount: 0, total_sales: 0 },
        );
        res.json({
          rows,
          totals: {
            total_discount: Number(totals.total_discount.toFixed(2)),
            total_sales: Number(totals.total_sales.toFixed(2)),
          },
        });
      });
    },
  );

  app.get(
    "/api/reports/dead-stock",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const inactiveDays = Math.max(
        1,
        Math.min(3650, parseInt(req.query.inactive_days || 60, 10)),
      );
      const outletFilter = req.query.outlet_id ? "AND os.outlet_id = ?" : "";
      const params = req.query.outlet_id
        ? [inactiveDays, req.query.outlet_id]
        : [inactiveDays];
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(os.quantity * COALESCE(p.cost_price, 0), 2) AS stock_cost_value,
        ROUND(os.quantity * COALESCE(p.price, 0), 2) AS stock_retail_value,
        MAX(s.timestamp) AS last_sold_at,
        CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS days_since_sale
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE os.quantity > 0 ${outletFilter}
      GROUP BY p.id, o.id
      HAVING COALESCE(days_since_sale, 99999) >= ?
      ORDER BY stock_cost_value DESC
      LIMIT 500
    `;
      const reorderedParams = req.query.outlet_id
        ? [req.query.outlet_id, inactiveDays]
        : [inactiveDays];
      db.all(sql, reorderedParams, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rows, inactive_days: inactiveDays });
      });
    },
  );

  app.get(
    "/api/reports/stock-aging",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(os.quantity * COALESCE(p.cost_price, 0), 2) AS stock_cost_value,
        MAX(s.timestamp) AS last_sold_at,
        CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS days_since_sale
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE os.quantity > 0
      ${req.query.outlet_id ? "AND os.outlet_id = ?" : ""}
      GROUP BY p.id, o.id
      ORDER BY COALESCE(days_since_sale, 99999) DESC, stock_cost_value DESC
      LIMIT 500
    `;
      const params = req.query.outlet_id ? [req.query.outlet_id] : [];
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rows });
      });
    },
  );

  app.get(
    "/api/reports/stockout-risk",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const lookbackDays = Math.max(
        7,
        Math.min(365, parseInt(req.query.lookback_days || 30, 10)),
      );
      const sql = `
      WITH sales_velocity AS (
        SELECT
          si.product_id,
          s.outlet_id,
          SUM(si.quantity) AS units_sold
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.voided = 0
          AND date(s.timestamp, 'localtime') >= date('now', '-' || ? || ' days', 'localtime')
        GROUP BY si.product_id, s.outlet_id
      )
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(COALESCE(v.units_sold, 0) / ?, 4) AS avg_daily_units,
        ROUND(
          CASE WHEN COALESCE(v.units_sold, 0) > 0
            THEN os.quantity / (COALESCE(v.units_sold, 0) / ?)
            ELSE NULL
          END, 2
        ) AS days_of_cover,
        CASE
          WHEN COALESCE(v.units_sold, 0) = 0 THEN 'stable'
          WHEN (os.quantity / (COALESCE(v.units_sold, 0) / ?)) < 7 THEN 'high'
          WHEN (os.quantity / (COALESCE(v.units_sold, 0) / ?)) < 14 THEN 'medium'
          ELSE 'stable'
        END AS risk_level
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sales_velocity v ON v.product_id = os.product_id AND v.outlet_id = os.outlet_id
      WHERE os.quantity > 0
      ${req.query.outlet_id ? "AND os.outlet_id = ?" : ""}
      ORDER BY
        CASE risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        days_of_cover ASC
      LIMIT 500
    `;
      const params = req.query.outlet_id
        ? [
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
            req.query.outlet_id,
          ]
        : [
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
          ];
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rows, lookback_days: lookbackDays });
      });
    },
  );

  app.get(
    "/api/reports/exceptions",
    requireFeature("reports_exceptions"),
    (req, res) => {
      const type = String(req.query.type || "negative_margin_sales");
      if (type === "negative_margin_sales") {
        const sql = `
        SELECT
          s.id AS sale_id,
          s.timestamp,
          p.id AS product_id,
          p.name AS product_name,
          p.barcode,
          o.name AS outlet_name,
          e.name AS employee_name,
          si.quantity,
          si.price_at_sale,
          si.cost_price_at_sale,
          ROUND((si.price_at_sale - si.cost_price_at_sale), 2) AS unit_margin
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id AND s.voided = 0
        JOIN products p ON p.id = si.product_id
        LEFT JOIN outlets o ON o.id = s.outlet_id
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE si.price_at_sale < si.cost_price_at_sale
        ORDER BY s.timestamp DESC
        LIMIT 300
      `;
        return db.all(sql, [], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, rows });
        });
      }

      if (type === "high_discount_orders") {
        const thresholdPct = Math.max(
          0,
          Math.min(100, Number(req.query.threshold_pct || 20)),
        );
        const sql = `
        SELECT
          s.id AS sale_id,
          s.timestamp,
          COALESCE(o.name, '—') AS outlet_name,
          COALESCE(e.name, '—') AS employee_name,
          ROUND(COALESCE(s.total_amount, 0), 2) AS total_amount,
          ROUND(COALESCE(s.discount_amount, 0), 2) AS total_discount,
          ROUND(
            CASE
              WHEN (COALESCE(s.total_amount, 0) + COALESCE(s.discount_amount, 0)) > 0
              THEN (COALESCE(s.discount_amount, 0) * 100.0)
                   / (COALESCE(s.total_amount, 0) + COALESCE(s.discount_amount, 0))
              ELSE 0
            END,
            2
          ) AS discount_pct
        FROM sales s
        LEFT JOIN outlets o ON o.id = s.outlet_id
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE s.voided = 0
        GROUP BY s.id
        HAVING discount_pct >= ?
        ORDER BY discount_pct DESC, s.timestamp DESC
        LIMIT 300
      `;
        return db.all(sql, [thresholdPct], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, threshold_pct: thresholdPct, rows });
        });
      }

      if (type === "frequent_voids_by_employee") {
        const sql = `
        SELECT
          COALESCE(e.id, 0) AS employee_id,
          COALESCE(e.name, 'Unknown') AS employee_name,
          COUNT(*) AS void_count,
          ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS void_value
        FROM sales s
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE s.voided = 1
        GROUP BY e.id
        HAVING void_count > 0
        ORDER BY void_count DESC, void_value DESC
        LIMIT 200
      `;
        return db.all(sql, [], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, rows });
        });
      }

      if (type === "frequent_returns_by_product") {
        const sql = `
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.barcode,
          COUNT(ri.id) AS return_lines,
          ROUND(COALESCE(SUM(ri.quantity), 0), 2) AS returned_qty,
          ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0), 2) AS returned_value
        FROM return_items ri
        JOIN products p ON p.id = ri.product_id
        GROUP BY p.id
        HAVING return_lines > 0
        ORDER BY returned_value DESC, returned_qty DESC
        LIMIT 300
      `;
        return db.all(sql, [], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, rows });
        });
      }

      return res.status(400).json({
        error: "Unsupported exception type",
        supported_types: [
          "negative_margin_sales",
          "high_discount_orders",
          "frequent_voids_by_employee",
          "frequent_returns_by_product",
        ],
      });
    },
  );

  function parseJsonObject(raw) {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed;
      return {};
    } catch {
      return {};
    }
  }

  function nextRunAtIso(
    frequency,
    runHour = 6,
    runMinute = 0,
    fromDate = new Date(),
  ) {
    const next = new Date(fromDate);
    next.setSeconds(0, 0);
    next.setHours(Number(runHour) || 6, Number(runMinute) || 0, 0, 0);
    if (next <= fromDate) {
      next.setDate(next.getDate() + 1);
    }
    if (String(frequency || "daily").toLowerCase() === "weekly") {
      next.setDate(next.getDate() + 6);
    }
    return next.toISOString().slice(0, 19).replace("T", " ");
  }

  async function buildForecastRows(filters, cb) {
    const lookbackDays = Math.max(
      7,
      Math.min(
        365,
        parseInt(filters.lookback_days || filters.lookbackDays || 28, 10),
      ),
    );
    const where = [
      "s.voided = 0",
      "date(s.timestamp,'localtime') >= date('now', '-' || ? || ' days', 'localtime')",
    ];
    const params = [lookbackDays];
    if (filters.outlet_id) {
      where.push("s.outlet_id = ?");
      params.push(filters.outlet_id);
    }
    if (filters.category_id) {
      const leafIds = await getDescendantLeafIds(db, Number(filters.category_id));
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push("p.category_id = ?");
        params.push(Number(leafIds[0]));
      } else {
        where.push(`p.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        COALESCE(SUM(si.quantity), 0) AS units_lookback,
        ROUND(COALESCE(SUM(si.quantity), 0) / ?, 4) AS avg_daily_units,
        COALESCE(os.quantity, 0) AS on_hand_qty,
        ROUND((COALESCE(SUM(si.quantity), 0) / ?) * 7, 2) AS forecast_7d_units,
        ROUND((COALESCE(SUM(si.quantity), 0) / ?) * 14, 2) AS forecast_14d_units,
        ROUND(
          CASE WHEN COALESCE(SUM(si.quantity), 0) > 0
            THEN COALESCE(os.quantity, 0) / (COALESCE(SUM(si.quantity), 0) / ?)
            ELSE NULL
          END, 2
        ) AS days_of_cover
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      JOIN outlets o ON o.id = s.outlet_id
      LEFT JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = o.id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, o.id
      ORDER BY avg_daily_units DESC
      LIMIT 1000
    `;
    db.all(
      sql,
      [...params, lookbackDays, lookbackDays, lookbackDays, lookbackDays],
      (err, rows) => {
        if (err) return cb(err);
        return cb(null, rows || [], lookbackDays);
      },
    );
  }

  app.get(
    "/api/reports/forecast-demand",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      buildForecastRows(req.query || {}, (err, rows, lookbackDays) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          rows,
          lookback_days: lookbackDays,
          formula: "moving_average_daily_velocity",
          data_as_of: new Date().toISOString(),
        });
      });
    },
  );

  app.get(
    "/api/reports/replenishment-smart",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const forecastDays = Math.max(
        7,
        Math.min(90, parseInt(req.query.forecast_days || 14, 10)),
      );
      buildForecastRows(req.query || {}, (err, rows, lookbackDays) => {
        if (err) return res.status(500).json({ error: err.message });
        const smart = (rows || []).map((r) => {
          const avgDaily = Number(r.avg_daily_units || 0);
          const onHand = Number(r.on_hand_qty || 0);
          const target = avgDaily * forecastDays;
          const suggested = Math.max(0, Math.ceil(target - onHand));
          return {
            ...r,
            forecast_days: forecastDays,
            target_cover_units: Number(target.toFixed(2)),
            suggested_reorder_qty: suggested,
          };
        });
        res.json({
          rows: smart,
          lookback_days: lookbackDays,
          forecast_days: forecastDays,
          formula: "moving_average_cover_gap",
          data_as_of: new Date().toISOString(),
        });
      });
    },
  );

  function toCsvLines(rows, columns, meta = {}) {
    const lines = [];
    lines.push(`# generated_at: ${new Date().toISOString()}`);
    lines.push(`# data_as_of: ${new Date().toISOString()}`);
    lines.push(`# currency: PKR`);
    lines.push(`# filters_applied: ${JSON.stringify(meta)}`);
    lines.push(columns.map((c) => c.header).join(","));
    (rows || []).forEach((row) => {
      lines.push(
        columns
          .map(
            (c) =>
              `"${String(row[c.key] == null ? "" : row[c.key]).replace(/"/g, '""')}"`,
          )
          .join(","),
      );
    });
    return lines.join("\n");
  }

  function getRowsForScheduleReport(reportKey, filters, cb) {
    if (reportKey === "profit-by-product") {
      const where = ["s.voided = 0"];
      const params = [];
      if (filters.date_from) {
        where.push("date(s.timestamp,'localtime') >= ?");
        params.push(filters.date_from);
      }
      if (filters.date_to) {
        where.push("date(s.timestamp,'localtime') <= ?");
        params.push(filters.date_to);
      }
      if (filters.outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(filters.outlet_id);
      }
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
      return buildForecastRows(filters, (err, rows) => {
        if (err) return cb(err);
        const mapped = (rows || []).map((r) => ({
          product_name: r.product_name,
          barcode: r.barcode,
          outlet_name: r.outlet_name,
          on_hand_qty: r.on_hand_qty,
          avg_daily_units: r.avg_daily_units,
          days_of_cover: r.days_of_cover,
        }));
        return cb(null, mapped);
      });
    }

    if (reportKey === "exceptions-high-discount") {
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

    return cb(new Error("Unsupported scheduled report key"));
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

  const REPORT_EXPORT_DIR = path.resolve(__dirname, "..", "exports", "reports");
  if (!fs.existsSync(REPORT_EXPORT_DIR)) {
    fs.mkdirSync(REPORT_EXPORT_DIR, { recursive: true });
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
      `SELECT *
       FROM report_schedules
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
      if (!name || !report_key) {
        return res
          .status(400)
          .json({ error: "name and report_key are required" });
      }
      const nextRun = nextRunAtIso(frequency, run_hour, run_minute);
      db.run(
        `INSERT INTO report_schedules
         (name, report_key, frequency, run_hour, run_minute, recipient, export_format, filters_json, next_run_at, created_by)
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
         SET name = COALESCE(?, name),
             report_key = COALESCE(?, report_key),
             frequency = COALESCE(?, frequency),
             run_hour = COALESCE(?, run_hour),
             run_minute = COALESCE(?, run_minute),
             recipient = ?,
             export_format = COALESCE(?, export_format),
             filters_json = COALESCE(?, filters_json),
             is_active = COALESCE(?, is_active),
             next_run_at = ?,
             updated_at = datetime('now','localtime')
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
      if (!report_key || !name) {
        return res
          .status(400)
          .json({ error: "report_key and name are required" });
      }
      db.run(
        `INSERT INTO saved_report_views
         (report_key, name, scope, employee_id, role_id, filters_json, is_default)
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
        `UPDATE saved_report_views
         SET name = COALESCE(?, name),
             filters_json = COALESCE(?, filters_json),
             is_default = COALESCE(?, is_default),
             updated_at = datetime('now','localtime')
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
      if (!report_key || !version) {
        return res
          .status(400)
          .json({ error: "report_key and version are required" });
      }
      db.run(
        `INSERT INTO report_definition_versions
         (report_key, version, query_signature, notes, created_by)
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
