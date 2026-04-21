// Phase 2-G.8 — Inventory Intelligence Hub.
// All endpoints mounted under /api/inventory-intelligence are gated by
// requireFeature("phase2g_inventory_intelligence") + requirePerm("manage_inventory").
// Task 4 ships the reorder endpoints; ABC / dashboard-cards / cycle-counts
// are added in later tasks on this same router.

const {
  resolveLeadTime,
  suggestReorderQty,
} = require("../services/inventory-intelligence");

module.exports = function registerInventoryIntelligenceRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2g_inventory_intelligence");

  // GET /api/inventory-intelligence/reorder
  // Realtime join of nightly product_abc_class.daily_velocity × live outlet_stock.
  // Skips products with velocity 0, inactive products, and any product already
  // above threshold = velocity × (lead_time + safety).
  app.get(
    "/api/inventory-intelligence/reorder",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const outletIdParam = req.query.outlet_id ? parseInt(req.query.outlet_id, 10) : null;

        // Tenant defaults live on company_profile.
        const { rows: cfgRows } = await db.query(
          `SELECT tenant_default_lead_time_days AS lead_time,
                  tenant_default_safety_stock_days AS safety
             FROM company_profile LIMIT 1`
        );
        const tenantLead = cfgRows[0]?.lead_time ?? 7;
        const tenantSafety = cfgRows[0]?.safety ?? 3;

        const params = [];
        let outletFilter = "";
        if (outletIdParam != null) {
          params.push(outletIdParam);
          outletFilter = `AND os.outlet_id = $${params.length}`;
        }

        const { rows } = await db.query(
          `SELECT p.id AS product_id,
                  p.name,
                  p.sku,
                  p.supplier_id,
                  p.lead_time_days_override,
                  p.safety_stock_days,
                  s.default_lead_time_days AS supplier_lead,
                  s.name AS supplier_name,
                  abc.daily_velocity,
                  os.outlet_id,
                  os.quantity AS current_stock
             FROM products p
             LEFT JOIN suppliers s ON s.id = p.supplier_id
             LEFT JOIN product_abc_class abc ON abc.product_id = p.id AND abc.variant_id IS NULL
             LEFT JOIN outlet_stock os ON os.product_id = p.id ${outletFilter}
            WHERE COALESCE(p.status, 'active') = 'active'
              AND p.deleted_at IS NULL
              AND abc.daily_velocity IS NOT NULL
              AND abc.daily_velocity > 0`,
          params
        );

        const suggestions = [];
        for (const row of rows) {
          const leadTime = resolveLeadTime(
            { lead_time_days_override: row.lead_time_days_override },
            { default_lead_time_days: row.supplier_lead },
            tenantLead
          );
          const safety =
            row.safety_stock_days != null ? Number(row.safety_stock_days) : tenantSafety;
          const currentStock = Number(row.current_stock) || 0;
          const velocity = Number(row.daily_velocity) || 0;
          const suggestedQty = suggestReorderQty(currentStock, velocity, leadTime, safety);
          if (suggestedQty <= 0) continue;

          suggestions.push({
            product_id: row.product_id,
            name: row.name,
            sku: row.sku,
            outlet_id: row.outlet_id,
            current_stock: currentStock,
            velocity,
            lead_time_days: leadTime,
            lead_time_source:
              row.lead_time_days_override != null
                ? "override"
                : row.supplier_lead != null
                  ? "supplier"
                  : "tenant",
            safety_stock_days: safety,
            suggested_qty: suggestedQty,
            supplier_id: row.supplier_id,
            supplier_name: row.supplier_name,
          });
        }

        res.json({ suggestions });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/inventory-intelligence/abc
  // Paginated list from the nightly rollup. Supports rank filter, search by
  // product name, and a dead_stock_only toggle. Sorted by revenue
  // contribution desc so the highest-value rows come first; NULL ranks
  // (zero-revenue products) sort to the bottom.
  app.get(
    "/api/inventory-intelligence/abc",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rank, dead_stock_only, search } = req.query;
        const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
        const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

        const where = ["1=1"];
        const params = [];
        if (rank && ["A", "B", "C"].includes(rank)) {
          params.push(rank);
          where.push(`abc.rank = $${params.length}`);
        }
        if (dead_stock_only === "true") {
          where.push(`abc.days_since_last_sale >= 90`);
        } else {
          // When not filtering dead-stock-only, require an abc row at all so
          // products never touched by the worker don't leak into the list.
          where.push(`abc.product_id IS NOT NULL`);
        }
        if (search) {
          params.push(`%${search}%`);
          where.push(`p.name ILIKE $${params.length}`);
        }
        params.push(limit, offset);

        const sql = `
          SELECT p.id AS product_id, p.name, p.sku,
                 abc.rank, abc.revenue_contribution_pct, abc.units_sold,
                 abc.sell_through_rate, abc.gmroi, abc.daily_velocity,
                 abc.days_since_last_sale, abc.computed_at
            FROM product_abc_class abc
            JOIN products p ON p.id = abc.product_id
           WHERE ${where.join(" AND ")}
             AND COALESCE(p.status, 'active') = 'active'
             AND p.deleted_at IS NULL
           ORDER BY abc.revenue_contribution_pct DESC NULLS LAST, p.name ASC
           LIMIT $${params.length - 1} OFFSET $${params.length}
        `;
        const { rows } = await db.query(sql, params);
        res.json({ items: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/inventory-intelligence/dashboard-cards
  // Four card payloads for the hub header. Each is an indexed query; total
  // budget <500ms per design. Safe to call on every hub load.
  app.get(
    "/api/inventory-intelligence/dashboard-cards",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const [reorder, nextCount, deadStock, valueAtRisk] = await Promise.all([
          // Reorder count — any product whose current stock falls below its
          // velocity-based threshold. Uses same lead-time + safety fallback
          // as the reorder endpoint (product override → default 7/3).
          db.query(
            `SELECT COUNT(DISTINCT p.id)::int AS c
               FROM products p
               JOIN product_abc_class abc ON abc.product_id = p.id AND abc.variant_id IS NULL
               JOIN outlet_stock os ON os.product_id = p.id
              WHERE abc.daily_velocity IS NOT NULL
                AND abc.daily_velocity > 0
                AND os.quantity < abc.daily_velocity
                  * (COALESCE(p.lead_time_days_override, 7) + COALESCE(p.safety_stock_days, 3))
                AND COALESCE(p.status, 'active') = 'active'
                AND p.deleted_at IS NULL`
          ),
          db.query(
            `SELECT MIN(next_due_date) AS next
               FROM cycle_count_schedules WHERE is_active = TRUE`
          ),
          db.query(
            `SELECT COUNT(*)::int AS c
               FROM product_abc_class WHERE days_since_last_sale >= 90`
          ),
          db.query(
            `SELECT COALESCE(SUM(os.quantity * p.cost_price), 0) AS v
               FROM product_abc_class abc
               JOIN products p ON p.id = abc.product_id
               JOIN outlet_stock os ON os.product_id = p.id
              WHERE abc.days_since_last_sale >= 90`
          ),
        ]);

        res.json({
          reorder_count: reorder.rows[0].c,
          next_cycle_count: nextCount.rows[0].next,
          dead_stock_count: deadStock.rows[0].c,
          stock_value_at_risk: Number(valueAtRisk.rows[0].v) || 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ────────────────────────────────────────────────────────────────────
  //   CYCLE COUNT SCHEDULES
  // ────────────────────────────────────────────────────────────────────

  const ALLOWED_RECURRENCE = new Set(["weekly", "monthly", "quarterly"]);
  const RECURRENCE_INTERVAL = {
    weekly: "7 days",
    monthly: "1 month",
    quarterly: "3 months",
  };

  app.get(
    "/api/inventory-intelligence/cycle-schedules",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT id, name, filter_criteria, recurrence,
                  next_due_date, last_run_at, is_active,
                  created_by, created_at
             FROM cycle_count_schedules
            ORDER BY is_active DESC, next_due_date ASC, id ASC`
        );
        res.json({ schedules: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/inventory-intelligence/cycle-schedules",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      const { name, filter_criteria, recurrence, next_due_date } = req.body || {};
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name is required" });
      }
      if (!recurrence || !ALLOWED_RECURRENCE.has(recurrence)) {
        return res.status(400).json({
          error: `recurrence must be one of ${[...ALLOWED_RECURRENCE].join(", ")}`,
        });
      }
      if (!next_due_date) {
        return res.status(400).json({ error: "next_due_date is required" });
      }
      try {
        const { rows } = await db.query(
          `INSERT INTO cycle_count_schedules
             (name, filter_criteria, recurrence, next_due_date, is_active, created_by)
           VALUES ($1, $2::jsonb, $3, $4, TRUE, $5)
           RETURNING id, name, filter_criteria, recurrence,
                     next_due_date, last_run_at, is_active,
                     created_by, created_at`,
          [
            name,
            JSON.stringify(filter_criteria || {}),
            recurrence,
            next_due_date,
            req.employee?.id ?? null,
          ]
        );
        res.status(201).json({ schedule: rows[0] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.put(
    "/api/inventory-intelligence/cycle-schedules/:id",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: "invalid id" });

      const { name, filter_criteria, recurrence, next_due_date, is_active } = req.body || {};
      if (recurrence != null && !ALLOWED_RECURRENCE.has(recurrence)) {
        return res.status(400).json({
          error: `recurrence must be one of ${[...ALLOWED_RECURRENCE].join(", ")}`,
        });
      }

      // Build a dynamic partial UPDATE so callers can patch any subset.
      const sets = [];
      const params = [];
      if (name != null) {
        params.push(name);
        sets.push(`name = $${params.length}`);
      }
      if (filter_criteria != null) {
        params.push(JSON.stringify(filter_criteria));
        sets.push(`filter_criteria = $${params.length}::jsonb`);
      }
      if (recurrence != null) {
        params.push(recurrence);
        sets.push(`recurrence = $${params.length}`);
      }
      if (next_due_date != null) {
        params.push(next_due_date);
        sets.push(`next_due_date = $${params.length}`);
      }
      if (is_active != null) {
        params.push(!!is_active);
        sets.push(`is_active = $${params.length}`);
      }
      if (sets.length === 0) {
        return res.status(400).json({ error: "no fields to update" });
      }
      params.push(id);
      try {
        const { rows } = await db.query(
          `UPDATE cycle_count_schedules SET ${sets.join(", ")}
            WHERE id = $${params.length}
          RETURNING id, name, filter_criteria, recurrence,
                    next_due_date, last_run_at, is_active,
                    created_by, created_at`,
          params
        );
        if (rows.length === 0) return res.status(404).json({ error: "not found" });
        res.json({ schedule: rows[0] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.delete(
    "/api/inventory-intelligence/cycle-schedules/:id",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: "invalid id" });
      try {
        // cycle_count_sessions.schedule_id is ON DELETE SET NULL so any open
        // session survives with schedule_id = NULL. variance still records.
        const { rowCount } = await db.query(
          `DELETE FROM cycle_count_schedules WHERE id = $1`,
          [id]
        );
        if (rowCount === 0) return res.status(404).json({ error: "not found" });
        res.status(204).end();
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/inventory-intelligence/cycle-schedules/:id/start-session
  //
  // Resolves the schedule's filter_criteria into a concrete product list,
  // creates a stock_counts row + stock_count_items rows for entry, wraps
  // with a cycle_count_sessions row, and advances schedule.next_due_date.
  //
  // Errors:
  //   400 — outlet_id missing from filter (stock_counts.outlet_id is NOT NULL)
  //   400 — filter matches no products (next_due_date unchanged)
  //   409 — a session is already open for this schedule (unique partial index)
  //   404 — schedule not found
  app.post(
    "/api/inventory-intelligence/cycle-schedules/:id/start-session",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      const scheduleId = parseInt(req.params.id, 10);
      if (!scheduleId) return res.status(400).json({ error: "invalid id" });

      try {
        const { rows: schedRows } = await db.query(
          `SELECT * FROM cycle_count_schedules WHERE id = $1`,
          [scheduleId]
        );
        if (schedRows.length === 0) {
          return res.status(404).json({ error: "schedule not found" });
        }
        const schedule = schedRows[0];
        const filter = schedule.filter_criteria || {};

        if (!filter.outlet_id) {
          return res
            .status(400)
            .json({ error: "filter_criteria.outlet_id is required — cycle counts are per-outlet" });
        }

        // Resolve product list per filter.
        const productFilterParts = [
          "COALESCE(p.status, 'active') = 'active'",
          "p.deleted_at IS NULL",
          "os.outlet_id = $1",
        ];
        const productParams = [filter.outlet_id];
        if (filter.category_id) {
          productParams.push(filter.category_id);
          productFilterParts.push(`p.category_id = $${productParams.length}`);
        }
        if (filter.brand_id) {
          productParams.push(filter.brand_id);
          productFilterParts.push(`p.brand_id = $${productParams.length}`);
        }
        if (filter.supplier_id) {
          productParams.push(filter.supplier_id);
          productFilterParts.push(`p.supplier_id = $${productParams.length}`);
        }
        if (filter.abc_rank && ["A", "B", "C"].includes(filter.abc_rank)) {
          productParams.push(filter.abc_rank);
          productFilterParts.push(
            `EXISTS (SELECT 1 FROM product_abc_class abc
                      WHERE abc.product_id = p.id AND abc.rank = $${productParams.length})`
          );
        }

        const { rows: products } = await db.query(
          `SELECT DISTINCT p.id, os.quantity AS system_qty
             FROM products p
             JOIN outlet_stock os ON os.product_id = p.id
            WHERE ${productFilterParts.join(" AND ")}
            ORDER BY p.id`,
          productParams
        );

        if (products.length === 0) {
          return res.status(400).json({
            error: "Filter matches no products. Adjust the filter criteria.",
          });
        }

        // Bundle: seed stock_count + items, create session, advance schedule.
        // If a session is already open for this schedule, the partial unique
        // index idx_cycle_count_sessions_one_open raises 23505 → 409.
        let result;
        try {
          result = await db.transaction(async (client) => {
            const countNumber =
              `CYCLE-${scheduleId}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
            const { rows: scRows } = await client.query(
              `INSERT INTO stock_counts (count_number, outlet_id, status, started_by, started_at)
               VALUES ($1, $2, 'in_progress', $3, NOW()) RETURNING id`,
              [countNumber, filter.outlet_id, req.employee?.id ?? null]
            );
            const stockCountId = scRows[0].id;

            for (const p of products) {
              await client.query(
                `INSERT INTO stock_count_items (stock_count_id, product_id, system_qty, counted_qty)
                 VALUES ($1, $2, $3, 0)`,
                [stockCountId, p.id, Math.round(Number(p.system_qty) || 0)]
              );
            }

            const { rows: sessRows } = await client.query(
              `INSERT INTO cycle_count_sessions (schedule_id, stock_count_id, assigned_to)
               VALUES ($1, $2, $3) RETURNING id`,
              [scheduleId, stockCountId, req.employee?.id ?? null]
            );

            const interval = RECURRENCE_INTERVAL[schedule.recurrence];
            await client.query(
              `UPDATE cycle_count_schedules
                  SET next_due_date = next_due_date + INTERVAL '${interval}',
                      last_run_at = NOW()
                WHERE id = $1`,
              [scheduleId]
            );

            return { session_id: sessRows[0].id, stock_count_id: stockCountId };
          });
        } catch (err) {
          if (err.code === "23505") {
            return res
              .status(409)
              .json({ error: "A count session is already open for this schedule" });
          }
          throw err;
        }

        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/inventory-intelligence/cycle-sessions/:id/complete
  // Closes the session and computes variance_units + variance_value from the
  // stock_count_items rows. Does not mutate outlet_stock — that happens via
  // the existing stock-count completion flow (out of scope for this wave).
  app.post(
    "/api/inventory-intelligence/cycle-sessions/:id/complete",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      const sessionId = parseInt(req.params.id, 10);
      if (!sessionId) return res.status(400).json({ error: "invalid id" });

      try {
        const { rows: sessRows } = await db.query(
          `SELECT * FROM cycle_count_sessions WHERE id = $1`,
          [sessionId]
        );
        if (sessRows.length === 0) return res.status(404).json({ error: "session not found" });
        const session = sessRows[0];
        if (session.completed_at) {
          return res.status(400).json({ error: "session already completed" });
        }

        const { rows: varRows } = await db.query(
          `SELECT COALESCE(SUM(ABS(COALESCE(sci.counted_qty, 0) - sci.system_qty)), 0) AS units,
                  COALESCE(SUM(ABS(COALESCE(sci.counted_qty, 0) - sci.system_qty) * COALESCE(p.cost_price, 0)), 0) AS value
             FROM stock_count_items sci
             JOIN products p ON p.id = sci.product_id
            WHERE sci.stock_count_id = $1`,
          [session.stock_count_id]
        );
        const varianceUnits = Math.round(Number(varRows[0].units) || 0);
        const varianceValue = Number(varRows[0].value) || 0;

        await db.query(
          `UPDATE cycle_count_sessions
              SET completed_at = NOW(),
                  variance_units = $1,
                  variance_value = $2
            WHERE id = $3`,
          [varianceUnits, varianceValue, sessionId]
        );

        res.json({ variance_units: varianceUnits, variance_value: varianceValue });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get(
    "/api/inventory-intelligence/cycle-sessions",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
        const { rows } = await db.query(
          `SELECT s.id, s.schedule_id, sch.name AS schedule_name,
                  s.stock_count_id,
                  s.started_at, s.completed_at,
                  s.variance_units, s.variance_value,
                  s.assigned_to, e.name AS assigned_to_name
             FROM cycle_count_sessions s
             LEFT JOIN cycle_count_schedules sch ON sch.id = s.schedule_id
             LEFT JOIN employees e ON e.id = s.assigned_to
            ORDER BY s.started_at DESC
            LIMIT $1`,
          [limit]
        );
        res.json({ sessions: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/inventory-intelligence/reorder/create-po
  // Creates a Draft PO from a list of reorder line items for ONE supplier.
  // The frontend groups selections by supplier and calls this per supplier
  // (per design: no multi-supplier split logic in the backend).
  app.post(
    "/api/inventory-intelligence/reorder/create-po",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      const { supplier_id, items } = req.body || {};
      if (!supplier_id) {
        return res.status(400).json({ error: "supplier_id is required" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items must be a non-empty array" });
      }

      try {
        const totalCost = items.reduce(
          (sum, it) => sum + (Number(it.cost_price) || 0) * (Number(it.qty) || 0),
          0
        );

        const poId = await db.transaction(async (client) => {
          const { rows } = await client.query(
            `INSERT INTO purchase_orders (supplier_id, total_cost, status)
             VALUES ($1, $2, 'Draft') RETURNING id`,
            [supplier_id, totalCost]
          );
          const newPoId = rows[0].id;

          for (const item of items) {
            await client.query(
              `INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price)
               VALUES ($1, $2, $3, $4)`,
              [
                newPoId,
                item.product_id,
                Number(item.qty) || 0,
                Number(item.cost_price) || 0,
              ]
            );
          }

          return newPoId;
        });

        res.json({ po_id: poId });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
