const { SUPPLIER_TOTALS_SQL } = require("../services/supplier-balance");
const { toUtcStart, tenantToday } = require("../utils/tz");

// Blank / absent → undefined (keep the stored value on edit); else a number.
function optionalMoney(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = function registerSupplierRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  // Get all suppliers — includes credit terms + running balance
  app.get("/api/suppliers", async (req, res) => {
    try {
      // running_balance = what we owe (services/supplier-balance.js).
      const { rows } = await db.query(
        `SELECT s.*, t.balance AS running_balance
         FROM suppliers s
         JOIN (${SUPPLIER_TOTALS_SQL}) t ON t.supplier_id = s.id
         ORDER BY s.name ASC`
      );
      res.json({ suppliers: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new supplier
  app.post("/api/suppliers", requirePerm("manage_inventory"), async (req, res) => {
    const {
      name, contact_person, phone, email, address,
      payment_terms = "cash", credit_days = 0, credit_limit = 0,
      default_lead_time_days, opening_balance, opening_balance_date,
    } = req.body;
    const opening = optionalMoney(opening_balance) ?? 0;
    if (Number.isNaN(opening)) return res.status(400).json({ error: "opening_balance must be a number" });
    try {
      const { rows } = await db.query(
        `INSERT INTO suppliers (name, contact_person, phone, email, address, payment_terms, credit_days, credit_limit, default_lead_time_days,
                                opening_balance, opening_balance_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10::numeric <> 0 THEN COALESCE($11::date, $12::date) END) RETURNING id`,
        [
          name, contact_person, phone, email, address,
          payment_terms, Number(credit_days), Number(credit_limit),
          default_lead_time_days != null ? Number(default_lead_time_days) : null,
          opening, opening_balance_date || null, tenantToday(req.company?.timezone || "UTC"),
        ]
      );
      res.json({
        id: rows[0].id, name, contact_person, phone, email, address,
        payment_terms, credit_days, credit_limit,
        default_lead_time_days, opening_balance: opening,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update a supplier
  app.put("/api/suppliers/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const {
      name, contact_person, phone, email, address,
      payment_terms, credit_days, credit_limit,
      default_lead_time_days, opening_balance, opening_balance_date,
    } = req.body;
    // Absent → keep the stored opening balance (a partial edit must not wipe it).
    const opening = optionalMoney(opening_balance);
    if (Number.isNaN(opening)) return res.status(400).json({ error: "opening_balance must be a number" });
    try {
      const { rowCount } = await db.query(
        `UPDATE suppliers SET
           name                    = COALESCE($1, name),
           contact_person          = COALESCE($2, contact_person),
           phone                   = COALESCE($3, phone),
           email                   = COALESCE($4, email),
           address                 = COALESCE($5, address),
           payment_terms           = COALESCE($6, payment_terms),
           credit_days             = COALESCE($7, credit_days),
           credit_limit            = COALESCE($8, credit_limit),
           default_lead_time_days  = COALESCE($9, default_lead_time_days),
           opening_balance         = COALESCE($11, opening_balance),
           opening_balance_date    = CASE WHEN $11::numeric IS NULL THEN opening_balance_date
                                          ELSE COALESCE($12::date, opening_balance_date, $13::date) END
         WHERE id = $10`,
        [
          name, contact_person, phone, email, address,
          payment_terms,
          credit_days !== undefined ? Number(credit_days) : undefined,
          credit_limit !== undefined ? Number(credit_limit) : undefined,
          default_lead_time_days !== undefined && default_lead_time_days !== null
            ? Number(default_lead_time_days) : undefined,
          id,
          opening, opening_balance_date || null, tenantToday(req.company?.timezone || "UTC"),
        ]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
      res.json({ message: "Supplier updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pay a supplier ON ACCOUNT (D13): a lump sum (cash by hand, bank transfer,
  // cheque) that lowers what we owe without naming a bill. Paying more than is
  // owed is allowed: the balance goes negative (an advance). Void it through
  // POST /api/supplier-payments/:id/void like any other supplier payment.
  app.post(
    "/api/suppliers/:id/payments",
    requirePerm("manage_orders"),
    requireFeature("supplier_payables"),
    async (req, res) => {
      const { amount, payment_method = "Cash", reference, paid_by, notes, paid_at } = req.body || {};
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Valid amount is required" });
      if (paid_at && !/^\d{4}-\d{2}-\d{2}/.test(String(paid_at))) {
        return res.status(400).json({ error: "paid_at must be a date (YYYY-MM-DD)" });
      }
      try {
        // A date only: today keeps the time of payment; an earlier day is
        // stored at midday in the shop's timezone (not midnight UTC, which is
        // 5 AM in Lahore and can fall on the wrong day elsewhere).
        const tz = req.company?.timezone || "UTC";
        const day = paid_at ? String(paid_at).slice(0, 10) : null;
        const paidAt = !day || day === tenantToday(tz)
          ? null
          : new Date(new Date(toUtcStart(day, tz)).getTime() + 12 * 3600 * 1000).toISOString();
        const { rows: [sup] } = await db.query("SELECT id FROM suppliers WHERE id = $1", [req.params.id]);
        if (!sup) return res.status(404).json({ error: "Supplier not found" });
        const { rows: [payment] } = await db.query(
          `INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, notes, paid_at)
           VALUES (NULL, $1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()))
           RETURNING id, supplier_id, amount::float AS amount, payment_method, reference, paid_at`,
          [sup.id, amt, payment_method, reference || null, paid_by || null, notes || null, paidAt],
        );
        const { rows: [t] } = await db.query(
          `SELECT balance FROM (${SUPPLIER_TOTALS_SQL}) t WHERE t.supplier_id = $1`, [sup.id]);
        res.status(201).json({ payment, balance: t.balance });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Delete a supplier — blocked when outstanding invoices exist
  app.delete("/api/suppliers/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT COUNT(*) as cnt FROM supplier_invoices WHERE supplier_id = $1 AND (status != 'paid' OR status IS NULL)`,
        [id]
      );
      if (Number(rows[0]?.cnt || 0) > 0) {
        return res.status(400).json({ error: "Cannot delete supplier with outstanding invoices. Settle all invoices first." });
      }
      const { rowCount } = await db.query("DELETE FROM suppliers WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
      res.json({ message: "Supplier deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
