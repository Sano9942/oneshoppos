module.exports = function registerParkedSalesRoutes(app, deps) {
  const { db, requirePerm } = deps;

// --- ROUTES: PARKED SALES (Phase 3) ---

  // List all parked sales (with item count)
  app.get("/api/parked-sales", (req, res) => {
    const { outlet_id } = req.query;
    let sql = `
    SELECT ps.*, e.name as employee_name, c.name as customer_name, o.name as outlet_name,
           COUNT(psi.id) as item_count
    FROM parked_sales ps
    LEFT JOIN employees e ON ps.employee_id = e.id
    LEFT JOIN customers c ON ps.customer_id = c.id
    LEFT JOIN outlets o ON ps.outlet_id = o.id
    LEFT JOIN parked_sale_items psi ON psi.parked_sale_id = ps.id
  `;
    const params = [];
    if (outlet_id) {
      sql += " WHERE ps.outlet_id = ?";
      params.push(outlet_id);
    }
    sql += " GROUP BY ps.id ORDER BY ps.parked_at DESC";
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ parkedSales: rows });
    });
  });

  // Get a single parked sale with all items
  app.get("/api/parked-sales/:id", (req, res) => {
    const { id } = req.params;
    db.get(
      `SELECT ps.*, e.name as employee_name, c.name as customer_name, o.name as outlet_name
     FROM parked_sales ps
     LEFT JOIN employees e ON ps.employee_id = e.id
     LEFT JOIN customers c ON ps.customer_id = c.id
     LEFT JOIN outlets o ON ps.outlet_id = o.id
     WHERE ps.id = ?`,
      [id],
      (err, sale) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sale)
          return res.status(404).json({ error: "Parked sale not found" });
        db.all(
          "SELECT * FROM parked_sale_items WHERE parked_sale_id = ?",
          [id],
          (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ parkedSale: sale, items });
          },
        );
      },
    );
  });

  // Park a sale (create)
  app.post("/api/parked-sales", requirePerm("pos_park"), (req, res) => {
    const { employee_id, outlet_id, customer_id, label, notes, items } =
      req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Cannot park an empty cart" });
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "INSERT INTO parked_sales (employee_id, outlet_id, customer_id, label, notes) VALUES (?, ?, ?, ?, ?)",
        [
          employee_id || null,
          outlet_id || null,
          customer_id || null,
          label || null,
          notes || null,
        ],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }
          const parkedId = this.lastID;
          const stmt = db.prepare(
            "INSERT INTO parked_sale_items (parked_sale_id, product_id, variant_id, product_name, quantity, price, effective_tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?)",
          );
          items.forEach((item) => {
            stmt.run(
              parkedId,
              item.product_id || null,
              item.variant_id || null,
              item.product_name || item.name || "",
              item.quantity,
              item.price,
              item.effective_tax_rate || 0,
            );
          });
          stmt.finalize();
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Sale parked successfully", id: parkedId });
          });
        },
      );
    });
  });

  // Delete (unpark/restore) a parked sale
  app.delete("/api/parked-sales/:id", requirePerm("pos_park"), (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM parked_sales WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Parked sale not found" });
      res.json({ message: "Parked sale removed" });
    });
  });
};
