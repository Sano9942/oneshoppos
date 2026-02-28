module.exports = function registerReconciliationRoutes(app, deps) {
  const {
    db, requirePerm, requireAnyPerm, requireFeature,
    canApproveReconciliationRequest, createNotification,
    adjustShopifyInventory, fetchInventoryLevel,
    logShopifyEvent, runtimeState
  } = deps;

// --- ROUTES: RECONCILIATION (internal) ---

  app.get(
    "/api/reconciliation/inventory",
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
            pv.sku as variant_sku,
            o.name as outlet_name
     FROM inventory_reconciliation ir
     LEFT JOIN products p ON p.id = ir.product_id
     LEFT JOIN product_variants pv ON pv.id = ir.variant_id
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

  app.post(
    "/api/reconciliation/inventory/run",
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
              return res.status(400).json({
                error:
                  "No mapped inventory items/locations found for reconciliation",
              });
            }

            const rowsToInsert = [];
            let matched = 0;
            let mismatch = 0;
            let errorsCount = 0;

            // Batch processing for Shopify fetching
            const batchSize = 50;
            for (let i = 0; i < mappedRows.length; i += batchSize) {
              const batch = mappedRows.slice(i, i + batchSize);
              const inventoryItemIds = batch.map(
                (r) => r.shopify_inventory_item_id,
              );
              // Assuming all items in batch share the same Shopify location for this specific reconciliation context,
              // or grouping by location if they differ. The current 'Run' logic uses slm.shopify_location_id per row.
              // To handle mixed locations, we group by location_id.
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
                      resolution_note: null,
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
                      resolution_note: String(
                        e.message || "Batch fetch failed",
                      ),
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
                  r.resolution_note,
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

  app.post(
    "/api/reconciliation/inventory/:id/resolve",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id } = req.params;
      const { resolution_status = "resolved", resolution_note = null } =
        req.body || {};
      const allowed = ["open", "resolved", "ignored"];
      if (!allowed.includes(String(resolution_status))) {
        return res.status(400).json({
          error: `resolution_status must be one of: ${allowed.join(", ")}`,
        });
      }
      const resolvedBy = req.headers["x-employee-id"]
        ? Number(req.headers["x-employee-id"])
        : null;
      db.run(
        `UPDATE inventory_reconciliation
     SET resolution_status = ?,
         resolution_note = ?,
         resolved_by = ?,
         resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now','localtime') END
     WHERE id = ?`,
        [resolution_status, resolution_note, resolvedBy, resolution_status, id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res
              .status(404)
              .json({ error: "Reconciliation row not found" });
          logActionHistory(
            req,
            "reconciliation_resolve",
            `Reconciliation row #${id} marked as ${resolution_status}`,
          );
          res.json({ message: "Reconciliation row updated" });
        },
      );
    },
  );

  app.post(
    "/api/reconciliation/inventory/bulk-resolve",
    requirePerm("manage_inventory"),
    (req, res) => {
      const {
        ids,
        resolution_status = "resolved",
        resolution_note = null,
      } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      const allowed = ["open", "resolved", "ignored"];
      if (!allowed.includes(String(resolution_status))) {
        return res.status(400).json({
          error: `resolution_status must be one of: ${allowed.join(", ")}`,
        });
      }
      const resolvedBy = req.headers["x-employee-id"]
        ? Number(req.headers["x-employee-id"])
        : null;

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const chunkSize = 500;
        let totalUpdated = 0;
        let finalErr = null;

        const processChunks = (index) => {
          if (index >= ids.length) {
            if (finalErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: finalErr.message });
            }
            db.run("COMMIT", (commitErr) => {
              if (commitErr)
                return res.status(500).json({ error: commitErr.message });
              logActionHistory(
                req,
                "reconciliation_bulk_resolve",
                `Bulk resolved ${totalUpdated} rows to ${resolution_status}`,
              );
              res.json({
                message: `Successfully updated ${totalUpdated} reconciliation rows`,
              });
            });
            return;
          }

          const chunk = ids.slice(index, index + chunkSize);
          const placeholders = chunk.map(() => "?").join(",");
          db.run(
            `UPDATE inventory_reconciliation
             SET resolution_status = ?,
                 resolution_note = ?,
                 resolved_by = ?,
                 resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now','localtime') END
             WHERE id IN (${placeholders})`,
            [
              resolution_status,
              resolution_note,
              resolvedBy,
              resolution_status,
              ...chunk,
            ],
            function (err) {
              if (err) {
                finalErr = err;
                processChunks(ids.length); // skip to end
              } else {
                totalUpdated += this.changes;
                processChunks(index + chunkSize);
              }
            },
          );
        };

        processChunks(0);
      });
    },
  );

  function executeReconciliationFix(req, row, mode, cb) {
    const fixMode = String(mode || "");
    if (!["push_to_shopify", "pull_to_local"].includes(fixMode)) {
      return cb(new Error("mode must be 'push_to_shopify' or 'pull_to_local'"));
    }
    const rowId = row?.id;
    if (!rowId) return cb(new Error("Reconciliation row not found"));

    const localQty = Number(row.local_qty || 0);
    const externalQty = Number(row.external_qty || 0);
    const diff = Number((localQty - externalQty).toFixed(4));

    if (fixMode === "push_to_shopify") {
      if (!row.external_location_id) {
        return cb(
          new Error("Missing external location id on reconciliation row"),
        );
      }
      return db.get(
        `SELECT shopify_inventory_item_id
       FROM shopify_product_map
       WHERE product_id = ?
         AND ((variant_id IS NOT NULL AND variant_id = ?) OR (variant_id IS NULL AND ? IS NULL))
         AND is_active = 1
       ORDER BY CASE WHEN variant_id IS NOT NULL THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
        [row.product_id, row.variant_id || null, row.variant_id || null],
        (mapErr, map) => {
          if (mapErr) return cb(mapErr);
          if (!map?.shopify_inventory_item_id) {
            return cb(
              new Error(
                "No active Shopify inventory mapping found for this row",
              ),
            );
          }
          return getActiveShopifyConnection(async (connErr, conn) => {
            if (connErr) return cb(connErr);
            if (!conn) return cb(new Error("No active Shopify connection"));
            try {
              const result = await adjustShopifyInventory(
                conn,
                [
                  {
                    inventory_item_id: map.shopify_inventory_item_id,
                    location_id: row.external_location_id,
                    delta: diff,
                  },
                ],
                "correction",
              );
              if ((result.userErrors || []).length > 0) {
                return cb(
                  new Error(
                    result.userErrors.map((e) => e.message).join("; ") ||
                      "Shopify user error",
                  ),
                );
              }
              db.run(
                `UPDATE inventory_reconciliation
               SET external_qty = local_qty,
                   diff = 0,
                   status = 'matched',
                   resolution_status = 'resolved',
                   resolution_note = ?,
                   resolved_by = ?,
                   resolved_at = datetime('now','localtime')
               WHERE id = ?`,
                [
                  "Corrective action: pushed local qty to Shopify",
                  req.headers["x-employee-id"]
                    ? Number(req.headers["x-employee-id"])
                    : null,
                  rowId,
                ],
                (updErr) => {
                  if (updErr) return cb(updErr);
                  return cb(null, {
                    message: "Corrective push applied to Shopify",
                    delta: diff,
                  });
                },
              );
            } catch (e) {
              return cb(
                new Error(e.message || "Failed applying Shopify correction"),
              );
            }
          });
        },
      );
    }

    const deltaLocal = Number((externalQty - localQty).toFixed(4));
    return db.run(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
     VALUES (?, ?, ?)
     ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
      [row.product_id, row.outlet_id, deltaLocal, deltaLocal],
      (stockErr) => {
        if (stockErr) return cb(stockErr);
        return db.run(
          `UPDATE inventory_reconciliation
         SET local_qty = external_qty,
             diff = 0,
             status = 'matched',
             resolution_status = 'resolved',
             resolution_note = ?,
             resolved_by = ?,
             resolved_at = datetime('now','localtime')
         WHERE id = ?`,
          [
            "Corrective action: pulled Shopify qty to local stock",
            req.headers["x-employee-id"]
              ? Number(req.headers["x-employee-id"])
              : null,
            rowId,
          ],
          (updErr) => {
            if (updErr) return cb(updErr);
            return cb(null, {
              message: "Corrective pull applied to local stock",
              delta: deltaLocal,
            });
          },
        );
      },
    );
  }

  app.post(
    "/api/reconciliation/inventory/bulk-fix",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { ids, mode } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      if (!["push_to_shopify", "pull_to_local"].includes(mode)) {
        return res
          .status(400)
          .json({ error: "mode must be 'push_to_shopify' or 'pull_to_local'" });
      }

      const results = { success: 0, fail: 0, errors: [] };
      const idChunkSize = 500;
      const allRows = [];

      const fetchRows = async (index) => {
        if (index >= ids.length) {
          if (!allRows.length)
            return res
              .status(404)
              .json({ error: "No matching reconciliation rows found" });

          const fixChunkSize = 20;
          for (let i = 0; i < allRows.length; i += fixChunkSize) {
            const chunk = allRows.slice(i, i + fixChunkSize);
            await Promise.all(
              chunk.map(
                (row) =>
                  new Promise((resolve) => {
                    executeReconciliationFix(req, row, mode, (fixErr) => {
                      if (fixErr) {
                        results.fail++;
                        results.errors.push(
                          `Row #${row.id}: ${fixErr.message}`,
                        );
                      } else {
                        results.success++;
                      }
                      resolve();
                    });
                  }),
              ),
            );
          }

          return res.json({
            message: `Bulk fix complete: ${results.success} succeeded, ${results.fail} failed`,
            ...results,
          });
        }

        const currentIds = ids.slice(index, index + idChunkSize);
        db.all(
          `SELECT * FROM inventory_reconciliation WHERE id IN (${currentIds
            .map(() => "?")
            .join(",")})`,
          currentIds,
          async (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            allRows.push(...(rows || []));
            fetchRows(index + idChunkSize);
          },
        );
      };

      fetchRows(0);
    },
  );

  app.post(
    "/api/reconciliation/inventory/:id/request-fix",
    requirePerm("manage_inventory"),
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { mode, requested_by, note } = req.body || {};
      const requesterEmployeeId = req.headers["x-employee-id"]
        ? Number(req.headers["x-employee-id"])
        : null;
      const fixMode = String(mode || "");
      if (!["push_to_shopify", "pull_to_local"].includes(fixMode)) {
        return res
          .status(400)
          .json({ error: "mode must be 'push_to_shopify' or 'pull_to_local'" });
      }

      db.get(
        "SELECT * FROM inventory_reconciliation WHERE id = ?",
        [id],
        (rowErr, row) => {
          if (rowErr) return res.status(500).json({ error: rowErr.message });
          if (!row)
            return res
              .status(404)
              .json({ error: "Reconciliation row not found" });

          db.get(
            `SELECT id
         FROM approval_requests
         WHERE reference_type = 'reconciliation'
           AND reference_id = ?
           AND status = 'pending_approval'`,
            [id],
            (pendingErr, pendingReq) => {
              if (pendingErr)
                return res.status(500).json({ error: pendingErr.message });
              if (pendingReq) {
                return res.status(409).json({
                  error:
                    "A reconciliation approval is already pending for this row",
                });
              }

              const notes = JSON.stringify({
                mode: fixMode,
                note: note || null,
                diff: row.diff,
                local_qty: row.local_qty,
                external_qty: row.external_qty,
                product_id: row.product_id,
                variant_id: row.variant_id || null,
                outlet_id: row.outlet_id,
                requester_employee_id: requesterEmployeeId || null,
                requested_at: new Date().toISOString(),
              });

              db.run(
                `INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes, status)
             VALUES ('reconciliation_fix', ?, 'reconciliation', ?, ?, 'pending_approval')`,
                [
                  id,
                  requested_by ||
                    (requesterEmployeeId ? String(requesterEmployeeId) : null),
                  notes,
                ],
                function (insErr) {
                  if (insErr)
                    return res.status(500).json({ error: insErr.message });
                  logActionHistory(
                    req,
                    "reconciliation_fix_request",
                    `Reconciliation fix requested for row #${id} mode=${fixMode}`,
                  );
                  return res.json({
                    message: "Reconciliation fix approval request submitted",
                    approval_request_id: this.lastID,
                  });
                },
              );
            },
          );
        },
      );
    },
  );

  app.post(
    "/api/reconciliation/inventory/:id/approve-fix",
    requireAnyPerm(["manage_orders", "manage_employees"]),
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { action, action_by, reason } = req.body || {};
      const approverEmployeeId = req.headers["x-employee-id"]
        ? Number(req.headers["x-employee-id"])
        : null;
      if (!["approved", "rejected"].includes(String(action))) {
        return res
          .status(400)
          .json({ error: "action must be 'approved' or 'rejected'" });
      }

      db.get(
        "SELECT * FROM inventory_reconciliation WHERE id = ?",
        [id],
        (rowErr, row) => {
          if (rowErr) return res.status(500).json({ error: rowErr.message });
          if (!row)
            return res
              .status(404)
              .json({ error: "Reconciliation row not found" });

          db.get(
            `SELECT *
       FROM approval_requests
       WHERE reference_type = 'reconciliation'
         AND reference_id = ?
         AND status = 'pending_approval'
       ORDER BY id DESC
       LIMIT 1`,
            [id],
            (reqErr, approvalReq) => {
              if (reqErr)
                return res.status(500).json({ error: reqErr.message });
              if (!approvalReq)
                return res.status(404).json({
                  error: "No pending approval request found for this row",
                });

              let parsedNotes = {};
              try {
                parsedNotes = JSON.parse(approvalReq.notes || "{}");
              } catch {
                parsedNotes = {};
              }
              const mode = String(parsedNotes.mode || "");
              if (!["push_to_shopify", "pull_to_local"].includes(mode)) {
                return res
                  .status(400)
                  .json({ error: "Pending request is missing a valid mode" });
              }
              const requesterFromNotes =
                Number(parsedNotes.requester_employee_id || 0) || null;
              const requesterFromColumn =
                Number(approvalReq.requested_by || 0) || null;
              const requesterEmployeeId =
                requesterFromNotes || requesterFromColumn;
              const approverPerms = req.employeePerms || [];
              const isAllAccessApprover = approverPerms.includes("all_access");
              if (
                !isAllAccessApprover &&
                !canApproveReconciliationRequest({
                  requesterEmployeeId,
                  approverEmployeeId,
                })
              ) {
                return res.status(403).json({
                  error:
                    "Requester cannot approve or reject their own reconciliation fix request",
                });
              }

              const finalizeApproval = (finalStatus, extraMessage = null) => {
                const actionReasonPayload = JSON.stringify({
                  note: reason || null,
                  mode,
                  row_id: Number(id),
                  requester_employee_id: requesterEmployeeId || null,
                  approver_employee_id: approverEmployeeId || null,
                  local_qty_before: Number(row.local_qty || 0),
                  external_qty_before: Number(row.external_qty || 0),
                  diff_before: Number(row.diff || 0),
                  decision_at: new Date().toISOString(),
                });
                db.serialize(() => {
                  db.run(
                    "UPDATE approval_requests SET status = ? WHERE id = ?",
                    [finalStatus, approvalReq.id],
                  );
                  db.run(
                    "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
                    [
                      approvalReq.id,
                      finalStatus,
                      action_by ||
                        (approverEmployeeId
                          ? String(approverEmployeeId)
                          : null),
                      actionReasonPayload,
                    ],
                  );
                });
                return res.json({
                  message:
                    finalStatus === "approved"
                      ? extraMessage ||
                        "Reconciliation fix approved and applied"
                      : "Reconciliation fix rejected",
                });
              };

              if (action === "rejected") {
                logActionHistory(
                  req,
                  "reconciliation_fix_reject",
                  `Reconciliation fix request rejected for row #${id}`,
                );
                return finalizeApproval("rejected");
              }

              executeReconciliationFix(req, row, mode, (fixErr, fixResult) => {
                if (fixErr)
                  return res.status(500).json({ error: fixErr.message });
                logActionHistory(
                  req,
                  "reconciliation_fix_approve",
                  `Reconciliation fix approved for row #${id} mode=${mode}`,
                );
                return finalizeApproval("approved", fixResult?.message || null);
              });
            },
          );
        },
      );
    },
  );

  app.get(
    "/api/reconciliation/inventory/:id/audit",
    requireAnyPerm(["manage_inventory", "manage_employees", "view_reports"]),
    (req, res) => {
      const { id } = req.params;
      db.get(
        `SELECT ir.*,
            p.name as product_name,
            o.name as outlet_name
     FROM inventory_reconciliation ir
     LEFT JOIN products p ON p.id = ir.product_id
     LEFT JOIN outlets o ON o.id = ir.outlet_id
     WHERE ir.id = ?`,
        [id],
        (rowErr, row) => {
          if (rowErr) return res.status(500).json({ error: rowErr.message });
          if (!row)
            return res
              .status(404)
              .json({ error: "Reconciliation row not found" });

          db.all(
            `SELECT *
         FROM approval_requests
         WHERE reference_type = 'reconciliation'
           AND reference_id = ?
         ORDER BY id DESC`,
            [id],
            (reqErr, requests) => {
              if (reqErr)
                return res.status(500).json({ error: reqErr.message });
              const requestIds = (requests || []).map((r) => r.id);
              if (requestIds.length === 0) {
                return res.json({
                  row,
                  approval_requests: [],
                  approval_actions: [],
                });
              }
              const placeholders = requestIds.map(() => "?").join(",");
              db.all(
                `SELECT *
             FROM approval_actions
             WHERE approval_request_id IN (${placeholders})
             ORDER BY id DESC`,
                requestIds,
                (actErr, actions) => {
                  if (actErr)
                    return res.status(500).json({ error: actErr.message });
                  return res.json({
                    row,
                    approval_requests: requests || [],
                    approval_actions: actions || [],
                  });
                },
              );
            },
          );
        },
      );
    },
  );

  // --- APPROVAL WORKFLOW TABLES (Phase 1) ---
  // Ensure approval tables exist on startup (idempotent)
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_type TEXT NOT NULL,
    reference_id INTEGER NOT NULL,
    reference_type TEXT NOT NULL,
    requested_by TEXT,
    status TEXT DEFAULT 'pending_approval',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS approval_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_request_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    action_by TEXT,
    reason TEXT,
    actioned_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  });

  // --- ROUTES: APPROVAL WORKFLOW ---

  // List pending approvals (with context info)
  app.get("/api/approvals", requireFeature("approvals"), (req, res) => {
    const { status = "pending_approval" } = req.query;
    db.all(
      `SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC`,
      [status],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ approvals: rows });
      },
    );
  });

  // Submit a PO for approval
  app.post(
    "/api/purchase-orders/:id/submit",
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { requested_by, notes } = req.body;

      db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status !== "Draft")
          return res
            .status(400)
            .json({ error: "Only Draft POs can be submitted for approval" });

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run(
            "UPDATE purchase_orders SET status = 'pending_approval' WHERE id = ?",
            [id],
            (err) => {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }
            },
          );
          db.run(
            "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('po_approval', ?, 'purchase_order', ?, ?)",
            [id, requested_by || null, notes || null],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }
              db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                  message: "PO submitted for approval",
                  approval_request_id: this.lastID,
                });
              });
            },
          );
        });
      });
    },
  );

  // Approve or reject a PO
  app.post(
    "/api/purchase-orders/:id/approve",
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { action, action_by, reason } = req.body; // action: 'approved' | 'rejected'

      if (!["approved", "rejected"].includes(action)) {
        return res
          .status(400)
          .json({ error: "action must be 'approved' or 'rejected'" });
      }

      db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status !== "pending_approval")
          return res.status(400).json({
            error: "Only POs pending approval can be approved/rejected",
          });

        db.get(
          "SELECT id FROM approval_requests WHERE reference_type = 'purchase_order' AND reference_id = ? AND status = 'pending_approval'",
          [id],
          (err, req_row) => {
            if (err) return res.status(500).json({ error: err.message });

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              db.run("UPDATE purchase_orders SET status = ? WHERE id = ?", [
                action === "approved" ? "Approved" : "Draft",
                id,
              ]);
              if (req_row) {
                db.run("UPDATE approval_requests SET status = ? WHERE id = ?", [
                  action,
                  req_row.id,
                ]);
                db.run(
                  "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
                  [req_row.id, action, action_by || null, reason || null],
                );
              }
              db.run(
                "INSERT INTO action_history (user_name, action_type, description) VALUES (?, 'po_approval', ?)",
                [
                  action_by || "System",
                  `PO #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`,
                ],
              );
              db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: `PO ${action} successfully` });
              });
            });
          },
        );
      });
    },
  );

  // Submit a transfer for approval
  app.post(
    "/api/transfers/:id/submit",
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { requested_by, notes } = req.body;

      db.get(
        "SELECT * FROM inventory_transfers WHERE id = ?",
        [id],
        (err, tr) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!tr) return res.status(404).json({ error: "Transfer not found" });
          if (tr.status !== "draft")
            return res.status(400).json({
              error: "Only draft transfers can be submitted for approval",
            });

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run(
              "UPDATE inventory_transfers SET status = 'pending_approval' WHERE id = ?",
              [id],
              (err) => {
                if (err) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err.message });
                }
              },
            );
            db.run(
              "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('str_approval', ?, 'transfer', ?, ?)",
              [id, requested_by || null, notes || null],
              function (err) {
                if (err) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err.message });
                }
                db.run("COMMIT", (err) => {
                  if (err) return res.status(500).json({ error: err.message });
                  res.json({
                    message: "Transfer submitted for approval",
                    approval_request_id: this.lastID,
                  });
                });
              },
            );
          });
        },
      );
    },
  );

  // Approve or reject a transfer
  app.post(
    "/api/transfers/:id/approve",
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { action, action_by, reason } = req.body;

      if (!["approved", "rejected"].includes(action)) {
        return res
          .status(400)
          .json({ error: "action must be 'approved' or 'rejected'" });
      }

      db.get(
        "SELECT * FROM inventory_transfers WHERE id = ?",
        [id],
        (err, tr) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!tr) return res.status(404).json({ error: "Transfer not found" });
          if (tr.status !== "pending_approval")
            return res.status(400).json({
              error: "Only transfers pending approval can be approved/rejected",
            });

          db.get(
            "SELECT id FROM approval_requests WHERE reference_type = 'transfer' AND reference_id = ? AND status = 'pending_approval'",
            [id],
            (err, req_row) => {
              if (err) return res.status(500).json({ error: err.message });

              db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                db.run(
                  "UPDATE inventory_transfers SET status = ? WHERE id = ?",
                  [action === "approved" ? "approved" : "draft", id],
                );
                if (req_row) {
                  db.run(
                    "UPDATE approval_requests SET status = ? WHERE id = ?",
                    [action, req_row.id],
                  );
                  db.run(
                    "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
                    [req_row.id, action, action_by || null, reason || null],
                  );
                }
                db.run(
                  "INSERT INTO action_history (user_name, action_type, description) VALUES (?, 'str_approval', ?)",
                  [
                    action_by || "System",
                    `Transfer #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`,
                  ],
                );
                db.run("COMMIT", (err) => {
                  if (err) return res.status(500).json({ error: err.message });
                  res.json({ message: `Transfer ${action} successfully` });
                });
              });
            },
          );
        },
      );
    },
  );
};
