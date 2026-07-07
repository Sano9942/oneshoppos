/**
 * Admin system — worker status, orphaned schemas, backup.
 */
module.exports = function registerSystemRoutes(app, deps) {
  const { db, requireAllowedIp, requireSuperAdmin, logAdminAction } = deps;

  // ── Worker Status ──────────────────────────────────────────────────────
  //
  // W35 — heartbeat globals are in-memory only and wipe on every Railway
  // redeploy. Daily/weekly workers (rental_overdue 8am, room_overdue 11am,
  // treatment_plan 9am, abc 2am, anomaly 2:30am, cleanup 2am, retail_digest
  // Monday 8am) appear "stopped" until their next cron tick — sometimes for
  // hours after a deploy. Operators saw scary post-deploy dashboards even
  // though pg-boss + the cron schedule were healthy.
  //
  // Mitigation: also query pgboss.job MAX(completed_on) per known queue and
  // use whichever timestamp is newer (in-memory or DB). The DB reading is
  // canonical for pg-boss workers and survives deploys cleanly. Falls back
  // to the in-memory global on DB error so we never regress to "stopped"
  // when the DB lookup happens to fail.
  //
  // Maps each worker key to its pg-boss queue name (when applicable). Workers
  // without a pg-boss queue (booking_reminder uses setInterval, catalog_scheduler
  // ditto) are mapped to null and rely on the in-memory heartbeat alone.
  const PG_BOSS_QUEUES = {
    email: "email",
    fbr: "fbr-invoice",
    cleanup: "cleanup-dead-tenants",
    reservation: "expire-reservations",
    marketplace_sync: "marketplace-order-poll",
    booking_reminder: null, // setInterval
    rental_overdue: "rental-overdue-check",
    room_overdue: "room-overdue-check",
    channel_sync: "channel-sync-poll",
    night_audit: "night-audit-run",
    treatment_plan: "treatment-plan-daily-check",
    recall: "recall-outreach-check",
    course_release: "course-release-sweep",
    kds_snapshot: "kds-load-snapshot",
    reservation_reminder: "reservation-reminder-check",
    abc: "abc-daily",
    hold_expiry: "hold-expiry-sweep",
    deposit_hold_expiry: "deposit-hold-expiry-sweep",
    anomaly: "anomaly-daily",
    expiry_alert: "expiry-alert-daily",
    retail_digest: "retail-weekly-digest",
    shift_auto_close: "shift-auto-close",
    subscription_grace: "subscription-grace-check",
    subscription_dunning: "subscription-dunning-check",
    attendance_auto_close: "attendance-auto-close",
    catalog_scheduler: null, // setInterval
    orphan_schema_scan: "orphan-schema-scan",
    adoption_snapshot: "adoption-snapshot",
    shopify_sync: null, // setInterval
    report_schedule: null, // setInterval
  };

  app.get("/api/admin/worker-status", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const emailStatus = global.__emailWorkerStatus || null;
      const fbrStatus = global.__fbrWorkerStatus || null;
      const cleanupStatus = global.__cleanupWorkerStatus || null;
      // Pattern A Commit 4 — Phase 1 H2 visibility gap. The reservation,
      // marketplace-sync, and booking-reminder workers were invisible to
      // super-admin monitoring. Each worker already sets its own heartbeat
      // global; this endpoint just had to read them.
      const reservationStatus = global.__reservationWorkerStatus || null;
      const marketplaceSyncStatus = global.__marketplaceSyncWorkerStatus || null;
      const bookingReminderStatus = global.__bookingReminderWorkerStatus || null;
      const rentalOverdueStatus = global.__rentalOverdueWorkerStatus || null;
      const roomOverdueStatus = global.__roomOverdueWorkerStatus || null;
      // V10 lodging — 10-min OTA iCal sync + reservation TTL; nightly audit.
      const channelSyncStatus = global.__channelSyncWorkerStatus || null;
      const nightAuditStatus = global.__nightAuditWorkerStatus || null;
      const treatmentPlanStatus = global.__treatmentPlanWorkerStatus || null;
      // V05 clinical — daily 10 AM recall outreach sweep.
      const recallStatus = global.__recallWorkerStatus || null;
      const courseReleaseStatus = global.__courseReleaseWorkerStatus || null;
      const kdsSnapshotStatus = global.__kdsSnapshotWorkerStatus || null;
      const reservationReminderStatus = global.__reservationReminderWorkerStatus || null;
      // 2-G.8 Inventory Intelligence — nightly ABC rollup at 02:00 UTC.
      const abcStatus = global.__abcWorkerStatus || null;
      // 2-G.9 Holds — hourly expiry sweep.
      const holdExpiryStatus = global.__holdExpiryWorkerStatus || null;
      // F04 — hourly release of lapsed gateway deposit holds.
      const depositHoldExpiryStatus = global.__depositHoldExpiryWorkerStatus || null;
      // 2-G.17 Anti-theft — nightly anomaly scan at 02:30 UTC.
      const anomalyStatus = global.__anomalyWorkerStatus || null;
      // F07 batch/expiry — daily near-expiry scan at 06:00 UTC.
      const expiryAlertStatus = global.__expiryAlertWorkerStatus || null;
      // 2-G.16 Merchant home — weekly digest email (Monday 08:00 UTC).
      const retailDigestStatus = global.__retailDigestWorkerStatus || null;
      // Bucket F — hourly force-close of stale open shifts.
      const shiftAutoCloseStatus = global.__shiftAutoCloseWorkerStatus || null;
      // Customer subscription grace transitions (hourly).
      const subscriptionGraceStatus = global.__subscriptionGraceWorkerStatus || null;
      // Customer subscription dunning retries (hourly).
      const subscriptionDunningStatus = global.__subscriptionDunningWorkerStatus || null;
      // Daily 9 AM UTC sweep that auto-closes stale day-level attendance rows.
      const attendanceAutoCloseStatus = global.__attendanceAutoCloseWorkerStatus || null;
      // Scheduled catalog changes — 60s setInterval poll.
      const catalogSchedulerStatus = global.__catalogSchedulerStatus || null;
      // Hourly orphan-schema scan (default ON when pg-boss is wired).
      const orphanSchemaScanStatus = global.__orphanSchemaScanWorkerStatus || null;
      const adoptionSnapshotStatus = global.__adoptionSnapshotWorkerStatus || null;
      // Shopify inventory-event poll (30s) + report-schedule poll (60s).
      const shopifySyncStatus = global.__shopifySyncWorkerStatus || null;
      const reportScheduleStatus = global.__reportScheduleWorkerStatus || null;
      // Boot-time env-gate registry (boot/workers.js) — knows each worker's
      // env var, whether it's set, and whether registration succeeded. This
      // is what lets the panel flag "shipped but env var never set" drift.
      const registry = global.__workerRegistry || {};

      // W35: query pgboss.job once for all known queues. Returns a map of
      // queue_name → max(completed_on) timestamp in ms. Failures fall back
      // to an empty map so we never make the panel worse than before.
      const queueNames = Object.values(PG_BOSS_QUEUES).filter(Boolean);
      const dbLastRunByQueue = {};
      try {
        const { rows } = await db.query(
          `SELECT name, MAX(completed_on) AS last_completed
           FROM pgboss.job
           WHERE name = ANY($1) AND state = 'completed'
           GROUP BY name`,
          [queueNames]
        );
        for (const r of rows) {
          dbLastRunByQueue[r.name] = r.last_completed
            ? new Date(r.last_completed).getTime()
            : null;
        }
      } catch (err) {
        // Pre-pgboss tenants or DB hiccup — fall back to in-memory only.
      }

      // Real backlog per queue — durable, survives redeploys (unlike the
      // in-memory queueDepth heartbeat field, which resets to 0).
      const dbDepthByQueue = {};
      try {
        const { rows } = await db.query(
          `SELECT name, COUNT(*)::int AS depth
           FROM pgboss.job
           WHERE name = ANY($1) AND state IN ('created', 'retry', 'active')
           GROUP BY name`,
          [queueNames]
        );
        for (const r of rows) dbDepthByQueue[r.name] = r.depth;
      } catch (err) {
        // Fall back to in-memory heartbeat depth below.
      }

      function workerInfo(workerKey, status, pollIntervalMs) {
        const inMemoryAt = status?.lastPollAt || 0;
        const queueName = PG_BOSS_QUEUES[workerKey];
        const dbAt = queueName ? dbLastRunByQueue[queueName] || 0 : 0;
        // Use whichever is newer.
        const lastPollAt = Math.max(inMemoryAt, dbAt) || 0;
        const reg = registry[workerKey] || null;

        const lastPollAgo = lastPollAt ? Date.now() - lastPollAt : Number.MAX_SAFE_INTEGER;
        const running = lastPollAt ? lastPollAgo < pollIntervalMs * 2.5 : false;
        const queueDepth = queueName && dbDepthByQueue[queueName] !== undefined
          ? dbDepthByQueue[queueName]
          : status?.queueDepth || 0;

        // Drift/failure alert. Registry only exists on processes booted with
        // the new boot/workers.js — when absent, fall back to old inference.
        let alert = null;
        if (reg) {
          if (!reg.env_enabled && reg.env_value === null && !reg.default_on && !reg.opt_out) {
            alert = "env_var_missing"; // code gate exists, Railway var never set
          } else if (reg.env_enabled && reg.register_error) {
            alert = "register_failed";
          } else if (reg.env_enabled && !running) {
            alert = "enabled_but_stopped"; // no run within 2.5× expected interval
          }
        }

        const base = {
          enabled: reg ? reg.env_enabled : !!(status || lastPollAt),
          running,
          env_var: reg ? reg.env_var : null,
          env_value: reg ? reg.env_value : undefined,
          registered: reg ? reg.registered : undefined,
          register_error: reg ? reg.register_error : undefined,
          alert,
        };
        if (!status && !lastPollAt) return base;
        return {
          ...base,
          last_poll_at: lastPollAt ? new Date(lastPollAt).toISOString() : null,
          last_poll_ago_seconds: lastPollAt ? Math.round(lastPollAgo / 1000) : null,
          processed_today: status?.processedToday || 0,
          queue_depth: queueDepth,
        };
      }

      return res.json({
        email: workerInfo("email", emailStatus, 60_000),
        fbr: workerInfo("fbr", fbrStatus, 30_000),
        cleanup: workerInfo("cleanup", cleanupStatus, 24 * 60 * 60 * 1000),
        reservation: workerInfo("reservation", reservationStatus, 60_000),
        // Marketplace sync is intentionally manual-only (no background polling
        // is implemented — see marketplace-sync-worker-boss.js). Report it
        // honestly instead of as a "stopped" worker, which would look broken.
        marketplace_sync: {
          enabled: true,
          running: false,
          mode: marketplaceSyncStatus?.mode || "manual",
          note:
            marketplaceSyncStatus?.note ||
            "Background auto-sync not implemented — marketplace sync is manual via the Integrations Hub.",
          processed_today: 0,
          queue_depth: 0,
        },
        booking_reminder: workerInfo("booking_reminder", bookingReminderStatus, 5 * 60_000),
        rental_overdue: workerInfo("rental_overdue", rentalOverdueStatus, 24 * 60 * 60 * 1000),
        room_overdue: workerInfo("room_overdue", roomOverdueStatus, 24 * 60 * 60 * 1000),
        channel_sync: workerInfo("channel_sync", channelSyncStatus, 15 * 60_000),
        night_audit: workerInfo("night_audit", nightAuditStatus, 24 * 60 * 60 * 1000),
        treatment_plan: workerInfo("treatment_plan", treatmentPlanStatus, 24 * 60 * 60 * 1000),
        recall: workerInfo("recall", recallStatus, 24 * 60 * 60 * 1000),
        course_release: workerInfo("course_release", courseReleaseStatus, 60_000),
        kds_snapshot: workerInfo("kds_snapshot", kdsSnapshotStatus, 15 * 60_000),
        reservation_reminder: workerInfo("reservation_reminder", reservationReminderStatus, 15 * 60_000),
        abc: workerInfo("abc", abcStatus, 24 * 60 * 60 * 1000),
        hold_expiry: workerInfo("hold_expiry", holdExpiryStatus, 60 * 60 * 1000),
        deposit_hold_expiry: workerInfo("deposit_hold_expiry", depositHoldExpiryStatus, 60 * 60 * 1000),
        anomaly: workerInfo("anomaly", anomalyStatus, 24 * 60 * 60 * 1000),
        expiry_alert: workerInfo("expiry_alert", expiryAlertStatus, 24 * 60 * 60 * 1000),
        retail_digest: workerInfo("retail_digest", retailDigestStatus, 7 * 24 * 60 * 60 * 1000),
        shift_auto_close: workerInfo("shift_auto_close", shiftAutoCloseStatus, 60 * 60 * 1000),
        subscription_grace: workerInfo("subscription_grace", subscriptionGraceStatus, 60 * 60 * 1000),
        subscription_dunning: workerInfo("subscription_dunning", subscriptionDunningStatus, 60 * 60 * 1000),
        attendance_auto_close: workerInfo("attendance_auto_close", attendanceAutoCloseStatus, 24 * 60 * 60 * 1000),
        catalog_scheduler: workerInfo("catalog_scheduler", catalogSchedulerStatus, 60_000),
        orphan_schema_scan: workerInfo("orphan_schema_scan", orphanSchemaScanStatus, 60 * 60 * 1000),
        adoption_snapshot: workerInfo("adoption_snapshot", adoptionSnapshotStatus, 6 * 60 * 60 * 1000),
        shopify_sync: workerInfo("shopify_sync", shopifySyncStatus, 30_000),
        report_schedule: workerInfo("report_schedule", reportScheduleStatus, 60_000),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Feature-adoption matrix ────────────────────────────────────────────
  // Reads public.infra_cache (key: 'feature_adoption') populated by the
  // adoption-snapshot worker (every 6h). ?force=1 recomputes live — a full
  // cross-tenant fanout, so avoid forcing without reason.
  app.get("/api/admin/adoption", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const force = req.query.force === "1" || req.query.force === "true";

      if (!force) {
        const { rows: [cached] } = await db.query(
          `SELECT payload, computed_at, duration_ms
           FROM public.infra_cache WHERE cache_key = 'feature_adoption'`
        );
        if (cached) {
          res.set("X-Infra-Cache", "hit");
          return res.json({
            ...cached.payload,
            computed_at: cached.computed_at,
            snapshot_duration_ms: cached.duration_ms,
          });
        }
      }

      const { runSnapshot } = require("../../workers/adoption-snapshot-worker-boss");
      const result = await runSnapshot(db);
      res.set("X-Infra-Cache", "miss");
      return res.json({ ...result, snapshot_duration_ms: result.durationMs });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Orphaned Schemas ───────────────────────────────────────────────────
  // Reads from public.infra_cache (key: 'orphaned_schemas') populated by the
  // hourly orphan-schema-scan-worker. Live scan was the worst per-call query
  // in prod (up to 104s p100). ?force=1 falls back to a live scan when the
  // cache is missing or you really need fresh data; the route never blocks
  // on the live scan unless explicitly asked.
  app.get("/api/admin/orphaned-schemas", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const force = req.query.force === "1" || req.query.force === "true";

      if (!force) {
        const { rows: [cached] } = await db.query(
          `SELECT payload, computed_at, duration_ms
           FROM public.infra_cache WHERE cache_key = 'orphaned_schemas'`
        );
        if (cached) {
          res.set("X-Infra-Cache", "hit");
          return res.json({
            ...cached.payload,
            computed_at: cached.computed_at,
            scan_duration_ms: cached.duration_ms,
          });
        }
      }

      const { runScan } = require("../../workers/orphan-schema-scan-worker-boss");
      const result = await runScan(db);
      res.set("X-Infra-Cache", "miss");
      return res.json({
        orphans: result.orphans,
        count: result.count,
        computed_at: new Date().toISOString(),
        scan_duration_ms: result.durationMs,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/orphaned-schemas/cleanup", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: schemas } = await db.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`
      );
      const { rows: tenants } = await db.query("SELECT slug FROM tenants");
      const tenantSlugs = new Set(tenants.map(t => `tenant_${t.slug}`));

      const dropped = [];
      for (const s of schemas) {
        if (!tenantSlugs.has(s.schema_name)) {
          await db.query(`DROP SCHEMA IF EXISTS "${s.schema_name}" CASCADE`);
          dropped.push(s.schema_name);
        }
      }

      logAdminAction(req.admin.email, "orphaned_schemas_cleanup", "system", null, { dropped }, req.ip);
      return res.json({ dropped, count: dropped.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Backup ─────────────────────────────────────────────────────────────
  app.post("/api/admin/backup", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { isPgDumpAvailable, backupAllSchemas } = require("../../utils/backup-pg");
      const { uploadToR2 } = require("../../utils/r2");

      const available = await isPgDumpAvailable();
      if (!available) return res.status(500).json({ error: "pg_dump not available on this server" });

      // Gather all active tenant schemas + public
      const { rows: tenants } = await db.query(
        "SELECT slug FROM tenants WHERE status = 'active' ORDER BY slug"
      );
      const schemas = ["public", ...tenants.map(t => `tenant_${t.slug}`)];

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const key = `backups/full-backup-${timestamp}.dump`;

      const { stream, process: proc } = backupAllSchemas(schemas);
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));

      await new Promise((resolve, reject) => {
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}`)));
        proc.on("error", reject);
      });

      const buffer = Buffer.concat(chunks);
      const url = await uploadToR2(buffer, key, "application/octet-stream");

      // P33 — log audit row. action='full_backup' marks this as the
      // platform-wide backup (no tenant_slug scope). Errors are logged
      // (not silent) so future schema drift surfaces immediately.
      try {
        await db.query(
          `INSERT INTO backup_log
             (action, filename, size_bytes, performed_by, url, schema_name, status, tenant_slug)
           VALUES ($1, $2, $3, $4, $5, NULL, 'success', NULL)`,
          ["full_backup", key, buffer.length, req.admin?.email || null, url]
        );
      } catch (err) {
        console.warn(`[admin/backup] backup_log INSERT failed: ${err.message}`);
      }

      logAdminAction(req.admin.email, "backup_created", "system", null, {
        key, size: buffer.length, schema_count: schemas.length,
        tenant_count: tenants.length,
      }, req.ip);
      return res.json({
        message: "Backup created",
        key, size: buffer.length, url,
        schemas_included: schemas.length,
        tenant_schemas: tenants.map(t => t.slug),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Backup Verification ─────────────────────────────────────────────────
  app.post("/api/admin/backup/verify", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { listSchemasInBackup } = require("../../utils/backup-pg");
      const { filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: "filePath is required" });

      const schemasInBackup = await listSchemasInBackup(filePath);

      // Expected: public + all active tenant schemas
      const { rows: tenants } = await db.query(
        "SELECT slug FROM tenants WHERE status = 'active' ORDER BY slug"
      );
      const expectedSchemas = ["public", ...tenants.map(t => `tenant_${t.slug}`)].sort();

      const missing = expectedSchemas.filter(s => !schemasInBackup.includes(s));
      const extra = schemasInBackup.filter(s => !expectedSchemas.includes(s));
      const valid = missing.length === 0;

      logAdminAction(req.admin.email, "backup_verified", "system", null, { valid, missing: missing.length, extra: extra.length }, req.ip);
      return res.json({
        valid,
        schemas_in_backup: schemasInBackup.length,
        schemas_expected: expectedSchemas.length,
        missing,
        extra,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/backup-history", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 20"
      );
      return res.json(rows);
    } catch (err) {
      return res.json([]);
    }
  });
};
