module.exports = function registerCustomerRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm } = deps;

  // GET all customers (with total order count and spend)
  app.get("/api/customers", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { search = "" } = req.query;
    let query = `
    SELECT c.*,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = false
  `;
    const params = [];
    let paramIdx = 1;
    if (search) {
      query += ` WHERE c.deleted_at IS NULL AND (c.name ILIKE $${paramIdx} OR c.mobile ILIKE $${paramIdx + 1} OR c.email ILIKE $${paramIdx + 2})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIdx += 3;
    } else {
      query += " WHERE c.deleted_at IS NULL";
    }
    query += " GROUP BY c.id ORDER BY c.name ASC";
    try {
      const { rows } = await db.query(query, params);
      res.json({ customers: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single customer's sales history
  app.get("/api/customers/:id/sales", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT s.*, o.name as outlet_name, e.name as employee_name,
              COUNT(si.id) as item_count
       FROM sales s
       LEFT JOIN outlets o ON s.outlet_id = o.id
       LEFT JOIN employees e ON s.employee_id = e.id
       LEFT JOIN sale_items si ON s.id = si.sale_id
       WHERE s.customer_id = $1
       GROUP BY s.id
       ORDER BY s.timestamp DESC`,
        [id],
      );
      res.json({ sales: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create customer
  app.post("/api/customers", async (req, res) => {
    const { name, mobile, email, address, cnic, occupation, balance, ntn_cnic } =
      req.body;
    if (!name)
      return res.status(400).json({ error: "Customer name is required" });
    try {
      const { rows } = await db.query(
        "INSERT INTO customers (name, mobile, email, address, cnic, occupation, balance, ntn_cnic) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [
          name,
          mobile || null,
          email || null,
          address || null,
          cnic || null,
          occupation || null,
          balance || 0,
          ntn_cnic || null,
        ],
      );
      res.json({
        id: rows[0].id,
        name,
        mobile,
        email,
        address,
        cnic,
        occupation,
        balance: balance || 0,
        ntn_cnic: ntn_cnic || null,
        order_count: 0,
        total_spent: 0,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update customer
  app.put("/api/customers/:id", requirePerm("manage_customers"), async (req, res) => {
    const { id } = req.params;
    const { name, mobile, email, address, cnic, occupation, balance, ntn_cnic } =
      req.body;
    if (!name)
      return res.status(400).json({ error: "Customer name is required" });
    try {
      const { rowCount } = await db.query(
        "UPDATE customers SET name = $1, mobile = $2, email = $3, address = $4, cnic = $5, occupation = $6, balance = COALESCE($7, balance), ntn_cnic = $8 WHERE id = $9",
        [
          name,
          mobile || null,
          email || null,
          address || null,
          cnic || null,
          occupation || null,
          balance !== undefined ? balance : null,
          ntn_cnic || null,
          id,
        ],
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ message: "Customer updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update customer points manually
  app.put("/api/customers/:id/points", requirePerm("manage_customers"), async (req, res) => {
    const { id } = req.params;
    const { points } = req.body;
    if (points === undefined || isNaN(points))
      return res.status(400).json({ error: "Points value is required" });

    try {
      const { rowCount } = await db.query(
        "UPDATE customers SET loyalty_points = $1 WHERE id = $2",
        [parseInt(points), id],
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ message: "Customer points updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET customer wallet balance + ledger
  app.get("/api/customers/:id/wallet", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: custRows } = await db.query(
        "SELECT balance FROM customers WHERE id = $1",
        [id],
      );
      if (!custRows.length)
        return res.status(404).json({ error: "Customer not found" });
      const { rows: ledger } = await db.query(
        "SELECT * FROM customer_wallet_ledger WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50",
        [id],
      );
      res.json({ balance: custRows[0].balance || 0, ledger: ledger || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST top-up customer wallet (credit)
  app.post("/api/customers/:id/wallet/topup", requirePerm("manage_customers"), async (req, res) => {
    const { id } = req.params;
    const { amount, note } = req.body;
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: "Valid amount is required" });

    const amt = parseFloat(amount);
    try {
      const result = await db.transaction(async (client) => {
        const { rowCount } = await client.query(
          "UPDATE customers SET balance = COALESCE(balance, 0) + $1 WHERE id = $2",
          [amt, id],
        );
        if (rowCount === 0) throw Object.assign(new Error("Customer not found"), { statusCode: 404 });
        await client.query(
          "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, note) VALUES ($1, 'credit', $2, 'topup', $3)",
          [id, amt, note || "Manual top-up"],
        );
        const { rows } = await client.query(
          "SELECT balance FROM customers WHERE id = $1",
          [id],
        );
        return rows[0]?.balance || 0;
      });
      res.json({ message: "Wallet topped up", balance: result });
    } catch (err) {
      if (err.statusCode === 404) return res.status(404).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Archive a customer (soft delete)
  app.delete("/api/customers/:id", requirePerm("manage_customers"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query(
        "UPDATE customers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ message: "Customer archived" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
