module.exports = function (app, deps, helpers) {
  const { db, requireFeature } = deps;
  const { buildCategoryMetaMap, withCategoryPaths } = helpers;

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

      // 2. Sales by Outlet (Today)
      const salesByOutlet = await getQuery(`
            SELECT o.name, SUM(s.total_amount) as total
            FROM sales s
            JOIN outlets o ON s.outlet_id = o.id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
            GROUP BY o.name
        `);

      // 3. Top Selling Products (Last 7 Days)
      const topProducts = await getQuery(`
            SELECT p.name, SUM(si.quantity) as units_sold
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE date(s.timestamp, 'localtime') >= date('now', '-7 days', 'localtime')
            GROUP BY p.name
            ORDER BY units_sold DESC
            LIMIT 5
        `);

      // 4. Monthly Revenue Trend (Last 6 Months)
      const monthlyTrend = await getQuery(`
            SELECT strftime('%Y-%m', s.timestamp, 'localtime') as month, 
                   SUM(s.total_amount) as total
            FROM sales s
            WHERE date(s.timestamp, 'localtime') >= date('now', '-6 months', 'localtime')
            GROUP BY month
            ORDER BY month ASC
        `);

      // 5. Inventory Overview
      const inventoryStatus = await getQuery(`
            SELECT 
                COUNT(*) as total_products,
                SUM(CASE WHEN stock_alert = 1 THEN 1 ELSE 0 END) as low_stock_items
            FROM products
        `);

      // 6. Category Performance
      const categoryMatrix = await getQuery(`
            SELECT c.name as category, SUM(si.quantity * si.price_at_sale) as revenue
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN categories c ON p.category_id = c.id
            JOIN sales s ON si.sale_id = s.id
            WHERE date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')
            GROUP BY c.name
            ORDER BY revenue DESC
            LIMIT 5
        `);

      // 7. Hourly Sales Distribution (Today)
      const hourlySales = await getQuery(`
        SELECT strftime('%H:00', timestamp, 'localtime') as hour, 
               SUM(total_amount) as total
        FROM sales
        WHERE date(timestamp, 'localtime') = date('now', 'localtime')
        GROUP BY hour
        ORDER BY hour ASC
      `);

      res.json({
        totalRevenueToday,
        zReport,
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
