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

  async function getActiveShopifyConnection() {
    return _getActiveShopifyConnection(db, decryptShopifySecret);
  }

  async function logActionHistory(req, actionType, description) {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return;
    try {
      const { rows } = await db.query("SELECT name FROM employees WHERE id = $1", [employeeId]);
      const userName = rows[0]?.name || "System";
      await db.query(
        "INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3)",
        [userName, actionType, description]
      );
    } catch { /* fire-and-forget */ }
  }

  // GET reconciliation list
  app.get(
    "/api/integrations/shopify/reconciliation",
    requireAnyPerm(["view_reports", "manage_inventory"]),
    async (req, res) => {
      try {
        const { status, resolution_status } = req.query;
        const where = ["1=1"];
        const params = [];
        let idx = 1;
        if (status) {
          where.push(`ir.status = $${idx++}`);
          params.push(status);
        }
        if (resolution_status) {
          where.push(`ir.resolution_status = $${idx++}`);
          params.push(resolution_status);
        }
        const { rows } = await db.query(
          `SELECT ir.*,
                  p.name as product_name,
                  p.barcode,
                  o.name as outlet_name
           FROM inventory_reconciliation ir
           LEFT JOIN products p ON p.id = ir.product_id
           LEFT JOIN outlets o ON o.id = ir.outlet_id
           WHERE ${where.join(" AND ")}
           ORDER BY ir.checked_at DESC, ABS(ir.diff) DESC`,
          params
        );
        const mapped = (rows || []).map(r => ({
          ...r,
          pos_qty: r.local_qty,
          shopify_qty: r.external_qty,
        }));
        res.json({ rows: mapped });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST run reconciliation
  app.post(
    "/api/integrations/shopify/reconciliation",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });

        const { rows: mappedRows } = await db.query(
          `SELECT spm.product_id,
                  spm.variant_id,
                  spm.shopify_inventory_item_id,
                  slm.outlet_id,
                  slm.shopify_location_id,
                  COALESCE(SUM(os.quantity), 0) as local_qty
           FROM shopify_product_map spm
           JOIN shopify_location_map slm ON true
           LEFT JOIN outlet_stock os
             ON os.product_id = spm.product_id
            AND os.outlet_id = slm.outlet_id
           WHERE spm.is_active = true
             AND spm.shopify_inventory_item_id IS NOT NULL
           GROUP BY spm.product_id, spm.variant_id, spm.shopify_inventory_item_id, slm.outlet_id, slm.shopify_location_id`
        );

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
            if (!byLocation[r.shopify_location_id]) byLocation[r.shopify_location_id] = [];
            byLocation[r.shopify_location_id].push(r);
          });

          for (const locId of Object.keys(byLocation)) {
            const locBatch = byLocation[locId];
            const itemIds = locBatch.map((r) => r.shopify_inventory_item_id);
            try {
              const remoteLevels = await fetchInventoryLevelsBatch(conn, itemIds, locId);
              const remoteMap = new Map(
                remoteLevels.map((l) => [l.inventory_item_id, l.available])
              );

              for (const row of locBatch) {
                const localQty = Number(row.local_qty || 0);
                const externalQty = Number(
                  remoteMap.get(`gid://shopify/InventoryItem/${row.shopify_inventory_item_id}`) ?? 0
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

        await db.transaction(async (client) => {
          await client.query("DELETE FROM inventory_reconciliation");
          for (const r of rowsToInsert) {
            await client.query(
              `INSERT INTO inventory_reconciliation (
                 product_id, variant_id, outlet_id, external_location_id,
                 local_qty, external_qty, diff, status, checked_at,
                 resolution_status, resolution_note
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)`,
              [
                r.product_id, r.variant_id, r.outlet_id, r.external_location_id,
                r.local_qty, r.external_qty, r.diff, r.status,
                r.resolution_status, r.resolution_note || null,
              ]
            );
          }
        });

        res.json({
          message: "Live reconciliation completed",
          row_count: rowsToInsert.length,
          matched,
          mismatch,
          errors: errorsCount,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // PUT resolve reconciliation row
  app.put(
    "/api/integrations/shopify/reconciliation/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { resolution_status = "resolved", resolution_note = null } = req.body || {};
        const allowed = ["open", "resolved", "ignored"];
        if (!allowed.includes(String(resolution_status))) {
          return res.status(400).json({
            error: `resolution_status must be one of: ${allowed.join(", ")}`,
          });
        }
        const resolvedBy = req.headers["x-employee-id"]
          ? Number(req.headers["x-employee-id"])
          : null;
        const { rowCount } = await db.query(
          `UPDATE inventory_reconciliation
           SET resolution_status = $1, resolution_note = $2, resolved_by = $3,
               resolved_at = CASE WHEN $1 = 'open' THEN NULL ELSE NOW() END
           WHERE id = $4`,
          [resolution_status, resolution_note, resolvedBy, id]
        );
        if (rowCount === 0)
          return res.status(404).json({ error: "Not found" });
        logActionHistory(req, "reconciliation_resolve", `Row #${id} marked as ${resolution_status}`);
        res.json({ message: "Updated successfully" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST request fix (creates approval request)
  app.post(
    "/api/integrations/shopify/reconciliation/:id/fix",
    requirePerm("manage_inventory"),
    requireFeature("approvals"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { mode, note } = req.body || {};
        const requesterEmployeeId = req.headers["x-employee-id"]
          ? Number(req.headers["x-employee-id"])
          : null;

        const { rows } = await db.query(
          "SELECT * FROM inventory_reconciliation WHERE id = $1", [id]
        );
        const row = rows[0];
        if (!row) return res.status(404).json({ error: "Not found" });

        const notes = JSON.stringify({
          mode, note,
          diff: row.diff,
          local_qty: row.local_qty,
          external_qty: row.external_qty,
          product_id: row.product_id,
          outlet_id: row.outlet_id,
          requester_employee_id: requesterEmployeeId,
          requested_at: new Date().toISOString(),
        });

        const { rows: insRows } = await db.query(
          `INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes)
           VALUES ('reconciliation_fix', $1, 'reconciliation', $2, $3)
           RETURNING id`,
          [id, requesterEmployeeId ? String(requesterEmployeeId) : null, notes]
        );
        logActionHistory(req, "reconciliation_fix_request", `Fix requested for row #${id}`);
        res.json({ message: "Approval request submitted", approval_request_id: insRows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST bulk action
  app.post(
    "/api/integrations/shopify/reconciliation/bulk",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { ids, action, mode } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0)
          return res.status(400).json({ error: "ids required" });

        if (action === "ignore") {
          const employeeId = req.headers["x-employee-id"]
            ? Number(req.headers["x-employee-id"])
            : null;
          const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
          const { rowCount } = await db.query(
            `UPDATE inventory_reconciliation SET resolution_status = 'ignored', resolved_by = $1, resolved_at = NOW()
             WHERE id IN (${placeholders})`,
            [employeeId, ...ids]
          );
          logActionHistory(req, "reconciliation_bulk_ignore", `Ignored ${rowCount} rows`);
          res.json({ message: `Ignored ${rowCount} items` });
        } else if (action === "fix") {
          if (!mode || !["pos_wins", "shopify_wins"].includes(mode)) {
            return res.status(400).json({ error: "mode must be 'pos_wins' or 'shopify_wins'" });
          }
          const employeeId = req.headers["x-employee-id"]
            ? Number(req.headers["x-employee-id"])
            : null;

          let fixedCount = 0;
          await db.transaction(async (client) => {
            if (mode === "shopify_wins") {
              const { rows } = await client.query(
                `SELECT product_id, outlet_id, external_qty
                 FROM inventory_reconciliation WHERE id = ANY($1::int[])`,
                [ids]
              );
              for (const row of rows) {
                await client.query(
                  `UPDATE outlet_stock SET quantity = $1
                   WHERE product_id = $2 AND outlet_id = $3`,
                  [row.external_qty, row.product_id, row.outlet_id]
                );
              }
            }
            // pos_wins: no stock changes needed — Shopify sync will push POS values

            const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
            const result = await client.query(
              `UPDATE inventory_reconciliation
               SET resolution_status = 'resolved', resolved_by = $1, resolved_at = NOW()
               WHERE id IN (${placeholders})`,
              [employeeId, ...ids]
            );
            fixedCount = result.rowCount;
          });

          logActionHistory(req, "reconciliation_bulk_fix", `Fixed ${fixedCount} rows (mode: ${mode})`);
          res.json({ message: `Fixed ${fixedCount} items` });
        } else {
          res.status(400).json({ error: "Invalid action" });
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
