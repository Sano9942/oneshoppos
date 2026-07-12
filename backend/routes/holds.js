// 2-G.9 Layaway / hold / special-order routes.
//
// Entire surface is gated by the phase2g_holds feature flag. Stock is held
// via inventory_reservations (reservation_key='hold:<id>:<product_id>:<variant_id>')
// which the existing reservation worker already knows how to sweep on expiry.
//
// Lifecycle:
//   POST /api/holds                      → reserve stock + create hold (active)
//   POST /api/holds/:id/payments         → deposit / part-payment (may flip → paid)
//   POST /api/holds/:id/complete         → create sale, consume reservations, deduct stock
//   POST /api/holds/:id/cancel           → release reservations; deposit disposition
//   GET  /api/holds                      → list with filters
//   GET  /api/holds/:id                  → detail (items + payments)
//   GET  /api/holds/by-barcode/:code     → scanner lookup (hold_number)
//   GET  /api/holds/expiring?days=7      → dashboard widget feed
const { validate } = require("../middleware/validate");
const { resolveTaxSnapshot } = require("../services/tax-snapshot");
const kitEngine = require("../services/kit-engine");
const batchStock = require("../services/batch-stock");
const {
  CreateHoldSchema,
  AddPaymentSchema,
  CompleteHoldSchema,
  CancelHoldSchema,
} = require("../schemas/holds");

