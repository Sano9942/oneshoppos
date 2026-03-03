module.exports = function (app, deps) {
  const { db, createNotification } = deps;

  // GET all shifts (newest first, with outlet + employee names)
  app.get("/api/shifts", (req, res) => {
    const { outlet_id } = req.query;
    let query = `
    SELECT cs.*, o.name as outlet_name, e.name as employee_name
    FROM cash_shifts cs
    JOIN outlets o ON cs.outlet_id = o.id
    LEFT JOIN employees e ON cs.employee_id = e.id
  `;
    const params = [];
    if (outlet_id) {
      query += " WHERE cs.outlet_id = ?";
      params.push(outlet_id);
    }
    query += " ORDER BY cs.opened_at DESC";

    db.all(query, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ shifts: rows });
    });
  });

  // GET active shift for an outlet (used by POS to check before checkout)
  app.get("/api/shifts/active", (req, res) => {
    const { outlet_id } = req.query;
    if (!outlet_id)
      return res.status(400).json({ error: "outlet_id is required" });

    db.get(
      `SELECT cs.*, o.name as outlet_name, e.name as employee_name
     FROM cash_shifts cs
     JOIN outlets o ON cs.outlet_id = o.id
     LEFT JOIN employees e ON cs.employee_id = e.id
     WHERE cs.outlet_id = ? AND cs.status = 'open'
     ORDER BY cs.opened_at DESC LIMIT 1`,
      [outlet_id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ shift: row || null });
      },
    );
  });

  // POST open a new shift
  app.post("/api/shifts/open", (req, res) => {
    const { outlet_id, employee_id, opening_float } = req.body;

    if (!outlet_id || opening_float === undefined) {
      return res
        .status(400)
        .json({ error: "outlet_id and opening_float are required" });
    }

    // Check if there's already an open shift for this outlet
    db.get(
      "SELECT id FROM cash_shifts WHERE outlet_id = ? AND status = 'open'",
      [outlet_id],
      (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing) {
          return res.status(400).json({
            error: "A shift is already open for this outlet. Close it first.",
          });
        }

        db.run(
          "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float) VALUES (?, ?, ?)",
          [outlet_id, employee_id || null, opening_float],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (typeof createNotification === "function") {
              createNotification(
                "shift_open",
                "Shift Opened",
                `Shift opened at outlet #${outlet_id}`,
                "/cash-management",
              );
            }
            res.json({
              message: "Shift opened successfully",
              shift_id: this.lastID,
            });
          },
        );
      },
    );
  });

  // POST close a shift — auto-calculates expected cash from cash sales during shift period
  app.post("/api/shifts/:id/close", (req, res) => {
    const { id } = req.params;
    const {
      closing_cash,
      notes,
      variance_reason,
      variance_approved_by,
      denominations,
    } = req.body;

    if (closing_cash === undefined) {
      return res.status(400).json({ error: "closing_cash is required" });
    }

    // Get the shift first
    db.get(
      "SELECT * FROM cash_shifts WHERE id = ? AND status = 'open'",
      [id],
      (err, shift) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!shift)
          return res.status(404).json({ error: "Open shift not found" });

        // Sum all cash payments for this outlet during this shift period
        db.get(
          `SELECT COALESCE(SUM(sp.amount), 0) as cash_sales
       FROM sale_payments sp
       JOIN sales s ON sp.sale_id = s.id
       WHERE s.outlet_id = ?
         AND s.voided = 0
         AND sp.payment_method = 'Cash'
         AND s.timestamp >= ?`,
          [shift.outlet_id, shift.opened_at],
          (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            const cashSales = row?.cash_sales || 0;

            db.get(
              `SELECT COALESCE(SUM(total_refund), 0) as cash_refunds
             FROM returns
             WHERE outlet_id = ?
               AND refund_method = 'Cash'
               AND timestamp >= ?`,
              [shift.outlet_id, shift.opened_at],
              (err, refundRow) => {
                if (err) return res.status(500).json({ error: err.message });

                const cashRefunds = refundRow?.cash_refunds || 0;
                const netCashSales = cashSales - cashRefunds;
                const expectedCash =
                  parseFloat(shift.opening_float) + netCashSales;
                const variance = parseFloat(closing_cash) - expectedCash;
                const closedAt = new Date()
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19);

                db.run(
                  `UPDATE cash_shifts
               SET status = 'closed', closing_cash = ?, expected_cash = ?, variance = ?,
                   closed_at = ?, notes = ?, variance_reason = ?, variance_approved_by = ?
               WHERE id = ?`,
                  [
                    closing_cash,
                    expectedCash,
                    variance,
                    closedAt,
                    notes || null,
                    variance_reason || null,
                    variance_approved_by || null,
                    id,
                  ],
                  function (err) {
                    if (err)
                      return res.status(500).json({ error: err.message });
                    // Store denomination breakdown if provided
                    if (denominations && denominations.length > 0) {
                      const stmt = db.prepare(
                        "INSERT INTO shift_denominations (shift_id, denomination, count) VALUES (?,?,?)",
                      );
                      denominations.forEach((d) => {
                        if (d.count > 0)
                          stmt.run([id, d.denomination, d.count]);
                      });
                      stmt.finalize();
                    }
                    if (typeof createNotification === "function") {
                      createNotification(
                        "shift_close",
                        "Shift Closed",
                        `Shift #${id} closed. Variance: ${Number(variance || 0).toFixed(2)}`,
                        "/cash-management",
                      );
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
                  },
                );
              },
            );
          },
        );
      },
    );
  });

  // GET denomination breakdown for a shift
  app.get("/api/shifts/:id/denominations", (req, res) => {
    db.all(
      "SELECT denomination, count, subtotal FROM shift_denominations WHERE shift_id = ? ORDER BY denomination DESC",
      [req.params.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ denominations: rows });
      },
    );
  });

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
