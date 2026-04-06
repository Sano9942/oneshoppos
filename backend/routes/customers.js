const { validate } = require("../middleware/validate");
const { CreateCustomerSchema, UpdateCustomerSchema } = require("../schemas/customers");

module.exports = function registerCustomerRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm } = deps;
  const { toUtcStart, toUtcEnd } = require("../utils/tz");

  // GET customer ledger — all financial transactions in one timeline
  app.get("/api/customers/:id/ledger", requireAnyPerm(["view_reports", "manage_customers"]), async (req, res) => {
    const { id } = req.params;
    const { from, to, page = 1, per_page = 50 } = req.query;
    const tz = req.company?.timezone || "UTC";
    const limit = Math.min(Math.max(parseInt(per_page) || 50, 1), 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

    try {
      // Verify customer exists
      const { rowCount } = await db.query("SELECT 1 FROM customers WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Customer not found" });

      const dateFilters = [];
      const dateParams = [];
      let pIdx = 2; // $1 is customer_id
      if (from) {
        const utcFrom = toUtcStart(from, tz);
        if (utcFrom) { dateFilters.push(`date >= $${pIdx}`); dateParams.push(utcFrom); pIdx++; }
      }
      if (to) {
        const utcTo = toUtcEnd(to, tz);
        if (utcTo) { dateFilters.push(`date < $${pIdx}`); dateParams.push(utcTo); pIdx++; }
      }
      const dateWhere = dateFilters.length ? " WHERE " + dateFilters.join(" AND ") : "";

      const sql = `
        WITH ledger AS (
          SELECT timestamp AS date, 'sale' AS type, total_amount AS amount,
                 invoice_number AS reference, id AS source_id
          FROM sales
          WHERE customer_id = $1 AND voided = false

          UNION ALL

          SELECT timestamp AS date, 'return' AS type, -total_refund AS amount,
                 'Return #' || id AS reference, id AS source_id
          FROM returns
          WHERE customer_id = $1

          UNION ALL

          SELECT created_at AS date,
                 CASE WHEN type = 'credit' THEN 'wallet_credit' ELSE 'wallet_debit' END AS type,
                 CASE WHEN type = 'credit' THEN amount ELSE -amount END AS amount,
                 COALESCE(note, reference_type) AS reference, id AS source_id
          FROM customer_wallet_ledger
          WHERE customer_id = $1

          UNION ALL

          SELECT timestamp AS date, 'points_earned' AS type,
                 points_earned::numeric AS amount,
                 invoice_number AS reference, id AS source_id
          FROM sales
          WHERE customer_id = $1 AND voided = false AND points_earned > 0

          UNION ALL

          SELECT timestamp AS date, 'points_redeemed' AS type,
                 -points_redeemed::numeric AS amount,
                 invoice_number AS reference, id AS source_id
          FROM sales
          WHERE customer_id = $1 AND voided = false AND points_redeemed > 0
        ),
        filtered AS (
          SELECT * FROM ledger${dateWhere}
        ),
        with_balance AS (
          SELECT *,
                 SUM(amount) OVER (ORDER BY date ASC, source_id ASC) AS running_balance
          FROM filtered
        )
        SELECT date, type, amount, reference, running_balance,
               (SELECT COUNT(*) FROM filtered) AS total_count
        FROM with_balance
        ORDER BY date DESC, source_id DESC
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `;

      const params = [id, ...dateParams, limit, offset];
      const { rows } = await db.query(sql, params);

      const totalCount = rows.length > 0 ? parseInt(rows[0].total_count) : 0;
      res.json({
        ledger: rows.map(r => ({
          date: r.date,
          type: r.type,
          amount: Number(r.amount),
          reference: r.reference,
          running_balance: Number(r.running_balance),
        })),
        total: totalCount,
        page: Math.max(parseInt(page) || 1, 1),
        per_page: limit,
        total_pages: Math.ceil(totalCount / limit),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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
  app.post("/api/customers", validate(CreateCustomerSchema), async (req, res) => {
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
  app.put("/api/customers/:id", requirePerm("manage_customers"), validate(UpdateCustomerSchema), async (req, res) => {
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

  // PUT blacklist a customer
  app.put("/api/customers/:id/blacklist", requireAnyPerm(["manage_customers", "all_access"]), async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "Blacklist reason is required" });
    try {
      const { rows, rowCount } = await db.query(
        "UPDATE customers SET is_blacklisted = true, blacklist_reason = $1, blacklisted_at = NOW() WHERE id = $2 RETURNING *",
        [reason, id],
      );
      if (rowCount === 0) return res.status(404).json({ error: "Customer not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT unblacklist a customer
  app.put("/api/customers/:id/unblacklist", requireAnyPerm(["manage_customers", "all_access"]), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows, rowCount } = await db.query(
        "UPDATE customers SET is_blacklisted = false, blacklist_reason = NULL, blacklisted_at = NULL WHERE id = $1 RETURNING *",
        [id],
      );
      if (rowCount === 0) return res.status(404).json({ error: "Customer not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST transfer loyalty points between customers
  app.post("/api/customers/transfer-points", requirePerm("manage_customers"), async (req, res) => {
    const { from_customer_id, to_customer_id, points, reason } = req.body;

    if (!from_customer_id || !to_customer_id || from_customer_id === to_customer_id)
      return res.status(400).json({ error: "Must specify two different customers" });

    const pts = parseInt(points);
    if (!pts || pts <= 0) return res.status(400).json({ error: "Points must be a positive integer" });

    try {
      const result = await db.transaction(async (client) => {
        // Verify both customers exist
        const { rows: fromRows } = await client.query(
          "SELECT id, name, loyalty_points FROM customers WHERE id = $1 AND deleted_at IS NULL",
          [from_customer_id],
        );
        if (!fromRows.length) throw Object.assign(new Error("Sender customer not found"), { statusCode: 404 });

        const { rows: toRows } = await client.query(
          "SELECT id, name, loyalty_points FROM customers WHERE id = $1 AND deleted_at IS NULL",
          [to_customer_id],
        );
        if (!toRows.length) throw Object.assign(new Error("Recipient customer not found"), { statusCode: 404 });

        // Atomic deduction — fails if insufficient points
        const { rowCount } = await client.query(
          "UPDATE customers SET loyalty_points = loyalty_points - $1 WHERE id = $2 AND loyalty_points >= $1",
          [pts, from_customer_id],
        );
        if (rowCount === 0) throw Object.assign(new Error("Insufficient loyalty points"), { statusCode: 400 });

        // Credit receiver
        await client.query(
          "UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2",
          [pts, to_customer_id],
        );

        const note = reason || "Loyalty points transfer";

        // Ledger: debit sender
        await client.query(
          "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, reference_id, note) VALUES ($1, 'debit', $2, 'points_transfer', $3, $4)",
          [from_customer_id, pts, to_customer_id, `${note} → ${toRows[0].name}`],
        );

        // Ledger: credit receiver
        await client.query(
          "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, reference_id, note) VALUES ($1, 'credit', $2, 'points_transfer', $3, $4)",
          [to_customer_id, pts, from_customer_id, `${note} ← ${fromRows[0].name}`],
        );

        // Read final balances
        const { rows: finalFrom } = await client.query("SELECT loyalty_points FROM customers WHERE id = $1", [from_customer_id]);
        const { rows: finalTo } = await client.query("SELECT loyalty_points FROM customers WHERE id = $1", [to_customer_id]);

        return { from_balance: finalFrom[0].loyalty_points, to_balance: finalTo[0].loyalty_points };
      });

      res.json({ success: true, from_balance: result.from_balance, to_balance: result.to_balance });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message });
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
