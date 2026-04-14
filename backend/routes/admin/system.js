/**
 * Admin system — worker status, orphaned schemas, backup.
 */
module.exports = function registerSystemRoutes(app, deps) {
  const { db, requireAllowedIp, requireSuperAdmin, logAdminAction } = deps;

  // ── Worker Status ──────────────────────────────────────────────────────
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

      function workerInfo(status, pollIntervalMs) {
        if (!status) return { enabled: false, running: false };
        const lastPollAgo = Date.now() - (status.lastPollAt || 0);
        return {
          enabled: true,
          running: lastPollAgo < pollIntervalMs * 2.5,
          last_poll_at: status.lastPollAt ? new Date(status.lastPollAt).toISOString() : null,
          last_poll_ago_seconds: Math.round(lastPollAgo / 1000),
          processed_today: status.processedToday || 0,
          queue_depth: status.queueDepth || 0,
        };
      }

      return res.json({
        email: workerInfo(emailStatus, 60_000),
        fbr: workerInfo(fbrStatus, 30_000),
        cleanup: workerInfo(cleanupStatus, 24 * 60 * 60 * 1000),
        reservation: workerInfo(reservationStatus, 60_000),
        marketplace_sync: workerInfo(marketplaceSyncStatus, 5 * 60_000),
        booking_reminder: workerInfo(bookingReminderStatus, 5 * 60_000),
        rental_overdue: workerInfo(rentalOverdueStatus, 24 * 60 * 60 * 1000),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Orphaned Schemas ───────────────────────────────────────────────────
  app.get("/api/admin/orphaned-schemas", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: schemas } = await db.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`
      );
      const { rows: tenants } = await db.query("SELECT slug FROM tenants");
      const tenantSlugs = new Set(tenants.map(t => `tenant_${t.slug}`));

      const orphans = [];
      for (const s of schemas) {
        if (!tenantSlugs.has(s.schema_name)) {
          const { rows: [size] } = await db.query(
            `SELECT pg_size_pretty(COALESCE(SUM(pg_total_relation_size(quote_ident($1)||'.'||quote_ident(tablename)))::bigint, 0)) AS size
             FROM pg_tables WHERE schemaname = $1`,
            [s.schema_name]
          );
          orphans.push({ schema: s.schema_name, size: size.size });
        }
      }

      return res.json({ orphans, count: orphans.length });
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

      try {
        await db.query(
          "INSERT INTO backup_log (filename, size_bytes, url, created_at) VALUES ($1, $2, $3, NOW())",
          [key, buffer.length, url]
        );
      } catch (_) { /* table may not exist */ }

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
