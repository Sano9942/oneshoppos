/**
 * ABC worker — pg-boss implementation.
 *
 * Nightly at 02:00 UTC (07:00 Asia/Karachi): for each active tenant with
 * phase2g_inventory_intelligence flag on, aggregates sales + GRN + current
 * inventory over a configurable window (abc_window_days on company_profile,
 * default 90) and upserts per-product metrics into product_abc_class.
 *
 * The actual per-tenant rollup lives in runAbcWorkerForDb(), which takes a
 * scoped db proxy (same shape as deps.db in routes) so it is directly
 * testable against an isolated schema without pg-boss or tenant context.
 */

const {
  assignAbcRanks,
  computeVelocity,
  computeGmroi,
} = require("../services/inventory-intelligence");

global.__abcWorkerStatus = global.__abcWorkerStatus || {
  lastPollAt: null,
  processedToday: 0,
  queueDepth: 0,
};

/**
 * Run one rollup against a scoped db (test schema or tenant schema).
 * The db proxy must expose query(sql, params). No transaction is required —
 * individual upserts are idempotent via ON CONFLICT.
 *
 * @param {object} opts
 * @param {{query: Function}} opts.db — scoped tenant db
 * @param {number} [opts.windowDays] — override the company_profile default
 * @returns {Promise<number>} — number of rows upserted (0 when flag off or no sales)
 */