module.exports = function registerHoldRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;
  const feat = requireFeature("phase2g_holds");

  // ── helpers ────────────────────────────────────────────────────────

  async function generateHoldNumber(client) {
    const year = new Date().getFullYear();
    const { rows: [row] } = await client.query(
      `SELECT COUNT(*) AS cnt FROM holds
         WHERE created_at >= date_trunc('year', NOW())`,
    );
    const seq = String(Number(row?.cnt || 0) + 1).padStart(5, "0");
    return `H-${year}-${seq}`;
  }

  function computeBalance(total, deposit) {
    const bal = Math.max(0, Number(total) - Number(deposit));
    return Math.round(bal * 100) / 100;
  }

  async function fetchHoldFull(client, holdId) {
    const { rows: [hold] } = await client.query(
      `SELECT h.*, o.name AS outlet_name, c.name AS customer_name_full
       FROM holds h
       LEFT JOIN outlets o ON h.outlet_id = o.id
       LEFT JOIN customers c ON h.customer_id = c.id
       WHERE h.id = $1`,
      [holdId],
    );
    if (!hold) return null;
    const { rows: items } = await client.query(
      `SELECT hi.*, p.name AS product_name, p.barcode
       FROM hold_items hi
       JOIN products p ON p.id = hi.product_id
       WHERE hi.hold_id = $1
       ORDER BY hi.id`,
      [holdId],
    );
    const { rows: payments } = await client.query(
      `SELECT * FROM hold_payments WHERE hold_id = $1 ORDER BY paid_at`,
      [holdId],
    );
    return { hold, items, payments };
  }

  // ── LIST ───────────────────────────────────────────────────────────

  app.get("/api/holds", feat, requireAnyPerm(["pos_park", "manage_orders", "all_access"]), async (req, res) => {
    const { status, outlet_id, expiring_within_days, customer_id } = req.query;
    try {
      let where = "1=1";
      const params = [];
      let idx = 1;
      if (status) { where += ` AND h.status = $${idx++}`; params.push(status); }
      if (outlet_id) { where += ` AND h.outlet_id = $${idx++}`; params.push(Number(outlet_id)); }
      if (customer_id) { where += ` AND h.customer_id = $${idx++}`; params.push(Number(customer_id)); }
      if (expiring_within_days) {
        where += ` AND h.status = 'active' AND h.hold_until <= NOW() + ($${idx++} || ' days')::interval`;
        params.push(String(Number(expiring_within_days)));
      }
      const { rows } = await db.query(
        `SELECT h.*, o.name AS outlet_name, c.name AS customer_name_full
         FROM holds h
         LEFT JOIN outlets o ON h.outlet_id = o.id
         LEFT JOIN customers c ON h.customer_id = c.id
         WHERE ${where}
         ORDER BY h.created_at DESC
         LIMIT 500`,
        params,
      );
      res.json({ holds: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DETAIL ─────────────────────────────────────────────────────────

  app.get("/api/holds/expiring", feat, requireAnyPerm(["pos_park", "manage_orders", "view_sales_reports", "all_access"]), async (req, res) => {
    const days = Number(req.query.days || 7);
    try {
      const { rows } = await db.query(
        `SELECT h.*, o.name AS outlet_name, c.name AS customer_name_full
         FROM holds h
         LEFT JOIN outlets o ON h.outlet_id = o.id
         LEFT JOIN customers c ON h.customer_id = c.id
         WHERE h.status = 'active'
           AND h.hold_until IS NOT NULL
           AND h.hold_until <= NOW() + ($1 || ' days')::interval
         ORDER BY h.hold_until ASC
         LIMIT 50`,
        [String(days)],
      );
      res.json({ holds: rows, days });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/holds/by-barcode/:code", feat, requireAnyPerm(["pos_park", "view_sales_reports", "all_access"]), async (req, res) => {
    const code = String(req.params.code || "").trim();
    if (!code) return res.status(400).json({ error: "barcode required" });
    try {
      const { rows: [hold] } = await db.query(
        "SELECT id FROM holds WHERE UPPER(hold_number) = UPPER($1) LIMIT 1",
        [code],
      );
      if (!hold) return res.status(404).json({ error: "Hold not found" });
      const detail = await fetchHoldFull(db, hold.id);
      res.json(detail);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/holds/:id", feat, requireAnyPerm(["pos_park", "manage_orders", "view_sales_reports", "all_access"]), async (req, res) => {
    try {
      const detail = await fetchHoldFull(db, req.params.id);
      if (!detail) return res.status(404).json({ error: "Hold not found" });
      res.json(detail);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── CREATE ─────────────────────────────────────────────────────────

  app.post("/api/holds", feat, requireAnyPerm(["pos_park", "manage_orders", "all_access"]), validate(CreateHoldSchema), async (req, res) => {
    const {
      outlet_id, customer_id, customer_phone, customer_name,
      items, total_amount, deposit_amount, deposit_method,
      hold_until, hold_days, notes,
    } = req.body;
    const employeeId = req.employee?.id || req.headers["x-employee-id"] || null;
    const deposit = Number(deposit_amount || 0);
    const balance = computeBalance(total_amount, deposit);

    const expiresAt = hold_until
      ? new Date(hold_until).toISOString()
      : new Date(Date.now() + (Number(hold_days || 14) * 86400 * 1000)).toISOString();

    try {
      const result = await db.transaction(async (client) => {
        // Lock stock rows before reserving to match the sales FOR UPDATE pattern.
        for (const it of items) {
          if (it.variant_id) {
            await client.query(
              "SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE",
              [it.variant_id],
            );
          } else {
            await client.query(
              "SELECT quantity FROM outlet_stock WHERE outlet_id = $1 AND product_id = $2 FOR UPDATE",
              [outlet_id, it.product_id],
            );
          }
        }

        const holdNumber = await generateHoldNumber(client);
        const { rows: [hold] } = await client.query(
          `INSERT INTO holds (
             hold_number, customer_id, customer_phone, customer_name,
             outlet_id, status, total_amount, deposit_paid, balance_due,
             hold_until, notes, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            holdNumber, customer_id || null, customer_phone || null, customer_name || null,
            outlet_id,
            deposit > 0 && balance === 0 ? "paid" : "active",
            total_amount, deposit, balance,
            expiresAt, notes || null, employeeId,
          ],
        );

        for (const it of items) {
          await client.query(
            `INSERT INTO hold_items (hold_id, product_id, variant_id, quantity, price_at_hold)
             VALUES ($1,$2,$3,$4,$5)`,
            [hold.id, it.product_id, it.variant_id || null, it.quantity, it.price_at_hold],
          );
          await client.query(
            `INSERT INTO inventory_reservations (
               reservation_key, product_id, variant_id, outlet_id, quantity, status, expires_at
             ) VALUES ($1,$2,$3,$4,$5,'active',$6)`,
            [
              `hold:${hold.id}:${it.product_id}:${it.variant_id || 0}`,
              it.product_id,
              it.variant_id || null,
              outlet_id,
              Math.ceil(Number(it.quantity)), // reservation.quantity is INT
              expiresAt,
            ],
          );
        }

        if (deposit > 0) {
          await client.query(
            `INSERT INTO hold_payments (hold_id, amount, method, recorded_by)
             VALUES ($1,$2,$3,$4)`,
            [hold.id, deposit, deposit_method || "Cash", employeeId],
          );
        }

        return hold;
      });

      const detail = await fetchHoldFull(db, result.id);
      res.status(201).json(detail);
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── ADD PAYMENT ────────────────────────────────────────────────────

  app.post("/api/holds/:id/payments", feat, requireAnyPerm(["pos_park", "manage_orders", "all_access"]), validate(AddPaymentSchema), async (req, res) => {
    const holdId = Number(req.params.id);
    const { amount, method, gateway_ref } = req.body;
    const employeeId = req.employee?.id || null;

    try {
      const result = await db.transaction(async (client) => {
        const { rows: [hold] } = await client.query(
          "SELECT * FROM holds WHERE id = $1 FOR UPDATE",
          [holdId],
        );
        if (!hold) {
          throw Object.assign(new Error("Hold not found"), { statusCode: 404 });
        }
        if (!["active", "paid"].includes(hold.status)) {
          throw Object.assign(
            new Error(`Cannot add payment to hold in status ${hold.status}`),
            { statusCode: 400 },
          );
        }
        const pay = Number(amount);
        const newDeposit = Number(hold.deposit_paid) + pay;
        const newBalance = computeBalance(hold.total_amount, newDeposit);
        const newStatus = newBalance === 0 ? "paid" : "active";

        await client.query(
          `INSERT INTO hold_payments (hold_id, amount, method, gateway_ref, recorded_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [holdId, pay, method, gateway_ref || null, employeeId],
        );
        const { rows: [updated] } = await client.query(
          `UPDATE holds SET deposit_paid = $1, balance_due = $2, status = $3, updated_at = NOW()
           WHERE id = $4 RETURNING *`,
          [newDeposit, newBalance, newStatus, holdId],
        );
        return updated;
      });
      res.json({ hold: result });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── COMPLETE (convert to sale) ─────────────────────────────────────

  app.post("/api/holds/:id/complete", feat, requireAnyPerm(["manage_orders", "pos_park", "all_access"]), validate(CompleteHoldSchema), async (req, res) => {
    const holdId = Number(req.params.id);
    const employeeId = req.body.employee_id || req.employee?.id || null;
    const incomingPayments = Array.isArray(req.body.payments) ? req.body.payments : [];

    try {
      const result = await db.transaction(async (client) => {
        const { rows: [hold] } = await client.query(
          "SELECT * FROM holds WHERE id = $1 FOR UPDATE",
          [holdId],
        );
        if (!hold) throw Object.assign(new Error("Hold not found"), { statusCode: 404 });
        if (!["active", "paid"].includes(hold.status)) {
          throw Object.assign(
            new Error(`Cannot complete hold in status ${hold.status}`),
            { statusCode: 400 },
          );
        }

        const { rows: heldItems } = await client.query(
          "SELECT * FROM hold_items WHERE hold_id = $1",
          [holdId],
        );
        if (!heldItems.length) {
          throw Object.assign(new Error("Hold has no items"), { statusCode: 400 });
        }

        // 1. Settle any remaining balance with the provided payments.
        const newPaymentsTotal = incomingPayments.reduce((s, p) => s + Number(p.amount), 0);
        const paidBefore = Number(hold.deposit_paid);
        const finalPaid = paidBefore + newPaymentsTotal;
        if (finalPaid + 0.005 < Number(hold.total_amount)) {
          throw Object.assign(
            new Error(
              `Balance not settled — need ${(Number(hold.total_amount) - finalPaid).toFixed(2)} more`,
            ),
            { statusCode: 400 },
          );
        }

        // Record the fresh tender lines against the hold for audit, then we'll
        // carry them into sale_payments below.
        for (const p of incomingPayments) {
          await client.query(
            `INSERT INTO hold_payments (hold_id, amount, method, gateway_ref, recorded_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [holdId, p.amount, p.method, p.reference || null, employeeId],
          );
        }

        // 2. Resolve the v83 per-line tax snapshot against the frozen hold
        //    prices so the settled sale is visible to the tax ledger / GST /
        //    FBR exactly like a POS sale (shared cascade — tax-snapshot.js).
        const taxSnapshot = await resolveTaxSnapshot(client, {
          items: heldItems.map((hi) => ({
            productId: hi.product_id,
            price: hi.price_at_hold,
            quantity: hi.quantity,
          })),
          taxMode: (req.company && req.company.tax_mode) || "none",
          outletId: hold.outlet_id,
          tenantId: req.tenantId,
        });

        // Create the sale row (minimal — layaway pickup is a straight settle,
        // no promotion/loyalty/discount at this layer).
        const { rows: [sale] } = await client.query(
          `INSERT INTO sales (
             employee_id, outlet_id, total_amount, payment_method,
             customer_id, discount_amount, subtotal, tax_total, tax_inclusive
           ) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8)
           RETURNING *`,
          [
            employeeId,
            hold.outlet_id,
            hold.total_amount,
            incomingPayments[0]?.method || "Cash",
            hold.customer_id,
            taxSnapshot.subtotal,
            taxSnapshot.taxTotal,
            taxSnapshot.taxInclusive,
          ],
        );

        // 3. Sale items (copy from hold_items, with staff attribution left null
        //    since holds don't currently carry per-line staff — set at pickup time
        //    via future enhancement if needed).
        for (let i = 0; i < heldItems.length; i++) {
          const hi = heldItems[i];
          const taxLine = taxSnapshot.lines[i] || { rate: 0, amount: 0, hsCode: null };
          await client.query(
            `INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale,
               tax_rate_at_sale, tax_amount_at_sale, hs_code_at_sale)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [sale.id, hi.product_id, hi.variant_id, hi.quantity, hi.price_at_hold,
             Number(taxLine.rate || 0), Number(taxLine.amount || 0), taxLine.hsCode || null],
          );
        }

        // 4. Sale payments — carry forward every hold_payment + any new ones
        //    recorded above. Keeps the customer-facing receipt self-contained.
        const { rows: allPayments } = await client.query(
          "SELECT amount, method, gateway_ref FROM hold_payments WHERE hold_id = $1 ORDER BY paid_at",
          [holdId],
        );
        for (const p of allPayments) {
          await client.query(
            `INSERT INTO sale_payments (sale_id, payment_method, amount)
             VALUES ($1,$2,$3)`,
            [sale.id, p.method, p.amount],
          );
        }

        // 5. Consume reservations + deduct stock.
        await client.query(
          `UPDATE inventory_reservations SET status = 'consumed', updated_at = NOW()
           WHERE reservation_key LIKE $1 AND status = 'active'`,
          [`hold:${holdId}:%`],
        );
        for (const hi of heldItems) {
          // F01: a held kit decrements its COMPONENTS at settle (the kit holds no
          // stock of its own). The engine locks components in stable order and
          // throws insufficient_stock if a component sold out during the layaway.
          if ((await kitEngine.getBomType(client, hi.product_id)) === "kit") {
            const decs = await kitEngine.reserveAndDecrement(client, {
              productId: hi.product_id,
              outletId: hold.outlet_id,
              saleQty: Number(hi.quantity),
            });
            // F07: consume batches per tracked component of the settled kit.
            for (const d of decs || []) {
              await batchStock.consumeBatches(client, {
                productId: d.component_product_id,
                variantId: d.component_variant_id || null,
                outletId: hold.outlet_id,
                qty: d.needed,
                refType: "sale",
                refId: sale.id,
              });
            }
            continue;
          }
          if (hi.variant_id) {
            await client.query(
              `UPDATE product_variants SET stock = GREATEST(0, COALESCE(stock,0) - $1)
               WHERE id = $2`,
              [Number(hi.quantity), hi.variant_id],
            );
          }
          await client.query(
            `UPDATE outlet_stock
               SET quantity = GREATEST(0, quantity - $1)
             WHERE outlet_id = $2 AND product_id = $3`,
            [Number(hi.quantity), hold.outlet_id, hi.product_id],
          );
          // F07: FEFO-consume batches for a tracked held SKU at settle.
          await batchStock.consumeBatches(client, {
            productId: hi.product_id,
            variantId: hi.variant_id || null,
            outletId: hold.outlet_id,
            qty: Number(hi.quantity),
            refType: "sale",
            refId: sale.id,
          });
        }

        // 6. Flip hold status + link completed_sale_id.
        const { rows: [updated] } = await client.query(
          `UPDATE holds SET status = 'completed', completed_sale_id = $1,
             deposit_paid = $2, balance_due = 0, updated_at = NOW()
           WHERE id = $3 RETURNING *`,
          [sale.id, finalPaid, holdId],
        );

        return { hold: updated, sale };
      });

      res.json(result);
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── CANCEL ─────────────────────────────────────────────────────────

  app.post("/api/holds/:id/cancel", feat, requireAnyPerm(["manage_orders", "all_access"]), validate(CancelHoldSchema), async (req, res) => {
    const holdId = Number(req.params.id);
    const { reason, forfeit_deposit } = req.body;

    try {
      const result = await db.transaction(async (client) => {
        const { rows: [hold] } = await client.query(
          "SELECT * FROM holds WHERE id = $1 FOR UPDATE",
          [holdId],
        );
        if (!hold) throw Object.assign(new Error("Hold not found"), { statusCode: 404 });
        if (!["active", "paid"].includes(hold.status)) {
          throw Object.assign(
            new Error(`Cannot cancel hold in status ${hold.status}`),
            { statusCode: 400 },
          );
        }

        // Release reservations.
        await client.query(
          `UPDATE inventory_reservations SET status = 'released', updated_at = NOW()
           WHERE reservation_key LIKE $1 AND status = 'active'`,
          [`hold:${holdId}:%`],
        );

        const newStatus = forfeit_deposit ? "forfeit" : "cancelled";
        const newNotes = reason
          ? `${hold.notes ? hold.notes + "\n" : ""}Cancelled: ${reason}`
          : hold.notes;
        const { rows: [updated] } = await client.query(
          `UPDATE holds SET status = $1, notes = $2, updated_at = NOW()
           WHERE id = $3 RETURNING *`,
          [newStatus, newNotes, holdId],
        );
        return updated;
      });
      res.json({ hold: result });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── EXPIRY SWEEP — called by the hold-expiry worker ───────────────
  // Idempotent: flips past-due active holds to 'forfeit' and releases their
  // reservations. Safe to call repeatedly.
  app.post("/api/holds/_sweep-expired", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const result = await db.transaction(async (client) => {
        const { rows: due } = await client.query(
          `SELECT id FROM holds
             WHERE status = 'active' AND hold_until IS NOT NULL AND hold_until < NOW()
             ORDER BY id
             FOR UPDATE`,
        );
        for (const row of due) {
          await client.query(
            `UPDATE inventory_reservations SET status = 'released', updated_at = NOW()
             WHERE reservation_key LIKE $1 AND status = 'active'`,
            [`hold:${row.id}:%`],
          );
          await client.query(
            "UPDATE holds SET status = 'forfeit', updated_at = NOW() WHERE id = $1",
            [row.id],
          );
        }
        return { expired: due.length };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
