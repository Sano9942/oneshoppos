module.exports = function registerTaxLookupRoutes(app, deps) {
  const { db } = deps;

  // GET /api/tax-lookup — search tax_rate_reference (public schema)
  app.get("/api/tax-lookup", async (req, res) => {
    try {
      const { q, province, limit = 100 } = req.query;
      const where = [];
      const params = [];
      let idx = 1;

      if (q) {
        where.push(
          `(hs_code ILIKE $${idx} OR description_en ILIKE $${idx} OR description_ur ILIKE $${idx})`
        );
        params.push(`%${q}%`);
        idx++;
      }

      const whereClause = where.length
        ? `WHERE ${where.join(" AND ")}`
        : "";

      const { rows } = await db.query(
        `SELECT * FROM public.tax_rate_reference ${whereClause}
         ORDER BY hs_code LIMIT $${idx}`,
        [...params, parseInt(limit)]
      );

      const {
        rows: [meta],
      } = await db.query(
        "SELECT MAX(last_updated) AS last_updated FROM public.tax_rate_reference"
      );

      res.json({
        rates: rows,
        last_updated: meta?.last_updated || null,
        province: province || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/tax-lookup/export — returns all rows as JSON
  app.get("/api/tax-lookup/export", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM public.tax_rate_reference ORDER BY hs_code"
      );
      res.json({ rates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tax-lookup/suggest — insert a rate correction suggestion
  app.post("/api/tax-lookup/suggest", async (req, res) => {
    try {
      const {
        reference_id,
        field_name,
        suggested_value,
        source_reference,
        notes,
      } = req.body;

      if (!reference_id || !field_name || suggested_value == null) {
        return res.status(400).json({
          error: "reference_id, field_name, and suggested_value are required",
        });
      }

      // Get current value from public schema
      const {
        rows: [ref],
      } = await db.query(
        "SELECT * FROM public.tax_rate_reference WHERE id = $1",
        [reference_id]
      );
      if (!ref) {
        return res.status(404).json({ error: "Reference rate not found" });
      }

      const currentValue = ref[field_name] != null ? Number(ref[field_name]) : null;

      await db.query(
        `INSERT INTO tax_rate_suggestions
         (reference_id, suggested_by_tenant, suggested_by_employee, field_name, current_value, suggested_value, source_reference, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          reference_id,
          req.tenantSlug || null,
          req.employeeId || null,
          field_name,
          currentValue,
          suggested_value,
          source_reference || null,
          notes || null,
        ]
      );

      res.json({ message: "Suggestion submitted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