async function runAbcWorkerForDb({ db, windowDays }) {
  // 1. Feature-flag gate — no-op if the tenant hasn't opted in. Matches the
  //    design doc: "Worker skips tenants with flag OFF to keep DB clean."
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'phase2g_inventory_intelligence'`
  );
  if (!flagRows[0]?.enabled) return 0;

  // 2. Resolve window — caller override wins, then tenant setting on
  //    company_profile, then hardcoded 90d.
  let resolvedWindow = Number(windowDays);
  if (!Number.isFinite(resolvedWindow) || resolvedWindow <= 0) {
    const { rows: cfgRows } = await db.query(
      `SELECT abc_window_days FROM company_profile LIMIT 1`
    );
    resolvedWindow = Number(cfgRows[0]?.abc_window_days) || 90;
  }

  // 3. Revenue / margin / units_sold aggregation over window.
  const { rows: salesAgg } = await db.query(
    `SELECT si.product_id,
            si.variant_id,
            SUM(si.quantity * si.price_at_sale) AS revenue,
            SUM(si.quantity * (si.price_at_sale - COALESCE(si.cost_price_at_sale, 0))) AS margin,
            SUM(si.quantity) AS units_sold,
            MAX(s.timestamp) AS last_sale_at
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
      WHERE s.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
        AND (s.voided IS NULL OR s.voided = false)
      GROUP BY si.product_id, si.variant_id`,
    [resolvedWindow]
  );

  if (salesAgg.length === 0) return 0;

  // 4. Trailing 30d velocity — always 30 days regardless of ABC window so
  //    the reorder formula stays calibrated.
  const { rows: velocityAgg } = await db.query(
    `SELECT si.product_id, SUM(si.quantity) AS units_30d
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
      WHERE s.timestamp >= NOW() - INTERVAL '30 days'
        AND (s.voided IS NULL OR s.voided = false)
      GROUP BY si.product_id`
  );
  const velocityByProduct = Object.fromEntries(
    velocityAgg.map((r) => [r.product_id, Number(r.units_30d) || 0])
  );

  // 5. GRN receipts over window (per-product; variant_id not yet tracked on grn_items).
  const { rows: grnAgg } = await db.query(
    `SELECT gi.product_id, SUM(gi.qty_received) AS units_received
       FROM grn_items gi
       JOIN goods_received_notes grn ON grn.id = gi.grn_id
      WHERE grn.received_at >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY gi.product_id`,
    [resolvedWindow]
  );
  const receivedByProduct = Object.fromEntries(
    grnAgg.map((r) => [r.product_id, Number(r.units_received) || 0])
  );

  // 6. Current inventory value snapshot. Using current outlet_stock × cost_price
  //    as the avg_inventory_value proxy (per design acceptance: "current snapshot,
  //    not historical avg"). Summed across outlets.
  const { rows: invAgg } = await db.query(
    `SELECT p.id AS product_id,
            COALESCE(SUM(os.quantity * p.cost_price), 0) AS avg_inventory_value
       FROM products p
       LEFT JOIN outlet_stock os ON os.product_id = p.id
      GROUP BY p.id, p.cost_price`
  );
  const invByProduct = Object.fromEntries(
    invAgg.map((r) => [r.product_id, Number(r.avg_inventory_value) || 0])
  );

  // 7. Rank in memory via pure function.
  const ranked = assignAbcRanks(
    salesAgg.map((r) => ({
      product_id: r.product_id,
      variant_id: r.variant_id,
      revenue: Number(r.revenue) || 0,
      margin: Number(r.margin) || 0,
      units_sold: Number(r.units_sold) || 0,
      last_sale_at: r.last_sale_at,
    }))
  );

  // 8. Upsert per-product row. ON CONFLICT uses the partial unique index on
  //    (product_id, COALESCE(variant_id, 0)) so NULL variant_id rows are
  //    distinct-safe and re-running the worker updates in place.
  let upserted = 0;
  for (const row of ranked) {
    const unitsReceived = receivedByProduct[row.product_id] || 0;
    const unitsSold = row.units_sold;
    const sellThrough = unitsReceived > 0 ? unitsSold / unitsReceived : null;
    const avgInv = invByProduct[row.product_id] || 0;
    const gmroi = computeGmroi(row.margin, sellThrough || 0, avgInv);
    const velocity = computeVelocity(velocityByProduct[row.product_id] || 0);
    const daysSince = row.last_sale_at
      ? Math.floor((Date.now() - new Date(row.last_sale_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    await db.query(
      `INSERT INTO product_abc_class
         (product_id, variant_id, rank, revenue_contribution_pct, units_sold, units_received,
          sell_through_rate, gross_margin, avg_inventory_value, gmroi, daily_velocity,
          days_since_last_sale, window_days, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (product_id, COALESCE(variant_id, 0))
       DO UPDATE SET
         rank = EXCLUDED.rank,
         revenue_contribution_pct = EXCLUDED.revenue_contribution_pct,
         units_sold = EXCLUDED.units_sold,
         units_received = EXCLUDED.units_received,
         sell_through_rate = EXCLUDED.sell_through_rate,
         gross_margin = EXCLUDED.gross_margin,
         avg_inventory_value = EXCLUDED.avg_inventory_value,
         gmroi = EXCLUDED.gmroi,
         daily_velocity = EXCLUDED.daily_velocity,
         days_since_last_sale = EXCLUDED.days_since_last_sale,
         window_days = EXCLUDED.window_days,
         computed_at = NOW()`,
      [
        row.product_id,
        row.variant_id,
        row.rank,
        row.revenue_contribution_pct,
        unitsSold,
        unitsReceived,
        sellThrough,
        row.margin,
        avgInv,
        gmroi,
        velocity,
        daysSince,
        resolvedWindow,
      ]
    );
    upserted += 1;
  }

  return upserted;
}

async function registerAbcWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "abc-worker" });

  await boss.createQueue("abc-daily");
  await boss.schedule("abc-daily", "0 2 * * *");

  await boss.work("abc-daily", async () => {
    logger.info("Running nightly ABC rollup");
    global.__abcWorkerStatus.lastPollAt = Date.now();
    let totalUpserted = 0;

    try {
      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const n = await runAbcWorkerForDb({ db: tenantDb });
            totalUpserted += n;
          } catch (err) {
            logger.error(
              { err, tenantSlug: tenant.slug },
              "ABC rollup failed for tenant"
            );
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalUpserted = await runAbcWorkerForDb({ db });
      }

      global.__abcWorkerStatus.processedToday += totalUpserted;
      logger.info({ upserted: totalUpserted }, "ABC rollup complete");
    } catch (err) {
      logger.error({ err }, "ABC rollup error");
      throw err;
    }
  });

  logger.info("ABC worker (pg-boss) registered — daily 02:00 UTC");
}

module.exports = { registerAbcWorker, runAbcWorkerForDb };
