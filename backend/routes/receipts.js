module.exports = function mountReceiptRoutes(app, deps) {
  const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";

  app.get("/api/receipts/:invoiceNumber/public", async (req, res) => {
    try {
      let db;

      if (IS_MULTI_TENANT) {
        const tenantSlug = req.query.tenant;
        if (!tenantSlug) {
          return res.status(400).json({ error: "tenant query param is required" });
        }
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = deps.tenantDbManager || require("../tenant-db-manager-pg");

        const { rows: [tenant] } = await masterDb.query(
          "SELECT id, slug, status FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(tenantSlug).trim()]
        );
        if (!tenant) {
          return res.status(404).json({ error: "Store not found" });
        }
        db = await tenantDbMgr.getDb(tenant.id);
      } else {
        db = deps.db;
      }

      const invoiceNumber = req.params.invoiceNumber;

      // Fetch sale with store info
      const { rows: [sale] } = await db.query(
        `SELECT s.id, s.invoice_number, s.timestamp, s.total_amount, s.discount_amount,
                s.customer_id, s.employee_id, s.outlet_id,
                e.name AS employee_name,
                c.name AS customer_name,
                o.name AS outlet_name,
                cp.company_name, cp.logo_url, cp.address, cp.phone, cp.currency_symbol
         FROM sales s
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         LEFT JOIN outlets o ON s.outlet_id = o.id
         CROSS JOIN company_profile cp
         WHERE s.invoice_number = $1 AND s.voided = false
         LIMIT 1`,
        [invoiceNumber]
      );

      if (!sale) {
        return res.status(404).json({ error: "Receipt not found" });
      }

      // Fetch sale items with product info
      const { rows: items } = await db.query(
        `SELECT si.quantity, si.price_at_sale,
                (si.quantity * si.price_at_sale) AS total,
                p.name, p.sku
         FROM sale_items si
         LEFT JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = $1
         ORDER BY si.id ASC`,
        [sale.id]
      );

      // Fetch sale payments
      const { rows: payments } = await db.query(
        `SELECT method, amount
         FROM sale_payments
         WHERE sale_id = $1
         ORDER BY id ASC`,
        [sale.id]
      );

      return res.json({
        store: {
          name: sale.company_name,
          logo: sale.logo_url,
          address: sale.address,
          phone: sale.phone,
        },
        sale: {
          invoice_number: sale.invoice_number,
          timestamp: sale.timestamp,
          total_amount: sale.total_amount,
          discount_amount: sale.discount_amount,
          employee_name: sale.employee_name,
          customer_name: sale.customer_name,
          currency_symbol: sale.currency_symbol,
        },
        items: items.map(i => ({
          name: i.name,
          sku: i.sku,
          quantity: i.quantity,
          price: i.price_at_sale,
          total: i.total,
        })),
        payments: payments.map(p => ({
          method: p.method,
          amount: p.amount,
        })),
      });
    } catch (err) {
      console.error("Public receipt error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
};
