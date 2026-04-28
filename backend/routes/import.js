const XLSX = require("xlsx");
const { getMapper, getTemplate, listSources } = require("../services/import/mappers");

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
    // raw: false keeps cell values as the displayed strings — without it, XLSX
    // auto-coerces ISO dates ("2026-04-29") into Excel serial numbers
    // (46141.20...), which breaks Date.parse() in expenses/payments validation.
    // Numeric fields (selling_price, amount) still parse cleanly via parseFloat.
    return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
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
  // Helper: if ?source=<shopify|square> is set, run raw rows through the
  // competitor mapper before normaliseRow(). Unknown source = ignored.
  // Returns the mapped rows (still in their raw-capitalised shape for Shopify)
  // which normaliseRow() will then lowercase + snake_case downstream.
  // ---------------------------------------------------------------------------
  function applySourceMapper(rawRows, source, entity) {
    const mapper = getMapper(source, entity);
    if (!mapper) return rawRows;
    return mapper(rawRows);
  }

  // ---------------------------------------------------------------------------
  // Helper: build unified preview response. Merges valid[] + errors[] back into
  // a single ordered rows[] array (one entry per input data row, in original
  // file order), with `_row` (line number) and `_errors` (string[], empty when
  // valid) on each. Frontend ImportRedesign.jsx reads `preview.rows[]._errors`
  // — keep this shape stable.
  // ---------------------------------------------------------------------------
  function buildPreviewResponse(valid, errors, totalRows) {
    const byRow = new Map();
    for (const v of valid) {
      const { row, ...fields } = v;
      byRow.set(row, { _row: row, _errors: [], ...fields });
    }
    for (const e of errors) {
      byRow.set(e.row, { _row: e.row, _errors: e.errors, ...e.data });
    }
    const rows = [];
    for (let i = 0; i < totalRows; i++) {
      const rowNum = i + 2;
      if (byRow.has(rowNum)) rows.push(byRow.get(rowNum));
    }
    return { preview: true, rows, valid: valid.length, errors: errors.length };
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

        const source = req.query.source ? String(req.query.source).toLowerCase() : null;
        const raw = parseFile(req.file.buffer, req.file.originalname);
        const mapped = source ? applySourceMapper(raw, source, "products") : raw;
        const rows = mapped.map(normaliseRow);
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
          return res.json(buildPreviewResponse(valid, errors, rows.length));
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

        const source = req.query.source ? String(req.query.source).toLowerCase() : null;
        const raw = parseFile(req.file.buffer, req.file.originalname);
        const mapped = source ? applySourceMapper(raw, source, "customers") : raw;
        const rows = mapped.map(normaliseRow);
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
          return res.json(buildPreviewResponse(valid, errors, rows.length));
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
          return res.json(buildPreviewResponse(valid, errors, rows.length));
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
  // POST /api/import/expenses
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/expenses",
    requirePerm("all_access"),
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const rows = parseFile(req.file.buffer, req.file.originalname).map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";

        // Pre-fetch expense categories
        const catRows = await db.query("SELECT id, name FROM expense_categories");
        const catMap = new Map(catRows.rows.map((r) => [r.name.toLowerCase(), r.id]));

        const valid = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          // Required: date, category, amount
          const expenseDate = r.date || r.expense_date || "";
          if (!expenseDate) rowErrors.push("date is required");
          else if (isNaN(Date.parse(expenseDate))) rowErrors.push("date is not valid");

          if (!r.category) rowErrors.push("category is required");
          let category_id = null;
          if (r.category) {
            category_id = catMap.get(String(r.category).toLowerCase()) || null;
            if (!category_id) rowErrors.push(`category "${r.category}" not found`);
          }

          const amount = parseFloat(r.amount || "");
          if (isNaN(amount) || amount <= 0) rowErrors.push("amount must be a positive number");

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              date: expenseDate,
              category: r.category,
              category_id,
              amount,
              description: r.description || null,
              reference: r.reference || null,
              outlet_id: r.outlet_id ? parseInt(r.outlet_id, 10) : null,
            });
          }
        }

        if (isPreview) {
          return res.json(buildPreviewResponse(valid, errors, rows.length));
        }

        const employeeId = req.employee?.id || null;
        let imported = 0;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const e of valid) {
            await client.query(
              `INSERT INTO expenses (expense_date, category_id, amount, description, reference, outlet_id, employee_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [e.date, e.category_id, e.amount, e.description, e.reference, e.outlet_id, employeeId],
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
        console.error("Import expenses error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/import/payments
  // ---------------------------------------------------------------------------
  app.post(
    "/api/import/payments",
    requirePerm("all_access"),
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const rows = parseFile(req.file.buffer, req.file.originalname).map(normaliseRow);
        if (!rows.length) return res.status(400).json({ error: "File is empty or has no data rows" });

        const isPreview = req.query.preview === "1";

        // Pre-fetch suppliers (by name and id)
        const supRows = await db.query("SELECT id, name FROM suppliers");
        const supByName = new Map(supRows.rows.map((r) => [r.name.toLowerCase(), r.id]));
        const supById = new Map(supRows.rows.map((r) => [String(r.id), r.id]));

        // Pre-fetch supplier invoices keyed by (supplier_id, invoice_number)
        const invRows = await db.query("SELECT id, supplier_id, invoice_number, amount, status FROM supplier_invoices");
        const invMap = new Map();
        for (const inv of invRows.rows) {
          if (inv.invoice_number) {
            invMap.set(`${inv.supplier_id}:${inv.invoice_number.toLowerCase()}`, inv);
          }
        }

        const valid = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 2;
          const rowErrors = [];

          // Resolve supplier
          const supplierVal = String(r.supplier || "").trim();
          if (!supplierVal) rowErrors.push("supplier is required");
          let supplier_id = null;
          if (supplierVal) {
            supplier_id = supById.get(supplierVal) || supByName.get(supplierVal.toLowerCase()) || null;
            if (!supplier_id) rowErrors.push(`supplier "${supplierVal}" not found`);
          }

          // Resolve invoice
          const invoiceNum = String(r.invoice_number || "").trim();
          if (!invoiceNum) rowErrors.push("invoice_number is required");
          let invoice = null;
          if (supplier_id && invoiceNum) {
            invoice = invMap.get(`${supplier_id}:${invoiceNum.toLowerCase()}`) || null;
            if (!invoice) rowErrors.push(`invoice "${invoiceNum}" not found for this supplier`);
          }

          const amount = parseFloat(r.amount || "");
          if (isNaN(amount) || amount <= 0) rowErrors.push("amount must be a positive number");

          const payDate = r.date || r.paid_at || "";
          if (!payDate) rowErrors.push("date is required");
          else if (isNaN(Date.parse(payDate))) rowErrors.push("date is not valid");

          const paymentMethod = r.payment_method || "Cash";

          if (rowErrors.length) {
            errors.push({ row: rowNum, data: r, errors: rowErrors });
          } else {
            valid.push({
              row: rowNum,
              supplier: supplierVal,
              supplier_id,
              invoice_number: invoiceNum,
              supplier_invoice_id: invoice.id,
              invoice_amount: Number(invoice.amount),
              amount,
              date: payDate,
              payment_method: paymentMethod,
              reference: r.reference || null,
              notes: r.notes || null,
            });
          }
        }

        if (isPreview) {
          return res.json(buildPreviewResponse(valid, errors, rows.length));
        }

        let imported = 0;
        const paidBy = req.employee?.name || null;
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          for (const p of valid) {
            await client.query(
              `INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, paid_at, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [p.supplier_invoice_id, p.supplier_id, p.amount, p.payment_method, p.reference, paidBy, p.date, p.notes],
            );

            // Update invoice status based on total payments
            const { rows: totals } = await client.query(
              "SELECT COALESCE(SUM(amount), 0) AS total_paid FROM supplier_payments WHERE supplier_invoice_id = $1",
              [p.supplier_invoice_id],
            );
            const totalPaid = Number(totals[0].total_paid);
            const newStatus = totalPaid >= p.invoice_amount ? "paid" : "partial";
            await client.query(
              "UPDATE supplier_invoices SET status = $1 WHERE id = $2",
              [newStatus, p.supplier_invoice_id],
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
        console.error("Import payments error:", err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/import/template/:entity
  // Optional ?source=shopify|square → delivers a source-specific template so
  // merchants can export from Shopify/Square and upload the file directly.
  // ---------------------------------------------------------------------------
  app.get(
    "/api/import/template/:entity",
    requirePerm("all_access"),
    (req, res) => {
      const { entity } = req.params;
      const source = req.query.source ? String(req.query.source).toLowerCase() : null;
      let headers;
      let exampleRows;

      if (source) {
        const tpl = getTemplate(source, entity);
        if (!tpl) {
          return res.status(400).json({
            error: `No ${source} template for "${entity}". Supported sources: ${listSources().join(", ")}. Supported entities for a source: products, customers`,
          });
        }
        headers = tpl.headers;
        exampleRows = tpl.examples;
        const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, entity);
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${source}_${entity}_template.xlsx"`);
        return res.send(buf);
      }

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
        case "expenses":
          headers = ["date", "category", "amount", "description", "reference", "outlet_id"];
          exampleRows = [
            ["2026-04-01", "Rent", 25000, "Monthly shop rent", "RNT-APR-2026", ""],
            ["2026-04-02", "Utilities", 5000, "Electricity bill", "ELEC-042026", ""],
          ];
          break;
        case "payments":
          headers = ["supplier", "invoice_number", "amount", "date", "payment_method", "reference", "notes"];
          exampleRows = [
            ["Acme Corp", "INV-001", 15000, "2026-04-01", "Bank Transfer", "CHQ-1234", "Partial payment"],
            ["Global Supply", "INV-055", 8000, "2026-04-03", "Cash", "", "Full settlement"],
          ];
          break;
        default:
          return res.status(400).json({ error: `Unknown entity "${entity}". Supported: products, customers, suppliers, expenses, payments` });
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
