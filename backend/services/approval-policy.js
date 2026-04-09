/**
 * Shared approval policy engine.
 *
 * Supported action_types:
 *   manual_discount, discount_code, return, unverified_return,
 *   void, tax_edit, order_cancel, custom_sale
 */

async function evaluatePolicy(db, { actionType, outletId, roleId, value }) {
  // Find matching policy: most specific first (outlet+role > outlet > role > global)
  const { rows } = await db.query(
    `SELECT * FROM approval_policies
     WHERE action_type = $1 AND is_active = TRUE
       AND (outlet_id = $2 OR outlet_id IS NULL)
       AND (role_id = $3 OR role_id IS NULL)
     ORDER BY
       outlet_id IS NULL ASC,
       role_id IS NULL ASC
     LIMIT 1`,
    [actionType, outletId, roleId]
  );

  if (rows.length === 0) return { policy: "allowed", policyId: null };

  const pol = rows[0];

  // Threshold check: if value is below threshold, allow regardless
  if (pol.threshold_value != null && value != null) {
    if (pol.threshold_type === "amount" && Number(value) < Number(pol.threshold_value)) {
      return { policy: "allowed", policyId: pol.id };
    }
    if (pol.threshold_type === "percent" && Number(value) < Number(pol.threshold_value)) {
      return { policy: "allowed", policyId: pol.id };
    }
  }

  return { policy: pol.policy, policyId: pol.id };
}

async function recordApprovalEvent(db, {
  policyId, actionType, referenceType, referenceId,
  requestedBy, approvedBy, status, reason, metadata, outletId,
}) {
  const { rows } = await db.query(
    `INSERT INTO approval_events
       (policy_id, action_type, reference_type, reference_id,
        requested_by, approved_by, status, reason, metadata, outlet_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [policyId, actionType, referenceType, referenceId,
     requestedBy, approvedBy, status, reason,
     metadata ? JSON.stringify(metadata) : null, outletId]
  );
  return rows[0];
}

module.exports = { evaluatePolicy, recordApprovalEvent };
