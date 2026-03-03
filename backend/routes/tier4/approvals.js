const express = require("express");

module.exports = function createApprovalsRouter(deps) {
  const router = express.Router();
  const { db, requireFeature, requirePerm, requireAnyPerm } = deps;

  // List pending approvals (with context info)
  router.get("/api/approvals", requireFeature("approvals"), (req, res) => {
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
  router.post(
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
  router.post(
    "/api/purchase-orders/:id/approve",
    requireFeature("approvals"),
    (req, res) => {
      const { id } = req.params;
      const { action, action_by, reason } = req.body;

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
  router.post(
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
  router.post(
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

  return router;
};
