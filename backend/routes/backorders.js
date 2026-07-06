// V02 wholesale depth — backorder fulfillment loop.
//
// Backorders are CREATED by the order-taking surfaces (sales.js checkout,
// storefront checkout) via services/backorder.js. This file is the back-office
// side: list/filter open demand, suggest oldest-first allocation when stock
// arrives (GRN), and manage the rows. CONVERSION to an invoice deliberately
// does not live here — the Backorders screen posts to the standard
// POST /api/sales with cartItems[].backorder_id so stock locks, tax snapshot,
// AR, FBR, and F05 all run through the one sale path.
module.exports = function registerBackorderRoutes(app, deps) {
  const { db, requireAnyPerm, requirePerm, requireFeature } = deps;

  const gate = [
    requireFeature("wholesale_backorders"),
    requireAnyPerm(["manage_orders", "manage_inventory", "view_reports", "all_access"]),
  ];
  const writeGate = [
    requireFeature("wholesale_backorders"),
    requireAnyPerm(["manage_orders", "manage_inventory", "all_access"]),
  ];

  // ── List (filter by status/product/customer/age) — oldest first ─────
  app.get("/api/backorders", ...gate, async (req, res) => {
    try {
      const { status, product_id, customer_id, min_age_days, outlet_id } = req.query;
      const where = [];
      const params = [];
      const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };

      if (status) add("b.status = ?", String(status));
      else where.push("b.status IN ('open','partial')");
      if (product_id) add("b.product_id = ?", Number(product_id));
      if (customer_id) add("b.customer_id = ?", Number(customer_id));
      if (outlet_id) add("b.outlet_id = ?", Number(outlet_id));
      if (min_age_days) add("b.created_at <= NOW() - (? || ' days')::interval", Number(min_age_days));

      const { rows } = await db.query(
        `SELECT b.*, c.name AS customer_name, c.mobile AS customer_mobile,
                p.name AS product_name, pv.variant_name,
                o.name AS outlet_name,
                (b.qty_ordered - b.qty_fulfilled) AS qty_remaining,
                ROUND(((b.qty_ordered - b.qty_fulfilled) * b.unit_price)::numeric, 2) AS value_remaining,
                COALESCE(os.quantity, 0) AS stock_available
           FROM backorders b
           JOIN customers c ON c.id = b.customer_id
           JOIN products p ON p.id = b.product_id
           LEFT JOIN product_variants pv ON pv.id = b.variant_id
           LEFT JOIN outlets o ON o.id = b.outlet_id
           LEFT JOIN outlet_stock os ON os.product_id = b.product_id AND os.outlet_id = b.outlet_id
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY b.created_at ASC
          LIMIT 500`,
        params
      );
      res.json({ backorders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Open-backorder value by product (feeds purchasing) ──────────────
  app.get("/api/backorders/summary", ...gate, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT b.product_id, p.name AS product_name, p.sku,
                COUNT(*)::int AS open_count,
                SUM(b.qty_ordered - b.qty_fulfilled)::numeric AS qty_remaining,
                ROUND(SUM((b.qty_ordered - b.qty_fulfilled) * b.unit_price)::numeric, 2) AS value_remaining,
                MIN(b.created_at) AS oldest_at
           FROM backorders b
           JOIN products p ON p.id = b.product_id
          WHERE b.status IN ('open','partial')
          GROUP BY b.product_id, p.name, p.sku
          ORDER BY value_remaining DESC`
      );
      const totals = rows.reduce(
        (acc, r) => ({
          open_count: acc.open_count + Number(r.open_count),
          value_remaining: acc.value_remaining + Number(r.value_remaining),
        }),
        { open_count: 0, value_remaining: 0 }
      );
      res.json({ products: rows, totals });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Oldest-first allocation suggestion for arrived stock ────────────
  // GET /api/backorders/suggestions?product_id=X&qty=50 → walk open
  // backorders for the product oldest-first, allocating up to qty. The
  // screen turns accepted suggestions into POST /api/sales conversions.
  app.get("/api/backorders/suggestions", ...gate, async (req, res) => {
    try {
      const productId = Number(req.query.product_id);
      let pool = Number(req.query.qty);
      if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: "product_id is required" });
      }
      if (!Number.isFinite(pool) || pool <= 0) {
        return res.status(400).json({ error: "qty (received quantity to allocate) is required" });
      }
      const { rows } = await db.query(
        `SELECT b.id, b.customer_id, c.name AS customer_name, b.variant_id,
                b.unit_price, b.created_at, b.expected_at, b.outlet_id,
                (b.qty_ordered - b.qty_fulfilled) AS qty_remaining
           FROM backorders b
           JOIN customers c ON c.id = b.customer_id
          WHERE b.product_id = $1 AND b.status IN ('open','partial')
          ORDER BY b.created_at ASC`,
        [productId]
      );
      const suggestions = [];
      for (const bo of rows) {
        if (pool <= 0) break;
        const remaining = Number(bo.qty_remaining);
        const allocate = Math.min(pool, remaining);
        suggestions.push({ ...bo, allocate_qty: allocate });
        pool -= allocate;
      }
      res.json({ suggestions, unallocated_qty: Math.max(0, pool) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update expected date / notes ─────────────────────────────────────
  app.put("/api/backorders/:id", ...writeGate, async (req, res) => {
    try {
      const { expected_at, notes } = req.body || {};
      const { rows: [row] } = await db.query(
        `UPDATE backorders
            SET expected_at = COALESCE($1, expected_at),
                notes = COALESCE($2, notes),
                updated_at = NOW()
          WHERE id = $3 AND status IN ('open','partial')
          RETURNING *`,
        [expected_at || null, typeof notes === "string" ? notes.slice(0, 500) : null, req.params.id]
      );
      if (!row) return res.status(404).json({ error: "Backorder not found or not open" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Cancel ───────────────────────────────────────────────────────────
  app.put("/api/backorders/:id/cancel", ...writeGate, async (req, res) => {
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 300) : null;
      const { rows: [row] } = await db.query(
        `UPDATE backorders
            SET status = 'cancelled',
                notes = CASE WHEN $1::text IS NULL THEN notes
                             ELSE COALESCE(notes || E'\\n', '') || 'Cancelled: ' || $1 END,
                updated_at = NOW()
          WHERE id = $2 AND status IN ('open','partial')
          RETURNING *`,
        [reason, req.params.id]
      );
      if (!row) return res.status(404).json({ error: "Backorder not found or not open" });
      try {
        await db.query(
          "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
          [req.employee?.id || null, "backorder_cancelled", JSON.stringify({ backorder_id: row.id, reason })]
        );
      } catch { /* audit best-effort */ }
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
