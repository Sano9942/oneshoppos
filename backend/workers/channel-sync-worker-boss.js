"use strict";

/**
 * Channel sync worker (V10) — two queues:
 *
 *  - `channel-sync-poll` (every 10 min): polls each tenant's active import
 *    iCal feeds (OTA calendars) via services/room-channel-sync.js. Conflicts
 *    dead-letter + notify; a failed feed stamps last_status='error' and the
 *    sweep moves on.
 *  - `room-reservation-expiry` (every 10 min): cancels unpaid public
 *    reservations past their TTL (room-service.expireStaleRoomReservations).
 *    Availability already ignores them the moment the TTL lapses — this
 *    formalizes the cancel + frees the room row.
 *
 * Tenants are skipped cheaply when the room_channel_feeds table doesn't
 * exist yet (pre-v119) or the tenant has no feeds.
 */

async function registerChannelSyncWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "channel-sync-worker" });
  const channelSync = require("../services/room-channel-sync");
  const roomService = require("../services/room-service");
  const { enqueueEmail } = require("../services/email");
  const { withTenantContext } = require("./tenant-job-context");

  global.__channelSyncWorkerStatus = global.__channelSyncWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  const forEachTenant = async (fn) => {
    if (String(process.env.MULTI_TENANT || "0") === "1") {
      const masterDb = require("../master-db-pg");
      const { rows: tenants } = await masterDb.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active'"
      );
      for (const tenant of tenants) {
        try {
          await withTenantContext(pool, tenant.slug, (db) => fn(db, tenant));
        } catch (err) {
          if (!String(err.message || "").includes("does not exist")) {
            logger.error({ err, tenantSlug: tenant.slug }, "channel-sync tenant sweep failed");
          }
        }
      }
    } else {
      const db = {
        query: (text, params) => pool.query(text, params),
        transaction: async (fn2) => {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const out = await fn2(client);
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
      try {
        await fn(db, { slug: "single", name: null });
      } catch (err) {
        if (!String(err.message || "").includes("does not exist")) {
          logger.error({ err }, "channel-sync single-tenant sweep failed");
        }
      }
    }
  };

  await boss.createQueue("channel-sync-poll");
  await boss.schedule("channel-sync-poll", "*/10 * * * *", null, {
    singletonKey: "channel-sync-poll",
  });
  await boss.work("channel-sync-poll", async () => {
    global.__channelSyncWorkerStatus.lastPollAt = Date.now();
    let synced = 0;
    await forEachTenant(async (db, tenant) => {
      // Feature-flag gate — no-op for tenants with the Room Channel Sync
      // card off (Business Modules rule). Pattern: abc-worker-boss.js.
      const { rows: flagRows } = await db.query(
        `SELECT enabled FROM feature_flags WHERE key = 'room_channel_sync'`
      );
      if (!flagRows[0]?.enabled) return;
      const { rows: feeds } = await db.query(
        "SELECT 1 FROM room_channel_feeds WHERE direction = 'import' AND is_active = TRUE LIMIT 1"
      );
      if (!feeds.length) return;
      let staffEmail = null;
      let storeName = tenant.name || tenant.slug;
      try {
        const { rows: [cp] } = await db.query("SELECT store_name, email FROM company_profile LIMIT 1");
        if (cp?.email) staffEmail = cp.email;
        if (cp?.store_name) storeName = cp.store_name;
      } catch { /* optional */ }
      const results = await channelSync.syncAllImportFeeds(db, {
        enqueueEmail,
        staffEmail,
        storeName,
        tenantSlug: tenant.slug,
        tenant: { slug: tenant.slug, name: storeName },
      });
      synced += results.length;
      const conflicts = results.reduce((s, r) => s + (r.conflicts || 0), 0);
      if (conflicts) {
        logger.warn({ tenantSlug: tenant.slug, conflicts }, "channel sync found conflicts");
      }
    });
    global.__channelSyncWorkerStatus.processedToday += synced;
  });

  await boss.createQueue("room-reservation-expiry");
  await boss.schedule("room-reservation-expiry", "*/10 * * * *", null, {
    singletonKey: "room-reservation-expiry",
  });
  await boss.work("room-reservation-expiry", async () => {
    global.__channelSyncWorkerStatus.lastPollAt = Date.now();
    await forEachTenant(async (db, tenant) => {
      // Gate on the Rooms module (this queue formalizes public-reservation
      // expiry, a rooms surface — not channel-sync-specific).
      const { rows: flagRows } = await db.query(
        `SELECT enabled FROM feature_flags WHERE key = 'phase4_room_management'`
      );
      if (!flagRows[0]?.enabled) return;
      const expired = await roomService.expireStaleRoomReservations(db);
      if (expired.length) {
        logger.info({ tenantSlug: tenant.slug, expired: expired.length }, "expired stale room reservations");
        global.__channelSyncWorkerStatus.processedToday += expired.length;
      }
    });
  });

  logger.info("Channel sync worker (pg-boss) registered — 10-min cadence");
}

module.exports = { registerChannelSyncWorker };
