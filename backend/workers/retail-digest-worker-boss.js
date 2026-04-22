/**
 * Retail weekly digest worker — pg-boss implementation (2-G.16).
 *
 * Weekly (Monday 08:00 UTC): for each active tenant with `retail_weekly_digest`
 * flag on, compiles last-7-day summary data and enqueues a digest email to
 * the company contact. Reuses existing `buildDigestEmailHtml()` + `enqueueEmail`.
 *
 * Idempotency: checked via `email_queue.email_type = 'retail_weekly_digest'`
 * within the last 6 days — prevents duplicate emails if the cron fires twice
 * in the same week (cluster restart, catch-up job, etc.).
 *
 * The rollup lives in `runRetailDigestForDb()` which takes a scoped db proxy
 * so it's testable against an isolated schema without pg-boss.
 */

global.__retailDigestWorkerStatus = global.__retailDigestWorkerStatus || {
  lastPollAt: null,
  processedToday: 0,
  queueDepth: 0,
};

/**
 * Run one digest rollup against a scoped db (test schema or tenant schema).
 * Returns { skipped: bool, reason?: string, recipient?: string }.
 *
 * @param {object} opts
 * @param {{query: Function}} opts.db
 * @param {number|null} [opts.tenantId]
 * @param {object} [opts.tenant] — { id, slug, name } — passed to enqueueEmail
 * @param {boolean} [opts.force] — skip the idempotency + flag check (for tests)
 */
async function runRetailDigestForDb({ db, tenantId = null, tenant = null, force = false }) {
  // 1. Feature-flag gate.
  if (!force) {
    const { rows: flagRows } = await db.query(
      `SELECT enabled FROM feature_flags WHERE key = 'retail_weekly_digest'`,
    );
    if (!flagRows[0]?.enabled) return { skipped: true, reason: "flag_off" };
  }

  // 2. Resolve recipient — company_profile.email, fall back to first admin.
  const { rows: cpRows } = await db.query(
    `SELECT company_name, email, currency_symbol, currency_code, timezone
       FROM company_profile WHERE id = 1`,
  );
  const companyName = cpRows[0]?.company_name || "SanoPOS";
  let recipient = cpRows[0]?.email || null;
  if (!recipient) {
    const { rows: adminRows } = await db.query(
      `SELECT email FROM employees
        WHERE email IS NOT NULL AND deleted_at IS NULL
        ORDER BY id ASC LIMIT 1`,
    );
    recipient = adminRows[0]?.email || null;
  }
  if (!recipient) return { skipped: true, reason: "no_recipient" };

  // 3. Idempotency — don't re-send if the same tenant was queued within 6
  //    days. Scoped by tenant_id when available; falls back to recipient
  //    match for single-tenant installs.
  if (!force) {
    const { rows: dup } = await db.query(
      `SELECT 1 FROM email_queue
         WHERE email_type = 'retail_weekly_digest'
           AND ($1::int IS NULL OR tenant_id = $1)
           AND to_email = $2
           AND created_at >= NOW() - INTERVAL '6 days'
         LIMIT 1`,
      [tenantId, recipient],
    ).catch(() => ({ rows: [] })); // email_queue may not exist in tests
    if (dup.length) return { skipped: true, reason: "recent_duplicate", recipient };
  }

  // 4. Aggregate last-7-day headline metrics. Keep the query list small —
  //    the digest email only renders totals + top products + low-stock.
  const { rows: totalsRows } = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS revenue,
            COUNT(*)::int AS sale_count
       FROM sales
      WHERE timestamp >= NOW() - INTERVAL '7 days'
        AND COALESCE(voided, false) = false`,
  );
  const revenue = Number(totalsRows[0]?.revenue || 0);
  const saleCount = Number(totalsRows[0]?.sale_count || 0);

  const { rows: zRows } = await db.query(
    `SELECT payment_method AS method,
            COUNT(*)::int  AS count,
            COALESCE(SUM(total_amount), 0) AS total
       FROM sales
      WHERE timestamp >= NOW() - INTERVAL '7 days'
        AND COALESCE(voided, false) = false
      GROUP BY payment_method
      ORDER BY total DESC`,
  );

  const { rows: topSelling } = await db.query(
    `SELECT p.name,
            SUM(si.quantity)::int AS units,
            COALESCE(SUM(si.quantity * si.price_at_sale), 0) AS revenue
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
      WHERE s.timestamp >= NOW() - INTERVAL '7 days'
        AND COALESCE(s.voided, false) = false
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 5`,
  );

  const { rows: lowStock } = await db.query(
    `SELECT p.name,
            COALESCE(SUM(os.quantity), 0)::int AS stock,
            COALESCE(p.min_stock, 0)::int AS min_stock
       FROM products p
       LEFT JOIN outlet_stock os ON os.product_id = p.id
      GROUP BY p.id, p.name, p.min_stock
     HAVING COALESCE(SUM(os.quantity), 0) <= COALESCE(p.min_stock, 0)
      ORDER BY stock ASC
      LIMIT 8`,
  ).catch(() => ({ rows: [] })); // min_stock column may not exist on older schemas

  // 5. Enqueue via the shared email service. enqueueEmail ignores the db
  //    arg (it always writes to public pg-boss), which is fine here —
  //    idempotency already ran above.
  const dateStr = new Date().toISOString().slice(0, 10);
  const digestData = {
    currency: { symbol: cpRows[0]?.currency_symbol || "Rs", code: cpRows[0]?.currency_code || "PKR" },
    totalRevenueToday: revenue,
    saleCount,
    zReport: zRows.map((r) => ({ ...r, total: Number(r.total) })),
    topSelling: topSelling.map((r) => ({ ...r, revenue: Number(r.revenue) })),
    lowStock,
  };

  try {
    const { enqueueEmail } = require("../services/email");
    await enqueueEmail(db, {
      tenantId,
      type: "retail_weekly_digest",
      to: recipient,
      tenant,
      data: { companyName, dateStr, data: digestData },
    });
  } catch (err) {
    return { skipped: true, reason: "enqueue_failed", error: err.message, recipient };
  }

  return { skipped: false, recipient, revenue, saleCount };
}

async function registerRetailDigestWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "retail-digest-worker" });

  await boss.createQueue("retail-weekly-digest");
  // Monday 08:00 UTC — well inside the cache-warm window before most tenants
  // open. Tenants in later timezones still get it in the morning.
  await boss.schedule("retail-weekly-digest", "0 8 * * 1");

  await boss.work("retail-weekly-digest", async () => {
    logger.info("Running weekly retail digest");
    global.__retailDigestWorkerStatus.lastPollAt = Date.now();
    let enqueued = 0;

    try {
      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'",
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const result = await runRetailDigestForDb({
              db: tenantDb,
              tenantId: tenant.id,
              tenant,
            });
            if (!result.skipped) enqueued += 1;
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Retail digest failed for tenant");
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        const result = await runRetailDigestForDb({ db });
        if (!result.skipped) enqueued += 1;
      }

      global.__retailDigestWorkerStatus.processedToday += enqueued;
      logger.info({ enqueued }, "Retail digest run complete");
    } catch (err) {
      logger.error({ err }, "Retail digest run error");
      throw err;
    }
  });

  logger.info("Retail digest worker (pg-boss) registered — weekly Monday 08:00 UTC");
}

module.exports = { registerRetailDigestWorker, runRetailDigestForDb };
