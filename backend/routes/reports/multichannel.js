/**
 * Multi-channel aggregated reports — combined POS + Shopify + WooCommerce.
 * Feature #24, Wave 6.
 */
const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function registerMultichannelReports(app, deps, helpers) {
  const { db } = deps;
  const { pgWhere } = helpers;

  // ── GET /api/reports/multichannel-summary ──────────────────────────────
  // Per-channel summary: order_count, gross_revenue, discount_total, tax_total, net_revenue, aov
  app.get("/api/reports/multichannel-summary", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { from, to, outlet_id } = req.query;

      // -- POS channel --
      const posWhere = ["s.voided = false"];
      const posParams = [];
      if (from) { posWhere.push("s.timestamp >= ?"); posParams.push(toUtcStart(from, tz)); }
      if (to)   { posWhere.push("s.timestamp < ?");  posParams.push(toUtcEnd(to, tz)); }
      if (outlet_id) { posWhere.push("s.outlet_id = ?"); posParams.push(Number(outlet_id)); }

      const posFilter = pgWhere(posWhere, posParams);
      const posSQL = `
        SELECT
          COUNT(*)::int AS order_count,
          COALESCE(SUM(s.total_amount + s.discount_amount), 0)::numeric AS gross_revenue,
          COALESCE(SUM(s.discount_amount), 0)::numeric AS discount_total,
          0::numeric AS tax_total,
          COALESCE(SUM(s.total_amount), 0)::numeric AS net_revenue
        FROM sales s
        WHERE ${posFilter.text}
      `;
      const posResult = await db.query(posSQL, posFilter.values);

      // -- Web channels (Shopify + WooCommerce) --
      const webChannels = ["shopify", "woocommerce"];
      const channelResults = {};

      for (const source of webChannels) {
        const wWhere = ["w.source = ?"];
        const wParams = [source];
        if (from) { wWhere.push("w.ordered_at >= ?"); wParams.push(toUtcStart(from, tz)); }
        if (to)   { wWhere.push("w.ordered_at < ?");  wParams.push(toUtcEnd(to, tz)); }

        const wFilter = pgWhere(wWhere, wParams);
        const wSQL = `
          SELECT
            COUNT(*)::int AS order_count,
            COALESCE(SUM(w.subtotal + w.discount_total + w.tax_total), 0)::numeric AS gross_revenue,
            COALESCE(SUM(w.discount_total), 0)::numeric AS discount_total,
            COALESCE(SUM(w.tax_total), 0)::numeric AS tax_total,
            COALESCE(SUM(w.grand_total), 0)::numeric AS net_revenue
          FROM web_orders w
          WHERE ${wFilter.text}
        `;
        const result = await db.query(wSQL, wFilter.values);
        channelResults[source] = result.rows[0];
      }

      const pos = posResult.rows[0];
      const shopify = channelResults.shopify;
      const woocommerce = channelResults.woocommerce;

      const channels = [
        { channel: "POS", ...pos, average_order_value: pos.order_count > 0 ? Number((Number(pos.net_revenue) / pos.order_count).toFixed(2)) : 0 },
        { channel: "Shopify", ...shopify, average_order_value: shopify.order_count > 0 ? Number((Number(shopify.net_revenue) / shopify.order_count).toFixed(2)) : 0 },
        { channel: "WooCommerce", ...woocommerce, average_order_value: woocommerce.order_count > 0 ? Number((Number(woocommerce.net_revenue) / woocommerce.order_count).toFixed(2)) : 0 },
      ];

      // Cast numerics
      for (const ch of channels) {
        ch.gross_revenue = Number(ch.gross_revenue);
        ch.discount_total = Number(ch.discount_total);
        ch.tax_total = Number(ch.tax_total);
        ch.net_revenue = Number(ch.net_revenue);
      }

      const grand = {
        order_count: channels.reduce((s, c) => s + c.order_count, 0),
        gross_revenue: Number(channels.reduce((s, c) => s + c.gross_revenue, 0).toFixed(2)),
        discount_total: Number(channels.reduce((s, c) => s + c.discount_total, 0).toFixed(2)),
        tax_total: Number(channels.reduce((s, c) => s + c.tax_total, 0).toFixed(2)),
        net_revenue: Number(channels.reduce((s, c) => s + c.net_revenue, 0).toFixed(2)),
      };
      grand.average_order_value = grand.order_count > 0 ? Number((grand.net_revenue / grand.order_count).toFixed(2)) : 0;

      res.json({ channels, grand });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/reports/multichannel-daily ────────────────────────────────
  // Daily breakdown per channel — useful for trend charts
  app.get("/api/reports/multichannel-daily", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { from, to, outlet_id } = req.query;

      // POS daily
      const posWhere = ["s.voided = false"];
      const posParams = [];
      if (from) { posWhere.push("s.timestamp >= ?"); posParams.push(toUtcStart(from, tz)); }
      if (to)   { posWhere.push("s.timestamp < ?");  posParams.push(toUtcEnd(to, tz)); }
      if (outlet_id) { posWhere.push("s.outlet_id = ?"); posParams.push(Number(outlet_id)); }

      const pf = pgWhere(posWhere, posParams);
      const posDailySQL = `
        SELECT (s.timestamp AT TIME ZONE '${tz}')::date AS day,
               COALESCE(SUM(s.total_amount), 0)::numeric AS revenue,
               COUNT(*)::int AS orders
        FROM sales s
        WHERE ${pf.text}
        GROUP BY day ORDER BY day
      `;
      const posDaily = await db.query(posDailySQL, pf.values);

      // Web daily (combined query with source grouping)
      const wWhere = [];
      const wParams = [];
      if (from) { wWhere.push("w.ordered_at >= ?"); wParams.push(toUtcStart(from, tz)); }
      if (to)   { wWhere.push("w.ordered_at < ?");  wParams.push(toUtcEnd(to, tz)); }

      const wf = pgWhere(wWhere, wParams);
      const webDailySQL = `
        SELECT (w.ordered_at AT TIME ZONE '${tz}')::date AS day,
               w.source,
               COALESCE(SUM(w.grand_total), 0)::numeric AS revenue,
               COUNT(*)::int AS orders
        FROM web_orders w
        ${wf.text ? `WHERE ${wf.text}` : ""}
        GROUP BY day, w.source ORDER BY day
      `;
      const webDaily = await db.query(webDailySQL, wf.values);

      // Merge into day-keyed map
      const dayMap = new Map();
      const ensureDay = (d) => {
        const key = String(d);
        if (!dayMap.has(key)) dayMap.set(key, { date: key, pos_revenue: 0, shopify_revenue: 0, woocommerce_revenue: 0, pos_orders: 0, shopify_orders: 0, woocommerce_orders: 0 });
        return dayMap.get(key);
      };

      for (const r of posDaily.rows) {
        const row = ensureDay(r.day);
        row.pos_revenue = Number(r.revenue);
        row.pos_orders = r.orders;
      }
      for (const r of webDaily.rows) {
        const row = ensureDay(r.day);
        if (r.source === "shopify") {
          row.shopify_revenue = Number(r.revenue);
          row.shopify_orders = r.orders;
        } else if (r.source === "woocommerce") {
          row.woocommerce_revenue = Number(r.revenue);
          row.woocommerce_orders = r.orders;
        }
      }

      const days = [...dayMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ ...d, total_revenue: Number((d.pos_revenue + d.shopify_revenue + d.woocommerce_revenue).toFixed(2)) }));

      res.json({ days });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/reports/multichannel-products ─────────────────────────────
  // Top products across all channels
  app.get("/api/reports/multichannel-products", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { from, to, outlet_id, limit: rawLimit } = req.query;
      const limit = Math.min(200, Math.max(1, parseInt(rawLimit || 50, 10)));

      // POS product sales
      const posWhere = ["s.voided = false"];
      const posParams = [];
      if (from) { posWhere.push("s.timestamp >= ?"); posParams.push(toUtcStart(from, tz)); }
      if (to)   { posWhere.push("s.timestamp < ?");  posParams.push(toUtcEnd(to, tz)); }
      if (outlet_id) { posWhere.push("s.outlet_id = ?"); posParams.push(Number(outlet_id)); }

      const pf = pgWhere(posWhere, posParams);
      const posProductsSQL = `
        SELECT p.id AS product_id, p.name AS product_name,
               COALESCE(SUM(si.quantity), 0)::int AS qty,
               COALESCE(SUM(si.quantity * si.price_at_sale), 0)::numeric AS revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        WHERE ${pf.text}
        GROUP BY p.id, p.name
      `;
      const posProducts = await db.query(posProductsSQL, pf.values);

      // Web product sales
      const wWhere = [];
      const wParams = [];
      if (from) { wWhere.push("w.ordered_at >= ?"); wParams.push(toUtcStart(from, tz)); }
      if (to)   { wWhere.push("w.ordered_at < ?");  wParams.push(toUtcEnd(to, tz)); }

      const wf = pgWhere(wWhere, wParams);
      const webProductsSQL = `
        SELECT wi.product_id, COALESCE(p.name, wi.title) AS product_name,
               w.source,
               COALESCE(SUM(wi.qty), 0)::int AS qty,
               COALESCE(SUM(wi.line_total), 0)::numeric AS revenue
        FROM web_order_items wi
        JOIN web_orders w ON w.id = wi.web_order_id
        LEFT JOIN products p ON p.id = wi.product_id
        ${wf.text ? `WHERE ${wf.text}` : ""}
        GROUP BY wi.product_id, p.name, wi.title, w.source
      `;
      const webProducts = await db.query(webProductsSQL, wf.values);

      // Merge by product_id (or name fallback for unlinked web items)
      const productMap = new Map();
      const ensureProduct = (id, name) => {
        const key = id ? `id:${id}` : `name:${name}`;
        if (!productMap.has(key)) {
          productMap.set(key, {
            product_id: id,
            product_name: name || "Unknown",
            pos_qty: 0, shopify_qty: 0, woocommerce_qty: 0,
            pos_revenue: 0, shopify_revenue: 0, woocommerce_revenue: 0,
          });
        }
        return productMap.get(key);
      };

      for (const r of posProducts.rows) {
        const p = ensureProduct(r.product_id, r.product_name);
        p.pos_qty = r.qty;
        p.pos_revenue = Number(r.revenue);
      }
      for (const r of webProducts.rows) {
        const p = ensureProduct(r.product_id, r.product_name);
        if (r.source === "shopify") {
          p.shopify_qty += r.qty;
          p.shopify_revenue += Number(r.revenue);
        } else if (r.source === "woocommerce") {
          p.woocommerce_qty += r.qty;
          p.woocommerce_revenue += Number(r.revenue);
        }
      }

      const products = [...productMap.values()]
        .map((p) => ({
          ...p,
          total_qty: p.pos_qty + p.shopify_qty + p.woocommerce_qty,
          total_revenue: Number((p.pos_revenue + p.shopify_revenue + p.woocommerce_revenue).toFixed(2)),
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, limit);

      res.json({ products });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
