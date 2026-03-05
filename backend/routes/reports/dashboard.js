const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps) {
  const { db } = deps;

  app.get("/api/reports/dashboard", async (req, res) => {
    try {
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows || []),
          );
        });

      const tz = req.company?.timezone || "UTC";
      // Compute today's local date string in the company timezone
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      const todayStart = toUtcStart(todayStr, tz);
      const todayEnd = toUtcEnd(todayStr, tz);
      // First day of current local month
      const monthStartStr = todayStr.slice(0, 7) + "-01";
      const monthStart = toUtcStart(monthStartStr, tz);

      const outletId =
        req.query?.outlet_id !== undefined &&
        req.query?.outlet_id !== null &&
        req.query?.outlet_id !== ""
          ? Number(req.query.outlet_id)
          : null;

      const outletFilter = outletId !== null ? " AND s.outlet_id = ?" : "";
      const outletParams = outletId !== null ? [outletId] : [];

      const zReport = await getQuery(
        `
          SELECT
            COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
            ROUND(SUM(COALESCE(sp.amount, s.total_amount)), 2) AS total
          FROM sales s
          LEFT JOIN sale_payments sp ON s.id = sp.sale_id
          WHERE s.voided = 0
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
          GROUP BY COALESCE(sp.payment_method, s.payment_method, 'Unknown')
          ORDER BY total DESC
        `,
        [todayStart, todayEnd, ...outletParams],
      );
      const totalRevenueToday = zReport.reduce(
        (sum, row) => sum + Number(row.total || 0),
        0,
      );

      const salesByOutlet = await getQuery(
        `
        SELECT o.name, ROUND(SUM(s.total_amount), 2) AS total
        FROM sales s
        JOIN outlets o ON s.outlet_id = o.id
        WHERE s.voided = 0
          AND s.timestamp >= ?
          AND s.timestamp < ?
        GROUP BY o.name
        ORDER BY total DESC
      `,
        [todayStart, todayEnd],
      );

      // Compute UTC start for 7-days-ago local date
      const sevenDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 7 * 24 * 3600 * 1000));
      const sevenDaysAgoStart = toUtcStart(sevenDaysAgoStr, tz);

      const topProducts = await getQuery(
        `
          SELECT p.name, SUM(si.quantity) AS units_sold
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE s.voided = 0
            AND s.timestamp >= ?
            ${outletFilter}
          GROUP BY p.name
          ORDER BY units_sold DESC, p.name ASC
          LIMIT 5
        `,
        [sevenDaysAgoStart, ...outletParams],
      );

      // Compute UTC start for 6-months-ago local date
      const sixMonthsAgoDate = new Date();
      sixMonthsAgoDate.setMonth(sixMonthsAgoDate.getMonth() - 6);
      const sixMonthsAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(sixMonthsAgoDate);
      const sixMonthsAgoStart = toUtcStart(sixMonthsAgoStr, tz);

      const monthlyTrend = await getQuery(
        `
          SELECT
            strftime('%Y-%m', s.timestamp, 'localtime') AS month,
            ROUND(SUM(s.total_amount), 2) AS total
          FROM sales s
          WHERE s.voided = 0
            AND s.timestamp >= ?
            ${outletFilter}
          GROUP BY month
          ORDER BY month ASC
        `,
        [sixMonthsAgoStart, ...outletParams],
      );

      const inventoryStatus = await getQuery(
        `
          SELECT
            COUNT(*) AS total_products,
            SUM(CASE WHEN stock <= min_qty AND min_qty > 0 THEN 1 ELSE 0 END) AS low_stock_items
          FROM products
        `,
      );

      // Compute UTC start for 30-days-ago local date
      const thirtyDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 24 * 3600 * 1000));
      const thirtyDaysAgoStart = toUtcStart(thirtyDaysAgoStr, tz);

      const categoryMatrix = await getQuery(
        `
          SELECT c.name AS category, ROUND(SUM(si.quantity * si.price_at_sale), 2) AS revenue
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN categories c ON p.category_id = c.id
          JOIN sales s ON si.sale_id = s.id
          WHERE s.voided = 0
            AND s.timestamp >= ?
            ${outletFilter}
          GROUP BY c.name
          ORDER BY revenue DESC, c.name ASC
          LIMIT 5
        `,
        [thirtyDaysAgoStart, ...outletParams],
      );

      const hourlySales = await getQuery(
        `
          SELECT
            strftime('%H:00', s.timestamp, 'localtime') AS hour,
            ROUND(SUM(s.total_amount), 2) AS total,
            COUNT(s.id) AS orders
          FROM sales s
          WHERE s.voided = 0
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
          GROUP BY hour
          ORDER BY hour ASC
        `,
        [todayStart, todayEnd, ...outletParams],
      );

      const revenueMetrics = await getQuery(
        `
          SELECT
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS tax_inclusive,
            ROUND(
              COALESCE(
                SUM(
                  CASE
                    WHEN t.id IS NOT NULL
                      THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
                    ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0))
                  END
                ),
                0
              ),
              2
            ) AS tax_exclusive,
            ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS total_cost
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          LEFT JOIN taxes t ON p.tax_id = t.id
          WHERE s.voided = 0
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
        `,
        [todayStart, todayEnd, ...outletParams],
      );

      const metricRow = revenueMetrics[0] || {};
      const taxInclusive = Number(metricRow.tax_inclusive || 0);
      const taxExclusive = Number(metricRow.tax_exclusive || 0);
      const totalCost = Number(metricRow.total_cost || 0);
      const todayGrossProfit = taxExclusive - totalCost;

      const expenseWhere =
        outletId !== null
          ? "expense_date = ? AND outlet_id = ?"
          : "expense_date = ?";
      const expenseRows = await getQuery(
        `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS total FROM expenses WHERE ${expenseWhere}`,
        outletId !== null ? [todayStr, outletId] : [todayStr],
      );
      const todayExpenses = Number(expenseRows[0]?.total || 0);
      const todayProfit = Number((todayGrossProfit - todayExpenses).toFixed(2));

      const monthGrossMarginRows = await getQuery(
        `
          SELECT
            ROUND(
              COALESCE(
                SUM(
                  CASE
                    WHEN t.id IS NOT NULL
                      THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
                    ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0))
                  END
                ),
                0
              ),
              2
            ) AS month_tax_exclusive,
            ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS month_total_cost
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          LEFT JOIN taxes t ON p.tax_id = t.id
          WHERE s.voided = 0
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
        `,
        [monthStart, todayEnd, ...outletParams],
      );
      const monthMarginRow = monthGrossMarginRows[0] || {};
      const monthTaxExclusive = Number(monthMarginRow.month_tax_exclusive || 0);
      const monthTotalCost = Number(monthMarginRow.month_total_cost || 0);
      const monthGrossMargin = Number((monthTaxExclusive - monthTotalCost).toFixed(2));

      const saleCountRow = await getQuery(
        `
          SELECT COUNT(id) AS count
          FROM sales s
          WHERE s.voided = 0
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
        `,
        [todayStart, todayEnd, ...outletParams],
      );
      const saleCount = Number(saleCountRow[0]?.count || 0);
      const averageBill = saleCount > 0 ? Number((totalRevenueToday / saleCount).toFixed(2)) : 0;

      // Compute UTC start for 29-days-ago local date
      const twentyNineDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 29 * 24 * 3600 * 1000));
      const twentyNineDaysAgoStart = toUtcStart(twentyNineDaysAgoStr, tz);

      const topSelling = await getQuery(
        `
          SELECT p.name, SUM(si.quantity) AS total_sold
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          WHERE s.voided = 0
            AND s.timestamp >= ?
            ${outletFilter}
          GROUP BY p.name
          ORDER BY total_sold DESC, p.name ASC
          LIMIT 5
        `,
        [twentyNineDaysAgoStart, ...outletParams],
      );

      const lowStock = await getQuery(
        `
          SELECT
            p.name,
            p.barcode,
            p.price,
            p.cost_price,
            COALESCE(SUM(os.quantity), 0) AS stock
          FROM products p
          LEFT JOIN outlet_stock os ON p.id = os.product_id
          ${outletId !== null ? "AND os.outlet_id = ?" : ""}
          GROUP BY p.id
          HAVING stock <= CASE WHEN COALESCE(MAX(p.min_qty), 0) > 0 THEN MAX(p.min_qty) ELSE 10 END
          ORDER BY stock ASC, p.name ASC
          LIMIT 8
        `,
        outletId !== null ? [outletId] : [],
      );

      const inventoryValueRow = await getQuery(
        `
          SELECT
            ROUND(COALESCE(SUM(os.quantity * p.price), 0), 2) AS retail_value,
            ROUND(COALESCE(SUM(os.quantity * p.cost_price), 0), 2) AS cost_value,
            ROUND(COALESCE(SUM(os.quantity), 0), 2) AS total_units
          FROM outlet_stock os
          JOIN products p ON os.product_id = p.id
          WHERE os.quantity > 0
          ${outletId !== null ? "AND os.outlet_id = ?" : ""}
        `,
        outletId !== null ? [outletId] : [],
      );
      const inventoryValue = inventoryValueRow[0] || {
        retail_value: 0,
        cost_value: 0,
        total_units: 0,
      };

      // Compute UTC start for 6-days-ago local date
      const sixDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 6 * 24 * 3600 * 1000));
      const sixDaysAgoStart = toUtcStart(sixDaysAgoStr, tz);

      const salesTrend = await getQuery(
        `
          SELECT
            date(s.timestamp, 'localtime') AS day,
            ROUND(SUM(s.total_amount), 2) AS revenue,
            COUNT(s.id) AS sale_count
          FROM sales s
          WHERE s.voided = 0
            AND s.timestamp >= ?
            ${outletFilter}
          GROUP BY day
          ORDER BY day ASC
        `,
        [sixDaysAgoStart, ...outletParams],
      );

      const attendanceToday = await getQuery(
        `
          SELECT
            e.id,
            e.name,
            active.session_type,
            active.break_reason,
            COALESCE(work_hours.net_work_hours, 0) AS net_work_hours
          FROM employees e
          LEFT JOIN (
            SELECT employee_id, session_type, break_reason
            FROM attendance_sessions
            WHERE session_end IS NULL
              AND session_start >= ?
              AND session_start < ?
              ${outletId !== null ? "AND outlet_id = ?" : ""}
          ) active ON active.employee_id = e.id
          LEFT JOIN (
            SELECT employee_id, COALESCE(SUM(duration_hours), 0) AS net_work_hours
            FROM attendance_sessions
            WHERE session_type = 'work'
              AND session_end IS NOT NULL
              AND session_start >= ?
              AND session_start < ?
              ${outletId !== null ? "AND outlet_id = ?" : ""}
            GROUP BY employee_id
          ) work_hours ON work_hours.employee_id = e.id
          ORDER BY e.name ASC
        `,
        outletId !== null
          ? [todayStart, todayEnd, outletId, todayStart, todayEnd, outletId]
          : [todayStart, todayEnd, todayStart, todayEnd],
      );

      const refundsTodayRows = await getQuery(
        `
          SELECT
            COUNT(DISTINCT r.id) AS refund_count,
            ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0), 2) AS refund_value
          FROM returns r
          LEFT JOIN return_items ri ON ri.return_id = r.id
          WHERE r.timestamp >= ?
            AND r.timestamp < ?
          ${outletId !== null ? "AND r.outlet_id = ?" : ""}
        `,
        outletId !== null ? [todayStart, todayEnd, outletId] : [todayStart, todayEnd],
      );
      const refundsToday = {
        count: Number(refundsTodayRows[0]?.refund_count || 0),
        value: Number(refundsTodayRows[0]?.refund_value || 0),
      };

      const voidsTodayRows = await getQuery(
        `
          SELECT
            COUNT(*) AS void_count,
            ROUND(COALESCE(SUM(total_amount), 0), 2) AS void_value
          FROM sales s
          WHERE s.voided = 1
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
        `,
        [todayStart, todayEnd, ...outletParams],
      );
      const voidsToday = {
        count: Number(voidsTodayRows[0]?.void_count || 0),
        value: Number(voidsTodayRows[0]?.void_value || 0),
      };

      const discountsTodayRows = await getQuery(
        `
          SELECT
            COUNT(*) AS discount_count,
            ROUND(COALESCE(SUM(discount_amount), 0), 2) AS discount_value
          FROM sales s
          WHERE s.voided = 0
            AND COALESCE(s.discount_amount, 0) > 0
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
        `,
        [todayStart, todayEnd, ...outletParams],
      );
      const discountsToday = {
        count: Number(discountsTodayRows[0]?.discount_count || 0),
        value: Number(discountsTodayRows[0]?.discount_value || 0),
      };

      const monthSalesRows = await getQuery(
        `
          SELECT ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS total
          FROM sales s
          WHERE s.voided = 0
            AND s.timestamp >= ?
            AND s.timestamp < ?
            ${outletFilter}
        `,
        [monthStart, todayEnd, ...outletParams],
      );
      const monthSales = Number(monthSalesRows[0]?.total || 0);

      const monthPurchasesRows = await getQuery(
        `
          SELECT ROUND(COALESCE(SUM(gi.qty_received * gi.cost_price), 0), 2) AS total
          FROM goods_received_notes grn
          JOIN grn_items gi ON gi.grn_id = grn.id
          WHERE grn.received_at >= ?
            AND grn.received_at < ?
          ${outletId !== null ? "AND grn.outlet_id = ?" : ""}
        `,
        outletId !== null ? [monthStart, todayEnd, outletId] : [monthStart, todayEnd],
      );
      const monthPurchases = Number(monthPurchasesRows[0]?.total || 0);

      const paymentContribution = zReport.map((row) => ({
        ...row,
        contribution_pct:
          totalRevenueToday > 0
            ? Number(((Number(row.total || 0) / totalRevenueToday) * 100).toFixed(2))
            : 0,
      }));

      const categoryContributionRows = await getQuery(
        `
          SELECT
            c.name AS category,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          JOIN categories c ON c.id = p.category_id
          WHERE s.voided = 0
            AND s.timestamp >= ?
            ${outletFilter}
          GROUP BY c.name
          ORDER BY revenue DESC, c.name ASC
          LIMIT 5
        `,
        [twentyNineDaysAgoStart, ...outletParams],
      );
      const categoryContributionTotal = categoryContributionRows.reduce(
        (sum, row) => sum + Number(row.revenue || 0),
        0,
      );
      const categoryContribution = categoryContributionRows.map((row) => ({
        ...row,
        contribution_pct:
          categoryContributionTotal > 0
            ? Number(((Number(row.revenue || 0) / categoryContributionTotal) * 100).toFixed(2))
            : 0,
      }));

      const salePurchaseComparison = await getQuery(
        `
          WITH RECURSIVE dates(day) AS (
            SELECT ?
            UNION ALL
            SELECT date(day, '+1 day')
            FROM dates
            WHERE day < ?
          ),
          sales_daily AS (
            SELECT
              date(s.timestamp, 'localtime') AS day,
              ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS sales_total
            FROM sales s
            WHERE s.voided = 0
              AND s.timestamp >= ?
              ${outletFilter}
            GROUP BY date(s.timestamp, 'localtime')
          ),
          purchase_daily AS (
            SELECT
              date(grn.received_at, 'localtime') AS day,
              ROUND(COALESCE(SUM(gi.qty_received * gi.cost_price), 0), 2) AS purchase_total
            FROM goods_received_notes grn
            JOIN grn_items gi ON gi.grn_id = grn.id
            WHERE grn.received_at >= ?
              ${outletId !== null ? "AND grn.outlet_id = ?" : ""}
            GROUP BY date(grn.received_at, 'localtime')
          )
          SELECT
            dates.day,
            COALESCE(sales_daily.sales_total, 0) AS sales_total,
            COALESCE(purchase_daily.purchase_total, 0) AS purchase_total
          FROM dates
          LEFT JOIN sales_daily ON sales_daily.day = dates.day
          LEFT JOIN purchase_daily ON purchase_daily.day = dates.day
          ORDER BY dates.day ASC
        `,
        outletId !== null
          ? [sixDaysAgoStr, todayStr, sixDaysAgoStart, ...outletParams, sixDaysAgoStart, outletId]
          : [sixDaysAgoStr, todayStr, sixDaysAgoStart, ...outletParams, sixDaysAgoStart],
      );

      const attendanceDetails = attendanceToday.map((row) => {
        const status =
          row.session_type === "work"
            ? "clocked_in"
            : row.session_type === "break"
              ? "on_break"
              : Number(row.net_work_hours || 0) > 0
                ? "clocked_out"
                : "not_started";
        return {
          id: row.id,
          name: row.name,
          status,
          break_reason: row.break_reason || null,
          net_work_hours: Math.max(0, Number(row.net_work_hours || 0)),
        };
      });

      const attendanceSummary = {
        clocked_in: attendanceDetails.filter((row) => row.status === "clocked_in")
          .length,
        on_break: attendanceDetails.filter((row) => row.status === "on_break")
          .length,
        clocked_out: attendanceDetails.filter((row) => row.status === "clocked_out")
          .length,
        not_started: attendanceDetails.filter((row) => row.status === "not_started")
          .length,
        total_employees: attendanceDetails.length,
        details: attendanceDetails,
      };

      res.json({
        totalRevenueToday: Number(totalRevenueToday.toFixed(2)),
        saleCount,
        averageBill,
        monthSales,
        monthPurchases,
        monthGrossMargin,
        zReport,
        paymentContribution,
        todayProfit,
        todayGrossProfit: Number(todayGrossProfit.toFixed(2)),
        todayExpenses,
        refundsToday,
        voidsToday,
        discountsToday,
        taxInclusive,
        taxExclusive,
        inventoryValue,
        currentStockUnits: Number(inventoryValue.total_units || 0),
        topSelling,
        lowStock,
        salesTrend,
        salePurchaseComparison,
        categoryContribution,
        attendanceSummary,
        salesByOutlet,
        topProducts,
        monthlyTrend,
        hourlySales,
        categoryPerformance: categoryMatrix,
        inventory: inventoryStatus[0] || {
          total_products: 0,
          low_stock_items: 0,
        },
      });
    } catch (err) {
      console.error("Dashboard Error:", err);
      res.status(500).json({ error: "Failed to load dashboard data" });
    }
  });
};
