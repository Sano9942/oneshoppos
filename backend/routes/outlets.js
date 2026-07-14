module.exports = function registerOutletRoutes(app, deps) {
  const { db, requirePerm, requirePlanLimit } = deps;
  const { seedMultiOutletFlags } = require("../services/retail-flag-preset");
  const { copyOutletSettings, describeCopy } = require("../services/outlet-copy");

  // Get all outlets
  app.get("/api/outlets", async (req, res) => {
    try {
      const employeeId = Number(req.headers["x-employee-id"] || 0);
      const perms = req.employeePerms || [];
      const isAdmin = perms.includes("all_access");
      // Tier 1.2 wholesale: field reps don't have employee_outlets rows
      // (they're tenant-scoped, not outlet-scoped). Let them see all outlets
      // so the rep app can pick a default outlet for /api/sales. S3 split:
      // execute_field_sales is the rep perm; manage_field_sales kept so
      // owner/Manager visibility is unchanged.
      const isFieldRep =
        perms.includes("execute_field_sales") ||
        perms.includes("manage_field_sales");

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
  //
  // D8 (PLAN-V2 Step 12) — optional `copy_from_outlet_id` seeds the new outlet
  // from an existing one. v2 copies ONE thing: the source's
  // outlet_business_modules override rows. Stock, employees, and sales NEVER
  // copy. Omitting the param keeps the D1 inherit-by-default model exactly as
  // it is — no override rows, so every module resolves to its card
  // `default_outlet_enabled`. Every other outlet-keyed config table is a
  // Phase 2 owner ruling (E6), deliberately not implemented here.
  app.post("/api/outlets", requirePerm("all_access"), requirePlanLimit("outlets"), async (req, res) => {
    try {
      const { name, address, phone, outlet_type, van_rep_employee_id, copy_from_outlet_id } = req.body;

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
        // Direct feature_flags read (same pattern as services/backorder.js) —
        // the middleware's cached map isn't wired in every context this
        // route runs in (tests, ST mode).
        let vanFlagOn = false;
        try {
          const { rows } = await db.query(
            "SELECT enabled FROM feature_flags WHERE key = 'wholesale_van_sales'"
          );
          vanFlagOn = rows.length ? rows[0].enabled === true : false;
        } catch { /* flag table missing → off */ }
        if (!vanFlagOn) {
          return res.status(403).json({ error: "Feature disabled: wholesale_van_sales", flag: "wholesale_van_sales" });
        }
      }

      // D8 source normalisation. "" / null / undefined all mean "start fresh"
      // (the frontend Select's empty option), so only a real value is parsed.
      let copyFromId = null;
      if (copy_from_outlet_id !== undefined && copy_from_outlet_id !== null && copy_from_outlet_id !== "") {
        copyFromId = Number(copy_from_outlet_id);
        if (!Number.isInteger(copyFromId) || copyFromId <= 0) {
          return res.status(400).json({
            code: "INVALID_COPY_SOURCE",
            error: "copy_from_outlet_id must be a positive integer outlet id",
          });
        }
        // A van carries no per-outlet module state (the D1 resolver only walks
        // non-van outlets), so copying INTO one would write rows nothing reads.
        if (isVan) {
          return res.status(400).json({
            code: "COPY_SOURCE_NOT_SUPPORTED_FOR_VAN",
            error: "Vans do not carry per-outlet module settings — omit copy_from_outlet_id.",
          });
        }
      }

      const actor =
        req.employee?.name ||
        (req.headers["x-employee-id"] ? `employee:${req.headers["x-employee-id"]}` : "unknown");
      // pos_layouts.created_by is a real FK to employees(id) — attribute the
      // copied layout to whoever created the outlet, not the source's author.
      const employeeId =
        Number(req.employee?.id || req.headers["x-employee-id"]) || null;

      const result = await db.transaction(async (client) => {
        // Validate the copy source INSIDE the creation transaction: a source
        // that vanishes mid-flight must fail the whole create, never silently
        // yield an outlet with zero copied overrides. Foreign outlets can't
        // match — search_path already scopes this to the tenant's schema.
        // "Valid source" is the SAME non-van predicate the D1 resolver uses for
        // its outlet set (services/business-modules.js:loadActiveOutlets), not
        // a third interpretation of "active outlet".
        if (copyFromId !== null) {
          const { rows: srcRows } = await client.query(
            "SELECT id FROM outlets WHERE id = $1 AND COALESCE(outlet_type, 'store') <> 'van'",
            [copyFromId]
          );
          if (!srcRows.length) {
            const err = new Error(`Outlet ${copyFromId} not found or not a valid store outlet.`);
            err.statusCode = 404;
            err.code = "COPY_SOURCE_NOT_FOUND";
            throw err;
          }
        }

        const { rows: [{ id: outletId }] } = await client.query(
          `INSERT INTO outlets (name, address, phone, outlet_type, van_rep_employee_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [name, address, phone, isVan ? "van" : "store", isVan && van_rep_employee_id ? Number(van_rep_employee_id) : null]
        );

        // Clone the source's copyable settings in the same transaction. WHAT is
        // copyable lives in services/outlet-copy.js (owner ruling 2026-07-14) —
        // never widen the list here. Every statement is set-based and re-stamped
        // with this actor: the copy is a new decision by this employee, not the
        // source's history. A source with nothing configured copies 0 rows and
        // the new outlet simply inherits the defaults.
        let copied = { total: 0, perTable: {} };
        if (copyFromId !== null) {
          copied = await copyOutletSettings(client, {
            sourceOutletId: copyFromId,
            targetOutletId: outletId,
            actor,
            employeeId,
          });
          await client.query(
            `INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3)`,
            [
              actor,
              "outlet_settings_copied",
              `Copied ${describeCopy(copied)} setting row(s) from outlet ${copyFromId} to new outlet ${outletId} ('${name}')`,
            ]
          );
        }

        // Read the resulting STORE count + the seed-once flag in one
        // round-trip (vans never trigger multi-outlet seeding).
        const [{ rows: [{ cnt }] }, { rows: [profile] }] = await Promise.all([
          client.query("SELECT COUNT(*) AS cnt FROM outlets WHERE COALESCE(outlet_type, 'store') <> 'van'"),
          client.query("SELECT multi_outlet_flags_seeded FROM company_profile WHERE id = 1"),
        ]);
        const outletCount = Number(cnt);
        const alreadySeeded = profile?.multi_outlet_flags_seeded === true;

        let multiOutletSeeded = false;
        // Vans never trigger (or backfill) multi-outlet seeding — only the
        // creation of a second STORE flips the tenant into multi-outlet mode.
        if (!isVan && outletCount > 1 && !alreadySeeded) {
          await seedMultiOutletFlags(client);
          await client.query(
            "UPDATE company_profile SET multi_outlet_flags_seeded = true WHERE id = 1"
          );
          multiOutletSeeded = true;
        }

        return { id: outletId, multiOutletSeeded, copied };
      });

      // Step 9: the outlet-context resolver caches the tenant's outlet list.
      require("../middleware/outlet-context").invalidateOutletCache(req.tenantId);

      res.json({
        id: result.id,
        name,
        address,
        phone,
        outlet_type: isVan ? "van" : "store",
        van_rep_employee_id: isVan && van_rep_employee_id ? Number(van_rep_employee_id) : null,
        multi_outlet_flags_seeded: result.multiOutletSeeded,
        copied_from_outlet_id: copyFromId,
        // Kept for the Step 12 Phase 1 contract; `copied_settings` is the
        // per-table breakdown added when the ruling widened the copy.
        copied_module_overrides: result.copied.perTable.outlet_business_modules || 0,
        copied_settings: result.copied.perTable,
        copied_settings_total: result.copied.total,
      });
    } catch (err) {
      // Typed errors thrown inside the transaction (copy-source validation)
      // surface as themselves; everything else stays a 500.
      if (err.statusCode) {
        return res.status(err.statusCode).json({ code: err.code, error: err.message });
      }
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
      require("../middleware/outlet-context").invalidateOutletCache(req.tenantId);
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
      require("../middleware/outlet-context").invalidateOutletCache(req.tenantId);
      res.json({ message: "Outlet deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
