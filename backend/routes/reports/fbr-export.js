module.exports = function (app, deps) {
  const db = deps.db;
  const { requirePerm } = deps;

  app.get("/api/reports/fbr-export", requirePerm("all_access"), async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: "from and to dates required" });

    try {
      const { rows: [cp] } = await db.query("SELECT ntn, strn, company_name, fbr_default_hs_code FROM company_profile WHERE id = 1");

      // from/to are tenant-local days and s.timestamp is TIMESTAMPTZ — filter
      // with explicit UTC bounds (the old `($2::date + 1)` promoted to a
      // midnight in the DB SESSION timezone, splitting the FBR day wrongly).
      const { toUtcStart, toUtcEnd, tenantToday } = require("../../utils/tz");
      const fbrTz = req.company?.timezone || "Asia/Karachi";

      // P8 (v83): read per-line tax from sale_items snapshot, never recompute
      // against live taxes/products. Snapshot was frozen at sale-write time.
      const { rows } = await db.query(
        `SELECT s.invoice_number, s.timestamp, s.total_amount, s.discount_amount,
                c.name as buyer_name, c.mobile as buyer_phone,
                si.quantity, si.price_at_sale,
                si.tax_rate_at_sale, si.tax_amount_at_sale, si.hs_code_at_sale,
                p.name as item_description
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_id = p.id
         LEFT JOIN customers c ON s.customer_id = c.id
         WHERE s.timestamp >= $1 AND s.timestamp < $2
         AND s.voided = false
         ORDER BY s.timestamp`,
        [toUtcStart(String(from), fbrTz), toUtcEnd(String(to), fbrTz)]
      );

      const fbrRows = rows.map((r) => ({
        ntn: cp?.ntn || "",
        strn: cp?.strn || "",
        invoice_number: r.invoice_number,
        // LOCAL invoice date of the sale instant (UTC date was the previous
        // day for PKT sales before 5 AM — mismatched the printed receipt).
        invoice_date: tenantToday(fbrTz, new Date(r.timestamp)),
        buyer_name: r.buyer_name || "Walk-in",
        buyer_phone: r.buyer_phone || "",
        item_description: r.item_description,
        quantity: r.quantity,
        unit_price: r.price_at_sale,
        tax_rate: Number(r.tax_rate_at_sale || 0),
        tax_amount: Number(r.tax_amount_at_sale || 0).toFixed(2),
        hs_code: r.hs_code_at_sale || cp?.fbr_default_hs_code || "",
        total_amount: (r.price_at_sale * r.quantity).toFixed(2),
      }));

      res.json({ rows: fbrRows, company: cp || {} });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
