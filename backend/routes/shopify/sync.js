module.exports = function registerShopifySyncRoutes(app, deps) {
  const {
    db, requirePerm, requireAnyPerm,
    getActiveShopifyConnection, logShopifyEvent,
    isRetryableInventoryEventStatus,
    processPendingShopifyInventoryEvents, enqueueInventorySyncEvents,
  } = deps;

  app.get(
    "/api/integrations/shopify/events",
    requireAnyPerm(["manage_inventory", "manage_orders"]),
    (req, res) => {
      const limit = Math.min(
        200,
        Math.max(1, parseInt(req.query.limit || "50", 10)),
      );
      const { status, entity_type, direction, search } = req.query;
      const where = ["1=1"];
      const params = [];
      if (status) {
        where.push("status = ?");
        params.push(String(status));
      }
      if (entity_type) {
        where.push("entity_type = ?");
        params.push(String(entity_type));
      }
      if (direction) {
        where.push("direction = ?");
        params.push(String(direction));
      }
      if (search) {
        where.push(
          "(idempotency_key LIKE ? OR COALESCE(error_message,'') LIKE ?)",
        );
        params.push(`%${search}%`, `%${search}%`);
      }
      params.push(limit);
      db.all(
        `SELECT id, direction, entity_type, idempotency_key, status, error_message, attempt_count, next_retry_at, created_at, processed_at
     FROM external_sync_events
     WHERE ${where.join(" AND ")}
     ORDER BY id DESC
     LIMIT ?`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ events: rows || [] });
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/retry-event/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id } = req.params;
      db.get(
        `SELECT id, direction, entity_type, status
     FROM external_sync_events
     WHERE id = ?`,
        [id],
        (selErr, eventRow) => {
          if (selErr) return res.status(500).json({ error: selErr.message });
          if (!eventRow)
            return res.status(404).json({ error: "Event not found" });
          if (
            eventRow.direction !== "outbound" ||
            eventRow.entity_type !== "inventory"
          ) {
            return res
              .status(400)
              .json({ error: "Only outbound inventory events can be retried" });
          }
          if (!isRetryableInventoryEventStatus(eventRow.status)) {
            return res
              .status(400)
              .json({ error: "Event status is not retryable" });
          }

          db.run(
            `UPDATE external_sync_events
         SET status = 'pending',
             error_message = NULL,
             next_retry_at = datetime('now','localtime'),
             processed_at = NULL
         WHERE id = ?`,
            [id],
            function (updErr) {
              if (updErr)
                return res.status(500).json({ error: updErr.message });
              logShopifyEvent("info", "retry_single_queued", {
                event_id: Number(id),
                previous_status: eventRow.status,
              });
              res.json({ message: "Event queued for retry", id: Number(id) });
            },
          );
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/process-pending",
    requirePerm("manage_inventory"),
    (req, res) => {
      const limit = Math.min(
        100,
        Math.max(1, parseInt(req.body?.limit || "25", 10)),
      );
      db.run(
        `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
     VALUES ('outbound', 'process_pending_inventory', 'running', ?)`,
        [`Manual queue processing requested (limit ${limit})`],
        function (runErr) {
          if (runErr) return res.status(500).json({ error: runErr.message });
          const runId = this.lastID;
          processPendingShopifyInventoryEvents(limit, (err, result) => {
            const out = result || { processed: 0, failed: 0, skipped: 0 };
            db.run(
              `UPDATE shopify_sync_runs
           SET finished_at = datetime('now','localtime'),
               status = ?,
               processed_count = ?,
               failed_count = ?
           WHERE id = ?`,
              [
                out.failed > 0 ? "completed_with_errors" : "completed",
                out.processed || 0,
                out.failed || 0,
                runId,
              ],
            );
            if (err) return res.status(500).json({ error: err.message });
            res.json({ run_id: runId, ...out });
          });
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/retry-failed",
    requirePerm("manage_inventory"),
    (req, res) => {
      const limit = Math.min(
        500,
        Math.max(1, parseInt(req.body?.limit || "100", 10)),
      );
      db.run(
        `UPDATE external_sync_events
     SET status = 'pending',
         error_message = NULL,
         next_retry_at = datetime('now','localtime'),
         processed_at = NULL
     WHERE id IN (
       SELECT id FROM external_sync_events
       WHERE direction = 'outbound'
         AND entity_type = 'inventory'
         AND status IN ('failed', 'dead_letter', 'retry', 'failed_mapping')
       ORDER BY id ASC
       LIMIT ?
     )`,
        [limit],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          logShopifyEvent("info", "retry_bulk_queued", {
            queued: this.changes || 0,
            limit,
          });
          res.json({
            message: "Failed events queued for retry",
            queued: this.changes || 0,
          });
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/push-inventory",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { rows = [], process_now = true } = req.body || {};
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        db.serialize(() => {
          db.run(
            `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
         VALUES ('outbound', 'manual_push_inventory', 'running', ?)`,
            [
              rows.length > 0
                ? "Manual rows pushed"
                : "Dry-run push generated from local inventory",
            ],
            function (runErr) {
              if (runErr)
                return res.status(500).json({ error: runErr.message });
              const runId = this.lastID;
              const toPush = Array.isArray(rows) ? rows : [];
              enqueueInventorySyncEvents(
                toPush,
                {
                  reason: "manual_sync",
                  reference_type: "manual",
                  reference_id: runId,
                },
                (enqueueErr, enqueueResult) => {
                  if (enqueueErr) {
                    db.run(
                      `UPDATE shopify_sync_runs
                   SET finished_at = datetime('now','localtime'),
                       status = 'failed',
                       failed_count = 1,
                       notes = ?
                   WHERE id = ?`,
                      [enqueueErr.message, runId],
                    );
                    return res.status(500).json({ error: enqueueErr.message });
                  }

                  const queuedCount = enqueueResult?.queued || 0;
                  const finalizeRun = (processResult) => {
                    const processedCount = processResult?.processed || 0;
                    const failedCount = processResult?.failed || 0;
                    db.run(
                      `UPDATE shopify_sync_runs
                   SET finished_at = datetime('now','localtime'),
                       status = ?,
                       processed_count = ?,
                       failed_count = ?
                   WHERE id = ?`,
                      [
                        failedCount > 0 ? "completed_with_errors" : "completed",
                        processedCount,
                        failedCount,
                        runId,
                      ],
                    );
                    db.run(
                      `UPDATE shopify_connections
                   SET last_sync_at = datetime('now','localtime'),
                       last_error = ?,
                       updated_at = datetime('now','localtime')
                   WHERE id = ?`,
                      [
                        failedCount > 0
                          ? `${failedCount} event(s) failed`
                          : null,
                        conn.id,
                      ],
                    );
                    return res.json({
                      message: "Inventory sync run completed",
                      run_id: runId,
                      queued: queuedCount,
                      processed: processedCount,
                      failed: failedCount,
                      skipped: processResult?.skipped || 0,
                    });
                  };

                  if (!process_now || queuedCount === 0) {
                    return finalizeRun({
                      processed: 0,
                      failed: 0,
                      skipped: enqueueResult?.skipped || 0,
                    });
                  }
                  processPendingShopifyInventoryEvents(
                    50,
                    (procErr, procResult) => {
                      if (procErr)
                        return res.status(500).json({ error: procErr.message });
                      return finalizeRun(procResult || {});
                    },
                  );
                },
              );
            },
          );
        });
      });
    },
  );
};
