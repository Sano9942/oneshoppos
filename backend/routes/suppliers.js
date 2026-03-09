module.exports = function registerSupplierRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all suppliers — includes credit terms + running balance
  app.get("/api/suppliers", (req, res) => {
    db.all(
      `SELECT s.*,
              COALESCE(outstanding.balance, 0) AS running_balance
       FROM suppliers s
       LEFT JOIN (
         SELECT si.supplier_id,
                SUM(si.amount - COALESCE(sp.paid_amount, 0)) AS balance
         FROM supplier_invoices si
         LEFT JOIN (
           SELECT supplier_invoice_id, SUM(amount) AS paid_amount
           FROM supplier_payments GROUP BY supplier_invoice_id
         ) sp ON sp.supplier_invoice_id = si.id
         WHERE si.status != 'paid'
         GROUP BY si.supplier_id
       ) outstanding ON outstanding.supplier_id = s.id
       ORDER BY s.name ASC`,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ suppliers: rows });
      },
    );
  });

  // Add a new supplier
  app.post("/api/suppliers", requirePerm("manage_inventory"), (req, res) => {
    const {
      name, contact_person, phone, email, address,
      payment_terms = "cash", credit_days = 0, credit_limit = 0,
    } = req.body;
    db.run(
      `INSERT INTO suppliers (name, contact_person, phone, email, address, payment_terms, credit_days, credit_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, contact_person, phone, email, address, payment_terms, Number(credit_days), Number(credit_limit)],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, contact_person, phone, email, address, payment_terms, credit_days, credit_limit });
      },
    );
  });

  // Update a supplier
  app.put("/api/suppliers/:id", requirePerm("manage_inventory"), (req, res) => {
    const { id } = req.params;
    const {
      name, contact_person, phone, email, address,
      payment_terms, credit_days, credit_limit,
    } = req.body;
    db.run(
      `UPDATE suppliers SET
         name            = COALESCE(?, name),
         contact_person  = COALESCE(?, contact_person),
         phone           = COALESCE(?, phone),
         email           = COALESCE(?, email),
         address         = COALESCE(?, address),
         payment_terms   = COALESCE(?, payment_terms),
         credit_days     = COALESCE(?, credit_days),
         credit_limit    = COALESCE(?, credit_limit)
       WHERE id = ?`,
      [name, contact_person, phone, email, address,
       payment_terms,
       credit_days !== undefined ? Number(credit_days) : undefined,
       credit_limit !== undefined ? Number(credit_limit) : undefined,
       id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Supplier not found" });
        res.json({ message: "Supplier updated successfully" });
      },
    );
  });

  // Delete a supplier — blocked when outstanding invoices exist
  app.delete("/api/suppliers/:id", requirePerm("manage_inventory"), (req, res) => {
    const { id } = req.params;
    db.get(
      `SELECT COUNT(*) as cnt FROM supplier_invoices WHERE supplier_id = ? AND (status != 'paid' OR status IS NULL)`,
      [id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (Number(row?.cnt || 0) > 0) {
          return res.status(400).json({ error: "Cannot delete supplier with outstanding invoices. Settle all invoices first." });
        }
        db.run("DELETE FROM suppliers WHERE id = ?", [id], function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          if (this.changes === 0) return res.status(404).json({ error: "Supplier not found" });
          res.json({ message: "Supplier deleted" });
        });
      },
    );
  });
};
