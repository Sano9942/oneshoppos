const {
  getActiveShopifyConnection: _getActiveShopifyConnection,
} = require("../../shopify/utils");

module.exports = function registerShopifyReconciliationRoutes(app, deps) {
  const {
    db,
    requirePerm,
    requireAnyPerm,
    requireFeature,
    canApproveReconciliationRequest,
    createNotification,
    adjustShopifyInventory,
    fetchInventoryLevelsBatch,
    logShopifyEvent,
    decryptShopifySecret,
  } = deps;

  function getActiveShopifyConnection(cb) {
    return _getActiveShopifyConnection(db, decryptShopifySecret, cb);
  }

  function logActionHistory(req, actionType, description, cb = () => {}) {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return cb();
    db.get(
      "SELECT name FROM employees WHERE id = ?",
      [employeeId],
      (err, row) => {
        const userName = err ? "System" : row?.name || "System";
        db.run(
          "INSERT INTO action_history (user_name, action_type, description) VALUES (?, ?, ?)",
          [userName, actionType, description],
          () => cb(),
        );
      },
    );
  }

  // GET reconciliation list
  app.get(
    "/api/integrations/shopify/reconciliation",
    requireAnyPerm(["view_reports", "manage_inventory"]),
    (req, res) => {
      const { status, resolution_status } = req.query;
      const where = ["1=1"];
      const params = [];
      if (status) {
        where.push("ir.status = ?");
        params.push(status);
      }
      if (resolution_status) {
        where.push("ir.resolution_status = ?");
        params.push(resolution_status);
      }
      db.all(
        `SELECT ir.*,
            p.name as product_name,
            p.barcode,
            o.name as outlet_name
     FROM inventory_reconciliation ir
     LEFT JOIN products p ON p.id = ir.product_id
     LEFT JOIN outlets o ON o.id = ir.outlet_id
     WHERE ${where.join(" AND ")}
     ORDER BY ir.checked_at DESC, ABS(ir.diff) DESC`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ rows: rows || [] });
        },
      );
    },
  );

  // POST run reconciliation
  app.post(
    "/api/integrations/shopify/reconciliation",
    requirePerm("manage_inventory"),
    (req, res) => {
      getActiveShopifyConnection(async (connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        db.all(
          `SELECT spm.product_id,
              spm.variant_id,
              spm.shopify_inventory_item_id,
              slm.outlet_id,
              slm.shopify_location_id,
              COALESCE(SUM(os.quantity), 0) as local_qty
       FROM shopify_product_map spm
       JOIN shopify_location_map slm
       LEFT JOIN outlet_stock os
         ON os.product_id = spm.product_id
        AND os.outlet_id = slm.outlet_id
       WHERE spm.is_active = 1
         AND spm.shopify_inventory_item_id IS NOT NULL
       GROUP BY spm.product_id, spm.variant_id, spm.shopify_inventory_item_id, slm.outlet_id, slm.shopify_location_id`,
          [],
          async (mapErr, mappedRows) => {
            if (mapErr) return res.status(500).json({ error: mapErr.message });
            if (!mappedRows || mappedRows.length === 0) {
              return res.status(400).json({ error: "No mapped items found" });
            }

            const rowsToInsert = [];
            let matched = 0;
            let mismatch = 0;
            let errorsCount = 0;

            const batchSize = 50;
            for (let i = 0; i < mappedRows.length; i += batchSize) {
              const batch = mappedRows.slice(i, i + batchSize);
              const byLocation = {};
              batch.forEach((r) => {
                if (!byLocation[r.shopify_location_id])
                  byLocation[r.shopify_location_id] = [];
                byLocation[r.shopify_location_id].push(r);
              });

              for (const locId of Object.keys(byLocation)) {
                const locBatch = byLocation[locId];
                const itemIds = locBatch.map(
                  (r) => r.shopify_inventory_item_id,
                );
                try {
                  const remoteLevels = await fetchInventoryLevelsBatch(
                    conn,
                    itemIds,
                    locId,
                  );
                  const remoteMap = new Map(
                    remoteLevels.map((l) => [l.inventory_item_id, l.available]),
                  );

                  for (const row of locBatch) {
                    const localQty = Number(row.local_qty || 0);
                    const externalQty = Number(
                      remoteMap.get(
                        `gid://shopify/InventoryItem/${row.shopify_inventory_item_id}`,
                      ) ?? 0,
                    );
                    const diff = Number((localQty - externalQty).toFixed(4));
                    const status = diff === 0 ? "matched" : "mismatch";
                    if (status === "matched") matched += 1;
                    else mismatch += 1;
                    rowsToInsert.push({
                      product_id: row.product_id,
                      variant_id: row.variant_id || null,
                      outlet_id: row.outlet_id,
                      external_location_id: locId,
                      local_qty: localQty,
                      external_qty: externalQty,
                      diff,
                      status,
                      resolution_status: "open",
                    });
                  }
                } catch (e) {
                  errorsCount += locBatch.length;
                  locBatch.forEach((row) => {
                    rowsToInsert.push({
                      product_id: row.product_id,
                      variant_id: row.variant_id || null,
                      outlet_id: row.outlet_id,
                      external_location_id: locId,
                      local_qty: Number(row.local_qty || 0),
                      external_qty: 0,
                      diff: Number(row.local_qty || 0),
                      status: "error",
                      resolution_status: "open",
                      resolution_note: e.message || "Batch fetch failed",
                    });
                  });
                }
              }
            }

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              db.run("DELETE FROM inventory_reconciliation");
              const stmt = db.prepare(
                `INSERT INTO inventory_reconciliation (
               product_id, variant_id, outlet_id, external_location_id,
               local_qty, external_qty, diff, status, checked_at,
               resolution_status, resolution_note
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?)`,
              );
              for (const r of rowsToInsert) {
                stmt.run([
                  r.product_id,
                  r.variant_id,
                  r.outlet_id,
                  r.external_location_id,
                  r.local_qty,
                  r.external_qty,
                  r.diff,
                  r.status,
                  r.resolution_status,
                  r.resolution_note || null,
                ]);
              }
              stmt.finalize((finErr) => {
                if (finErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: finErr.message });
                }
                db.run("COMMIT", (commitErr) => {
                  if (commitErr)
                    return res.status(500).json({ error: commitErr.message });
                  return res.json({
                    message: "Live reconciliation completed",
                    row_count: rowsToInsert.length,
                    matched,
                    mismatch,
                    errors: errorsCount,
                  });
                });
              });
            });
          },
        );
      });
    },
  );

  // PUT resolve reconciliation row
  app.put(
    "/api/integrations/shopify/reconciliation/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id } = req.params;
      const { resolution_status = "resolved", resolution_note = null } =
        req.body || {};
      const allowed = ["open", "resolved", "ignored"];
      if (!allowed.includes(String(resolution_status))) {
        return res
          .status(400)
          .json({
            error: `resolution_status must be one of: ${allowed.join(", ")}`,
          });
      }
      const resolvedBy = req.headers["x-employee-id"]
        ? Number(req.headers["x-employee-id"])
        : null;
      db.run(
        `UPDATE inventory_reconciliation
         SET resolution_status = ?, resolution_note = ?, resolved_by = ?,
             resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now','localtime') END
         WHERE id = ?`,
        [resolution_status, resolution_note, resolvedBy, resolution_status, id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Not found" });
          logActionHistory(
            req,
            "reconciliation_resolve",
            `Row #${id} marked as ${resolution_status}`,
          );
          res.json({ message: "Updated successfully" });
        },
      );
    },
  );

  // POST request fix (creates approval request)
  app.post(
    "/api/integrations/shopify/reconciliation/:id/fix",
    requirePerm("manage_inventory"),
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { mode, note } = req.body || {};
      const requesterEmployeeId = req.headers["x-employee-id"]
        ? Number(req.headers["x-employee-id"])
        : null;

      db.get(
        "SELECT * FROM inventory_reconciliation WHERE id = ?",
        [id],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!row) return res.status(404).json({ error: "Not found" });

          const notes = JSON.stringify({
            mode,
            note,
            diff: row.diff,
            local_qty: row.local_qty,
            external_qty: row.external_qty,
            product_id: row.product_id,
            outlet_id: row.outlet_id,
            requester_employee_id: requesterEmployeeId,
            requested_at: new Date().toISOString(),
          });

          db.run(
            `INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes)
           VALUES ('reconciliation_fix', ?, 'reconciliation', ?, ?)`,
            [
              id,
              requesterEmployeeId ? String(requesterEmployeeId) : null,
              notes,
            ],
            function (insErr) {
              if (insErr)
                return res.status(500).json({ error: insErr.message });
              logActionHistory(
                req,
                "reconciliation_fix_request",
                `Fix requested for row #${id}`,
              );
              res.json({
                message: "Approval request submitted",
                approval_request_id: this.lastID,
              });
            },
          );
        },
      );
    },
  );

  // POST bulk action
  app.post(
    "/api/integrations/shopify/reconciliation/bulk",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { ids, action, mode } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ error: "ids required" });

      if (action === "ignore") {
        const placeholders = ids.map(() => "?").join(",");
        const employeeId = req.headers["x-employee-id"]
          ? Number(req.headers["x-employee-id"])
          : null;
        db.run(
          `UPDATE inventory_reconciliation SET resolution_status = 'ignored', resolved_by = ?, resolved_at = datetime('now','localtime')
           WHERE id IN (${placeholders})`,
          [employeeId, ...ids],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            logActionHistory(
              req,
              "reconciliation_bulk_ignore",
              `Ignored ${this.changes} rows`,
            );
            res.json({ message: `Ignored ${this.changes} items` });
          },
        );
      } else if (action === "fix") {
        // Here we'd call the fix logic. For brevity and safety, we'll suggest approval if feature enabled
        // or execute if authorized. For now, we'll return a 501 or a simple message.
        res
          .status(501)
          .json({
            error:
              "Bulk fix execution via API coming soon. Use individual fix requests for now.",
          });
      } else {
        res.status(400).json({ error: "Invalid action" });
      }
    },
  );
};
