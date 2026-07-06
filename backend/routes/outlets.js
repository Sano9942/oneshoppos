module.exports = function registerOutletRoutes(app, deps) {
  const { db, requirePerm, requirePlanLimit } = deps;
  const { seedMultiOutletFlags } = require("../services/retail-flag-preset");

  // Get all outlets
  app.get("/api/outlets", async (req, res) => {
    try {
      const employeeId = Number(req.headers["x-employee-id"] || 0);
      const perms = req.employeePerms || [];
      const isAdmin = perms.includes("all_access");
      // Tier 1.2 wholesale: field reps don't have employee_outlets rows
      // (they're tenant-scoped, not outlet-scoped). Let them see all outlets
      // so the rep app can pick a default outlet for /api/sales.
      const isFieldRep = perms.includes("manage_field_sales");

      if (employeeId && !isAdmin && !isFieldRep) {
        const { rows } = await db.query(
          `SELECT o.*
           FROM outlets o
           JOIN employee_outlets eo ON eo.outlet_id = o.id
           WHERE eo.employee_id = $1
           ORDER BY o.name ASC`,
          [employeeId]
        );
        return res.json({ outlets: rows || [] });
      }

      const { rows } = await db.query("SELECT * FROM outlets ORDER BY name ASC");
      res.json({ outlets: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new outlet
  //
  // When the tenant transitions from 1 → 2+ outlets, seed the 5 multi-outlet
  // feature flags (context_selection_required, context_header_enforced,
  // phase2_outlet_pricing, phase2_outlet_visibility, phase2g_price_books) so
  // the merchant gets outlet-aware pricing/visibility/price-books on by
  // default. Guarded by company_profile.multi_outlet_flags_seeded so deleting
  // and recreating an outlet doesn't re-seed.
  // Note: kiosk_context_locked is NOT in the seed list — merchant opt-in.
  app.post("/api/outlets", requirePerm("all_access"), requirePlanLimit("outlets"), async (req, res) => {
    try {
      const { name, address, phone, outlet_type, van_rep_employee_id } = req.body;

      // V02 wholesale van sales — a van IS an outlet, so all stock machinery
      // works unmodified. Creating one requires the wholesale_van_sales flag;
      // vans are exempt from the plan cap (plan-limits counts stores only)
      // and do NOT trigger multi-outlet flag seeding (a van isn't a second
      // selling location — enforcing context headers would break nothing but
      // add friction for single-store + van distributors).
      const isVan = outlet_type === "van";
      if (outlet_type && !["store", "van"].includes(outlet_type)) {
        return res.status(400).json({ error: "outlet_type must be 'store' or 'van'" });
      }
      if (isVan) {
        try {
          const { getFeatureFlagsMap } = require("../middleware/feature-flags");
          const flags = await getFeatureFlagsMap(req.tenantId);
          if (!flags.wholesale_van_sales) {
            return res.status(403).json({ error: "Feature disabled: wholesale_van_sales", flag: "wholesale_van_sales" });
          }
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
      }

      const result = await db.transaction(async (client) => {
        const { rows: [{ id: outletId }] } = await client.query(
          `INSERT INTO outlets (name, address, phone, outlet_type, van_rep_employee_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [name, address, phone, isVan ? "van" : "store", isVan && van_rep_employee_id ? Number(van_rep_employee_id) : null]
        );

        // Read the resulting STORE count + the seed-once flag in one
        // round-trip (vans never trigger multi-outlet seeding).
        const [{ rows: [{ cnt }] }, { rows: [profile] }] = await Promise.all([
          client.query("SELECT COUNT(*) AS cnt FROM outlets WHERE COALESCE(outlet_type, 'store') <> 'van'"),
          client.query("SELECT multi_outlet_flags_seeded FROM company_profile WHERE id = 1"),
        ]);
        const outletCount = Number(cnt);
        const alreadySeeded = profile?.multi_outlet_flags_seeded === true;

        let multiOutletSeeded = false;
        if (outletCount > 1 && !alreadySeeded) {
          await seedMultiOutletFlags(client);
          await client.query(
            "UPDATE company_profile SET multi_outlet_flags_seeded = true WHERE id = 1"
          );
          multiOutletSeeded = true;
        }

        return { id: outletId, multiOutletSeeded };
      });

      res.json({
        id: result.id,
        name,
        address,
        phone,
        outlet_type: isVan ? "van" : "store",
        van_rep_employee_id: isVan && van_rep_employee_id ? Number(van_rep_employee_id) : null,
        multi_outlet_flags_seeded: result.multiOutletSeeded,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update an outlet
  app.put("/api/outlets/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, address, phone, van_rep_employee_id } = req.body;
      // van_rep_employee_id: pass null explicitly to unassign; undefined
      // leaves it unchanged (COALESCE can't express "clear", so gate on
      // whether the key was present in the body).
      const hasRepKey = Object.prototype.hasOwnProperty.call(req.body || {}, "van_rep_employee_id");
      const { rowCount } = await db.query(
        `UPDATE outlets SET name = COALESCE($1, name), address = COALESCE($2, address), phone = COALESCE($3, phone),
                van_rep_employee_id = CASE WHEN $5 THEN $4::int ELSE van_rep_employee_id END
         WHERE id = $6`,
        [name, address, phone, van_rep_employee_id != null ? Number(van_rep_employee_id) : null, hasRepKey, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Outlet not found" });
      res.json({ message: "Outlet updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete an outlet — optionally reassign linked records to another outlet
  app.delete("/api/outlets/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { id } = req.params;
      const reassignTo = req.query.reassign_to ? Number(req.query.reassign_to) : null;

      const LINKED_TABLES = [
        "employee_attendance",
        "attendance_sessions",
        "sales",
        "shifts",
        "cash_drawer_logs",
        "inventory_transfers",
        "stock_adjustments",
        "purchase_orders",
        "parked_sales",
      ];

      if (reassignTo) {
        for (const table of LINKED_TABLES) {
          await db.query(
            `UPDATE ${table} SET outlet_id = $1 WHERE outlet_id = $2`,
            [reassignTo, id]
          );
        }
      }

      const { rowCount } = await db.query("DELETE FROM outlets WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Outlet not found" });
      res.json({ message: "Outlet deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
