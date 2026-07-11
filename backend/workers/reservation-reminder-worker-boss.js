/**
 * Reservation reminder worker — pg-boss implementation.
 *
 * Runs every 15 minutes: for each active tenant, finds confirmed
 * reservations starting in the [2h-10m, 2h+10m] window that have not
 * yet had a reminder SMS sent, and dispatches one via services/sms.
 * sendSms() is a no-op when the tenant has no SMS provider — the
 * worker treats that as success (sms_reminder_sent_at gets stamped
 * so we don't retry indefinitely).
 *
 * Env toggle: RESERVATION_REMINDER_WORKER_ENABLED=1.
 */

const smsService = require("../services/sms");
const logger = require("../services/logger").child({ component: "reservation-reminder-worker" });

// Exported so tests can drive the tenant-scoped handler without pg-boss.
async function runOnce(db) {
  // Feature-flag gate — no-op for tenants with the Restaurant module's
  // reservations flag off (Business Modules rule). Pattern: abc-worker-boss.js.
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'phase4_restaurant_reservations'`
  );
  if (!flagRows[0]?.enabled) return { sent: 0, considered: 0 };

  // 2h ± 10min window. Narrow enough that 15-min cadence never misses a
  // reservation and wide enough to tolerate a cron skip.
  const { rows } = await db.query(`
    SELECT r.id, r.customer_name, r.phone, r.party_size, r.reservation_start,
           cp.company_name
    FROM reservations r
    LEFT JOIN company_profile cp ON true
    WHERE r.status = 'confirmed'
      AND r.phone IS NOT NULL
      AND r.phone <> ''
      AND r.sms_reminder_sent_at IS NULL
      AND r.reservation_start BETWEEN NOW() + INTERVAL '1 hour 50 minutes'
                                  AND NOW() + INTERVAL '2 hours 10 minutes'
    LIMIT 200
  `);

  let sent = 0;
  for (const r of rows) {
    const when = new Date(r.reservation_start).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    const store = r.company_name || "our restaurant";
    const body = `Reminder: your reservation for ${r.party_size} at ${store} is at ${when}. Reply CANCEL if you can't make it.`;

    try {
      await smsService.sendSms(db, { to: r.phone, body, type: "transactional" });
    } catch (smsErr) {
      logger.warn({ err: smsErr, reservationId: r.id }, "Reminder SMS failed");
      // Don't stamp — the next 15-min tick retries within the 2h window.
      continue;
    }
    await db.query(
      `UPDATE reservations SET sms_reminder_sent_at = NOW() WHERE id = $1`,
      [r.id]
    );
    sent++;
  }
  return { sent, considered: rows.length };
}

async function registerReservationReminderWorker(boss, pool) {
  global.__reservationReminderWorkerStatus = global.__reservationReminderWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("reservation-reminder-check");
  // Every 15 minutes.
  await boss.schedule("reservation-reminder-check", "*/15 * * * *");

  await boss.work("reservation-reminder-check", async () => {
    logger.info("Running reservation reminder check");
    try {
      global.__reservationReminderWorkerStatus.lastPollAt = Date.now();
      let totalSent = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const { sent } = await runOnce(tenantDb);
            totalSent += sent;
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Reservation reminder failed for tenant");
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        const { sent } = await runOnce(db);
        totalSent = sent;
      }

      global.__reservationReminderWorkerStatus.processedToday += totalSent;
      logger.info({ sent: totalSent }, "Reservation reminder check complete");
    } catch (err) {
      logger.error({ err }, "Reservation reminder worker error");
      throw err;
    }
  });

  logger.info("Reservation reminder worker (pg-boss) registered — every 15 min");
}

module.exports = { registerReservationReminderWorker, runOnce };
