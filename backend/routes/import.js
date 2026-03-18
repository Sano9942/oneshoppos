const XLSX = require("xlsx");

module.exports = function mountImportRoutes(app, deps) {
  const { db, multer, requirePerm } = deps;

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  // ---------------------------------------------------------------------------
  // Helper: parse uploaded file (CSV or XLSX) into array of row objects
  // ---------------------------------------------------------------------------
  function parseFile(buffer, originalname) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }

  // ---------------------------------------------------------------------------
  // Helper: trim & normalise keys to snake_case-ish (lowercase, spaces→_)
  // ---------------------------------------------------------------------------
  function normaliseRow(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k).trim().toLowerCase().replace(/\s+/g, "_");
      out[key] = typeof v === "string" ? v.trim() : v;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // POST /api/import/products
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/products",
    requirePerm("all_access"),
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const rows = parseFile(req.file.buffer, req.file.originalname).map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";

        // Pre-fetch lookup tables
        const [catRows, brandRows, taxRows] = await Promise.all([
          db.query("SELECT id, name FROM categories"),
          db.query("SELECT id, name FROM brands"),
          db.query("SELECT id, name FROM taxes"),
        ]);
        const catMap = new Map(catRows.rows.map((r) => [r.name.toLowerCase(), r.id]));
        const brandMap = new Map(brandRows.rows.map((r) => [r.name.toLowerCase(), r.id]));
        const taxMap = new Map(taxRows.rows.map((r) => [r.name.toLowerCase(), r.id]));

        const valid = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2; // +2 because row 1 is header
          const rowErrors = [];

          if (!r.name) rowErrors.push("name is required");
          const sellingPrice = parseFloat(r.selling_price || r.price || "");
          if (isNaN(sellingPrice)) rowErrors.push("selling_price is required and must be a number");

          // Lookup foreign keys
          let category_id = null;
          if (r.category) {
            category_id = catMap.get(String(r.category).toLowerCase()) || null;
            if (!category_id) rowErrors.push(`category "${r.category}" not found`);
          }
          let brand_id = null;
          if (r.brand) {
            brand_id = brandMap.get(String(r.brand).toLowerCase()) || null;
            if (!brand_id) rowErrors.push(`brand "${r.brand}" not found`);
          }
          let tax_id = null;
          if (r.tax || r.tax_group) {
            const taxName = String(r.tax || r.tax_group).toLowerCase();
            tax_id = taxMap.get(taxName) || null;
            if (!tax_id) rowErrors.push(`tax "${r.tax || r.tax_group}" not found`);
          }

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              name: r.name,
              sku: r.sku || null,
              barcode: r.barcode || null,
              price: sellingPrice,
              cost_price: parseFloat(r.cost_price || "0") || 0,
              category_id,
              brand_id,
              tax_id,
              unit: r.unit || "pcs",
              stock_quantity: parseInt(r.stock_quantity || "0", 10) || 0,
              supplier_id: r.supplier_id ? parseInt(r.supplier_id, 10) : null,
              status: r.status || "active",
            });
          }
        }

        if (isPreview) {
          return res.json({ preview: true, valid: valid.length, errors, sample: valid.slice(0, 10) });
        }

        // Bulk insert in transaction
        const outletId = parseInt(req.headers["x-outlet-id"] || "0", 10) || null;
        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const p of valid) {
            const { rows: ins } = await client.query(
              `INSERT INTO products (name, sku, barcode, price, cost_price, category_id, brand_id, tax_id, unit, supplier_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
              [p.name, p.sku, p.barcode, p.price, p.cost_price, p.category_id, p.brand_id, p.tax_id, p.unit, p.supplier_id, p.status],
            );
            const productId = ins[0].id;

            if (p.stock_quantity > 0 && outletId) {
              await client.query(
                `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
                 ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + EXCLUDED.quantity`,
                [productId, outletId, p.stock_quantity],
              );
            }
            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import products error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/customers
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/customers",
    requirePerm("all_access"),
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const rows = parseFile(req.file.buffer, req.file.originalname).map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";
        const valid = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          if (!r.name) rowErrors.push("name is required");

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              name: r.name,
              mobile: r.mobile || r.phone || null,
              email: r.email || null,
              address: r.address || null,
              cnic: r.cnic || null,
              occupation: r.occupation || null,
            });
          }
        }

        if (isPreview) {
          return res.json({ preview: true, valid: valid.length, errors, sample: valid.slice(0, 10) });
        }

        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const c of valid) {
            await client.query(
              `INSERT INTO customers (name, mobile, email, address, cnic, occupation) VALUES ($1, $2, $3, $4, $5, $6)`,
              [c.name, c.mobile, c.email, c.address, c.cnic, c.occupation],
            );
            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import customers error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/suppliers
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/suppliers",
    requirePerm("all_access"),
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const rows = parseFile(req.file.buffer, req.file.originalname).map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";
        const valid = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          if (!r.name) rowErrors.push("name is required");

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              name: r.name,
              contact_person: r.contact_person || null,
              phone: r.phone || null,
              email: r.email || null,
              address: r.address || null,
              payment_terms: r.payment_terms || "cash",
              credit_days: parseInt(r.credit_days || "0", 10) || 0,
              credit_limit: parseFloat(r.credit_limit || "0") || 0,
            });
          }
        }

        if (isPreview) {
          return res.json({ preview: true, valid: valid.length, errors, sample: valid.slice(0, 10) });
        }

        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const s of valid) {
            await client.query(
              `INSERT INTO suppliers (name, contact_person, phone, email, address, payment_terms, credit_days, credit_limit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [s.name, s.contact_person, s.phone, s.email, s.address, s.payment_terms, s.credit_days, s.credit_limit],
            );
            imported++;
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return res.json({ imported, errors });
      } catch (err) {
        console.error("Import suppliers error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/import/template/:entity
  // ---------------------------------------------------------------------------
  app.get(
    "/api/import/template/:entity",
    requirePerm("all_access"),
    (req, res) => {
      const { entity } = req.params;
      let headers;
      let exampleRows;

      switch (entity) {
        case "products":
          headers = ["name", "sku", "barcode", "selling_price", "cost_price", "category", "brand", "tax", "unit", "stock_quantity", "status"];
          exampleRows = [
            ["Widget A", "WDG-001", "1234567890123", 29.99, 15.00, "Electronics", "Acme", "GST 17%", "pcs", 100, "active"],
            ["Widget B", "WDG-002", "1234567890124", 49.99, 25.00, "Accessories", "Acme", "GST 17%", "pcs", 50, "active"],
          ];
          break;
        case "customers":
          headers = ["name", "mobile", "email", "address", "cnic", "occupation"];
          exampleRows = [
            ["John Doe", "03001234567", "john@example.com", "123 Main St", "12345-6789012-3", "Engineer"],
            ["Jane Smith", "03009876543", "jane@example.com", "456 Oak Ave", "", "Teacher"],
          ];
          break;
        case "suppliers":
          headers = ["name", "contact_person", "phone", "email", "address", "payment_terms", "credit_days", "credit_limit"];
          exampleRows = [
            ["Acme Corp", "Bob Wilson", "03001112233", "bob@acme.com", "789 Industrial Rd", "credit", 30, 50000],
            ["Global Supply", "Sara Khan", "03004445566", "sara@global.com", "321 Trade St", "cash", 0, 0],
          ];
          break;
        default:
          return res.status(400).json({ error: `Unknown entity "${entity}". Supported: products, customers, suppliers` });
      }

      const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, entity);
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${entity}_template.xlsx"`);
      return res.send(buf);
    },
  );
};
