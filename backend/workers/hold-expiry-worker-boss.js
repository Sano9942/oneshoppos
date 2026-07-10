/**
 * 2-G.9 Hold expiry worker — pg-boss implementation.
 *
 * Runs every hour: for each active tenant, flip active holds past their
 * hold_until to status='forfeit' and release their inventory_reservations.
 *
 * Heartbeat: global.__holdExpiryWorkerStatus
 */

const { withTenantContext } = require("./tenant-job-context");

async function sweepTenant(db, logger, tenantSlug) {
  // Feature-flag gate — no-op for tenants with the Holds & Layaway module
  // off (Business Modules rule: module off freezes holds in place instead of
  // forfeiting them; re-enable resumes expiry). Pattern: abc-worker-boss.js.
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'phase2g_holds'`
  );
  if (!flagRows[0]?.enabled) return 0;

  const { rows: due } = await db.query(
    `SELECT id FROM holds
       WHERE status = 'active' AND hold_until IS NOT NULL AND hold_until < NOW()
       FOR UPDATE SKIP LOCKED`,
  );
  let flipped = 0;
  for (const row of due) {
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE inventory_reservations SET status = 'released', updated_at = NOW()
         WHERE reservation_key LIKE $1 AND status = 'active'`,
        [`hold:${row.id}:%`],
      );
      await client.query(
        "UPDATE holds SET status = 'forfeit', updated_at = NOW() WHERE id = $1",
        [row.id],
      );
    });
    flipped += 1;
  }
  if (flipped > 0) logger.info({ tenantSlug, flipped }, "Expired holds swept");
  return flipped;
}

async function registerHoldExpiryWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "hold-expiry-worker" });

  global.__holdExpiryWorkerStatus = global.__holdExpiryWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("hold-expiry-sweep");
  await boss.schedule("hold-expiry-sweep", "0 * * * *", null, {
    singletonKey: "hold-expiry-sweep",
  });

  await boss.work("hold-expiry-sweep", async () => {
    logger.info("Running hold expiry sweep");
    global.__holdExpiryWorkerStatus.lastPollAt = Date.now();
    let totalFlipped = 0;
    try {
      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'",
        );
        for (const t of tenants) {
          try {
            await withTenantContext(pool, t.slug, async (db) => {
              totalFlipped += await sweepTenant(db, logger, t.slug);
            });
          } catch (err) {
            // 'does not exist' = tenant provisioned before v71; skip silently
            if (err && /does not exist/.test(String(err.message))) continue;
            logger.error({ err, tenantSlug: t.slug }, "Hold expiry sweep failed for tenant");
          }
        }
      } else {
        const db = {
          query: (text, params) => pool.query(text, params),
          transaction: async (fn) => {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              const out = await fn(client);
              await client.query("COMMIT");
              return out;
            } catch (e) {
              await client.query("ROLLBACK");
              throw e;
            } finally {
              client.release();
            }
          },
        };
        totalFlipped = await sweepTenant(db, logger, "single");
      }
      global.__holdExpiryWorkerStatus.processedToday += totalFlipped;
      logger.info({ flipped: totalFlipped }, "Hold expiry sweep complete");
    } catch (err) {
      logger.error({ err }, "Hold expiry sweep error");
      throw err;
    }
  });

  logger.info("Hold expiry worker (pg-boss) registered — hourly");
}

module.exports = { registerHoldExpiryWorker, sweepTenant };
