const express = require("express");

module.exports = function createApprovalsRouter(deps) {
  const router = express.Router();
  const { db, requireFeature, requirePerm, requireAnyPerm } = deps;

  // List pending approvals (with context info)
  router.get("/api/approvals", requireFeature("approvals"), async (req, res) => {
    try {
      const { status = "pending_approval" } = req.query;
      const { rows } = await db.query(
        `SELECT * FROM approval_requests WHERE status = $1 ORDER BY created_at DESC`,
        [status]
      );
      res.json({ approvals: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Submit a PO for approval
  router.post(
    "/api/purchase-orders/:id/submit",
    requireFeature("approvals"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { requested_by, notes } = req.body;

        const { rows: poRows } = await db.query(
          "SELECT * FROM purchase_orders WHERE id = $1", [id]
        );
        const po = poRows[0];
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status !== "Draft")
          return res.status(400).json({ error: "Only Draft POs can be submitted for approval" });

        const result = await db.transaction(async (client) => {
          await client.query(
            "UPDATE purchase_orders SET status = 'pending_approval' WHERE id = $1",
            [id]
          );
          const { rows } = await client.query(
            "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('po_approval', $1, 'purchase_order', $2, $3) RETURNING id",
            [id, requested_by || null, notes || null]
          );
          return rows[0].id;
        });

        res.json({
          message: "PO submitted for approval",
          approval_request_id: result,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Approve or reject a PO
  router.post(
    "/api/purchase-orders/:id/approve",
    requireFeature("approvals"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { action, action_by, reason } = req.body;

        if (!["approved", "rejected"].includes(action)) {
          return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
        }

        const { rows: poRows } = await db.query(
          "SELECT * FROM purchase_orders WHERE id = $1", [id]
        );
        const po = poRows[0];
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status !== "pending_approval")
          return res.status(400).json({ error: "Only POs pending approval can be approved/rejected" });

        const { rows: reqRows } = await db.query(
          "SELECT id FROM approval_requests WHERE reference_type = 'purchase_order' AND reference_id = $1 AND status = 'pending_approval'",
          [id]
        );
        const req_row = reqRows[0];

        await db.transaction(async (client) => {
          await client.query(
            "UPDATE purchase_orders SET status = $1 WHERE id = $2",
            [action === "approved" ? "Approved" : "Draft", id]
          );
          if (req_row) {
            await client.query(
              "UPDATE approval_requests SET status = $1 WHERE id = $2",
              [action, req_row.id]
            );
            await client.query(
              "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES ($1, $2, $3, $4)",
              [req_row.id, action, action_by || null, reason || null]
            );
          }
          await client.query(
            "INSERT INTO action_history (user_name, action_type, description) VALUES ($1, 'po_approval', $2)",
            [
              action_by || "System",
              `PO #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`,
            ]
          );
        });

        res.json({ message: `PO ${action} successfully` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Submit a transfer for approval
  router.post(
    "/api/transfers/:id/submit",
    requireFeature("approvals"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { requested_by, notes } = req.body;

        const { rows: trRows } = await db.query(
          "SELECT * FROM inventory_transfers WHERE id = $1", [id]
        );
        const tr = trRows[0];
        if (!tr) return res.status(404).json({ error: "Transfer not found" });
        if (tr.status !== "draft")
          return res.status(400).json({ error: "Only draft transfers can be submitted for approval" });

        const result = await db.transaction(async (client) => {
          await client.query(
            "UPDATE inventory_transfers SET status = 'pending_approval' WHERE id = $1",
            [id]
          );
          const { rows } = await client.query(
            "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('str_approval', $1, 'transfer', $2, $3) RETURNING id",
            [id, requested_by || null, notes || null]
          );
          return rows[0].id;
        });

        res.json({
          message: "Transfer submitted for approval",
          approval_request_id: result,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Approve or reject a transfer
  router.post(
    "/api/transfers/:id/approve",
    requireFeature("approvals"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { action, action_by, reason } = req.body;

        if (!["approved", "rejected"].includes(action)) {
          return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
        }

        const { rows: trRows } = await db.query(
          "SELECT * FROM inventory_transfers WHERE id = $1", [id]
        );
        const tr = trRows[0];
        if (!tr) return res.status(404).json({ error: "Transfer not found" });
        if (tr.status !== "pending_approval")
          return res.status(400).json({ error: "Only transfers pending approval can be approved/rejected" });

        const { rows: reqRows } = await db.query(
          "SELECT id FROM approval_requests WHERE reference_type = 'transfer' AND reference_id = $1 AND status = 'pending_approval'",
          [id]
        );
        const req_row = reqRows[0];

        await db.transaction(async (client) => {
          await client.query(
            "UPDATE inventory_transfers SET status = $1 WHERE id = $2",
            [action === "approved" ? "approved" : "draft", id]
          );
          if (req_row) {
            await client.query(
              "UPDATE approval_requests SET status = $1 WHERE id = $2",
              [action, req_row.id]
            );
            await client.query(
              "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES ($1, $2, $3, $4)",
              [req_row.id, action, action_by || null, reason || null]
            );
          }
          await client.query(
            "INSERT INTO action_history (user_name, action_type, description) VALUES ($1, 'str_approval', $2)",
            [
              action_by || "System",
              `Transfer #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`,
            ]
          );
        });

        res.json({ message: `Transfer ${action} successfully` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Approve a reconciliation fix (push local to Shopify or pull from Shopify)
  router.post(
    "/api/reconciliation/inventory/:id/approve-fix",
    requireFeature("approvals"),
    requireAnyPerm(["manage_inventory", "all_access"]),
    async (req, res) => {
      const { id } = req.params;
      const { mode } = req.body; // "push_to_shopify" or "pull_from_shopify"
      const employeeId = req.employee?.id;

      try {
        const { rows: [row] } = await db.query(
          `SELECT * FROM inventory_reconciliation WHERE id = $1`,
          [id]
        );
        if (!row) return res.status(404).json({ error: "Reconciliation row not found" });

        await db.transaction(async (client) => {
          if (mode === "push_to_shopify") {
            // Local wins — mark as resolved, Shopify sync handled separately
            await client.query(
              `UPDATE inventory_reconciliation
               SET resolution_status = 'resolved', resolved_by = $1, resolved_at = NOW()
               WHERE id = $2`,
              [employeeId, id]
            );
          } else if (mode === "pull_from_shopify") {
            // Shopify wins — update outlet_stock to match external_qty
            await client.query(
              `UPDATE outlet_stock SET quantity = $1
               WHERE product_id = $2 AND outlet_id = $3`,
              [row.external_qty, row.product_id, row.outlet_id]
            );
            await client.query(
              `UPDATE inventory_reconciliation
               SET resolution_status = 'resolved', resolved_by = $1, resolved_at = NOW()
               WHERE id = $2`,
              [employeeId, id]
            );
          } else {
            throw new Error("Invalid mode");
          }
        });

        res.json({ message: "Reconciliation fix applied" });
      } catch (err) {
        console.error("Reconciliation approve-fix error:", err);
        res.status(500).json({ error: "Failed to apply fix" });
      }
    },
  );

  return router;
};
