module.exports = function registerSupplierRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all suppliers — includes credit terms + running balance
  app.get("/api/suppliers", async (req, res) => {
    try {
      const { rows } = await db.query(
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
    } = req.body;
    try {
      const { rows } = await db.query(
        `INSERT INTO suppliers (name, contact_person, phone, email, address, payment_terms, credit_days, credit_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [name, contact_person, phone, email, address, payment_terms, Number(credit_days), Number(credit_limit)]
      );
      res.json({ id: rows[0].id, name, contact_person, phone, email, address, payment_terms, credit_days, credit_limit });
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
    } = req.body;
    try {
      const { rowCount } = await db.query(
        `UPDATE suppliers SET
           name            = COALESCE($1, name),
           contact_person  = COALESCE($2, contact_person),
           phone           = COALESCE($3, phone),
           email           = COALESCE($4, email),
           address         = COALESCE($5, address),
           payment_terms   = COALESCE($6, payment_terms),
           credit_days     = COALESCE($7, credit_days),
           credit_limit    = COALESCE($8, credit_limit)
         WHERE id = $9`,
        [name, contact_person, phone, email, address,
         payment_terms,
         credit_days !== undefined ? Number(credit_days) : undefined,
         credit_limit !== undefined ? Number(credit_limit) : undefined,
         id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
      res.json({ message: "Supplier updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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
