"use strict";

/**
 * KDS analytics (Phase 2-R Wave C / 2-R.5) — prep-time percentiles per station
 * and category, plus recent load snapshots. Drives the KDS analytics tab and
 * its delta-vs-target column.
 *
 * Gate: restaurant mode + phase4_restaurant_kds_analytics flag + view_sales_reports perm.
 */

const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function registerKdsAnalyticsRoutes(app, deps /* , helpers */) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");

  const gate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_kds_analytics"),
    requirePerm("view_sales_reports"),
  ];

  app.get("/api/reports/kds/prep-times", ...gate, async (req, res) => {
    try {
      const { from, to, station_id, outlet_id } = req.query;
      const tz = req.company?.timezone || "UTC";

      // Date boundaries — toUtcStart/toUtcEnd handle local YYYY-MM-DD input;
      // strict '< to' at the end covers the full day (see utils/tz.js).
      const fromUtc = from ? toUtcStart(from, tz) : null;
      const toUtc = to ? toUtcEnd(to, tz) : null;

      const whereParts = ["t.bumped_at IS NOT NULL", "t.prep_seconds IS NOT NULL"];
      const params = [];
      if (fromUtc) { params.push(fromUtc); whereParts.push(`t.bumped_at >= $${params.length}`); }
      if (toUtc)   { params.push(toUtc);   whereParts.push(`t.bumped_at < $${params.length}`); }
      if (station_id) { params.push(Number(station_id)); whereParts.push(`t.station_id = $${params.length}`); }
      if (outlet_id)  { params.push(Number(outlet_id));  whereParts.push(`ks.outlet_id = $${params.length}`); }

      const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

      // Per-station percentiles + mean + target. Use PERCENTILE_CONT over the
      // prep_seconds column (interpolates, giving stable numbers for small N).
      const { rows: stations } = await deps.db.query(
        `SELECT
           ks.id AS station_id,
           ks.name AS station_name,
           ks.target_prep_seconds,
           COUNT(*)::int AS count,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.prep_seconds))::int AS p50,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.prep_seconds))::int AS p95,
           AVG(t.prep_seconds)::float AS mean
         FROM kds_tickets t
         JOIN kds_stations ks ON ks.id = t.station_id
         ${whereSql}
         GROUP BY ks.id, ks.name, ks.target_prep_seconds
         ORDER BY ks.name`,
        params
      );

      // By-category breakdown — kds_tickets → kds_ticket_items → draft_order_items
      // → products → categories. Left join guards rows with no product/category.
      const { rows: byCategory } = await deps.db.query(
        `SELECT
           c.id AS category_id,
           COALESCE(c.name, '(uncategorized)') AS category_name,
           COUNT(*)::int AS count,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.prep_seconds))::int AS p50,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.prep_seconds))::int AS p95,
           AVG(t.prep_seconds)::float AS mean
         FROM kds_tickets t
         JOIN kds_stations ks ON ks.id = t.station_id
         JOIN kds_ticket_items kti ON kti.ticket_id = t.id
         JOIN draft_order_items doi ON doi.id = kti.draft_order_item_id
         LEFT JOIN products p ON p.id = doi.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         ${whereSql}
         GROUP BY c.id, c.name
         ORDER BY count DESC NULLS LAST`,
        params
      );

      // Recent load snapshots — same date range, trend-line fodder.
      const snapshotParts = [];
      const snapshotParams = [];
      if (fromUtc) { snapshotParams.push(fromUtc); snapshotParts.push(`s.recorded_at >= $${snapshotParams.length}`); }
      if (toUtc)   { snapshotParams.push(toUtc);   snapshotParts.push(`s.recorded_at < $${snapshotParams.length}`); }
      if (station_id) { snapshotParams.push(Number(station_id)); snapshotParts.push(`s.station_id = $${snapshotParams.length}`); }
      if (outlet_id)  { snapshotParams.push(Number(outlet_id));  snapshotParts.push(`ks.outlet_id = $${snapshotParams.length}`); }
      const snapshotWhere = snapshotParts.length ? `WHERE ${snapshotParts.join(" AND ")}` : "";

      const { rows: snapshots } = await deps.db.query(
        `SELECT s.id, s.station_id, s.recorded_at, s.open_tickets, s.avg_prep_seconds, ks.name AS station_name
         FROM kds_station_load_snapshots s
         JOIN kds_stations ks ON ks.id = s.station_id
         ${snapshotWhere}
         ORDER BY s.recorded_at ASC
         LIMIT 500`,
        snapshotParams
      );

      res.json({
        stations,
        by_category: byCategory,
        snapshots,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
