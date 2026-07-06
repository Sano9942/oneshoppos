/**
 * routes/packages.js — F02 packages / session passes.
 *
 *   GET    /api/package-templates                 — list templates (+ ?active=1)
 *   POST   /api/package-templates                 — create template (optionally
 *                                                    auto-creating a POS product tile)
 *   PUT    /api/package-templates/:id             — update template
 *   DELETE /api/package-templates/:id             — soft-deactivate (is_active=false)
 *
 *   GET    /api/customers/:id/packages            — a customer's package balances
 *   POST   /api/customers/:id/packages            — sell / grant a package
 *   POST   /api/packages/:id/redeem               — redeem 1+ credits
 *   POST   /api/packages/:id/reverse              — reverse a redemption (give credit back)
 *
 * Template admin gated by manage_bookings; sell/redeem/balance by view_reports
 * (any counter staff). All gated by requireFeature("packages_passes").
 *
 * The credit ledger + locking live in services/packages.js — routes are thin.
 */
const pkgService = require("../services/packages");

module.exports = function registerPackageRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;

  const adminGuard = [
    requireFeature("packages_passes"),
    requireAnyPerm(["manage_bookings", "all_access"]),
  ];
  const staffGuard = [
    requireFeature("packages_passes"),
    requireAnyPerm(["view_reports", "manage_bookings", "all_access"]),
  ];

  // ── Template CRUD ──────────────────────────────────────────────────────

  app.get("/api/package-templates", ...adminGuard, async (req, res) => {
    try {
      const onlyActive = String(req.query.active || "") === "1";
      const { rows } = await db.query(
        `SELECT pt.id, pt.name, pt.price::numeric AS price, pt.credits,
                pt.validity_days, pt.service_scope, pt.product_id, pt.is_active,
                pt.created_at,
                COALESCE(
                  (SELECT json_agg(pts.booking_service_id)
                     FROM package_template_services pts
                    WHERE pts.package_template_id = pt.id), '[]'
                ) AS service_ids
           FROM package_templates pt
          ${onlyActive ? "WHERE pt.is_active = true" : ""}
          ORDER BY pt.is_active DESC, pt.name`,
      );
      res.json(rows.map((r) => ({ ...r, price: Number(r.price) })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/package-templates", ...adminGuard, async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      const price = Number(b.price);
      const credits = Math.floor(Number(b.credits));
      const validityDays = b.validity_days != null && b.validity_days !== ""
        ? Math.floor(Number(b.validity_days)) : null;
      const scope = b.service_scope === "listed" ? "listed" : "any";
      const serviceIds = Array.isArray(b.service_ids)
        ? b.service_ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      const createProduct = b.create_product !== false; // default: make a POS tile

      if (!name) return res.status(400).json({ error: "name is required" });
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: "price must be >= 0" });
      if (!Number.isInteger(credits) || credits <= 0) return res.status(400).json({ error: "credits must be > 0" });
      if (validityDays != null && (!Number.isInteger(validityDays) || validityDays <= 0)) {
        return res.status(400).json({ error: "validity_days must be a positive integer or blank" });
      }
      if (scope === "listed" && serviceIds.length === 0) {
        return res.status(400).json({ error: "scope 'listed' requires at least one service_id" });
      }

      const result = await db.transaction(async (client) => {
        let productId = null;
        if (createProduct) {
          // Backing product so the package rings up as a POS tile (mirrors the
          // gift-card SKU pattern). Marked as a non-inventory service line.
          const { rows: [prod] } = await client.query(
            `INSERT INTO products (name, sku, price, cost_price, product_type, status)
             VALUES ($1, $2, $3, 0, 'package', 'active')
             RETURNING id`,
            [name, `PKG-${Date.now().toString(36).toUpperCase()}`, price],
          );
          productId = prod.id;
        }
        const { rows: [tpl] } = await client.query(
          `INSERT INTO package_templates
             (name, price, credits, validity_days, service_scope, product_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING *`,
          [name, price, credits, validityDays, scope, productId],
        );
        if (scope === "listed") {
          for (const sid of serviceIds) {
            await client.query(
              `INSERT INTO package_template_services (package_template_id, booking_service_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [tpl.id, sid],
            );
          }
        }
        return tpl;
      });
      res.status(201).json({ ...result, price: Number(result.price) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/package-templates/:id", ...adminGuard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const fields = [];
      const params = [];
      if (b.name != null) { params.push(String(b.name).trim()); fields.push(`name = $${params.length}`); }
      if (b.price != null) { params.push(Number(b.price)); fields.push(`price = $${params.length}`); }
      if (b.is_active != null) { params.push(!!b.is_active); fields.push(`is_active = $${params.length}`); }
      if (b.validity_days !== undefined) {
        const v = b.validity_days === null || b.validity_days === "" ? null : Math.floor(Number(b.validity_days));
        params.push(v); fields.push(`validity_days = $${params.length}`);
      }
      // credits/scope are intentionally immutable once sold — changing them would
      // desync already-issued customer_packages. Only mutate metadata here.
      if (!fields.length) return res.status(400).json({ error: "no updatable fields" });
      params.push(id);
      const { rows: [tpl] } = await db.query(
        `UPDATE package_templates SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      if (!tpl) return res.status(404).json({ error: "Package template not found" });
      res.json({ ...tpl, price: Number(tpl.price) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/package-templates/:id", ...adminGuard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { rows: [tpl] } = await db.query(
        "UPDATE package_templates SET is_active = false WHERE id = $1 RETURNING id",
        [id],
      );
      if (!tpl) return res.status(404).json({ error: "Package template not found" });
      res.json({ ok: true, id: tpl.id, deactivated: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Customer balances + sell ───────────────────────────────────────────

  app.get("/api/customers/:id/packages", ...staffGuard, async (req, res) => {
    try {
      const customerId = Number(req.params.id);
      if (!Number.isInteger(customerId)) return res.status(400).json({ error: "invalid customer id" });
      // Catch up any stale-active-but-expired rows before reporting balances.
      await pkgService.expireStalePackages(db, customerId);
      const { rows } = await db.query(
        `SELECT cp.id, cp.package_template_id, cp.credits_total, cp.credits_used,
                (cp.credits_total - cp.credits_used) AS credits_remaining,
                cp.status, cp.expires_at, cp.sale_id, cp.created_at,
                pt.name AS template_name, pt.service_scope
           FROM customer_packages cp
           JOIN package_templates pt ON pt.id = cp.package_template_id
          WHERE cp.customer_id = $1
          ORDER BY cp.status = 'active' DESC, cp.created_at DESC`,
        [customerId],
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/customers/:id/packages", ...adminGuard, async (req, res) => {
    try {
      const customerId = Number(req.params.id);
      const templateId = Number(req.body?.template_id ?? req.body?.package_template_id);
      const saleId = req.body?.sale_id != null ? Number(req.body.sale_id) : null;
      if (!Number.isInteger(customerId)) return res.status(400).json({ error: "invalid customer id" });
      if (!Number.isInteger(templateId)) return res.status(400).json({ error: "template_id is required" });

      const pkg = await db.transaction((client) =>
        pkgService.sellPackage(client, { customerId, templateId, saleId }),
      );
      res.status(201).json(pkg);
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Redeem / reverse ───────────────────────────────────────────────────

  app.post("/api/packages/:id/redeem", ...staffGuard, async (req, res) => {
    try {
      const customerPackageId = Number(req.params.id);
      const b = req.body || {};
      if (!Number.isInteger(customerPackageId)) return res.status(400).json({ error: "invalid package id" });

      const result = await db.transaction(async (client) => {
        // Resolve service scope from an appointment or an explicit booking_service_id.
        let bookingServiceId = b.booking_service_id != null ? Number(b.booking_service_id) : null;
        if (!bookingServiceId && b.appointment_id) {
          const { rows } = await client.query(
            "SELECT service_id FROM appointments WHERE id = $1",
            [Number(b.appointment_id)],
          );
          if (rows.length) bookingServiceId = rows[0].service_id;
        }
        return pkgService.redeemPackage(client, {
          customerPackageId,
          credits: b.credits != null ? Number(b.credits) : 1,
          saleId: b.sale_id != null ? Number(b.sale_id) : null,
          appointmentId: b.appointment_id != null ? Number(b.appointment_id) : null,
          classSessionBookingId: b.class_session_booking_id != null ? Number(b.class_session_booking_id) : null,
          bookingServiceId,
        });
      });
      res.json(result);
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/packages/:id/reverse", ...staffGuard, async (req, res) => {
    try {
      const customerPackageId = Number(req.params.id);
      const b = req.body || {};
      const result = await db.transaction((client) =>
        pkgService.reverseRedemption(client, {
          redemptionId: b.redemption_id != null ? Number(b.redemption_id) : null,
          appointmentId: b.appointment_id != null ? Number(b.appointment_id) : null,
          classSessionBookingId: b.class_session_booking_id != null ? Number(b.class_session_booking_id) : null,
        }),
      );
      if (!result.reversed && result.reason === "no_active_redemption") {
        return res.status(404).json({ error: "No active redemption found to reverse" });
      }
      res.json(result);
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });
};
