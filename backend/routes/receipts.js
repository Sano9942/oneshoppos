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

      // Fetch sale with store info. Bucket F adds FBR columns + active
      // receipt template (logo, toggles, footer override). Left-joined so
      // tenants without a configured template still render the default view.
      const { rows: [sale] } = await db.query(
        `SELECT s.id, s.invoice_number, s.timestamp, s.total_amount, s.discount_amount,
                s.customer_id, s.employee_id, s.outlet_id,
                s.fbr_irn, s.fbr_qr_code, s.fbr_status,
                e.name AS employee_name,
                c.name AS customer_name,
                o.name AS outlet_name,
                cp.company_name, cp.logo_url, cp.address, cp.phone, cp.currency_symbol,
                rt.logo_url AS template_logo_url,
                rt.footer_text AS template_footer_text,
                rt.show_fbr AS template_show_fbr,
                rt.show_qr AS template_show_qr,
                rt.show_tax_breakdown AS template_show_tax_breakdown,
                rt.paper_width AS template_paper_width
         FROM sales s
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         LEFT JOIN outlets o ON s.outlet_id = o.id
         CROSS JOIN company_profile cp
         LEFT JOIN receipt_templates rt ON rt.is_active = true
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

      // Fetch sale payments. Column is `payment_method` per schema-pg.sql;
      // we alias to `method` so the externally-visible JSON field name on the
      // public receipt response stays stable for any client consuming it.
      const { rows: payments } = await db.query(
        `SELECT payment_method AS method, amount
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
        // Bucket F: FBR block omitted when sale has no IRN (non-FBR tenants
        // still get a tidy response shape).
        fbr: sale.fbr_irn
          ? {
              irn: sale.fbr_irn,
              qr_code: sale.fbr_qr_code || null,
              status: sale.fbr_status || null,
            }
          : null,
        // Bucket F: active template overrides (logo, footer, toggles).
        // Null when no active template is configured.
        template: sale.template_paper_width != null || sale.template_logo_url || sale.template_footer_text
          ? {
              logo_url: sale.template_logo_url || null,
              footer_text: sale.template_footer_text || null,
              show_fbr: sale.template_show_fbr !== false,
              show_qr: sale.template_show_qr !== false,
              show_tax_breakdown: sale.template_show_tax_breakdown !== false,
              paper_width: sale.template_paper_width || 48,
            }
          : null,
      });
    } catch (err) {
      console.error("Public receipt error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
};
