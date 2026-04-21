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
