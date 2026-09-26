const {
  getActiveShopifyConnection: _getActiveShopifyConnection,
} = require("../../shopify/utils");
const stockCheck = require("../../shopify/stock-check");

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
    processPendingShopifyInventoryEvents,
  } = deps;
  const setShopifyInventory =
    deps.setShopifyInventory || require("../../shopify/client").setShopifyInventory;
  const shopifyFns = { fetchInventoryLevelsBatch, setShopifyInventory };
  const processPending =
    typeof processPendingShopifyInventoryEvents === "function"
      ? (limit) => processPendingShopifyInventoryEvents(limit)
      : null;
  const employeeIdOf = (req) =>
    req.employee?.id ?? (req.headers["x-employee-id"] ? Number(req.headers["x-employee-id"]) : null);

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
    requireAnyPerm(["view_inventory_reports", "manage_inventory"]),
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

  // POST run reconciliation — compare only, changes nothing on either side.
  app.post(
    "/api/integrations/shopify/reconciliation",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });
        const rows = await stockCheck.compareCounts(db, conn, shopifyFns);
        if (rows.length === 0) {
          return res.status(400).json({ error: "No mapped items found" });
        }
        await stockCheck.saveCheck(db, rows);
        const counts = rows.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, {});
        res.json({
          message: "Live reconciliation completed",
          row_count: rows.length,
          matched: counts.matched || 0,
          mismatch: counts.mismatch || 0,
          not_at_location: counts.not_at_location || 0,
          not_found: counts.not_found || 0,
          errors: counts.error || 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST set Shopify to SanoPOS counts — the owner's button. Sets Shopify's
  // "available" to SanoPOS's exact count for every mapped item that differs
  // (or only `ids`, rows of the saved check). See shopify/stock-check.js.
  app.post(
    "/api/integrations/shopify/stock/set-to-pos",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });
        const ids = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids.map(Number) : null;
        const result = await stockCheck.setShopifyToPos(db, conn, shopifyFns, {
          reconIds: ids,
          processPending,
          employeeId: employeeIdOf(req),
        });
        logActionHistory(
          req,
          "shopify_set_counts",
          `Set Shopify to SanoPOS counts: ${result.set} set, ${result.mismatch} still different, ${result.waiting} waiting`,
        );
        res.json(result);
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

          if (mode === "pos_wins") {
            // Used to only mark rows resolved (claiming "Shopify sync will
            // push POS values", which nothing did). Now it actually sets Shopify.
            const conn = await getActiveShopifyConnection();
            if (!conn)
              return res.status(400).json({ error: "No active Shopify connection" });
            const result = await stockCheck.setShopifyToPos(db, conn, shopifyFns, {
              reconIds: ids.map(Number),
              processPending,
              employeeId,
            });
            logActionHistory(req, "reconciliation_bulk_fix", `Set Shopify to SanoPOS for ${result.set} of ${ids.length} rows`);
            return res.json({ message: `Set ${result.set} item(s) on Shopify to the SanoPOS count`, ...result });
          }

          // shopify_wins: overwrite SanoPOS with Shopify's count. Plain products
          // only: a variant row's Shopify count is for one variant, and writing
          // it into the product total would corrupt SanoPOS stock.
          const { rows: picked } = await db.query(
            `SELECT id, product_id, variant_id, outlet_id, external_qty
             FROM inventory_reconciliation WHERE id = ANY($1::int[])`,
            [ids.map(Number)]
          );
          if (picked.some((r) => r.variant_id)) {
            return res.status(400).json({
              error: "Shopify wins can't be used on variant items. Correct them with a stock adjustment instead.",
            });
          }
          if (picked.some((r) => r.external_qty === null)) {
            return res.status(400).json({
              error: "Some selected items have no Shopify count to copy.",
            });
          }
          let fixedCount = 0;
          await db.transaction(async (client) => {
            for (const row of picked) {
              await client.query(
                `UPDATE outlet_stock SET quantity = $1
                 WHERE product_id = $2 AND outlet_id = $3`,
                [row.external_qty, row.product_id, row.outlet_id]
              );
            }
            const result = await client.query(
              `UPDATE inventory_reconciliation
               SET resolution_status = 'resolved', resolved_by = $1, resolved_at = NOW()
               WHERE id = ANY($2::int[])`,
              [employeeId, picked.map((r) => r.id)]
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
