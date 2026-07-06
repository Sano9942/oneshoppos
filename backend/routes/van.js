// V02 wholesale depth — van sales.
//
// A van IS an outlet (outlets.outlet_type='van', v111), so load-out is the
// existing depot→van transfer, sell-from-van is the existing POST /api/sales
// with outlet_id = the van, and "expected on-hand" at day end is simply the
// van's outlet_stock (transfers and sales already flow through it). This file
// adds only what's genuinely new: the rep's van view, the day-open shift
// helper (sales.js requires an open cash shift per outlet), and the day-end
// reconciliation (counted vs expected → variance adjustment + cash check +
// shift close).
module.exports = function registerVanRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;
  const { toUtcStart, toUtcEnd, isValidTz } = require("../utils/tz");

  const repGate = [requireFeature("wholesale_van_sales"), requirePerm("manage_field_sales")];
  const mgrGate = [
    requireFeature("wholesale_van_sales"),
    requireAnyPerm(["manage_inventory", "manage_field_sales", "all_access"]),
  ];

  // Employee attribution: JWT-loaded req.employee in production; the
  // x-outlet/x-employee header bridge everywhere else (loadTenantAndPerms
  // backfills the header from the JWT, so the header is always populated).
  function employeeIdOf(req) {
    const fromJwt = Number(req.employee?.id);
    if (Number.isInteger(fromJwt) && fromJwt > 0) return fromJwt;
    const fromHeader = Number(req.headers["x-employee-id"]);
    return Number.isInteger(fromHeader) && fromHeader > 0 ? fromHeader : null;
  }

  // "Today" in the tenant's timezone — sales.timestamp is UTC, so a raw
  // `timestamp::date = CURRENT_DATE` misattributes early-morning local sales
  // (the repo's documented UTC-date trap). Boundaries computed per request.
  function todayBounds(req) {
    const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "Asia/Karachi";
    // en-CA locale formats as YYYY-MM-DD
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    return { from: toUtcStart(today, tz), to: toUtcEnd(today, tz), today };
  }

  async function resolveVan(req, res) {
    const outletId = Number(req.params.outletId || 0);
    const { rows: [van] } = await db.query(
      "SELECT id, name, outlet_type, van_rep_employee_id FROM outlets WHERE id = $1",
      [outletId]
    );
    if (!van || van.outlet_type !== "van") {
      res.status(404).json({ error: "Van outlet not found" });
      return null;
    }
    return van;
  }

  // ── Rep view: my van + stock + shift status ──────────────────────────
  app.get("/api/van/mine", ...repGate, async (req, res) => {
    try {
      const employeeId = employeeIdOf(req);
      if (!employeeId) return res.status(401).json({ error: "Not authenticated" });
      const { rows: [van] } = await db.query(
        "SELECT id, name, address FROM outlets WHERE outlet_type = 'van' AND van_rep_employee_id = $1 LIMIT 1",
        [employeeId]
      );
      if (!van) return res.json({ van: null });

      const [{ rows: stock }, { rows: [shift] }, { rows: [today] }] = await Promise.all([
        db.query(
          `SELECT os.product_id, p.name, p.sku, os.quantity, p.price
             FROM outlet_stock os JOIN products p ON p.id = os.product_id
            WHERE os.outlet_id = $1 AND os.quantity > 0 AND p.deleted_at IS NULL
            ORDER BY p.name ASC`,
          [van.id]
        ),
        db.query(
          "SELECT id, opening_float, opened_at FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
          [van.id]
        ),
        (() => {
          const { from, to } = todayBounds(req);
          return db.query(
            `SELECT COUNT(*)::int AS sale_count, COALESCE(SUM(total_amount), 0)::numeric AS sales_total
               FROM sales WHERE outlet_id = $1 AND voided IS NOT TRUE AND timestamp >= $2 AND timestamp < $3`,
            [van.id, from, to]
          );
        })(),
      ]);

      res.json({
        van,
        stock,
        open_shift: shift || null,
        today: { sale_count: Number(today.sale_count), sales_total: Number(today.sales_total) },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Open the van's selling day (cash shift) ──────────────────────────
  // Idempotent: returns the existing open shift if one exists. Needed
  // because POST /api/sales requires an open shift on the outlet.
  app.post("/api/van/:outletId/open-day", ...repGate, async (req, res) => {
    try {
      const van = await resolveVan(req, res);
      if (!van) return;
      const employeeId = employeeIdOf(req);
      const openingFloat = Number(req.body?.opening_float || 0);

      const { rows: [existing] } = await db.query(
        "SELECT id, opening_float, opened_at FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1",
        [van.id]
      );
      if (existing) return res.json({ shift: existing, already_open: true });

      const { rows: [shift] } = await db.query(
        `INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status)
         VALUES ($1, $2, $3, 'open') RETURNING id, opening_float, opened_at`,
        [van.id, employeeId, openingFloat]
      );
      res.status(201).json({ shift, already_open: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Day-end reconcile preview ─────────────────────────────────────────
  // expected = current outlet_stock (load-outs and sales already flowed
  // through it); plus today's movement + cash summary for the cash check.
  app.get("/api/van/:outletId/reconcile-preview", ...mgrGate, async (req, res) => {
    try {
      const van = await resolveVan(req, res);
      if (!van) return;
      const { from, to } = todayBounds(req);

      const [{ rows: lines }, { rows: [cash] }, { rows: [loaded] }] = await Promise.all([
        db.query(
          `SELECT os.product_id, p.name, p.sku, os.quantity AS expected,
                  COALESCE(sold.qty, 0) AS sold_today
             FROM outlet_stock os
             JOIN products p ON p.id = os.product_id AND p.deleted_at IS NULL
             LEFT JOIN (
               SELECT si.product_id, SUM(si.quantity) AS qty
                 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE s.outlet_id = $1 AND s.voided IS NOT TRUE AND s.timestamp >= $2 AND s.timestamp < $3
                GROUP BY si.product_id
             ) sold ON sold.product_id = os.product_id
            WHERE os.outlet_id = $1 AND (os.quantity > 0 OR COALESCE(sold.qty, 0) > 0)
            ORDER BY p.name ASC`,
          [van.id, from, to]
        ),
        db.query(
          `SELECT COALESCE(SUM(sp.amount), 0)::numeric AS cash_collected
             FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
            WHERE s.outlet_id = $1 AND s.voided IS NOT TRUE
              AND s.timestamp >= $2 AND s.timestamp < $3 AND LOWER(sp.payment_method) = 'cash'`,
          [van.id, from, to]
        ),
        db.query(
          `SELECT COALESCE(SUM(quantity), 0)::numeric AS loaded_today
             FROM inventory_transfers
            WHERE to_outlet_id = $1 AND reversed IS NOT TRUE AND timestamp >= $2 AND timestamp < $3`,
          [van.id, from, to]
        ),
      ]);

      const { rows: [shift] } = await db.query(
        "SELECT id, opening_float FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1",
        [van.id]
      );

      res.json({
        van: { id: van.id, name: van.name },
        lines,
        cash_expected: Number(cash.cash_collected) + Number(shift?.opening_float || 0),
        cash_collected_today: Number(cash.cash_collected),
        opening_float: Number(shift?.opening_float || 0),
        loaded_today: Number(loaded.loaded_today),
        open_shift_id: shift?.id || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Submit day-end count (draft) ──────────────────────────────────────
  app.post("/api/van/:outletId/reconcile", ...repGate, async (req, res) => {
    try {
      const van = await resolveVan(req, res);
      if (!van) return;
      const { lines, cash_counted, variance_reason } = req.body || {};
      if (!Array.isArray(lines) || !lines.length) {
        return res.status(400).json({ error: "lines (counted quantities) are required" });
      }

      // Recompute expected server-side — never trust client-sent expected.
      const productIds = lines.map((l) => Number(l.product_id)).filter((n) => Number.isInteger(n) && n > 0);
      const { rows: stockRows } = await db.query(
        "SELECT product_id, quantity FROM outlet_stock WHERE outlet_id = $1 AND product_id = ANY($2::int[])",
        [van.id, productIds]
      );
      const expectedMap = new Map(stockRows.map((r) => [Number(r.product_id), Number(r.quantity)]));
      const normalized = lines.map((l) => {
        const pid = Number(l.product_id);
        const expected = expectedMap.get(pid) ?? 0;
        const counted = Number(l.counted);
        if (!Number.isFinite(counted) || counted < 0) {
          throw Object.assign(new Error(`Invalid counted qty for product ${pid}`), { statusCode: 400 });
        }
        return { product_id: pid, expected, counted, variance: Number((counted - expected).toFixed(3)) };
      });

      const { from, to } = todayBounds(req);
      const { rows: [cashAgg] } = await db.query(
        `SELECT COALESCE(SUM(sp.amount), 0)::numeric AS cash_collected
           FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
          WHERE s.outlet_id = $1 AND s.voided IS NOT TRUE
            AND s.timestamp >= $2 AND s.timestamp < $3 AND LOWER(sp.payment_method) = 'cash'`,
        [van.id, from, to]
      );
      const { rows: [shift] } = await db.query(
        "SELECT opening_float FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1",
        [van.id]
      );
      const cashExpected = Number(cashAgg.cash_collected) + Number(shift?.opening_float || 0);

      const { rows: [recon] } = await db.query(
        `INSERT INTO van_reconciliations
           (outlet_id, reconcile_date, status, lines, cash_expected, cash_counted, variance_reason, created_by)
         VALUES ($1, $7::date, 'draft', $2::jsonb, $3, $4, $5, $6)
         ON CONFLICT (outlet_id, reconcile_date)
         DO UPDATE SET lines = EXCLUDED.lines, cash_expected = EXCLUDED.cash_expected,
                       cash_counted = EXCLUDED.cash_counted, variance_reason = EXCLUDED.variance_reason
           WHERE van_reconciliations.status = 'draft'
         RETURNING *`,
        [
          van.id, JSON.stringify(normalized), cashExpected,
          cash_counted != null ? Number(cash_counted) : null,
          typeof variance_reason === "string" ? variance_reason.slice(0, 300) : null,
          employeeIdOf(req),
          todayBounds(req).today,
        ]
      );
      // Conditional upsert (WHERE status='draft') returns no row when today's
      // reconciliation is already confirmed — never silently re-draft it.
      if (!recon) {
        return res.status(400).json({ error: "Today's reconciliation is already confirmed" });
      }
      res.status(201).json(recon);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Manager confirm: variance → stock adjustment, close the shift ────
  app.post("/api/van-reconciliations/:id/confirm", ...mgrGate, async (req, res) => {
    try {
      const result = await db.transaction(async (client) => {
        const { rows: [recon] } = await client.query(
          "SELECT * FROM van_reconciliations WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (!recon) throw Object.assign(new Error("Reconciliation not found"), { statusCode: 404 });
        if (recon.status === "confirmed") {
          throw Object.assign(new Error("Already confirmed"), { statusCode: 400 });
        }

        const lines = Array.isArray(recon.lines) ? recon.lines : JSON.parse(recon.lines || "[]");
        let adjustmentId = null;

        for (const line of lines) {
          const variance = Number(line.variance || 0);
          if (!variance) continue;
          // Lock + apply the counted truth. Variance is usually negative
          // (shrinkage in the field) — record it with a dedicated reason so
          // the shrinkage report picks it up.
          await client.query(
            "SELECT id FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE",
            [line.product_id, recon.outlet_id]
          );
          await client.query(
            `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
             ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $3`,
            [line.product_id, recon.outlet_id, variance]
          );
          const { rows: [adj] } = await client.query(
            `INSERT INTO stock_adjustments (product_id, outlet_id, employee_id, quantity_change, reason, notes)
             VALUES ($1, $2, $3, $4, 'van_reconcile', $5) RETURNING id`,
            [
              line.product_id, recon.outlet_id, employeeIdOf(req), variance,
              `Van day-end reconcile #${recon.id}: expected ${line.expected}, counted ${line.counted}` +
                (recon.variance_reason ? ` — ${recon.variance_reason}` : ""),
            ]
          );
          if (!adjustmentId) adjustmentId = adj.id;
        }

        // Close the van's open cash shift with the counted cash.
        const { rows: [shift] } = await client.query(
          "SELECT id, opening_float FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE",
          [recon.outlet_id]
        );
        if (shift) {
          const cashExpected = Number(recon.cash_expected || 0);
          const cashCounted = recon.cash_counted != null ? Number(recon.cash_counted) : cashExpected;
          await client.query(
            `UPDATE cash_shifts
                SET status = 'closed', closed_at = NOW(), closing_method = 'van_reconcile',
                    closing_cash = $1, expected_cash = $2, variance = $3,
                    variance_reason = COALESCE($4, variance_reason)
              WHERE id = $5`,
            [cashCounted, cashExpected, Number((cashCounted - cashExpected).toFixed(2)), recon.variance_reason, shift.id]
          );
        }

        const { rows: [updated] } = await client.query(
          `UPDATE van_reconciliations
              SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), adjustment_id = $2
            WHERE id = $3 RETURNING *`,
          [employeeIdOf(req), adjustmentId, recon.id]
        );
        return { reconciliation: updated, closed_shift_id: shift?.id || null };
      });

      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── List reconciliations (manager view) ──────────────────────────────
  app.get("/api/van-reconciliations", ...mgrGate, async (req, res) => {
    try {
      const params = [];
      const where = [];
      if (req.query.outlet_id) { params.push(Number(req.query.outlet_id)); where.push(`vr.outlet_id = $${params.length}`); }
      if (req.query.status) { params.push(String(req.query.status)); where.push(`vr.status = $${params.length}`); }
      const { rows } = await db.query(
        `SELECT vr.*, o.name AS van_name, ce.name AS created_by_name, cf.name AS confirmed_by_name
           FROM van_reconciliations vr
           JOIN outlets o ON o.id = vr.outlet_id
           LEFT JOIN employees ce ON ce.id = vr.created_by
           LEFT JOIN employees cf ON cf.id = vr.confirmed_by
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY vr.reconcile_date DESC, vr.id DESC
          LIMIT 200`,
        params
      );
      res.json({ reconciliations: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
