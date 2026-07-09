/**
 * 2-G.17 Anomaly worker — pg-boss implementation.
 *
 * Nightly at 02:30 UTC (staggered 30min after ABC): for each active tenant
 * with phase2g_risk_controls flag on, compute per-employee void / refund /
 * discount rates over the trailing 30 days, compare each to the outlet peer
 * mean + stddev, and upsert a retail_anomaly_flags row when z-score crosses
 * the tenant-configured threshold (default 2.0).
 *
 * The actual per-tenant rollup lives in runAnomalyWorkerForDb(), which takes
 * a scoped db proxy (same shape as deps.db in routes) so it is directly
 * testable against an isolated schema without pg-boss or tenant context.
 *
 * Early-outlet guard: employees in outlets with fewer than 3 active peers
 * over the period are skipped (stddev is unstable on tiny samples and would
 * false-positive every new tenant).
 */

global.__anomalyWorkerStatus = global.__anomalyWorkerStatus || {
  lastPollAt: null,
  processedToday: 0,
  queueDepth: 0,
};

const MIN_PEERS = 3;
const WINDOW_DAYS = 30;
const METRICS = ["voids_pct", "refunds_pct", "discounts_pct"];

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values, m) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Run one rollup against a scoped db (test schema or tenant schema).
 *
 * @param {object} opts
 * @param {{query: Function}} opts.db — scoped tenant db
 * @param {number} [opts.windowDays] — override the default 30d window
 * @returns {Promise<number>} — number of flags upserted
 */
async function runAnomalyWorkerForDb({ db, windowDays = WINDOW_DAYS } = {}) {
  // 1. Feature-flag gate
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'phase2g_risk_controls'`,
  );
  if (!flagRows[0]?.enabled) return 0;

  // 2. Resolve z-score threshold
  const { rows: cfgRows } = await db.query(
    `SELECT anomaly_z_score_threshold FROM risk_controls_config WHERE id = 1`,
  );
  const zThreshold = Number(cfgRows[0]?.anomaly_z_score_threshold || 2.0);

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - windowDays * 86400 * 1000);
  const periodStartDate = periodStart.toISOString().slice(0, 10);
  const periodEndDate = periodEnd.toISOString().slice(0, 10);

  // 3. Per-employee, per-outlet aggregates over the window.
  //    Counts everything non-voided as "sales" and voided as "voids" from
  //    the same table. Discount % uses SUM(discount_amount) / SUM(total_amount).
  const { rows: saleAgg } = await db.query(
    `SELECT s.employee_id,
            s.outlet_id,
            COUNT(*)::int AS total_sales,
            COUNT(*) FILTER (WHERE s.voided = true)::int AS void_count,
            COALESCE(SUM(s.total_amount), 0)::numeric AS gross_total,
            COALESCE(SUM(s.discount_amount), 0)::numeric AS discount_total
       FROM sales s
      WHERE s.timestamp >= $1::timestamptz
        AND s.employee_id IS NOT NULL
        AND s.outlet_id IS NOT NULL
      GROUP BY s.employee_id, s.outlet_id`,
    // ::timestamptz (not ::timestamp) — casting an ISO-Z string to bare
    // timestamp DROPS the Z, then the comparison re-reads it in the DB
    // session TZ (UTC prod / local dev diverge by the session offset).
    [periodStart.toISOString()],
  );
  if (!saleAgg.length) return 0;

  // 4. Refund counts per employee+outlet from the returns table.
  const { rows: refundAgg } = await db.query(
    `SELECT r.employee_id,
            r.outlet_id,
            COUNT(*)::int AS refund_count
       FROM returns r
      WHERE r.timestamp >= $1::timestamptz
        AND r.employee_id IS NOT NULL
        AND r.outlet_id IS NOT NULL
      GROUP BY r.employee_id, r.outlet_id`,
    [periodStart.toISOString()],
  );
  const refundMap = new Map();
  for (const row of refundAgg) {
    refundMap.set(`${row.employee_id}:${row.outlet_id}`, Number(row.refund_count));
  }

  // 5. Compute per-employee rates.
  const rowsByOutlet = new Map();
  for (const row of saleAgg) {
    const totalSales = Number(row.total_sales) || 0;
    if (totalSales === 0) continue;
    const voidCount = Number(row.void_count) || 0;
    const gross = Number(row.gross_total) || 0;
    const disc = Number(row.discount_total) || 0;
    const refunds = refundMap.get(`${row.employee_id}:${row.outlet_id}`) || 0;

    const rates = {
      voids_pct: voidCount / totalSales,
      refunds_pct: refunds / totalSales,
      discounts_pct: gross > 0 ? disc / gross : 0,
    };

    if (!rowsByOutlet.has(row.outlet_id)) rowsByOutlet.set(row.outlet_id, []);
    rowsByOutlet.get(row.outlet_id).push({
      employee_id: row.employee_id,
      outlet_id: row.outlet_id,
      rates,
    });
  }

  // 6. Per-outlet peer comparison + flag upsert.
  let upserted = 0;
  for (const [outletId, peers] of rowsByOutlet.entries()) {
    if (peers.length < MIN_PEERS) continue; // skip tiny outlets

    for (const metric of METRICS) {
      const values = peers.map((p) => p.rates[metric]);
      const m = mean(values);
      const sd = stddev(values, m);
      if (sd === 0) continue; // no variance — skip

      for (const peer of peers) {
        const v = peer.rates[metric];
        const z = (v - m) / sd;
        if (z <= zThreshold) continue;

        await db.query(
          `INSERT INTO retail_anomaly_flags
             (employee_id, outlet_id, metric, value, peer_mean, peer_stddev,
              z_score, period_start, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (employee_id, metric, period_start, period_end)
           DO UPDATE SET
             value = EXCLUDED.value,
             peer_mean = EXCLUDED.peer_mean,
             peer_stddev = EXCLUDED.peer_stddev,
             z_score = EXCLUDED.z_score,
             outlet_id = EXCLUDED.outlet_id,
             flagged_at = NOW()`,
          [
            peer.employee_id,
            outletId,
            metric,
            Number(v.toFixed(4)),
            Number(m.toFixed(4)),
            Number(sd.toFixed(4)),
            Number(z.toFixed(2)),
            periodStartDate,
            periodEndDate,
          ],
        );
        upserted += 1;
      }
    }
  }

  return upserted;
}

async function registerAnomalyWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "anomaly-worker" });

  await boss.createQueue("anomaly-daily");
  await boss.schedule("anomaly-daily", "30 2 * * *");

  await boss.work("anomaly-daily", async () => {
    logger.info("Running nightly retail anomaly scan");
    global.__anomalyWorkerStatus.lastPollAt = Date.now();
    let totalUpserted = 0;

    try {
      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active'",
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const n = await runAnomalyWorkerForDb({ db: tenantDb });
            totalUpserted += n;
          } catch (err) {
            logger.error(
              { err, tenantSlug: tenant.slug },
              "Anomaly scan failed for tenant",
            );
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalUpserted = await runAnomalyWorkerForDb({ db });
      }

      global.__anomalyWorkerStatus.processedToday += totalUpserted;
      logger.info({ upserted: totalUpserted }, "Anomaly scan complete");
    } catch (err) {
      logger.error({ err }, "Anomaly scan error");
      throw err;
    }
  });

  logger.info("Anomaly worker (pg-boss) registered — daily 02:30 UTC");
}

module.exports = { registerAnomalyWorker, runAnomalyWorkerForDb };
