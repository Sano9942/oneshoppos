/**
 * Room overdue-checkout worker — pg-boss implementation.
 *
 * Daily cron at 11 AM: for each active tenant, finds room bookings still
 * checked-in past their check_out_date, emails staff an alert, and records
 * the alert so it doesn't re-fire within 24h. Mirrors the rental-overdue
 * worker pattern (workers/rental-overdue-worker-boss.js).
 */

async function registerRoomOverdueCheckoutWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "room-overdue-worker" });
  const roomService = require("../services/room-service");
  const { enqueueEmail } = require("../services/email");

  global.__roomOverdueWorkerStatus = global.__roomOverdueWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("room-overdue-check");
  await boss.schedule("room-overdue-check", "0 11 * * *");

  await boss.work("room-overdue-check", async () => {
    logger.info("Running room overdue-checkout check");
    try {
      global.__roomOverdueWorkerStatus.lastPollAt = Date.now();
      let totalNotified = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const count = await checkOverdueForTenant(
              tenantDb,
              logger,
              tenant.slug,
              tenant.name,
              enqueueEmail,
              roomService
            );
            totalNotified += count;
          } catch (err) {
            // Table missing for tenants pre-v38 is expected — only log actual errors.
            if (!String(err.message || "").includes("does not exist")) {
              logger.error({ err, tenantSlug: tenant.slug }, "Room overdue check failed for tenant");
            }
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalNotified = await checkOverdueForTenant(
          db, logger, "single", null, enqueueEmail, roomService
        );
      }

      global.__roomOverdueWorkerStatus.processedToday += totalNotified;
      logger.info({ notified: totalNotified }, "Room overdue-checkout check complete");
    } catch (err) {
      logger.error({ err }, "Room overdue-checkout check error");
      throw err;
    }
  });

  logger.info("Room overdue-checkout worker (pg-boss) registered — daily 11 AM");
}

async function checkOverdueForTenant(db, logger, tenantSlug, tenantName, enqueueEmail, roomService) {
  let count = 0;

  // Feature-flag gate — no-op for tenants with the Rooms & Lodging module
  // off (Business Modules rule). Pattern: abc-worker-boss.js.
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'phase4_room_management'`
  );
  if (!flagRows[0]?.enabled) return 0;

  let storeName = tenantName || tenantSlug;
  let staffEmail = null;
  try {
    const { rows } = await db.query(
      "SELECT store_name, email FROM company_profile LIMIT 1"
    );
    if (rows[0]?.store_name) storeName = rows[0].store_name;
    if (rows[0]?.email) staffEmail = rows[0].email;
  } catch { /* ignore */ }

  const overdue = await roomService.getOverdueCheckouts(db);

  for (const booking of overdue) {
    const expected = booking.check_out_date ? new Date(booking.check_out_date) : null;
    const daysOverdue = expected
      ? Math.max(1, Math.ceil((Date.now() - expected.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;

    // Alert recipient: staff inbox (company_profile.email). Guest email too if present.
    const recipients = [];
    if (staffEmail) recipients.push(staffEmail);
    if (booking.customer_email) recipients.push(booking.customer_email);

    for (const to of recipients) {
      try {
        await enqueueEmail(db, {
          to,
          template: "room_overdue_checkout",
          data: {
            storeName,
            guestName: booking.customer_name || "Guest",
            bookingNumber: booking.booking_number,
            roomNumber: booking.room_number || "—",
            checkOutDate: booking.check_out_date,
            daysOverdue,
          },
        });
      } catch (err) {
        logger.error({ err, bookingId: booking.id }, "Failed to enqueue room-overdue email");
      }
    }

    await roomService.markOverdueEmailSent(db, booking.id);
    count++;
    logger.info({ tenantSlug, bookingId: booking.id, daysOverdue }, "Room overdue-checkout alert sent");
  }

  return count;
}

module.exports = { registerRoomOverdueCheckoutWorker };
