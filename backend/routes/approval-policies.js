const bcrypt = require("bcryptjs");
const { evaluatePolicy, recordApprovalEvent } = require("../services/approval-policy");

module.exports = function registerApprovalPolicyRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  // List approval policies
  app.get("/api/approval-policies", requireFeature("phase2_pos_approvals"), async (req, res) => {
    try {
      const { action_type } = req.query;
      let sql = `
        SELECT ap.*, r.name as role_name, o.name as outlet_name
        FROM approval_policies ap
        LEFT JOIN roles r ON ap.role_id = r.id
        LEFT JOIN outlets o ON ap.outlet_id = o.id
        WHERE ap.is_active = TRUE
      `;
      const params = [];
      if (action_type) {
        params.push(action_type);
        sql += ` AND ap.action_type = $${params.length}`;
      }
      sql += " ORDER BY ap.action_type, ap.outlet_id NULLS LAST, ap.role_id NULLS LAST";
      const { rows } = await db.query(sql, params);
      res.json({ policies: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create approval policy
  app.post("/api/approval-policies", requireFeature("phase2_pos_approvals"), requirePerm("all_access"), async (req, res) => {
    const { action_type, outlet_id, role_id, policy, threshold_value, threshold_type } = req.body;
    if (!action_type || !policy) {
      return res.status(400).json({ error: "action_type and policy are required" });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO approval_policies (action_type, outlet_id, role_id, policy, threshold_value, threshold_type)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [action_type, outlet_id || null, role_id || null, policy, threshold_value || null, threshold_type || null]
      );
      res.status(201).json({ policy: rows[0] });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "A policy for this action/outlet/role combination already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Update approval policy
  app.put("/api/approval-policies/:id", requireFeature("phase2_pos_approvals"), requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { action_type, outlet_id, role_id, policy, threshold_value, threshold_type } = req.body;
    try {
      const { rows, rowCount } = await db.query(
        `UPDATE approval_policies
         SET action_type = COALESCE($1, action_type),
             outlet_id = $2,
             role_id = $3,
             policy = COALESCE($4, policy),
             threshold_value = $5,
             threshold_type = $6,
             updated_at = NOW()
         WHERE id = $7 AND is_active = TRUE
         RETURNING *`,
        [action_type, outlet_id || null, role_id || null, policy, threshold_value || null, threshold_type || null, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Policy not found" });
      res.json({ policy: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Soft-delete approval policy
  app.delete("/api/approval-policies/:id", requireFeature("phase2_pos_approvals"), requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query(
        "UPDATE approval_policies SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active = TRUE",
        [id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Policy not found" });
      res.json({ message: "Policy deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POS authorize — manager PIN validation + approval event recording
  app.post("/api/approvals/pos-authorize", async (req, res) => {
    const { action_type, reference_type, reference_id, manager_pin, outlet_id, metadata } = req.body;
    if (!action_type || !manager_pin) {
      return res.status(400).json({ error: "action_type and manager_pin are required" });
    }

    const requestedBy = Number(req.headers["x-employee-id"] || 0);
    if (!requestedBy) return res.status(401).json({ error: "Unauthorized" });

    try {
      // Validate manager PIN
      const { rows: employees } = await db.query(
        `SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, r.name as role
         FROM employees e
         LEFT JOIN roles r ON e.role_id = r.id`
      );

      let manager = null;
      for (const emp of employees) {
        let match = false;
        if (emp.pin_hash) {
          match = await bcrypt.compare(String(manager_pin), emp.pin_hash);
        } else if (emp.pin_code) {
          match = String(manager_pin) === String(emp.pin_code);
        }
        if (match) {
          manager = emp;
          break;
        }
      }

      if (!manager) {
        return res.status(401).json({ error: "Invalid manager PIN" });
      }

      // Check manager has sufficient permissions
      const { rows: permRows } = await db.query(
        `SELECT permission FROM role_permissions WHERE role_id = $1`,
        [manager.role_id]
      );
      const perms = permRows.map(r => r.permission);
      if (!perms.includes("all_access") && !perms.includes("manage_pos")) {
        return res.status(403).json({ error: "Insufficient permissions for approval" });
      }

      // Record the approval event
      const event = await recordApprovalEvent(db, {
        policyId: null,
        actionType: action_type,
        referenceType: reference_type || "sale",
        referenceId: reference_id || null,
        requestedBy,
        approvedBy: manager.id,
        status: "approved",
        reason: `Approved by ${manager.name}`,
        metadata: metadata || null,
        outletId: outlet_id || null,
      });

      res.json({ authorized: true, approval_event: event, approver: { id: manager.id, name: manager.name } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Evaluate policy (check only, no recording)
  app.post("/api/approvals/evaluate", requireFeature("phase2_pos_approvals"), async (req, res) => {
    const { action_type, outlet_id, role_id, value } = req.body;
    if (!action_type) return res.status(400).json({ error: "action_type is required" });
    try {
      const result = await evaluatePolicy(db, { actionType: action_type, outletId: outlet_id, roleId: role_id, value });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
