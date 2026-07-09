/**
 * routes/batches.js — F07 batch/expiry surfaces (read + write-off).
 *
 * All gated by requireFeature("batch_expiry_tracking"). The FEFO consumption
 * itself lives in the sales/returns/transfer/adjustment paths (services/batch-stock);
 * this file is the ALERT + REPORT surface (expiring-soon, per-product drill-down,
 * drift-check) plus the expiring-page write-off action.
 */

const batchStock = require("../services/batch-stock");

module.exports = function registerBatchRoutes(app, deps) {
  const { db, requireAnyPerm, requirePerm, requireFeature } = deps;
  const VIEW = requireAnyPerm(["view_reports", "manage_inventory", "all_access"]);
  const FLAG = requireFeature("batch_expiry_tracking");

  // ── Expiring-soon list ─────────────────────────────────────────────────
  // Active batches expiring within `days` (default 30), including already-expired
  // (negative days_to_expiry). Mirrors the ReorderAlerts shape the UI expects.
  app.get("/api/batches/expiring", VIEW, FLAG, async (req, res) => {
    try {
      const days = Math.max(0, parseInt(req.query.days, 10) || 30);
      // Expiry is judged against the tenant-local day (CURRENT_DATE is the DB
      // session's day — UTC on prod — so batches flipped "expired" 5 hours
      // late for PK tenants).
      const { tenantToday } = require("../utils/tz");
      const params = [days, tenantToday(req.company?.timezone)];
      let outletFilter = "";
      if (req.query.outlet_id) {
        params.push(Number(req.query.outlet_id));
        outletFilter = ` AND sb.outlet_id = $${params.length}`;
      }
      const { rows } = await db.query(
        `SELECT sb.id, sb.product_id, p.name AS product_name, p.sku,
                sb.outlet_id, o.name AS outlet_name,
                sb.batch_number, sb.lot_type, sb.expiry_date,
                sb.remaining_qty, sb.unit_cost,
                (sb.expiry_date - $2::date) AS days_to_expiry
           FROM stock_batches sb
           JOIN products p ON p.id = sb.product_id
           LEFT JOIN outlets o ON o.id = sb.outlet_id
          WHERE sb.status = 'active'
            AND sb.remaining_qty > 0
            AND sb.expiry_date IS NOT NULL
            AND sb.expiry_date <= $2::date + ($1::int)${outletFilter}
          ORDER BY sb.expiry_date ASC, sb.id ASC`,
        params
      );
      res.json({
        batches: rows.map((r) => ({
          ...r,
          remaining_qty: Number(r.remaining_qty),
          unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
          days_to_expiry: Number(r.days_to_expiry),
          expired: Number(r.days_to_expiry) < 0,
        })),
        threshold_days: days,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Per-product stock-by-batch drill-down ──────────────────────────────
  app.get("/api/products/:id/batches", VIEW, FLAG, async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const includeInactive = req.query.include_inactive === "1";
      const { tenantToday } = require("../utils/tz");
      const params = [productId, tenantToday(req.company?.timezone)];
      let statusFilter = " AND sb.status = 'active'";
      if (includeInactive) statusFilter = "";
      if (req.query.outlet_id) {
        params.push(Number(req.query.outlet_id));
        statusFilter += ` AND sb.outlet_id = $${params.length}`;
      }
      const { rows } = await db.query(
        `SELECT sb.id, sb.outlet_id, o.name AS outlet_name, sb.lot_type,
                sb.batch_number, sb.expiry_date, sb.received_qty, sb.remaining_qty,
                sb.unit_cost, sb.status, sb.grn_id, sb.created_at,
                (sb.expiry_date - $2::date) AS days_to_expiry
           FROM stock_batches sb
           LEFT JOIN outlets o ON o.id = sb.outlet_id
          WHERE sb.product_id = $1${statusFilter}
          ORDER BY sb.expiry_date ASC NULLS LAST, sb.id ASC`,
        params
      );
      res.json({
        batches: rows.map((r) => ({
          ...r,
          received_qty: Number(r.received_qty),
          remaining_qty: Number(r.remaining_qty),
          unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
          days_to_expiry: r.days_to_expiry != null ? Number(r.days_to_expiry) : null,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Drift-check report (the invariant enforcer) ────────────────────────
  app.get("/api/batches/drift", VIEW, FLAG, async (req, res) => {
    try {
      const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;
      const drift = await batchStock.getDrift(db, { outletId });
      res.json({ drift, clean: drift.length === 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── FEFO cost-flow report (P1) ─────────────────────────────────────────
  // Per tracked product: ACTUAL cost of goods consumed from the batch ledger
  // (Σ consumed_qty × batch.unit_cost via batch_movements) vs the product-level
  // `cost_price`. Report-only — surfaces true batch COGS for margin analysis;
  // no accounting change. Optional from/to on the movement date.
  app.get("/api/batches/cost-flow", VIEW, FLAG, async (req, res) => {
    try {
      const params = [];
      const where = [
        "bm.movement_type = 'sale'",
        "sb.unit_cost IS NOT NULL",
      ];
      // from/to are tenant-local days; created_at is TIMESTAMPTZ — use UTC
      // bounds (a bare ::date comparison evaluates in the DB session TZ).
      const { toUtcStart, toUtcEnd } = require("../utils/tz");
      if (req.query.from) {
        params.push(toUtcStart(String(req.query.from), req.company?.timezone));
        where.push(`bm.created_at >= $${params.length}`);
      }
      if (req.query.to) {
        params.push(toUtcEnd(String(req.query.to), req.company?.timezone));
        where.push(`bm.created_at < $${params.length}`);
      }
      const { rows } = await db.query(
        `SELECT sb.product_id, p.name AS product_name, p.cost_price AS product_cost,
                SUM(-bm.quantity) AS qty_consumed,
                SUM(-bm.quantity * sb.unit_cost) AS actual_cogs,
                SUM(-bm.quantity * p.cost_price) AS standard_cogs
           FROM batch_movements bm
           JOIN stock_batches sb ON sb.id = bm.batch_id
           JOIN products p ON p.id = sb.product_id
          WHERE ${where.join(" AND ")}
          GROUP BY sb.product_id, p.name, p.cost_price
          ORDER BY actual_cogs DESC`,
        params
      );
      res.json({
        rows: rows.map((r) => {
          const qty = Number(r.qty_consumed) || 0;
          const actual = Number(r.actual_cogs) || 0;
          const standard = Number(r.standard_cogs) || 0;
          return {
            product_id: Number(r.product_id),
            product_name: r.product_name,
            product_cost: r.product_cost != null ? Number(r.product_cost) : null,
            qty_consumed: qty,
            actual_cogs: Math.round(actual * 100) / 100,
            standard_cogs: Math.round(standard * 100) / 100,
            variance: Math.round((actual - standard) * 100) / 100,
            avg_actual_unit_cost: qty > 0 ? Math.round((actual / qty) * 10000) / 10000 : null,
          };
        }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Write off a batch (expired / damaged) ──────────────────────────────
  // Writes off `qty` (default: the whole remaining batch) as a reason-coded
  // stock adjustment: creates the stock_adjustments audit row, decrements
  // outlet_stock, and flips the batch ledger via adjustBatches (write_off), all
  // in one transaction so the invariant holds.
  app.post("/api/batches/:id/write-off", requirePerm("manage_inventory"), FLAG, async (req, res) => {
    try {
      const batchId = Number(req.params.id);
      const reason = (req.body && req.body.reason) || "expired stock";
      const requestedQty = req.body && req.body.qty != null ? Number(req.body.qty) : null;
      const employeeId = Number(req.headers["x-employee-id"]) || null;

      const result = await db.transaction(async (client) => {
        const { rows: [batch] } = await client.query(
          `SELECT id, product_id, variant_id, outlet_id, remaining_qty, status
             FROM stock_batches WHERE id = $1 FOR UPDATE`,
          [batchId]
        );
        if (!batch) return { notFound: true };
        if (batch.status !== "active" || Number(batch.remaining_qty) <= 0) {
          return { invalid: "Batch is not active or already depleted" };
        }
        const writeOffQty = batchStock.roundQty(
          requestedQty != null
            ? Math.min(requestedQty, Number(batch.remaining_qty))
            : Number(batch.remaining_qty)
        );
        if (!(writeOffQty > 0)) return { invalid: "Nothing to write off" };

        // 1. Audit row (mirrors the adjustments path so reports pick it up).
        const { rows: [adj] } = await client.query(
          `INSERT INTO stock_adjustments (product_id, variant_id, outlet_id, employee_id, quantity_change, reason)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [batch.product_id, batch.variant_id || null, batch.outlet_id, employeeId, -writeOffQty, reason]
        );
        // 2. Decrement the authoritative outlet_stock total.
        await client.query(
          `UPDATE outlet_stock SET quantity = GREATEST(0, quantity - $1)
            WHERE product_id = $2 AND outlet_id = $3`,
          [writeOffQty, batch.product_id, batch.outlet_id]
        );
        if (batch.variant_id) {
          await client.query(
            `UPDATE variant_outlet_stock SET quantity = GREATEST(0, quantity - $1)
              WHERE variant_id = $2 AND outlet_id = $3`,
            [writeOffQty, batch.variant_id, batch.outlet_id]
          );
        }
        // 3. Flip the batch ledger — consume from THIS batch, mark 'written_off'.
        await batchStock.adjustBatches(client, {
          productId: batch.product_id,
          variantId: batch.variant_id || null,
          outletId: batch.outlet_id,
          delta: -writeOffQty,
          movementType: "write_off",
          refType: "adjustment",
          refId: adj.id,
          batchId,
        });
        return { ok: true, written_off: writeOffQty, adjustment_id: adj.id };
      });

      if (result.notFound) return res.status(404).json({ error: "Batch not found" });
      if (result.invalid) return res.status(400).json({ error: result.invalid });
      res.json({ message: "Batch written off", ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
