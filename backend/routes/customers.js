const { validate } = require("../middleware/validate");
const { CreateCustomerSchema, UpdateCustomerSchema } = require("../schemas/customers");

module.exports = function registerCustomerRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm } = deps;
  const { toUtcStart, toUtcEnd } = require("../utils/tz");

  // ── Customer Groups CRUD ───────────────────────────────────────────────────

  app.get("/api/customer-groups", requireAnyPerm(["manage_customers", "all_access"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT cg.*, COUNT(c.id)::int AS member_count
         FROM customer_groups cg
         LEFT JOIN customers c ON c.customer_group_id = cg.id AND c.deleted_at IS NULL
         GROUP BY cg.id
         ORDER BY cg.name ASC`
      );
      res.json({ groups: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/customer-groups", requireAnyPerm(["manage_customers", "all_access"]), async (req, res) => {
    const { name, description, discount_percent } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Group name is required" });
    try {
      const { rows } = await db.query(
        `INSERT INTO customer_groups (name, description, discount_percent)
         VALUES ($1, $2, $3) RETURNING *`,
        [name.trim(), description || null, discount_percent || 0]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/customer-groups/:id", requireAnyPerm(["manage_customers", "all_access"]), async (req, res) => {
    const { id } = req.params;
    const { name, description, discount_percent } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Group name is required" });
    try {
      const { rows, rowCount } = await db.query(
        `UPDATE customer_groups SET name = $1, description = $2, discount_percent = $3
         WHERE id = $4 RETURNING *`,
        [name.trim(), description || null, discount_percent || 0, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Group not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/customer-groups/:id", requireAnyPerm(["manage_customers", "all_access"]), async (req, res) => {
    const { id } = req.params;
    try {
      // Unassign customers from this group first
      await db.query("UPDATE customers SET customer_group_id = NULL WHERE customer_group_id = $1", [id]);
      const { rowCount } = await db.query("DELETE FROM customer_groups WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Group not found" });
      res.json({ message: "Group deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET all tags in use (for autocomplete) — must be before :id routes
  app.get("/api/customers/tags", requireAnyPerm(["view_reports", "manage_customers"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT DISTINCT unnest(tags) AS tag FROM customers WHERE tags IS NOT NULL AND deleted_at IS NULL ORDER BY tag"
      );
      res.json({ tags: rows.map((r) => r.tag) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

  /**
   * @swagger
   * /api/customers:
   *   get:
   *     summary: List all customers
   *     description: Returns all customers with total order count and lifetime spend. Supports search by name/phone/email and group filtering.
   *     tags: [Customers]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Search by name, phone, or email
   *       - in: query
   *         name: group_id
   *         schema: { type: integer }
   *         description: Filter by customer group
   *     responses:
   *       200:
   *         description: Array of customers
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Customer'
   *       401:
   *         description: Unauthorized
   */
  // GET all customers (with total order count and spend)
  app.get("/api/customers", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { search = "", group_id } = req.query;
    let query = `
    SELECT c.*,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent,
           lt.name AS tier_name, lt.color AS tier_color,
           lt.points_multiplier AS tier_multiplier, lt.discount_percent AS tier_discount,
           lt.min_spend AS tier_min_spend,
           cg.name AS group_name
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = false
    LEFT JOIN loyalty_tiers lt ON c.loyalty_tier_id = lt.id
    LEFT JOIN customer_groups cg ON c.customer_group_id = cg.id
  `;
    const params = [];
    let paramIdx = 1;
    const conditions = ["c.deleted_at IS NULL"];
    if (search) {
      conditions.push(`(c.name ILIKE $${paramIdx} OR c.mobile ILIKE $${paramIdx + 1} OR c.email ILIKE $${paramIdx + 2})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIdx += 3;
    }
    if (group_id) {
      conditions.push(`c.customer_group_id = $${paramIdx}`);
      params.push(group_id);
      paramIdx++;
    }
    query += " WHERE " + conditions.join(" AND ");
    query += " GROUP BY c.id, lt.name, lt.color, lt.points_multiplier, lt.discount_percent, lt.min_spend, cg.name ORDER BY c.name ASC";
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

  /**
   * @swagger
   * /api/customers:
   *   post:
   *     summary: Create a customer
   *     description: Create a new customer record with optional CRM fields (group, tags, notes, loyalty).
   *     tags: [Customers]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name: { type: string }
   *               mobile: { type: string }
   *               email: { type: string }
   *               address: { type: string }
   *               cnic: { type: string }
   *               city: { type: string }
   *               gender: { type: string, enum: [male, female, other] }
   *               date_of_birth: { type: string, format: date }
   *               customer_group_id: { type: integer }
   *               notes: { type: string }
   *               tags: { type: string }
   *     responses:
   *       201:
   *         description: Customer created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Customer'
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   */
  // GET unified order history (POS sales + web orders)
  app.get("/api/customers/:id/order-history", requireAnyPerm(["view_reports", "manage_customers"]), async (req, res) => {
    const { id } = req.params;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    try {
      // Verify customer exists
      const { rowCount } = await db.query("SELECT 1 FROM customers WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Customer not found" });

      const countSql = `
        SELECT (
          (SELECT COUNT(*) FROM sales WHERE customer_id = $1 AND voided = false)
          +
          (SELECT COUNT(*) FROM web_orders WHERE customer_id = $1)
        )::int AS total
      `;
      const { rows: [{ total }] } = await db.query(countSql, [id]);

      const sql = `
        SELECT 'pos_sale' AS type, s.id, s.invoice_number AS order_number,
               'pos' AS channel, s.total_amount AS total, 'completed' AS status,
               s.timestamp AS date
        FROM sales s WHERE s.customer_id = $1 AND s.voided = false

        UNION ALL

        SELECT 'web_order' AS type, wo.id, wo.external_order_id AS order_number,
               COALESCE(sc.code, wo.source) AS channel, wo.grand_total AS total,
               wo.order_status AS status, wo.ordered_at AS date
        FROM web_orders wo
        LEFT JOIN sales_channels sc ON sc.id = wo.channel_id
        WHERE wo.customer_id = $1

        ORDER BY date DESC
        LIMIT $2 OFFSET $3
      `;
      const { rows } = await db.query(sql, [id, limit, offset]);

      res.json({
        orders: rows.map(r => ({
          type: r.type,
          id: r.id,
          orderNumber: r.order_number,
          channel: r.channel,
          total: Number(r.total),
          status: r.status,
          date: r.date,
        })),
        pagination: { page, limit, total },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create customer
  app.post("/api/customers", validate(CreateCustomerSchema), async (req, res) => {
    const { name, mobile, email, address, cnic, occupation, balance, ntn_cnic,
            date_of_birth, gender, city, customer_group_id, notes, tags,
            preferred_payment_method, preferred_contact } = req.body;
    if (!name)
      return res.status(400).json({ error: "Customer name is required" });
    try {
      const { rows } = await db.query(
        `INSERT INTO customers (name, mobile, email, address, cnic, occupation, balance, ntn_cnic,
         date_of_birth, gender, city, customer_group_id, notes, tags, preferred_payment_method, preferred_contact)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          name, mobile || null, email || null, address || null, cnic || null,
          occupation || null, balance || 0, ntn_cnic || null,
          date_of_birth || null, gender || null, city || null,
          customer_group_id || null, notes || null,
          tags && tags.length ? tags : null,
          preferred_payment_method || null, preferred_contact || null,
        ],
      );
      res.json({ ...rows[0], order_count: 0, total_spent: 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update customer
  app.put("/api/customers/:id", requirePerm("manage_customers"), validate(UpdateCustomerSchema), async (req, res) => {
    const { id } = req.params;
    const { name, mobile, email, address, cnic, occupation, balance, ntn_cnic,
            date_of_birth, gender, city, customer_group_id, notes, tags,
            preferred_payment_method, preferred_contact } = req.body;
    if (!name)
      return res.status(400).json({ error: "Customer name is required" });
    try {
      const { rowCount } = await db.query(
        `UPDATE customers SET name = $1, mobile = $2, email = $3, address = $4, cnic = $5,
         occupation = $6, balance = COALESCE($7, balance), ntn_cnic = $8,
         date_of_birth = $9, gender = $10, city = $11, customer_group_id = $12,
         notes = $13, tags = $14, preferred_payment_method = $15, preferred_contact = $16
         WHERE id = $17`,
        [
          name, mobile || null, email || null, address || null, cnic || null,
          occupation || null, balance !== undefined ? balance : null, ntn_cnic || null,
          date_of_birth || null, gender || null, city || null,
          customer_group_id || null, notes || null,
          tags && tags.length ? tags : null,
          preferred_payment_method || null, preferred_contact || null, id,
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

  // GET enriched customer profile
  app.get("/api/customers/:id/profile", requireAnyPerm(["view_reports", "manage_customers"]), async (req, res) => {
    const { id } = req.params;
    try {
      // Basic info + group
      const { rows: custRows } = await db.query(
        `SELECT c.*, cg.name AS group_name, cg.discount_percent AS group_discount,
                lt.name AS tier_name, lt.color AS tier_color,
                lt.points_multiplier AS tier_multiplier, lt.discount_percent AS tier_discount
         FROM customers c
         LEFT JOIN customer_groups cg ON c.customer_group_id = cg.id
         LEFT JOIN loyalty_tiers lt ON c.loyalty_tier_id = lt.id
         WHERE c.id = $1`,
        [id]
      );
      if (!custRows.length) return res.status(404).json({ error: "Customer not found" });
      const customer = custRows[0];

      // Purchase summary
      const { rows: [summary] } = await db.query(
        `SELECT COUNT(*)::int AS total_orders,
                COALESCE(SUM(total_amount), 0) AS total_spend,
                ROUND(COALESCE(AVG(total_amount), 0)::numeric, 2) AS avg_order_value,
                MAX(timestamp) AS last_purchase_date
         FROM sales WHERE customer_id = $1 AND voided = false`,
        [id]
      );

      // Top 5 purchased products
      const { rows: topProducts } = await db.query(
        `SELECT p.name, p.sku, SUM(si.quantity)::int AS total_qty,
                SUM(si.quantity * si.price_at_sale) AS total_value
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         JOIN products p ON si.product_id = p.id
         WHERE s.customer_id = $1 AND s.voided = false
         GROUP BY p.id, p.name, p.sku
         ORDER BY total_qty DESC
         LIMIT 5`,
        [id]
      );

      res.json({
        customer,
        purchase_summary: {
          total_orders: summary.total_orders,
          total_spend: Number(summary.total_spend),
          avg_order_value: Number(summary.avg_order_value),
          last_purchase_date: summary.last_purchase_date,
        },
        top_products: topProducts.map((p) => ({
          name: p.name,
          sku: p.sku,
          total_qty: p.total_qty,
          total_value: Number(p.total_value),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update customer tags
  app.put("/api/customers/:id/tags", requirePerm("manage_customers"), async (req, res) => {
    const { id } = req.params;
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: "tags must be an array" });
    try {
      const cleaned = tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
      const unique = [...new Set(cleaned)];
      const { rowCount } = await db.query(
        "UPDATE customers SET tags = $1 WHERE id = $2",
        [unique.length ? unique : null, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Customer not found" });
      res.json({ tags: unique });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Loyalty Tier CRUD ──────────────────────────────────────────────────────

  // GET all loyalty tiers
  app.get("/api/loyalty/tiers", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT lt.*,
                COUNT(c.id)::int AS customer_count
         FROM loyalty_tiers lt
         LEFT JOIN customers c ON c.loyalty_tier_id = lt.id AND c.deleted_at IS NULL
         GROUP BY lt.id
         ORDER BY lt.sort_order ASC, lt.min_spend ASC`
      );
      res.json({ tiers: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create loyalty tier
  app.post("/api/loyalty/tiers", requirePerm("all_access"), async (req, res) => {
    const { name, min_spend, points_multiplier, discount_percent, benefits, color, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: "Tier name is required" });
    if (min_spend === undefined || isNaN(min_spend) || min_spend < 0)
      return res.status(400).json({ error: "min_spend must be a non-negative number" });

    try {
      const { rows } = await db.query(
        `INSERT INTO loyalty_tiers (name, min_spend, points_multiplier, discount_percent, benefits, color, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [name, min_spend, points_multiplier || 1.0, discount_percent || 0, benefits || null, color || null, sort_order || 0]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update loyalty tier
  app.put("/api/loyalty/tiers/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { name, min_spend, points_multiplier, discount_percent, benefits, color, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: "Tier name is required" });

    try {
      const { rows, rowCount } = await db.query(
        `UPDATE loyalty_tiers
         SET name = $1, min_spend = $2, points_multiplier = $3, discount_percent = $4,
             benefits = $5, color = $6, sort_order = $7
         WHERE id = $8 RETURNING *`,
        [name, min_spend, points_multiplier || 1.0, discount_percent || 0, benefits || null, color || null, sort_order || 0, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Tier not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE loyalty tier (block if customers assigned)
  app.delete("/api/loyalty/tiers/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: [countRow] } = await db.query(
        "SELECT COUNT(*)::int AS cnt FROM customers WHERE loyalty_tier_id = $1 AND deleted_at IS NULL",
        [id]
      );
      if (countRow.cnt > 0) {
        return res.status(400).json({
          error: `Cannot delete tier — ${countRow.cnt} customer(s) are assigned to it. Reassign them first.`,
        });
      }
      const { rowCount } = await db.query("DELETE FROM loyalty_tiers WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Tier not found" });
      res.json({ message: "Tier deleted" });
    } catch (err) {
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
