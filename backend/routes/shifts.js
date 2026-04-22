module.exports = function (app, deps) {
  const { db, createNotification, requirePerm } = deps;
  const { validate } = require("../middleware/validate");
  const {
    OpenShiftSchema,
    CloseShiftSchema,
    VarianceApproveSchema,
  } = require("../schemas/shifts");
  const { getFeatureFlagsMap } = require("../middleware/feature-flags");
  const { verifyManagerPin } = require("../services/manager-pin");

  async function storeShiftDenominations(client, shiftId, stage, denominations = []) {
    const rows = Array.isArray(denominations)
      ? denominations.filter((d) => Number(d?.count || 0) > 0)
      : [];
    for (const row of rows) {
      await client.query(
        "INSERT INTO shift_denominations (shift_id, stage, denomination, count) VALUES ($1, $2, $3, $4)",
        [Number(shiftId), stage, Number(row.denomination), Number(row.count)]
      );
    }
  }

  // GET all shifts (newest first, with outlet + employee names)
  app.get("/api/shifts", async (req, res) => {
    const { outlet_id } = req.query;
    let query = `
    SELECT cs.*, o.name as outlet_name, e.name as employee_name
    FROM cash_shifts cs
    JOIN outlets o ON cs.outlet_id = o.id
    LEFT JOIN employees e ON cs.employee_id = e.id
    `;
    const params = [];
    if (outlet_id) {
      query += " WHERE cs.outlet_id = $1";
      params.push(outlet_id);
    }
    query += " ORDER BY cs.opened_at DESC";

    try {
      const { rows } = await db.query(query, params);
      res.json({ shifts: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET active shift for an outlet (used by POS to check before checkout)
  app.get("/api/shifts/active", async (req, res) => {
    const { outlet_id } = req.query;
    if (!outlet_id) return res.status(400).json({ error: "outlet_id is required" });

    try {
      const { rows } = await db.query(
        `SELECT cs.*, o.name as outlet_name, e.name as employee_name
         FROM cash_shifts cs
         JOIN outlets o ON cs.outlet_id = o.id
         LEFT JOIN employees e ON cs.employee_id = e.id
         WHERE cs.outlet_id = $1 AND cs.status = 'open'
         ORDER BY cs.opened_at DESC LIMIT 1`,
        [outlet_id]
      );
      res.json({ shift: rows[0] || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST open a new shift
  app.post("/api/shifts/open", requirePerm("manage_orders"), validate(OpenShiftSchema), async (req, res) => {
    const { outlet_id, employee_id, opening_float, denominations } = req.body;

    try {
      // Check if there's already an open shift for this outlet
      const { rows: existing } = await db.query(
        "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open'",
        [outlet_id]
      );
      if (existing.length) {
        return res.status(400).json({
          error: "A shift is already open for this outlet. Close it first.",
        });
      }

      const { rows } = await db.query(
        "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float) VALUES ($1, $2, $3) RETURNING id",
        [outlet_id, employee_id || null, opening_float]
      );
      const shiftId = rows[0].id;

      // Store denominations using a separate client to avoid search_path issues
      if (denominations && denominations.length) {
        // Use the same db proxy (which holds our test client)
        const fakeClient = { query: (sql, params) => db.query(sql, params) };
        await storeShiftDenominations(fakeClient, shiftId, "opening", denominations);
      }

      if (typeof createNotification === "function") {
        createNotification("shift_open", "Shift Opened", `Shift opened at outlet #${outlet_id}`, "/cash-management");
      }
      res.json({ message: "Shift opened successfully", shift_id: shiftId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST close a shift — auto-calculates expected cash from cash sales during shift period
  app.post("/api/shifts/:id/close", requirePerm("manage_orders"), validate(CloseShiftSchema), async (req, res) => {
    const { id } = req.params;
    const { closing_cash, notes, variance_reason, variance_approved_by, denominations } = req.body;

    try {
      // Get the shift first
      const { rows: shiftRows } = await db.query(
        "SELECT * FROM cash_shifts WHERE id = $1 AND status = 'open'",
        [id]
      );
      if (!shiftRows.length) return res.status(404).json({ error: "Open shift not found" });
      const shift = shiftRows[0];

      const closedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

      // Sum all cash payments for this outlet during this shift period
      const { rows: cashRows } = await db.query(
        `SELECT COALESCE(SUM(sp.amount), 0) as cash_sales
         FROM sale_payments sp
         JOIN sales s ON sp.sale_id = s.id
         WHERE s.outlet_id = $1
           AND s.voided = false
           AND sp.payment_method = 'Cash'
           AND s.timestamp >= $2
           AND s.timestamp <= $3`,
        [shift.outlet_id, shift.opened_at, closedAt]
      );
      const cashSales = Number(cashRows[0]?.cash_sales || 0);

      const { rows: refundRows } = await db.query(
        `SELECT COALESCE(SUM(total_refund), 0) as cash_refunds
         FROM returns
         WHERE outlet_id = $1
           AND refund_method = 'Cash'
           AND timestamp >= $2
           AND timestamp <= $3`,
        [shift.outlet_id, shift.opened_at, closedAt]
      );
      const cashRefunds = Number(refundRows[0]?.cash_refunds || 0);
      const netCashSales = cashSales - cashRefunds;
      const expectedCash = parseFloat(shift.opening_float) + netCashSales;
      const variance = parseFloat(closing_cash) - expectedCash;

      // 2-G.17: if risk controls are on AND abs(variance) exceeds the tenant
      // threshold, require both a variance_reason and a valid manager PIN.
      // We resolve the manager to an employee id and store it in
      // variance_approved_by (which is a TEXT column today — keep using the
      // name to preserve backwards compat with existing data).
      let resolvedVarianceApprovedBy = variance_approved_by || null;
      try {
        const flags = await getFeatureFlagsMap(req.tenantId);
        if (flags.phase2g_risk_controls) {
          const { rows: thrRows } = await db.query(
            "SELECT variance_approval_threshold FROM risk_controls_config WHERE id = 1",
          );
          const threshold = Number(thrRows[0]?.variance_approval_threshold || 0);
          if (threshold > 0 && Math.abs(variance) > threshold) {
            if (!variance_reason) {
              return res.status(400).json({
                error: "variance_reason is required — variance exceeds tenant threshold",
                code: "variance_reason_required",
                threshold,
              });
            }
            const approverPin = req.body?.variance_approved_by_pin;
            if (!approverPin) {
              return res.status(400).json({
                error: "Manager PIN required — variance exceeds tenant threshold",
                code: "manager_pin_required",
                threshold,
              });
            }
            try {
              const manager = await verifyManagerPin(db, String(approverPin), {
                requiredPerm: "manage_orders",
                isImpersonating: req.isImpersonating === true,
              });
              resolvedVarianceApprovedBy = String(manager.employee_id);
            } catch (pinErr) {
              const status = pinErr.statusCode || 403;
              return res.status(status).json({ error: pinErr.message });
            }
          }
        }
      } catch { /* flag lookup failure → legacy behavior */ }

      await db.query(
        `UPDATE cash_shifts
         SET status = 'closed', closing_cash = $1, expected_cash = $2, variance = $3,
             closed_at = $4, notes = $5, variance_reason = $6, variance_approved_by = $7
         WHERE id = $8`,
        [closing_cash, expectedCash, variance, closedAt, notes || null, variance_reason || null, resolvedVarianceApprovedBy, id]
      );

      if (denominations && denominations.length) {
        const fakeClient = { query: (sql, params) => db.query(sql, params) };
        await storeShiftDenominations(fakeClient, id, "closing", denominations);
      }

      if (typeof createNotification === "function") {
        createNotification("shift_close", "Shift Closed", `Shift #${id} closed. Variance: ${Number(variance || 0).toFixed(2)}`, "/cash-management");
      }

      res.json({
        message: "Shift closed successfully",
        opening_float: shift.opening_float,
        cash_sales: cashSales,
        cash_refunds: cashRefunds,
        net_cash_sales: netCashSales,
        expected_cash: expectedCash,
        closing_cash,
        variance,
        variance_reason: variance_reason || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET denomination breakdown for a shift
  app.get("/api/shifts/:id/denominations", async (req, res) => {
    const params = [req.params.id];
    const { stage } = req.query;
    let sql = "SELECT stage, denomination, count, subtotal FROM shift_denominations WHERE shift_id = $1";
    if (stage === "opening" || stage === "closing") {
      sql += " AND stage = $2";
      params.push(stage);
    }
    sql += " ORDER BY stage ASC, denomination DESC";
    try {
      const { rows } = await db.query(sql, params);
      res.json({ denominations: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT approve a closed shift's variance — records approver + optional note
  app.put(
    "/api/shifts/:id/variance-approve",
    requirePerm("manage_orders"),
    validate(VarianceApproveSchema),
    async (req, res) => {
      const { id } = req.params;
      const { approved_by, approval_note } = req.body;
      try {
        const noteText = approval_note || "";
        const { rows } = await db.query(
          `UPDATE cash_shifts
           SET variance_approved_by = $1,
               notes = CASE
                 WHEN notes IS NULL OR notes = '' THEN 'Approval: ' || $2
                 ELSE notes || ' | Approval: ' || $2
               END
           WHERE id = $3 AND status = 'closed' AND variance IS NOT NULL
           RETURNING id, variance, variance_approved_by, notes`,
          [approved_by, noteText, id]
        );
        if (!rows.length) {
          return res.status(404).json({ error: "Closed shift with variance not found" });
        }
        if (typeof createNotification === "function") {
          createNotification(
            "shift_variance_approved",
            "Shift Variance Approved",
            `Shift #${id} variance approved by ${approved_by}`,
            "/cash-management"
          );
        }
        res.json({ shift: rows[0] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET variance reason codes (static list)
  app.get("/api/variance-reasons", (req, res) => {
    res.json({
      reasons: [
        "Counting error",
        "Till refund not recorded",
        "Change given incorrectly",
        "Currency denomination mix-up",
        "Tip/gratuity retained",
        "Manager override",
        "Other",
      ],
    });
  });
};
