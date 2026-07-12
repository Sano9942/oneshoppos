module.exports = function registerBarcodeExpenseRoutes(app, deps) {
  const { db, requirePerm, requireFeature, multer, path, fs, runtimeState } = deps;

  // --- CREATE TABLE statements removed — schema-pg.sql has them ---

  // --- BARCODE TEMPLATES ---

  app.get("/api/barcode-templates", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM barcode_templates ORDER BY is_default DESC, name ASC"
      );
      res.json({ templates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/barcode-templates",
    requirePerm("manage_inventory"),
    async (req, res) => {
      const {
        name,
        width_mm = 50,
        height_mm = 30,
        show_name = true,
        show_price = true,
        show_barcode = true,
        show_sku = false,
        show_brand = false,
        font_size = 10,
        is_default = false,
      } = req.body;
      if (!name) return res.status(400).json({ error: "Name required" });
      try {
        await db.transaction(async (client) => {
          if (is_default) {
            await client.query("UPDATE barcode_templates SET is_default = false");
          }
          const { rows } = await client.query(
            "INSERT INTO barcode_templates (name, width_mm, height_mm, show_name, show_price, show_barcode, show_sku, show_brand, font_size, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
            [
              name,
              width_mm,
              height_mm,
              show_name ? true : false,
              show_price ? true : false,
              show_barcode ? true : false,
              show_sku ? true : false,
              show_brand ? true : false,
              font_size,
              is_default ? true : false,
            ]
          );
          return rows[0].id;
        }).then((id) => {
          res.json({ id });
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/barcode-templates/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      const { id } = req.params;
      const {
        name,
        width_mm,
        height_mm,
        show_name,
        show_price,
        show_barcode,
        show_sku,
        show_brand,
        font_size,
        is_default,
      } = req.body;
      if (!name) return res.status(400).json({ error: "Name required" });
      try {
        await db.transaction(async (client) => {
          if (is_default) {
            await client.query("UPDATE barcode_templates SET is_default = false");
          }
          await client.query(
            "UPDATE barcode_templates SET name=$1, width_mm=$2, height_mm=$3, show_name=$4, show_price=$5, show_barcode=$6, show_sku=$7, show_brand=$8, font_size=$9, is_default=$10 WHERE id=$11",
            [
              name,
              width_mm,
              height_mm,
              show_name ? true : false,
              show_price ? true : false,
              show_barcode ? true : false,
              show_sku ? true : false,
              show_brand ? true : false,
              font_size,
              is_default ? true : false,
              id,
            ]
          );
        });
        res.json({ updated: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.delete(
    "/api/barcode-templates/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        await db.query(
          "DELETE FROM barcode_templates WHERE id = $1",
          [req.params.id]
        );
        res.json({ deleted: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /api/barcode-print-jobs — log a batch print event
  app.post("/api/barcode-print-jobs", requirePerm("manage_inventory"), async (req, res) => {
    const { template_id, items = [] } = req.body;
    if (!items.length) return res.status(400).json({ error: "No items" });
    try {
      for (const item of items) {
        await db.query(
          "INSERT INTO barcode_print_jobs (template_id, product_id, product_name, barcode, price, copies) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            template_id || null,
            item.product_id || null,
            item.name || "",
            item.barcode || "",
            item.price || 0,
            item.copies || 1,
          ]
        );
      }
      res.json({ logged: items.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- EXPENSES ---

  // Expense categories CRUD
  app.get("/api/expense-categories", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM expense_categories ORDER BY name ASC"
      );
      res.json({ categories: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/expense-categories",
    requirePerm("manage_inventory"),
    async (req, res) => {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name required" });
      try {
        const { rows } = await db.query(
          "INSERT INTO expense_categories (name, description) VALUES ($1,$2) RETURNING id",
          [name, description || null]
        );
        res.json({ id: rows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/expense-categories/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name required" });
      try {
        await db.query(
          "UPDATE expense_categories SET name=$1, description=$2 WHERE id=$3",
          [name, description || null, req.params.id]
        );
        res.json({ updated: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.delete(
    "/api/expense-categories/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        await db.query(
          "DELETE FROM expense_categories WHERE id=$1",
          [req.params.id]
        );
        res.json({ deleted: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Expenses CRUD
  app.get("/api/expenses", async (req, res) => {
    const { outlet_id, category_id, from, to } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;
    if (outlet_id) {
      where += ` AND e.outlet_id=$${idx++}`;
      params.push(outlet_id);
    }
    if (category_id) {
      where += ` AND e.category_id=$${idx++}`;
      params.push(category_id);
    }
    if (from) {
      where += ` AND e.expense_date >= $${idx++}`;
      params.push(from);
    }
    if (to) {
      where += ` AND e.expense_date <= $${idx++}`;
      params.push(to);
    }

    try {
      const { rows } = await db.query(
        `SELECT e.*, ec.name as category_name, o.name as outlet_name,
                emp.name as employee_name
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         LEFT JOIN outlets o ON e.outlet_id = o.id
         LEFT JOIN employees emp ON e.employee_id = emp.id
         ${where}
         ORDER BY e.expense_date DESC, e.created_at DESC`,
        params
      );
      res.json({ expenses: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/expenses", async (req, res) => {
    const {
      category_id,
      outlet_id,
      shift_id,
      employee_id,
      amount,
      description,
      reference,
      expense_date,
    } = req.body;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: "Valid amount required" });
    try {
      const { rows } = await db.query(
        `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          category_id || null,
          outlet_id || null,
          shift_id || null,
          employee_id || null,
          parseFloat(amount),
          description || null,
          reference || null,
          // Default expense day = tenant-local today (UTC date is a day
          // behind for evening entries east of UTC).
          expense_date || require("../utils/tz").tenantToday(req.company?.timezone),
        ]
      );
      res.json({ id: rows[0].id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/expenses/:id", async (req, res) => {
    const {
      category_id,
      outlet_id,
      shift_id,
      employee_id,
      amount,
      description,
      reference,
      expense_date,
    } = req.body;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: "Valid amount required" });
    try {
      await db.query(
        `UPDATE expenses SET category_id=$1, outlet_id=$2, shift_id=$3, employee_id=$4, amount=$5,
         description=$6, reference=$7, expense_date=$8 WHERE id=$9`,
        [
          category_id || null,
          outlet_id || null,
          shift_id || null,
          employee_id || null,
          parseFloat(amount),
          description || null,
          reference || null,
          // Default expense day = tenant-local today (UTC date is a day
          // behind for evening entries east of UTC).
          expense_date || require("../utils/tz").tenantToday(req.company?.timezone),
          req.params.id,
        ]
      );
      res.json({ updated: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete(
    "/api/expenses/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        await db.query("DELETE FROM expenses WHERE id=$1", [req.params.id]);
        res.json({ deleted: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Summary: expenses by category for a date range (used by reports/dashboard)
  app.get("/api/expenses/summary", async (req, res) => {
    const { from, to, outlet_id } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;
    if (from) {
      where += ` AND e.expense_date >= $${idx++}`;
      params.push(from);
    }
    if (to) {
      where += ` AND e.expense_date <= $${idx++}`;
      params.push(to);
    }
    if (outlet_id) {
      where += ` AND e.outlet_id = $${idx++}`;
      params.push(outlet_id);
    }

    try {
      const { rows } = await db.query(
        `SELECT ec.name as category, SUM(e.amount) as total, COUNT(e.id) as count
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         ${where}
         GROUP BY e.category_id, ec.name
         ORDER BY total DESC`,
        params
      );
      const grandTotal = rows.reduce((s, r) => s + Number(r.total), 0);
      res.json({ summary: rows, grand_total: grandTotal });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── BACKUP / RESTORE ────────────────────────────────────────────────────────

  // GET /api/backup/download — pg_dump backup
  app.get(
    "/api/backup/download",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    async (req, res) => {
      try {
        const { backupSchema, getSchemaName, isPgDumpAvailable } = require("../utils/backup-pg");

        if (!(await isPgDumpAvailable())) {
          return res.status(503).json({ error: "pg_dump is not available on this server" });
        }

        const schemaName = getSchemaName(req.tenantSlug);
        const filename = `backup-${schemaName}-${new Date().toISOString().slice(0, 10)}.dump`;
        const startTime = Date.now();

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        const { stream, process: proc } = backupSchema(schemaName);

        let size = 0;
        stream.on("data", (chunk) => { size += chunk.length; });
        stream.pipe(res);

        proc.on("close", async (code) => {
          const durationMs = Date.now() - startTime;
          // P33 — write into the public.backup_log audit table. action and
          // tenant_slug are required for the dashboards to scope correctly;
          // schema_name + status + duration_ms + size_bytes preserve the
          // older audit fields for back-compat. Errors are logged, not
          // silently swallowed.
          try {
            if (code === 0) {
              await db.query(
                `INSERT INTO backup_log
                   (action, schema_name, tenant_slug, status, size_bytes, duration_ms, performed_by, filename)
                 VALUES ('backup', $1, $2, 'success', $3, $4, $5, $6)`,
                [schemaName, req.tenantSlug || null, size, durationMs, req.employee?.email || null, filename]
              );
            } else {
              await db.query(
                `INSERT INTO backup_log
                   (action, schema_name, tenant_slug, status, size_bytes, duration_ms, error_message, performed_by, filename)
                 VALUES ('backup_failed', $1, $2, 'failed', $3, $4, $5, $6, $7)`,
                [schemaName, req.tenantSlug || null, size, durationMs, `pg_dump exited with code ${code}`, req.employee?.email || null, filename]
              );
            }
          } catch (err) {
            console.warn(`[backup/download] backup_log INSERT failed: ${err.message}`);
          }
        });

        proc.on("error", (err) => {
          const durationMs = Date.now() - startTime;
          db.query(
            `INSERT INTO backup_log
               (action, schema_name, tenant_slug, status, duration_ms, error_message, performed_by)
             VALUES ('backup_failed', $1, $2, 'failed', $3, $4, $5)`,
            [getSchemaName(req.tenantSlug), req.tenantSlug || null, durationMs, err.message, req.employee?.email || null]
          ).catch((logErr) => {
            console.warn(`[backup/download] backup_log INSERT failed: ${logErr.message}`);
          });
          if (!res.headersSent) {
            res.status(500).json({ error: `Backup failed: ${err.message}` });
          }
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /api/backup/restore — pg_restore
  const restoreUpload = multer({
    dest: path.join(__dirname, "../uploads_tmp"),
    limits: { fileSize: 50 * 1024 * 1024 },
  }).single("backup_file");

  app.post(
    "/api/backup/restore",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    (req, res, next) => {
      restoreUpload(req, res, (err) => {
        if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
        next();
      });
    },
    async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "backup_file is required" });
      }
      const startTime = Date.now();
      try {
        const { restoreSchema, listSchemasInBackup, getSchemaName } = require("../utils/backup-pg");
        const schemaName = getSchemaName(req.tenantSlug);

        // Inspect the dump's TOC before invoking pg_restore. A crafted
        // archive could declare objects in OTHER tenant schemas or in
        // public; pg_restore's --schema flag filters by schema name but
        // does not stop a malicious operator from learning the layout of
        // the platform or testing dumps tagged for other tenants. Reject
        // anything that mentions a schema other than the caller's own.
        let dumpSchemas;
        try {
          dumpSchemas = await listSchemasInBackup(req.file.path);
        } catch (inspectErr) {
          return res.status(400).json({
            error: `Backup file is not a valid pg_dump archive: ${inspectErr.message}`,
          });
        }
        const allowedSchemas = new Set([schemaName, "public"]);
        const foreignSchemas = dumpSchemas.filter((s) => !allowedSchemas.has(s));
        if (foreignSchemas.length) {
          return res.status(400).json({
            error: `Backup contains schemas this tenant cannot restore: ${foreignSchemas.join(", ")}`,
          });
        }
        if (!dumpSchemas.includes(schemaName)) {
          return res.status(400).json({
            error: `Backup does not contain the expected schema "${schemaName}"`,
          });
        }

        runtimeState.isRestoreInProgress = true;
        const result = await restoreSchema(schemaName, req.file.path);
        runtimeState.isRestoreInProgress = false;
        const durationMs = Date.now() - startTime;

        // P33 — audit row. action='restore' for success.
        try {
          await db.query(
            `INSERT INTO backup_log
               (action, schema_name, tenant_slug, status, size_bytes, duration_ms, error_message, performed_by, filename)
             VALUES ('restore', $1, $2, 'success', $3, $4, $5, $6, $7)`,
            [schemaName, req.tenantSlug || null, req.file.size, durationMs, result.stderr || null, req.employee?.email || null, req.file.originalname || null]
          );
        } catch (logErr) {
          console.warn(`[backup/restore] backup_log INSERT failed: ${logErr.message}`);
        }

        res.json({ success: true, message: "Restore complete" });
      } catch (err) {
        runtimeState.isRestoreInProgress = false;
        const durationMs = Date.now() - startTime;
        const { getSchemaName } = require("../utils/backup-pg");
        // P33 — audit row. action='restore_failed' for failure.
        try {
          await db.query(
            `INSERT INTO backup_log
               (action, schema_name, tenant_slug, status, size_bytes, duration_ms, error_message, performed_by, filename)
             VALUES ('restore_failed', $1, $2, 'failed', $3, $4, $5, $6, $7)`,
            [getSchemaName(req.tenantSlug), req.tenantSlug || null, req.file?.size || 0, durationMs, err.message, req.employee?.email || null, req.file?.originalname || null]
          );
        } catch (logErr) {
          console.warn(`[backup/restore] backup_log INSERT failed: ${logErr.message}`);
        }
        res.status(500).json({ error: err.message });
      } finally {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
      }
    },
  );

  // GET /api/backup/log — backup/restore history (P33: tenant-scoped)
  app.get(
    "/api/backup/log",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT * FROM backup_log
            WHERE tenant_slug = $1
               OR (tenant_slug IS NULL AND action = 'full_backup')
            ORDER BY created_at DESC LIMIT 100`,
          [req.tenantSlug || null]
        );
        res.json({ log: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET /api/backup-status — latest backup record for dashboard card
  // P33: previously returned ANY most-recent row across all tenants — leaked
  // cross-tenant data. Now scoped to the calling tenant_slug, falling back
  // to the most recent platform-wide full_backup so tenants on a fresh
  // schema still see "yes, infra-side backups exist".
  app.get(
    "/api/backup-status",
    requirePerm("all_access"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT * FROM backup_log
            WHERE tenant_slug = $1
               OR (tenant_slug IS NULL AND action = 'full_backup')
            ORDER BY created_at DESC LIMIT 1`,
          [req.tenantSlug || null]
        );
        res.json({ backup: rows[0] || null });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ─── E-INVOICING ─────────────────────────────────────────────────────────────

  // Helper: generate next invoice number atomically (INV-YYYY-00001)
  async function generateInvoiceNumber() {
    const year = new Date().getFullYear();
    await db.query(
      "INSERT INTO invoice_sequences (year, last_seq) VALUES ($1, 1) ON CONFLICT(year) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1",
      [year]
    );
    const { rows: [row] } = await db.query(
      "SELECT last_seq FROM invoice_sequences WHERE year = $1",
      [year]
    );
    const seq = String(row.last_seq).padStart(5, "0");
    return `INV-${year}-${seq}`;
  }

  async function assignInvoiceNumberToSale(saleId, retriesLeft) {
    try {
      const invoiceNumber = await generateInvoiceNumber();
      if (!invoiceNumber) {
        if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1);
        throw new Error("Failed to generate invoice number");
      }

      const { rowCount } = await db.query(
        "UPDATE sales SET invoice_number = $1 WHERE id = $2 AND invoice_number IS NULL",
        [invoiceNumber, saleId]
      );

      if (rowCount > 0) return invoiceNumber;

      const { rows: [row] } = await db.query(
        "SELECT invoice_number FROM sales WHERE id = $1",
        [saleId]
      );
      if (row && row.invoice_number) return row.invoice_number;
      if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1);
      throw new Error("Invoice number update affected zero rows");
    } catch (err) {
      if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1);
      throw err;
    }
  }

  async function getInvoiceData(saleId) {
    const { rows: [sale] } = await db.query(
      `SELECT s.*, o.name as outlet_name, o.address as outlet_address,
              e.name as employee_name,
              c.name as customer_name, c.mobile as customer_phone, c.email as customer_email,
              cp.company_name, cp.trading_name, cp.ntn, cp.strn, cp.phone as company_phone,
              cp.email as company_email, cp.website as company_website, cp.address as company_address,
              cp.city as company_city, cp.country as company_country, cp.logo_url as company_logo_url,
              cp.currency_symbol, cp.currency_code
       FROM sales s
       LEFT JOIN outlets o ON s.outlet_id = o.id
       LEFT JOIN employees e ON s.employee_id = e.id
       LEFT JOIN customers c ON s.customer_id = c.id
       LEFT JOIN company_profile cp ON cp.id = 1
       WHERE s.id = $1`,
      [saleId]
    );
    if (!sale) return null;

    const { rows: items } = await db.query(
      `SELECT si.*, p.name as product_name, p.barcode,
              t.name as tax_name, t.rate as tax_rate
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       LEFT JOIN taxes t ON p.tax_id = t.id
       WHERE si.sale_id = $1`,
      [saleId]
    );

    const { rows: payments } = await db.query(
      "SELECT * FROM sale_payments WHERE sale_id = $1",
      [saleId]
    );

    return { sale, items: items || [], payments: payments || [] };
  }

  // GET /api/sales/:id/invoice — formal invoice data for a sale
  app.get("/api/sales/:id/invoice", async (req, res) => {
    const { id } = req.params;
    try {
      const payload = await getInvoiceData(id);
      if (!payload) return res.status(404).json({ error: "Sale not found" });
      return res.json({
        ...payload,
        seller: {
          outlet_id: payload.sale.outlet_id || null,
          outlet_name: payload.sale.outlet_name || null,
          outlet_address: payload.sale.outlet_address || null,
          company_name:
            payload.sale.company_name || payload.sale.outlet_name || null,
          trading_name: payload.sale.trading_name || null,
          ntn: payload.sale.ntn || null,
          strn: payload.sale.strn || null,
          phone: payload.sale.company_phone || null,
          email: payload.sale.company_email || null,
          website: payload.sale.company_website || null,
          address: payload.sale.company_address || null,
          city: payload.sale.company_city || null,
          country: payload.sale.company_country || null,
          logo_url: payload.sale.company_logo_url || null,
          currency_symbol: payload.sale.currency_symbol || "PKRs",
          currency_code: payload.sale.currency_code || "PKR",
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/sales/:id/invoice/export - normalized JSON export contract (v1.0)
  app.get(
    "/api/sales/:id/invoice/export",
    requireFeature("e_invoicing_export"),
    async (req, res) => {
      const { id } = req.params;
      try {
        const payload = await getInvoiceData(id);
        if (!payload) return res.status(404).json({ error: "Sale not found" });

        const { sale, items, payments } = payload;
        const normalizedItems = items.map((item) => {
          const unitPrice = Number(item.price_at_sale || 0);
          const quantity = Number(item.quantity || 0);
          const taxRate = Number(item.tax_rate || 0);
          const lineSubtotal = Number((unitPrice * quantity).toFixed(2));
          const lineTax = Number(((lineSubtotal * taxRate) / 100).toFixed(2));
          return {
            product_id: item.product_id,
            product_name: item.product_name || null,
            barcode: item.barcode || null,
            quantity,
            unit_price: unitPrice,
            tax_name: item.tax_name || null,
            tax_rate: taxRate,
            line_subtotal: lineSubtotal,
            line_tax: lineTax,
            line_total: Number((lineSubtotal + lineTax).toFixed(2)),
          };
        });

        const subtotal = Number(
          normalizedItems
            .reduce((sum, row) => sum + row.line_subtotal, 0)
            .toFixed(2),
        );
        const taxTotal = Number(
          normalizedItems
            .reduce((sum, row) => sum + row.line_tax, 0)
            .toFixed(2),
        );
        const discountAmount = Number(sale.discount_amount || 0);
        const pointsRedeemed = Number(sale.points_redeemed || 0);
        const totalAmount = Number(sale.total_amount || 0);

        return res.json({
          version: "1.0",
          exported_at: new Date().toISOString(),
          invoice: {
            invoice_number: sale.invoice_number || `SALE-${sale.id}`,
            sale_id: sale.id,
            timestamp: sale.timestamp,
            status: sale.status || (sale.voided ? "voided" : "paid"),
            currency: "PKR",
            totals: {
              subtotal,
              tax_total: taxTotal,
              discount_amount: discountAmount,
              points_redeemed: pointsRedeemed,
              total_amount: totalAmount,
            },
          },
          seller: {
            outlet_id: sale.outlet_id || null,
            outlet_name: sale.outlet_name || null,
            outlet_address: sale.outlet_address || null,
            company_name: sale.company_name || sale.outlet_name || null,
            trading_name: sale.trading_name || null,
            ntn: sale.ntn || null,
            strn: sale.strn || null,
            phone: sale.company_phone || null,
            email: sale.company_email || null,
            website: sale.company_website || null,
            address: sale.company_address || null,
            city: sale.company_city || null,
            country: sale.company_country || null,
            logo_url: sale.company_logo_url || null,
            currency_symbol: sale.currency_symbol || "PKRs",
            currency_code: sale.currency_code || "PKR",
          },
          buyer: sale.customer_id
            ? {
                customer_id: sale.customer_id,
                name: sale.customer_name || null,
                phone: sale.customer_phone || null,
                email: sale.customer_email || null,
              }
            : null,
          items: normalizedItems,
          payments: (payments || []).map((p) => ({
            payment_method: p.payment_method || null,
            amount: Number(p.amount || 0),
          })),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ─── 3.6 Auto DB Backup (daily, 7-copy retention) ────────────────────────────

  // --- NOTIFICATIONS ---

  app.get("/api/notifications", requirePerm("view_sales_reports"), async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM notifications ORDER BY is_read ASC, created_at DESC"
      );
      res.json({ notifications: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/notifications/:id/read", requirePerm("view_sales_reports"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query(
        "UPDATE notifications SET is_read=true WHERE id=$1",
        [id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Notification not found" });
      res.json({ updated: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- SERIAL NUMBERS ---
  // NOTE: the endpoints that used to live here moved to routes/product-serials.js
  // in Phase 2-G Wave 3 (2-G.6). See there for: GET /api/products/:id/serials
  // (with ?status=, ?variant_id= filters), POST-equivalents via
  // /api/grn/:id/scan-receive (which now accepts serial_numbers[] when the
  // product is serial_required), and PUT /api/products/:id/serial-required.
  // The older /api/serials/:id/assign was not used by any caller — sales.js
  // now assigns serials via the sale_item_serials bridge inside the sale
  // transaction.

  app.post("/api/products/:id/serials", requirePerm("manage_inventory"), async (req, res) => {
    // Lightweight bulk-create endpoint kept here as a compatibility shim for
    // admin tooling that seeds serials outside of the GRN flow (e.g. importing
    // pre-existing inventory). Doesn't touch warranty/grn_id — pure
    // serial_number insert.
    const { id } = req.params;
    const { serial_numbers } = req.body;
    if (!Array.isArray(serial_numbers) || serial_numbers.length === 0)
      return res.status(400).json({ error: "serial_numbers array required" });
    try {
      let inserted = 0;
      let failed = 0;
      for (const sn of serial_numbers) {
        try {
          await db.query(
            "INSERT INTO product_serial_numbers (product_id, serial_number) VALUES ($1, $2)",
            [id, sn]
          );
          inserted++;
        } catch (_) {
          failed++;
        }
      }
      res.json({ inserted, failed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- GIFT CARDS ---
  // The 4 routes that used to live here were deprecated in Phase 2-G
  // Wave 2 (2-G.2). See routes/gift-cards.js for the wired-up
  // replacements: filter-aware list, digital + physical create, range
  // management, activation, balance, and transactional POS redemption
  // with ledger audit + depleted state handling.
};
