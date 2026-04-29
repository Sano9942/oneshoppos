const { toUtcStart, toUtcEnd, isValidTz } = require("../../utils/tz");

module.exports = function (app, deps) {
  const { db } = deps;

  /**
   * Build an outlet filter clause with numbered Postgres params.
   * @param {string} col - column name like "s.outlet_id"
   * @param {number[]} ids - outlet id array
   * @param {number} startIdx - next $N index
   * @returns {{ clause: string, values: number[] }}
   */
  function buildOutletClause(col, ids, startIdx) {
    if (!ids.length) return { clause: "", values: [] };
    if (ids.length === 1)
      return { clause: ` AND ${col} = $${startIdx}`, values: [ids[0]] };
    const placeholders = ids.map((_, i) => `$${startIdx + i}`).join(",");
    return {
      clause: ` AND ${col} IN (${placeholders})`,
      values: ids,
    };
  }

  app.get("/api/reports/dashboard", async (req, res) => {
    try {
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
      const todayStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
      }).format(new Date());
      const todayStart = toUtcStart(todayStr, tz);
      const todayEnd = toUtcEnd(todayStr, tz);
      const monthStartStr = todayStr.slice(0, 7) + "-01";
      const monthStart = toUtcStart(monthStartStr, tz);

      const rawOutletId = req.query?.outlet_id;
      const outletIds = rawOutletId
        ? String(rawOutletId)
            .split(",")
            .map(Number)
            .filter(Boolean)
        : [];

      const sevenDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 7 * 24 * 3600 * 1000));
      const sevenDaysAgoStart = toUtcStart(sevenDaysAgoStr, tz);
      const sixMonthsAgoDate = new Date();
      sixMonthsAgoDate.setMonth(sixMonthsAgoDate.getMonth() - 6);
      const sixMonthsAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(sixMonthsAgoDate);
      const sixMonthsAgoStart = toUtcStart(sixMonthsAgoStr, tz);
      const thirtyDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 24 * 3600 * 1000));
      const thirtyDaysAgoStart = toUtcStart(thirtyDaysAgoStr, tz);
      const twentyNineDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 29 * 24 * 3600 * 1000));
      const twentyNineDaysAgoStart = toUtcStart(twentyNineDaysAgoStr, tz);
      const sixDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 6 * 24 * 3600 * 1000));
      const sixDaysAgoStart = toUtcStart(sixDaysAgoStr, tz);
      const elapsedMs = Date.now() - new Date(todayStart.replace(" ", "T") + "Z").getTime();
      const yesterdayDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 24 * 3600 * 1000));
      const yesterdayStart = toUtcStart(yesterdayDateStr, tz);
      const yesterdayEndMs = new Date(yesterdayStart.replace(" ", "T") + "Z").getTime() + elapsedMs;
      const yesterdayEnd = new Date(yesterdayEndMs).toISOString().replace("T", " ").slice(0, 19);

      // ─── Query 1: zReport (payment breakdown) ───
      const zOutlet = buildOutletClause("s.outlet_id", outletIds, 3);
      const zReport = (await db.query(`
        SELECT COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
          ROUND(SUM(COALESCE(sp.amount, s.total_amount))::numeric, 2) AS total
        FROM sales s LEFT JOIN sale_payments sp ON s.id = sp.sale_id
        WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2 ${zOutlet.clause}
        GROUP BY COALESCE(sp.payment_method, s.payment_method, 'Unknown') ORDER BY total DESC`,
        [todayStart, todayEnd, ...zOutlet.values])).rows;
      const totalRevenueToday = zReport.reduce((sum, row) => sum + Number(row.total || 0), 0);

      // ─── Query 2: Today's scalar metrics (sale count, voids, discounts, month sales) ───
      const scOutlet = buildOutletClause("s.outlet_id", outletIds, 3);
      const todayScalars = (await db.query(`
        SELECT
          (SELECT COUNT(id) FROM sales s WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2 ${scOutlet.clause}) AS sale_count,
          (SELECT COUNT(*) FROM sales s WHERE s.voided = true AND s.timestamp >= $1 AND s.timestamp < $2 ${scOutlet.clause}) AS void_count,
          (SELECT ROUND(COALESCE(SUM(total_amount), 0)::numeric, 2) FROM sales s WHERE s.voided = true AND s.timestamp >= $1 AND s.timestamp < $2 ${scOutlet.clause}) AS void_value,
          (SELECT COUNT(*) FROM sales s WHERE s.voided = false AND COALESCE(s.discount_amount, 0) > 0 AND s.timestamp >= $1 AND s.timestamp < $2 ${scOutlet.clause}) AS discount_count,
          (SELECT ROUND(COALESCE(SUM(discount_amount), 0)::numeric, 2) FROM sales s WHERE s.voided = false AND COALESCE(s.discount_amount, 0) > 0 AND s.timestamp >= $1 AND s.timestamp < $2 ${scOutlet.clause}) AS discount_value`,
        [todayStart, todayEnd, ...scOutlet.values])).rows[0];
      const saleCount = Number(todayScalars.sale_count || 0);
      const voidsToday = { count: Number(todayScalars.void_count || 0), value: Number(todayScalars.void_value || 0) };
      const discountsToday = { count: Number(todayScalars.discount_count || 0), value: Number(todayScalars.discount_value || 0) };

      // ─── Query 3: Revenue metrics + month gross margin (combined CTE) ───
      const rmOutlet = buildOutletClause("s.outlet_id", outletIds, 3);
      const mgIdx = 3 + rmOutlet.values.length;
      const mgOutlet = buildOutletClause("s.outlet_id", outletIds, mgIdx + 2);
      const profitMetrics = (await db.query(`
        WITH today_metrics AS (
          SELECT
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0)::numeric, 2) AS tax_inclusive,
            ROUND(COALESCE(SUM(CASE WHEN t.id IS NOT NULL
              THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
              ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0)) END), 0)::numeric, 2) AS tax_exclusive,
            ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0)::numeric, 2) AS total_cost
          FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
          LEFT JOIN taxes t ON p.tax_id = t.id
          WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2 ${rmOutlet.clause}
        ),
        month_metrics AS (
          SELECT
            ROUND(COALESCE(SUM(CASE WHEN t.id IS NOT NULL
              THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
              ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0)) END), 0)::numeric, 2) AS month_tax_exclusive,
            ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0)::numeric, 2) AS month_total_cost
          FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
          LEFT JOIN taxes t ON p.tax_id = t.id
          WHERE s.voided = false AND s.timestamp >= $${mgIdx} AND s.timestamp < $${mgIdx + 1} ${mgOutlet.clause}
        )
        SELECT * FROM today_metrics, month_metrics`,
        [todayStart, todayEnd, ...rmOutlet.values, monthStart, todayEnd, ...mgOutlet.values])).rows[0] || {};
      const taxInclusive = Number(profitMetrics.tax_inclusive || 0);
      const taxExclusive = Number(profitMetrics.tax_exclusive || 0);
      const totalCost = Number(profitMetrics.total_cost || 0);
      const todayGrossProfit = taxExclusive - totalCost;
      const monthTaxExclusive = Number(profitMetrics.month_tax_exclusive || 0);
      const monthTotalCost = Number(profitMetrics.month_total_cost || 0);
      const monthGrossMargin = Number((monthTaxExclusive - monthTotalCost).toFixed(2));

      // ─── Query 4: Expenses today ───
      const expOutlet = buildOutletClause("outlet_id", outletIds, 2);
      const todayExpenses = Number((await db.query(
        `SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2) AS total FROM expenses WHERE expense_date = $1${expOutlet.clause}`,
        [todayStr, ...expOutlet.values])).rows[0]?.total || 0);
      const todayProfit = Number((todayGrossProfit - todayExpenses).toFixed(2));
      const averageBill = saleCount > 0 ? Number((totalRevenueToday / saleCount).toFixed(2)) : 0;

      // ─── Query 5: Yesterday metrics (combined CTE) ───
      const ysOutlet = buildOutletClause("s.outlet_id", outletIds, 3);
      const ypIdx = 3 + ysOutlet.values.length;
      const ypOutlet = buildOutletClause("s.outlet_id", outletIds, ypIdx + 2);
      const yrIdx = ypIdx + 2 + ypOutlet.values.length;
      const yrOutlet = buildOutletClause("r.outlet_id", outletIds, yrIdx + 2);
      const yesterdayData = (await db.query(`
        WITH yd_sales AS (
          SELECT ROUND(COALESCE(SUM(s.total_amount), 0)::numeric, 2) AS revenue, COUNT(s.id) AS sale_count
          FROM sales s WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2 ${ysOutlet.clause}
        ),
        yd_profit AS (
          SELECT
            ROUND(COALESCE(SUM(CASE WHEN t.id IS NOT NULL
              THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
              ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0)) END), 0)::numeric, 2) AS tax_exclusive,
            ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0)::numeric, 2) AS total_cost
          FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
          LEFT JOIN taxes t ON p.tax_id = t.id
          WHERE s.voided = false AND s.timestamp >= $${ypIdx} AND s.timestamp < $${ypIdx + 1} ${ypOutlet.clause}
        ),
        yd_refunds AS (
          SELECT ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0)::numeric, 2) AS refund_value
          FROM returns r LEFT JOIN return_items ri ON ri.return_id = r.id
          WHERE r.timestamp >= $${yrIdx} AND r.timestamp < $${yrIdx + 1} ${yrOutlet.clause}
        )
        SELECT * FROM yd_sales, yd_profit, yd_refunds`,
        [yesterdayStart, yesterdayEnd, ...ysOutlet.values,
         yesterdayStart, yesterdayEnd, ...ypOutlet.values,
         yesterdayStart, yesterdayEnd, ...yrOutlet.values])).rows[0] || {};
      const yesterdayRevenue = Number(yesterdayData.revenue || 0);
      const yesterdaySaleCount = Number(yesterdayData.sale_count || 0);
      const yesterdayProfit = Number((Number(yesterdayData.tax_exclusive || 0) - Number(yesterdayData.total_cost || 0)).toFixed(2));
      const yesterdayRefunds = Number(yesterdayData.refund_value || 0);

      // ─── Query 6: Month sales + purchases + refunds today (combined) ───
      const msOutlet = buildOutletClause("s.outlet_id", outletIds, 3);
      const mpIdx = 3 + msOutlet.values.length;
      const mpOutlet = buildOutletClause("grn.outlet_id", outletIds, mpIdx + 2);
      const rtIdx = mpIdx + 2 + mpOutlet.values.length;
      const rtOutlet = buildOutletClause("r.outlet_id", outletIds, rtIdx + 2);
      const monthAndRefunds = (await db.query(`
        WITH ms AS (
          SELECT ROUND(COALESCE(SUM(s.total_amount), 0)::numeric, 2) AS month_sales
          FROM sales s WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2 ${msOutlet.clause}
        ),
        mp AS (
          SELECT ROUND(COALESCE(SUM(gi.qty_received * gi.cost_price), 0)::numeric, 2) AS month_purchases
          FROM goods_received_notes grn JOIN grn_items gi ON gi.grn_id = grn.id
          WHERE grn.received_at::date >= $${mpIdx}::date AND grn.received_at::date <= $${mpIdx + 1}::date ${mpOutlet.clause}
        ),
        rt AS (
          SELECT COUNT(DISTINCT r.id) AS refund_count,
            ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0)::numeric, 2) AS refund_value
          FROM returns r LEFT JOIN return_items ri ON ri.return_id = r.id
          WHERE r.timestamp >= $${rtIdx} AND r.timestamp < $${rtIdx + 1} ${rtOutlet.clause}
        )
        SELECT * FROM ms, mp, rt`,
        [monthStart, todayEnd, ...msOutlet.values,
         monthStartStr, todayStr, ...mpOutlet.values,
         todayStart, todayEnd, ...rtOutlet.values])).rows[0] || {};
      const monthSales = Number(monthAndRefunds.month_sales || 0);
      const monthPurchases = Number(monthAndRefunds.month_purchases || 0);
      const refundsToday = {
        count: Number(monthAndRefunds.refund_count || 0),
        value: Number(monthAndRefunds.refund_value || 0),
      };

      // ─── Query 7: Sales by outlet (no outlet filter — always all outlets) ───
      const salesByOutlet = (await db.query(
        `SELECT o.name, ROUND(SUM(s.total_amount)::numeric, 2) AS total
         FROM sales s JOIN outlets o ON s.outlet_id = o.id
         WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2
         GROUP BY o.name ORDER BY total DESC`, [todayStart, todayEnd])).rows;

      // ─── Query 8: Top products (7 days) + top selling (29 days) + category contribution + category matrix ───
      const tpOutlet = buildOutletClause("s.outlet_id", outletIds, 2);
      const topProducts = (await db.query(
        `SELECT p.name, SUM(si.quantity) AS units_sold
         FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
         WHERE s.voided = false AND s.timestamp >= $1 ${tpOutlet.clause}
         GROUP BY p.name ORDER BY units_sold DESC, p.name ASC LIMIT 5`,
        [sevenDaysAgoStart, ...tpOutlet.values])).rows;

      const tsOutlet = buildOutletClause("s.outlet_id", outletIds, 2);
      const topSelling = (await db.query(
        `SELECT p.name, SUM(si.quantity) AS total_sold
         FROM sale_items si JOIN products p ON si.product_id = p.id JOIN sales s ON si.sale_id = s.id
         WHERE s.voided = false AND s.timestamp >= $1 ${tsOutlet.clause}
         GROUP BY p.name ORDER BY total_sold DESC, p.name ASC LIMIT 5`,
        [twentyNineDaysAgoStart, ...tsOutlet.values])).rows;

      const cmOutlet = buildOutletClause("s.outlet_id", outletIds, 2);
      const categoryMatrix = (await db.query(
        `SELECT c.name AS category, ROUND(SUM(si.quantity * si.price_at_sale)::numeric, 2) AS revenue
         FROM sale_items si JOIN products p ON si.product_id = p.id
         JOIN categories c ON p.category_id = c.id JOIN sales s ON si.sale_id = s.id
         WHERE s.voided = false AND s.timestamp >= $1 ${cmOutlet.clause}
         GROUP BY c.name ORDER BY revenue DESC, c.name ASC LIMIT 5`,
        [thirtyDaysAgoStart, ...cmOutlet.values])).rows;

      const ccOutlet = buildOutletClause("s.outlet_id", outletIds, 2);
      const categoryContributionRows = (await db.query(
        `SELECT c.name AS category, ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0)::numeric, 2) AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE s.voided = false AND s.timestamp >= $1 ${ccOutlet.clause}
         GROUP BY c.name ORDER BY revenue DESC, c.name ASC LIMIT 5`,
        [twentyNineDaysAgoStart, ...ccOutlet.values])).rows;
      const categoryContributionTotal = categoryContributionRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
      const categoryContribution = categoryContributionRows.map((row) => ({
        ...row,
        contribution_pct: categoryContributionTotal > 0 ? Number(((Number(row.revenue || 0) / categoryContributionTotal) * 100).toFixed(2)) : 0,
      }));

      // ─── Query 9: Hourly sales ───
      const hsOutlet = buildOutletClause("s.outlet_id", outletIds, 3);
      const hourlySales = (await db.query(
        `SELECT LPAD(EXTRACT(HOUR FROM s.timestamp)::text, 2, '0') || ':00' AS hour,
          ROUND(SUM(s.total_amount)::numeric, 2) AS total, COUNT(s.id) AS orders
         FROM sales s WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2 ${hsOutlet.clause}
         GROUP BY EXTRACT(HOUR FROM s.timestamp) ORDER BY hour ASC`,
        [todayStart, todayEnd, ...hsOutlet.values])).rows;

      // ─── Query 10: Monthly trend ───
      const mtOutlet = buildOutletClause("s.outlet_id", outletIds, 2);
      const monthlyTrend = (await db.query(
        `SELECT TO_CHAR(s.timestamp, 'YYYY-MM') AS month, ROUND(SUM(s.total_amount)::numeric, 2) AS total
         FROM sales s WHERE s.voided = false AND s.timestamp >= $1 ${mtOutlet.clause}
         GROUP BY TO_CHAR(s.timestamp, 'YYYY-MM') ORDER BY month ASC`,
        [sixMonthsAgoStart, ...mtOutlet.values])).rows;

      // ─── Query 11: Inventory (status + value + low stock) ───
      const inventoryStatus = (await db.query(
        `SELECT COUNT(*) AS total_products,
          SUM(CASE WHEN stock <= min_qty AND min_qty > 0 THEN 1 ELSE 0 END) AS low_stock_items
         FROM products WHERE deleted_at IS NULL`)).rows;

      const ivOutlet = buildOutletClause("os.outlet_id", outletIds, 1);
      const inventoryValue = (await db.query(
        `SELECT
          ROUND(COALESCE(SUM(os.quantity * p.price), 0)::numeric, 2) AS retail_value,
          ROUND(COALESCE(SUM(os.quantity * p.cost_price), 0)::numeric, 2) AS cost_value,
          ROUND(COALESCE(SUM(os.quantity), 0)::numeric, 2) AS total_units
         FROM outlet_stock os JOIN products p ON os.product_id = p.id WHERE os.quantity > 0 ${ivOutlet.clause}`,
        [...ivOutlet.values])).rows[0] || { retail_value: 0, cost_value: 0, total_units: 0 };

      let lsJoinExtra = "";
      const lsValues = [];
      if (outletIds.length === 1) {
        lsJoinExtra = ` AND os.outlet_id = $1`;
        lsValues.push(outletIds[0]);
      } else if (outletIds.length > 1) {
        const ph = outletIds.map((_, i) => `$${i + 1}`).join(",");
        lsJoinExtra = ` AND os.outlet_id IN (${ph})`;
        lsValues.push(...outletIds);
      }
      const lowStock = (await db.query(
        `SELECT p.name, p.barcode, p.price, p.cost_price, COALESCE(SUM(os.quantity), 0) AS stock
         FROM products p LEFT JOIN outlet_stock os ON p.id = os.product_id${lsJoinExtra}
         WHERE p.deleted_at IS NULL
         GROUP BY p.id, p.name, p.barcode, p.price, p.cost_price, p.min_qty
         HAVING COALESCE(SUM(os.quantity), 0) <= CASE WHEN COALESCE(p.min_qty, 0) > 0 THEN p.min_qty ELSE 10 END
         ORDER BY stock ASC, p.name ASC LIMIT 8`, lsValues)).rows;

      // ─── Query 12: Sales trend (7 days) ───
      // P22 fix: bucket by tenant-local date via AT TIME ZONE; emit as text to avoid
      // pg-driver Date-object reinterpretation on JS side. tz inline-literal'd because
      // isValidTz validates it (safe vs SQL injection) and Postgres needs identical
      // expression text for GROUP BY matching.
      const stOutlet = buildOutletClause("s.outlet_id", outletIds, 2);
      const salesTrend = (await db.query(
        `SELECT to_char((s.timestamp AT TIME ZONE '${tz}')::date, 'YYYY-MM-DD') AS day,
                ROUND(SUM(s.total_amount)::numeric, 2) AS revenue, COUNT(s.id) AS sale_count
         FROM sales s WHERE s.voided = false AND s.timestamp >= $1 ${stOutlet.clause}
         GROUP BY (s.timestamp AT TIME ZONE '${tz}')::date ORDER BY day ASC`,
        [sixDaysAgoStart, ...stOutlet.values])).rows;

      // ─── Query 13: Sale/purchase comparison (7-day series) ───
      // P22 fix: tz-aware bucketing for sales (tz inline-literal'd, validated).
      // grn.received_at is a LOCAL timestamp column (already in tenant-local time per
      // the column-type convention) so no TZ shift needed for grn buckets.
      const spcSalesOutlet = buildOutletClause("s.outlet_id", outletIds, 4);
      const spcGrnStartIdx = 4 + spcSalesOutlet.values.length;
      const spcGrnOutlet = buildOutletClause("grn.outlet_id", outletIds, spcGrnStartIdx + 1);
      const salePurchaseComparison = (await db.query(`
        WITH date_series AS (
          SELECT to_char(d, 'YYYY-MM-DD') AS day FROM generate_series($1::date, $2::date, '1 day'::interval) d),
        sales_daily AS (SELECT to_char((s.timestamp AT TIME ZONE '${tz}')::date, 'YYYY-MM-DD') AS day,
          ROUND(COALESCE(SUM(s.total_amount), 0)::numeric, 2) AS sales_total
          FROM sales s WHERE s.voided = false AND s.timestamp >= $3 ${spcSalesOutlet.clause}
          GROUP BY (s.timestamp AT TIME ZONE '${tz}')::date),
        purchase_daily AS (SELECT to_char(grn.received_at::date, 'YYYY-MM-DD') AS day,
          ROUND(COALESCE(SUM(gi.qty_received * gi.cost_price), 0)::numeric, 2) AS purchase_total
          FROM goods_received_notes grn JOIN grn_items gi ON gi.grn_id = grn.id
          WHERE grn.received_at::date >= $${spcGrnStartIdx}::date ${spcGrnOutlet.clause}
          GROUP BY grn.received_at::date)
        SELECT date_series.day, COALESCE(sales_daily.sales_total, 0) AS sales_total,
          COALESCE(purchase_daily.purchase_total, 0) AS purchase_total
        FROM date_series LEFT JOIN sales_daily ON sales_daily.day = date_series.day
        LEFT JOIN purchase_daily ON purchase_daily.day = date_series.day
        ORDER BY date_series.day ASC`,
        [sixDaysAgoStr, todayStr, sixDaysAgoStart, ...spcSalesOutlet.values, sixDaysAgoStr, ...spcGrnOutlet.values])).rows;

      // ─── Query 14: Attendance today ───
      const attOutlet1 = buildOutletClause("outlet_id", outletIds, 2);
      const secondTodayIdx = 2 + attOutlet1.values.length;
      const attOutlet2 = buildOutletClause("outlet_id", outletIds, secondTodayIdx + 1);
      const attParams = [todayStr, ...attOutlet1.values, todayStr, ...attOutlet2.values];
      const attendanceToday = (await db.query(`
        SELECT e.id, e.name, active.session_type, active.break_reason,
          COALESCE(work_hours.net_work_hours, 0) AS net_work_hours
        FROM employees e
        LEFT JOIN (SELECT employee_id, session_type, break_reason FROM attendance_sessions
          WHERE session_end IS NULL AND session_start::date = $1::date ${attOutlet1.clause}
        ) active ON active.employee_id = e.id
        LEFT JOIN (SELECT employee_id, COALESCE(SUM(duration_hours), 0) AS net_work_hours FROM attendance_sessions
          WHERE session_type = 'work' AND session_end IS NOT NULL AND session_start::date = $${secondTodayIdx}::date ${attOutlet2.clause}
          GROUP BY employee_id
        ) work_hours ON work_hours.employee_id = e.id
        WHERE e.deleted_at IS NULL ORDER BY e.name ASC`, attParams)).rows;

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
        clocked_in: attendanceDetails.filter((row) => row.status === "clocked_in").length,
        on_break: attendanceDetails.filter((row) => row.status === "on_break").length,
        clocked_out: attendanceDetails.filter((row) => row.status === "clocked_out").length,
        not_started: attendanceDetails.filter((row) => row.status === "not_started").length,
        total_employees: attendanceDetails.length,
        details: attendanceDetails,
      };

      // ─── Query 15: Operational readiness (single query for all outlets) ───
      const allOutlets = (await db.query(`SELECT id, name FROM outlets ORDER BY name ASC`)).rows;
      const operationalReadiness = [];
      for (const outlet of allOutlets) {
        const shiftRow = (await db.query(
          `SELECT cs.id, e.name AS employee_name, cs.opened_at, cs.opening_float
           FROM cash_shifts cs LEFT JOIN employees e ON cs.employee_id = e.id
           WHERE cs.outlet_id = $1 AND cs.status = 'open'
           ORDER BY cs.opened_at DESC LIMIT 1`, [outlet.id])).rows[0];
        const staffCounts = (await db.query(
          `SELECT
            SUM(CASE WHEN session_type = 'work' AND session_end IS NULL THEN 1 ELSE 0 END) AS clocked_in,
            SUM(CASE WHEN session_type = 'break' AND session_end IS NULL THEN 1 ELSE 0 END) AS on_break
           FROM attendance_sessions
           WHERE outlet_id = $1 AND session_start::date = $2::date`, [outlet.id, todayStr])).rows[0];
        const lastSaleRow = (await db.query(
          `SELECT MAX(timestamp) AS last_sale_at FROM sales WHERE outlet_id = $1 AND voided = false`,
          [outlet.id])).rows[0];
        operationalReadiness.push({
          outlet_id: outlet.id,
          outlet_name: outlet.name,
          shift_open: !!shiftRow,
          shift_employee: shiftRow?.employee_name || null,
          shift_opened_at: shiftRow?.opened_at || null,
          opening_float: shiftRow?.opening_float || 0,
          staff_clocked_in: Number(staffCounts?.clocked_in || 0),
          staff_on_break: Number(staffCounts?.on_break || 0),
          last_sale_at: lastSaleRow?.last_sale_at || null,
        });
      }

      // ─── Build derived metrics ───
      const paymentContribution = zReport.map((row) => ({
        ...row,
        contribution_pct: totalRevenueToday > 0 ? Number(((Number(row.total || 0) / totalRevenueToday) * 100).toFixed(2)) : 0,
      }));

      // ─── 2-G.16 Merchant home: staff-of-the-day + cash-position ───
      // Top 3 staff by today's non-voided sales. Outlet filter already applied
      // upstream via `outletClause` wrapping — reuse the existing clause shape.
      const staffOfDayClause = buildOutletClause("s.outlet_id", outletIds, 3);
      const { rows: staffOfDayRows } = await db.query(
        `SELECT e.id, e.name, COUNT(s.id)::int AS sale_count, COALESCE(SUM(s.total_amount),0) AS total
           FROM sales s
           JOIN employees e ON e.id = s.employee_id
          WHERE s.timestamp >= $1 AND s.timestamp < $2 AND COALESCE(s.voided, false) = false
            ${staffOfDayClause.clause}
          GROUP BY e.id, e.name
          ORDER BY total DESC
          LIMIT 3`,
        [todayStart, todayEnd, ...staffOfDayClause.values],
      );
      const staffOfDay = staffOfDayRows.map((r) => ({
        id: r.id,
        name: r.name,
        sale_count: Number(r.sale_count),
        total: Number(r.total),
      }));

      // Cash position: for every open shift, expected_cash = opening_float +
      // sum(cash payments) - sum(cash_paid_out). We approximate cash_paid_out
      // via expenses flagged paid from the drawer (no dedicated table today);
      // the shifts close flow has the authoritative calc and matches this.
      const cashShiftClause = buildOutletClause("cs.outlet_id", outletIds, 1);
      const { rows: cashPositionRows } = await db.query(
        `SELECT cs.id AS shift_id,
                cs.outlet_id,
                o.name AS outlet_name,
                cs.opening_float,
                cs.opened_at,
                e.name AS employee_name,
                COALESCE((
                  SELECT SUM(sp.amount)
                    FROM sale_payments sp
                    JOIN sales s ON s.id = sp.sale_id
                   WHERE s.shift_id = cs.id
                     AND LOWER(sp.payment_method) = 'cash'
                     AND COALESCE(s.voided, false) = false
                ), 0) AS cash_in,
                COALESCE((
                  SELECT SUM(r.total_refund)
                    FROM returns r
                   WHERE r.shift_id = cs.id
                     AND LOWER(r.refund_method) = 'cash'
                ), 0) AS cash_out
           FROM cash_shifts cs
           JOIN outlets o ON o.id = cs.outlet_id
           LEFT JOIN employees e ON e.id = cs.employee_id
          WHERE cs.status = 'open'
            ${cashShiftClause.clause}
          ORDER BY cs.opened_at ASC`,
        [...cashShiftClause.values],
      );
      const cashPosition = {
        by_outlet: cashPositionRows.map((r) => {
          const expected = Number(r.opening_float || 0) + Number(r.cash_in || 0) - Number(r.cash_out || 0);
          return {
            shift_id: r.shift_id,
            outlet_id: r.outlet_id,
            outlet_name: r.outlet_name,
            employee_name: r.employee_name,
            opened_at: r.opened_at,
            opening_float: Number(r.opening_float || 0),
            cash_in: Number(r.cash_in || 0),
            cash_out: Number(r.cash_out || 0),
            expected_cash: Number(expected.toFixed(2)),
          };
        }),
        total_expected: Number(
          cashPositionRows
            .reduce(
              (sum, r) =>
                sum + Number(r.opening_float || 0) + Number(r.cash_in || 0) - Number(r.cash_out || 0),
              0,
            )
            .toFixed(2),
        ),
      };

      // ─── PR 7 onboarding-checklist signals + FBR banner state ─────────
      // customerCount drives the "Add your first customer" step;
      // testReceiptPrinted drives "Print a test receipt"; the country_code +
      // fbr_banner_dismissed pair drives the PK-only FBR prompt banner.
      // All best-effort so dashboard render never fails on stale schemas.
      let customerCount = 0;
      let testReceiptPrinted = false;
      let countryCode = req.company?.country_code || null;
      let fbrBannerDismissed = false;
      let fbrIntegrationEnabled = false;
      try {
        const { rows: [r] } = await db.query(
          "SELECT COUNT(*)::int AS cnt FROM customers WHERE deleted_at IS NULL"
        );
        customerCount = Number(r?.cnt || 0);
      } catch { /* table missing on legacy tenant — leave 0 */ }
      try {
        const { rows: [r] } = await db.query(
          "SELECT test_receipt_printed_at, country_code, fbr_banner_dismissed FROM company_profile WHERE id = 1"
        );
        testReceiptPrinted = r?.test_receipt_printed_at != null;
        if (r?.country_code) countryCode = r.country_code;
        fbrBannerDismissed = r?.fbr_banner_dismissed === true;
      } catch { /* column missing — leave defaults */ }
      try {
        const { rows: [r] } = await db.query(
          "SELECT enabled FROM feature_flags WHERE key = 'fbr_integration'"
        );
        fbrIntegrationEnabled = r?.enabled === true;
      } catch { /* table missing — leave false */ }

      res.json({
        currency: {
          symbol: req.company?.currency_symbol || "PKRs",
          code: req.company?.currency_code || "PKR",
        },
        customerCount,
        testReceiptPrinted,
        countryCode,
        fbrBannerDismissed,
        fbrIntegrationEnabled,
        targets: {
          monthly_sales_target: Number(req.company?.monthly_sales_target || 0),
          margin_threshold_pct: Number(req.company?.margin_threshold_pct || 20),
          refund_threshold_pct: Number(req.company?.refund_threshold_pct || 5),
          void_threshold_pct: Number(req.company?.void_threshold_pct || 3),
        },
        totalRevenueToday: Number(totalRevenueToday.toFixed(2)),
        saleCount,
        averageBill,
        yesterdayRevenue,
        yesterdaySaleCount,
        yesterdayProfit,
        yesterdayRefunds,
        monthSales,
        monthPurchases,
        monthGrossMargin,
        zReport,
        paymentContribution,
        todayProfit,
        todayGrossProfit: Number(todayGrossProfit.toFixed(2)),
        todayExpenses,
        refundsToday: {
          count: refundsToday.count,
          value: refundsToday.value,
          pct_of_sales: totalRevenueToday > 0
            ? Number(((refundsToday.value / totalRevenueToday) * 100).toFixed(1))
            : 0,
          pct_of_orders: saleCount > 0
            ? Number(((refundsToday.count / saleCount) * 100).toFixed(1))
            : 0,
        },
        voidsToday: {
          count: voidsToday.count,
          value: voidsToday.value,
          pct_of_sales: totalRevenueToday > 0
            ? Number(((voidsToday.value / totalRevenueToday) * 100).toFixed(1))
            : 0,
          pct_of_orders: saleCount > 0
            ? Number(((voidsToday.count / saleCount) * 100).toFixed(1))
            : 0,
        },
        discountsToday: {
          count: discountsToday.count,
          value: discountsToday.value,
          pct_of_sales: totalRevenueToday > 0
            ? Number(((discountsToday.value / totalRevenueToday) * 100).toFixed(1))
            : 0,
          pct_of_orders: saleCount > 0
            ? Number(((discountsToday.count / saleCount) * 100).toFixed(1))
            : 0,
        },
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
        operationalReadiness,
        salesByOutlet,
        topProducts,
        monthlyTrend,
        hourlySales,
        categoryPerformance: categoryMatrix,
        inventory: inventoryStatus[0] || {
          total_products: 0,
          low_stock_items: 0,
        },
        // 2-G.16 Merchant home — new retail-focused cards
        staffOfDay,
        cashPosition,
      });
    } catch (err) {
      console.error("Dashboard Error:", err);
      res.status(500).json({ error: "Failed to load dashboard data" });
    }
  });
};
