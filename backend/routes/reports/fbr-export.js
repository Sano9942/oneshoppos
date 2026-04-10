module.exports = function (app, deps) {
  const db = deps.db;
  const { requirePerm } = deps;

  app.get("/api/reports/fbr-export", requirePerm("all_access"), async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: "from and to dates required" });

    try {
      const { rows: [cp] } = await db.query("SELECT ntn, strn, company_name FROM company_profile WHERE id = 1");

      const { rows } = await db.query(
        `SELECT s.invoice_number, s.timestamp, s.total_amount, s.discount_amount,
                c.name as buyer_name, c.mobile as buyer_phone,
                si.quantity, si.price_at_sale, p.name as item_description,
                t.name as tax_group_name, t.rate as tax_rate
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_id = p.id
         LEFT JOIN customers c ON s.customer_id = c.id
         LEFT JOIN taxes t ON p.tax_id = t.id
         WHERE s.timestamp >= $1 AND s.timestamp < ($2::date + 1)
         AND s.voided = false
         ORDER BY s.timestamp`,
        [from, to]
      );

      const fbrRows = rows.map((r) => ({
        ntn: cp?.ntn || "",
        strn: cp?.strn || "",
        invoice_number: r.invoice_number,
        invoice_date: new Date(r.timestamp).toISOString().split("T")[0],
        buyer_name: r.buyer_name || "Walk-in",
        buyer_phone: r.buyer_phone || "",
        item_description: r.item_description,
        quantity: r.quantity,
        unit_price: r.price_at_sale,
        tax_rate: Number(r.tax_rate || 0),
        tax_amount: ((r.price_at_sale * r.quantity * Number(r.tax_rate || 0)) / 100).toFixed(2),
        total_amount: (r.price_at_sale * r.quantity).toFixed(2),
      }));

      res.json({ rows: fbrRows, company: cp || {} });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
