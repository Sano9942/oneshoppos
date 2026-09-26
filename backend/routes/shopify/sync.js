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
    async (req, res) => {
      try {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
        const { status, entity_type, direction, search } = req.query;
        const where = ["1=1"];
        const params = [];
        let idx = 1;
        if (status) {
          where.push(`status = $${idx++}`);
          params.push(String(status));
        }
        if (entity_type) {
          where.push(`entity_type = $${idx++}`);
          params.push(String(entity_type));
        }
        if (direction) {
          where.push(`direction = $${idx++}`);
          params.push(String(direction));
        }
        if (search) {
          where.push(`(idempotency_key ILIKE $${idx} OR COALESCE(error_message,'') ILIKE $${idx + 1})`);
          params.push(`%${search}%`, `%${search}%`);
          idx += 2;
        }
        params.push(limit);
        const { rows } = await db.query(
          `SELECT id, direction, entity_type, idempotency_key, status, error_message, attempt_count, next_retry_at, created_at, processed_at
           FROM external_sync_events
           WHERE ${where.join(" AND ")}
           ORDER BY id DESC
           LIMIT $${idx}`,
          params
        );
        res.json({ events: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/integrations/shopify/sync/retry-event/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows } = await db.query(
          "SELECT id, direction, entity_type, status FROM external_sync_events WHERE id = $1",
          [id]
        );
        const eventRow = rows[0];
        if (!eventRow) return res.status(404).json({ error: "Event not found" });
        if (eventRow.direction !== "outbound" || eventRow.entity_type !== "inventory") {
          return res.status(400).json({ error: "Only outbound inventory events can be retried" });
        }
        if (!isRetryableInventoryEventStatus(eventRow.status)) {
          return res.status(400).json({ error: "Event status is not retryable" });
        }

        await db.query(
          `UPDATE external_sync_events
           SET status = 'pending', error_message = NULL, next_retry_at = NOW(), processed_at = NULL
           WHERE id = $1`,
          [id]
        );
        logShopifyEvent("info", "retry_single_queued", {
          event_id: Number(id),
          previous_status: eventRow.status,
        });
        res.json({ message: "Event queued for retry", id: Number(id) });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/integrations/shopify/sync/process-pending",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit || "25", 10)));
        const { rows } = await db.query(
          `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
           VALUES ('outbound', 'process_pending_inventory', 'running', $1)
           RETURNING id`,
          [`Manual queue processing requested (limit ${limit})`]
        );
        const runId = rows[0].id;

        // processPendingShopifyInventoryEvents is async. It used to be handed
        // a callback it never called, so this request never answered.
        let out = { processed: 0, failed: 0, skipped: 0 };
        let runErr = null;
        try {
          out = (await processPendingShopifyInventoryEvents(limit)) || out;
        } catch (e) {
          runErr = e;
        }
        await db.query(
          `UPDATE shopify_sync_runs
           SET finished_at = NOW(), status = $1, processed_count = $2, failed_count = $3
           WHERE id = $4`,
          [
            runErr ? "failed" : out.failed > 0 ? "completed_with_errors" : "completed",
            out.processed || 0,
            out.failed || 0,
            runId,
          ]
        ).catch(() => {});
        if (runErr) return res.status(500).json({ error: runErr.message });
        res.json({ run_id: runId, ...out });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/integrations/shopify/sync/retry-failed",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const limit = Math.min(500, Math.max(1, parseInt(req.body?.limit || "100", 10)));
        const { rowCount } = await db.query(
          `UPDATE external_sync_events
           SET status = 'pending', error_message = NULL, next_retry_at = NOW(), processed_at = NULL
           WHERE id IN (
             SELECT id FROM external_sync_events
             WHERE direction = 'outbound'
               AND entity_type = 'inventory'
               AND status IN ('failed', 'dead_letter', 'retry', 'failed_mapping')
             ORDER BY id ASC
             LIMIT $1
           )`,
          [limit]
        );
        logShopifyEvent("info", "retry_bulk_queued", { queued: rowCount || 0, limit });
        res.json({ message: "Failed events queued for retry", queued: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Push stock to Shopify. With no rows, this is the absolute push: Shopify is
  // set to SanoPOS's exact counts (same as "Set Shopify to SanoPOS counts").
  // With rows, each row is a +/- change queued and sent as before.
  app.post(
    "/api/integrations/shopify/sync/push-inventory",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows: bodyRows = [], process_now = true } = req.body || {};
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });

        const toPush = Array.isArray(bodyRows) ? bodyRows : [];
        if (toPush.length === 0) {
          const stockCheck = require("../../shopify/stock-check");
          const result = await stockCheck.setShopifyToPos(
            db,
            conn,
            {
              fetchInventoryLevelsBatch: deps.fetchInventoryLevelsBatch,
              setShopifyInventory:
                deps.setShopifyInventory || require("../../shopify/client").setShopifyInventory,
            },
            { processPending: (limit) => processPendingShopifyInventoryEvents(limit) },
          );
          return res.json({ message: "Shopify set to SanoPOS counts", ...result });
        }

        const { rows } = await db.query(
          `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
           VALUES ('outbound', 'manual_push_inventory', 'running', 'Manual rows pushed')
           RETURNING id`
        );
        const runId = rows[0].id;

        // Both helpers are async; they used to be handed callbacks they never
        // called, so this request never answered.
        let enqueueResult;
        try {
          enqueueResult = await enqueueInventorySyncEvents(toPush, {
            reason: "manual_sync",
            reference_type: "manual",
            reference_id: runId,
          });
        } catch (enqueueErr) {
          await db.query(
            `UPDATE shopify_sync_runs
             SET finished_at = NOW(), status = 'failed', failed_count = 1, notes = $1
             WHERE id = $2`,
            [enqueueErr.message, runId]
          ).catch(() => {});
          return res.status(500).json({ error: enqueueErr.message });
        }

        const queuedCount = enqueueResult?.queued || 0;
        let processResult = { processed: 0, failed: 0, skipped: enqueueResult?.skipped || 0 };
        if (process_now && queuedCount > 0) {
          processResult = (await processPendingShopifyInventoryEvents(50)) || processResult;
        }
        const processedCount = processResult?.processed || 0;
        const failedCount = processResult?.failed || 0;
        await db.query(
          `UPDATE shopify_sync_runs
           SET finished_at = NOW(), status = $1, processed_count = $2, failed_count = $3
           WHERE id = $4`,
          [
            failedCount > 0 ? "completed_with_errors" : "completed",
            processedCount,
            failedCount,
            runId,
          ]
        ).catch(() => {});
        res.json({
          message: "Inventory sync run completed",
          run_id: runId,
          queued: queuedCount,
          processed: processedCount,
          failed: failedCount,
          skipped: processResult?.skipped || 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
