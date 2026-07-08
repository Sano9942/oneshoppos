module.exports = function mountInsightRoutes(app, deps) {
  const db = deps.db;
  const { requirePerm } = deps;

  // GET /api/insights/auto — pre-built analytical insight cards
  app.get("/api/insights/auto", requirePerm("view_reports"), async (req, res) => {
    try {
      const cards = [];

      // 1. Revenue trend — this week vs last week
      const { rows: [thisWeek] } = await db.query(
        `SELECT COALESCE(SUM(total_amount), 0) as total FROM sales
         WHERE timestamp >= NOW() - INTERVAL '7 days' AND voided = false`
      );
      const { rows: [lastWeek] } = await db.query(
        `SELECT COALESCE(SUM(total_amount), 0) as total FROM sales
         WHERE timestamp >= NOW() - INTERVAL '14 days' AND timestamp < NOW() - INTERVAL '7 days' AND voided = false`
      );
      const thisTotal = Number(thisWeek.total);
      const lastTotal = Number(lastWeek.total);
      const pctChange = lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : 0;
      cards.push({
        type: "revenue_trend",
        title: "Revenue This Week",
        value: thisTotal,
        trend: pctChange,
        detail: pctChange >= 0 ? `Up ${pctChange}% vs last week` : `Down ${Math.abs(pctChange)}% vs last week`,
      });

      // 2. Top products this week
      const { rows: topProducts } = await db.query(
        `SELECT p.name, SUM(si.quantity) as qty FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         JOIN products p ON si.product_id = p.id
         WHERE s.timestamp >= NOW() - INTERVAL '7 days' AND s.voided = false
         GROUP BY p.name ORDER BY qty DESC LIMIT 5`
      );
      if (topProducts.length) {
        cards.push({
          type: "top_products",
          title: "Top Products This Week",
          value: topProducts[0].name,
          detail: topProducts.map((p) => `${p.name} (${p.qty})`).join(", "),
        });
      }

      // 3. Low stock count
      const { rows: [lowStock] } = await db.query(
        `SELECT COUNT(*) as count FROM products p
         JOIN outlet_stock os ON p.id = os.product_id
         WHERE os.quantity <= p.min_qty AND p.min_qty > 0 AND p.deleted_at IS NULL`
      );
      cards.push({
        type: "low_stock",
        title: "Low Stock Alerts",
        value: Number(lowStock.count),
        detail: Number(lowStock.count) > 0 ? `${lowStock.count} products below reorder level` : "All stock levels healthy",
      });

      // 4. Busiest hour
      const { rows: busyHours } = await db.query(
        `SELECT EXTRACT(HOUR FROM timestamp) as hour, COUNT(*) as count FROM sales
         WHERE timestamp >= NOW() - INTERVAL '30 days' AND voided = false
         GROUP BY hour ORDER BY count DESC LIMIT 1`
      );
      if (busyHours.length) {
        const h = Number(busyHours[0].hour);
        const label = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
        cards.push({
          type: "busiest_hour",
          title: "Busiest Hour",
          value: label,
          detail: `${busyHours[0].count} transactions (last 30 days)`,
        });
      }

      // 5. Average transaction value trend
      const { rows: [avgThis] } = await db.query(
        `SELECT COALESCE(AVG(total_amount), 0) as avg FROM sales
         WHERE timestamp >= NOW() - INTERVAL '7 days' AND voided = false`
      );
      const { rows: [avgLast] } = await db.query(
        `SELECT COALESCE(AVG(total_amount), 0) as avg FROM sales
         WHERE timestamp >= NOW() - INTERVAL '14 days' AND timestamp < NOW() - INTERVAL '7 days' AND voided = false`
      );
      const avgPct = Number(avgLast.avg) > 0 ? Math.round(((Number(avgThis.avg) - Number(avgLast.avg)) / Number(avgLast.avg)) * 100) : 0;
      cards.push({
        type: "avg_transaction",
        title: "Avg Transaction",
        value: Number(avgThis.avg).toFixed(0),
        trend: avgPct,
        detail: avgPct >= 0 ? `Up ${avgPct}% vs last week` : `Down ${Math.abs(avgPct)}% vs last week`,
      });

      res.json({ cards });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
