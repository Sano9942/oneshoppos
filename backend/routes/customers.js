module.exports = function registerCustomerRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // GET all customers (with total order count and spend)
  app.get("/api/customers", (req, res) => {
    const { search = "" } = req.query;
    let query = `
    SELECT c.*,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
  `;
    const params = [];
    if (search) {
      query += " WHERE c.deleted_at IS NULL AND (c.name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      query += " WHERE c.deleted_at IS NULL";
    }
    query += " GROUP BY c.id ORDER BY c.name ASC";
    db.all(query, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ customers: rows });
    });
  });

  // GET single customer's sales history
  app.get("/api/customers/:id/sales", (req, res) => {
    const { id } = req.params;
    db.all(
      `SELECT s.*, o.name as outlet_name, e.name as employee_name,
            COUNT(si.id) as item_count
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     LEFT JOIN sale_items si ON s.id = si.sale_id
     WHERE s.customer_id = ?
     GROUP BY s.id
     ORDER BY s.timestamp DESC`,
      [id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ sales: rows });
      },
    );
  });

  // POST create customer
  app.post("/api/customers", (req, res) => {
    const { name, mobile, email, address, cnic, occupation, balance } =
      req.body;
    if (!name)
      return res.status(400).json({ error: "Customer name is required" });
    db.run(
      "INSERT INTO customers (name, mobile, email, address, cnic, occupation, balance) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        name,
        mobile || null,
        email || null,
        address || null,
        cnic || null,
        occupation || null,
        balance || 0,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          id: this.lastID,
          name,
          mobile,
          email,
          address,
          cnic,
          occupation,
          balance: balance || 0,
          order_count: 0,
          total_spent: 0,
        });
      },
    );
  });

  // PUT update customer
  app.put("/api/customers/:id", requirePerm("manage_customers"), (req, res) => {
    const { id } = req.params;
    const { name, mobile, email, address, cnic, occupation, balance } =
      req.body;
    if (!name)
      return res.status(400).json({ error: "Customer name is required" });
    db.run(
      "UPDATE customers SET name = ?, mobile = ?, email = ?, address = ?, cnic = ?, occupation = ?, balance = COALESCE(?, balance) WHERE id = ?",
      [
        name,
        mobile || null,
        email || null,
        address || null,
        cnic || null,
        occupation || null,
        balance !== undefined ? balance : null,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Customer not found" });
        res.json({ message: "Customer updated" });
      },
    );
  });

  // PUT update customer points manually
  app.put("/api/customers/:id/points", requirePerm("manage_customers"), (req, res) => {
    const { id } = req.params;
    const { points } = req.body;
    if (points === undefined || isNaN(points))
      return res.status(400).json({ error: "Points value is required" });

    db.run(
      "UPDATE customers SET loyalty_points = ? WHERE id = ?",
      [parseInt(points), id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Customer not found" });
        res.json({ message: "Customer points updated" });
      },
    );
  });

  // GET customer wallet balance + ledger
  app.get("/api/customers/:id/wallet", (req, res) => {
    const { id } = req.params;
    db.get(
      "SELECT balance FROM customers WHERE id = ?",
      [id],
      (err, customer) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!customer)
          return res.status(404).json({ error: "Customer not found" });
        db.all(
          "SELECT * FROM customer_wallet_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50",
          [id],
          (err2, ledger) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ balance: customer.balance || 0, ledger: ledger || [] });
          },
        );
      },
    );
  });

  // POST top-up customer wallet (credit)
  app.post("/api/customers/:id/wallet/topup", requirePerm("manage_customers"), (req, res) => {
    const { id } = req.params;
    const { amount, note } = req.body;
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: "Valid amount is required" });

    const amt = parseFloat(amount);
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "UPDATE customers SET balance = COALESCE(balance, 0) + ? WHERE id = ?",
        [amt, id],
        function (err) {
          if (err || this.changes === 0) {
            db.run("ROLLBACK");
            return res
              .status(err ? 500 : 404)
              .json({ error: err ? err.message : "Customer not found" });
          }
          db.run(
            "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, note) VALUES (?, 'credit', ?, 'topup', ?)",
            [id, amt, note || "Manual top-up"],
            (err2) => {
              if (err2) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err2.message });
              }
              db.run("COMMIT", () => {
                db.get(
                  "SELECT balance FROM customers WHERE id = ?",
                  [id],
                  (e, row) => {
                    res.json({
                      message: "Wallet topped up",
                      balance: row?.balance || 0,
                    });
                  },
                );
              });
            },
          );
        },
      );
    });
  });

  // Archive a customer (soft delete)
  app.delete("/api/customers/:id", requirePerm("manage_customers"), (req, res) => {
    const { id } = req.params;
    db.run(
      "UPDATE customers SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
      [id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Customer not found" });
        res.json({ message: "Customer archived" });
      },
    );
  });
};
