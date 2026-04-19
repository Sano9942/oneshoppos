// Phase 2-R Wave B — 2-R.2 void + comp workflow.
//
// Server-gated action that writes `sale_item_adjustments` rows with a manager
// audit trail. The legacy POST /api/sales/:id/void handler is untouched so
// retail + restaurant tenants without the phase4_restaurant_void_comp flag
// continue to work. Adjustments table is additive — it records who approved,
// why, and how much, without mutating `voided` semantics in sales.

module.exports = function registerRestaurantVoidCompRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");
  const { validate } = require("../../middleware/validate");
  const { voidCompAdjustSchema, voidReasonUpdateSchema } = require("../../schemas/restaurant-void-comp");
  const { verifyManagerPin } = require("../../services/manager-pin");

  const gate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_void_comp"),
    requirePerm("manage_restaurant"),
  ];

  // GET /api/restaurant/void-reasons — active reason codes, optionally
  // filtered by adjustment type. "both" reasons always match; a void request
  // sees void+both, a comp request sees comp+both.
  app.get("/api/restaurant/void-reasons", ...gate, async (req, res) => {
    try {
      const filter = String(req.query.adjustment_type || "").toLowerCase();
      let sql =
        "SELECT id, code, label, adjustment_type, is_active, sort_order FROM void_reason_codes WHERE is_active = true";
      const params = [];
      if (filter === "void" || filter === "comp") {
        sql += ` AND adjustment_type IN ($1, 'both')`;
        params.push(filter);
      } else if (filter === "both") {
        sql += ` AND adjustment_type = 'both'`;
      }
      sql += ` ORDER BY sort_order, label`;
      const { rows } = await deps.db.query(sql, params);
      res.json(rows);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Admin CRUD-lite on reason codes (toggle active, reorder, rename).
  // Stricter gate: all_access only. Creating/deleting is out of scope —
  // the seeded set is the source of truth.
  app.patch(
    "/api/restaurant/void-reasons/:id",
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_void_comp"),
    requirePerm("all_access"),
    validate(voidReasonUpdateSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid reason id" });
        }
        const { is_active, sort_order, label } = req.body;
        const sets = [];
        const params = [];
        let idx = 1;
        if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(is_active); }
        if (sort_order !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(sort_order); }
        if (label !== undefined) { sets.push(`label = $${idx++}`); params.push(label); }
        if (!sets.length) return res.status(400).json({ error: "No fields to update" });
        params.push(id);
        const { rows: [row] } = await deps.db.query(
          `UPDATE void_reason_codes SET ${sets.join(", ")} WHERE id = $${idx}
           RETURNING id, code, label, adjustment_type, is_active, sort_order`,
          params
        );
        if (!row) return res.status(404).json({ error: "Reason code not found" });
        res.json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // POST /api/restaurant/sale-items/:id/adjust — void or comp a single line
  // with manager PIN override. Writes a sale_item_adjustments row; legacy
  // sales.voided stays untouched so retail workflows keep their existing
  // audit surface.
  app.post(
    "/api/restaurant/sale-items/:id/adjust",
    ...gate,
    validate(voidCompAdjustSchema),
    async (req, res) => {
      try {
        const saleItemId = Number(req.params.id);
        if (!Number.isInteger(saleItemId) || saleItemId <= 0) {
          return res.status(400).json({ error: "Invalid sale item id" });
        }
        const { adjustment_type, reason_code, reason_note, amount, manager_pin } = req.body;

        // Reason must exist and be compatible with this adjustment type.
        const { rows: [reason] } = await deps.db.query(
          `SELECT code, adjustment_type, is_active FROM void_reason_codes WHERE code = $1`,
          [reason_code]
        );
        if (!reason || reason.is_active !== true) {
          return res.status(400).json({ error: "Unknown or inactive reason code" });
        }
        if (reason.adjustment_type !== "both" && reason.adjustment_type !== adjustment_type) {
          return res.status(400).json({
            error: `Reason '${reason_code}' cannot be used for ${adjustment_type}`,
          });
        }

        // Verify manager PIN before starting the transaction — cheaper to
        // fail fast and avoids a dangling open tx on auth failures.
        const manager = await verifyManagerPin(deps.db, manager_pin, {
          isImpersonating: req.isImpersonating === true,
        });

        const result = await deps.db.transaction(async (client) => {
          const { rows: [item] } = await client.query(
            `SELECT si.id, si.sale_id, si.price_at_sale, si.quantity
             FROM sale_items si
             WHERE si.id = $1`,
            [saleItemId]
          );
          if (!item) {
            const e = new Error("Sale item not found");
            e.statusCode = 404;
            throw e;
          }
          const { rows: [adj] } = await client.query(
            `INSERT INTO sale_item_adjustments (
               sale_id, sale_item_id, adjustment_type, reason_code, reason_note,
               amount, manager_employee_id, manager_pin_verified_at, created_by_employee_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)
             RETURNING *`,
            [
              item.sale_id,
              saleItemId,
              adjustment_type,
              reason_code,
              reason_note || null,
              amount,
              manager.employee_id,
              req.employee?.id || null,
            ]
          );

          // Updated sale totals for the UI. We do NOT mutate sales.total here
          // — accounting interprets adjustments via the adjustments table.
          const { rows: [sale] } = await client.query(
            `SELECT id, total_amount, timestamp FROM sales WHERE id = $1`,
            [item.sale_id]
          );
          const { rows: totalsRows } = await client.query(
            `SELECT adjustment_type, COALESCE(SUM(amount), 0)::numeric AS total
             FROM sale_item_adjustments WHERE sale_id = $1 GROUP BY adjustment_type`,
            [item.sale_id]
          );
          const totals = { void: 0, comp: 0, discount: 0 };
          for (const r of totalsRows) totals[r.adjustment_type] = Number(r.total);

          return { adjustment: adj, sale, adjustment_totals: totals, manager };
        });

        // Best-effort audit hook — matches restaurant/availability pattern.
        try {
          await deps.db.query(
            "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
            [
              req.employee?.id || null,
              `restaurant_${adjustment_type}`,
              JSON.stringify({
                sale_item_id: saleItemId,
                reason_code,
                amount,
                manager_employee_id: manager.employee_id,
                impersonated: req.isImpersonating === true,
              }),
            ]
          );
        } catch { /* audit best-effort */ }

        res.status(201).json(result);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // GET /api/restaurant/adjustments?sale_id= — audit trail for a sale.
  app.get("/api/restaurant/adjustments", ...gate, async (req, res) => {
    try {
      const saleId = Number(req.query.sale_id);
      if (!Number.isInteger(saleId) || saleId <= 0) {
        return res.status(400).json({ error: "sale_id is required" });
      }
      const { rows } = await deps.db.query(
        `SELECT a.*,
                mgr.name AS manager_name,
                actor.name AS created_by_name,
                rc.label AS reason_label
         FROM sale_item_adjustments a
         LEFT JOIN employees mgr ON mgr.id = a.manager_employee_id
         LEFT JOIN employees actor ON actor.id = a.created_by_employee_id
         LEFT JOIN void_reason_codes rc ON rc.code = a.reason_code
         WHERE a.sale_id = $1
         ORDER BY a.created_at ASC`,
        [saleId]
      );
      res.json(rows);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
