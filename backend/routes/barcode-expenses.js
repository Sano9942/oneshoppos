module.exports = function registerBarcodeExpenseRoutes(app, deps) {
  const { db, requirePerm, requireFeature, sqlite3, multer, path, fs, UPLOADS_DIR, DB_PATH, runtimeState } = deps;

// --- BARCODE TEMPLATES ---

  app.get("/api/barcode-templates", (req, res) => {
    db.all(
      "SELECT * FROM barcode_templates ORDER BY is_default DESC, name ASC",
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ templates: rows });
      },
    );
  });

  app.post(
    "/api/barcode-templates",
    requirePerm("manage_inventory"),
    (req, res) => {
      const {
        name,
        width_mm = 50,
        height_mm = 30,
        show_name = 1,
        show_price = 1,
        show_barcode = 1,
        show_sku = 0,
        show_brand = 0,
        font_size = 10,
        is_default = 0,
      } = req.body;
      if (!name) return res.status(400).json({ error: "Name required" });
      db.serialize(() => {
        if (is_default) db.run("UPDATE barcode_templates SET is_default = 0");
        db.run(
          "INSERT INTO barcode_templates (name, width_mm, height_mm, show_name, show_price, show_barcode, show_sku, show_brand, font_size, is_default) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [
            name,
            width_mm,
            height_mm,
            show_name ? 1 : 0,
            show_price ? 1 : 0,
            show_barcode ? 1 : 0,
            show_sku ? 1 : 0,
            show_brand ? 1 : 0,
            font_size,
            is_default ? 1 : 0,
          ],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
          },
        );
      });
    },
  );

  app.put(
    "/api/barcode-templates/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
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
      db.serialize(() => {
        if (is_default) db.run("UPDATE barcode_templates SET is_default = 0");
        db.run(
          "UPDATE barcode_templates SET name=?, width_mm=?, height_mm=?, show_name=?, show_price=?, show_barcode=?, show_sku=?, show_brand=?, font_size=?, is_default=? WHERE id=?",
          [
            name,
            width_mm,
            height_mm,
            show_name ? 1 : 0,
            show_price ? 1 : 0,
            show_barcode ? 1 : 0,
            show_sku ? 1 : 0,
            show_brand ? 1 : 0,
            font_size,
            is_default ? 1 : 0,
            id,
          ],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ updated: true });
          },
        );
      });
    },
  );

  app.delete(
    "/api/barcode-templates/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.run(
        "DELETE FROM barcode_templates WHERE id = ?",
        [req.params.id],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ deleted: true });
        },
      );
    },
  );

  // POST /api/barcode-print-jobs — log a batch print event
  app.post("/api/barcode-print-jobs", (req, res) => {
    const { template_id, items = [] } = req.body;
    if (!items.length) return res.status(400).json({ error: "No items" });
    const stmt = db.prepare(
      "INSERT INTO barcode_print_jobs (template_id, product_id, product_name, barcode, price, copies) VALUES (?,?,?,?,?,?)",
    );
    for (const item of items) {
      stmt.run([
        template_id || null,
        item.product_id || null,
        item.name || "",
        item.barcode || "",
        item.price || 0,
        item.copies || 1,
      ]);
    }
    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ logged: items.length });
    });
  });

  // --- EXPENSES ---

  // Expense categories CRUD
  app.get("/api/expense-categories", (req, res) => {
    db.all(
      "SELECT * FROM expense_categories ORDER BY name ASC",
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ categories: rows });
      },
    );
  });

  app.post(
    "/api/expense-categories",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name required" });
      db.run(
        "INSERT INTO expense_categories (name, description) VALUES (?,?)",
        [name, description || null],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID });
        },
      );
    },
  );

  app.put(
    "/api/expense-categories/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name required" });
      db.run(
        "UPDATE expense_categories SET name=?, description=? WHERE id=?",
        [name, description || null, req.params.id],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ updated: true });
        },
      );
    },
  );

  app.delete(
    "/api/expense-categories/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.run(
        "DELETE FROM expense_categories WHERE id=?",
        [req.params.id],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ deleted: true });
        },
      );
    },
  );

  // Expenses CRUD
  app.get("/api/expenses", (req, res) => {
    const { outlet_id, category_id, from, to } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (outlet_id) {
      where += " AND e.outlet_id=?";
      params.push(outlet_id);
    }
    if (category_id) {
      where += " AND e.category_id=?";
      params.push(category_id);
    }
    if (from) {
      where += " AND e.expense_date >= ?";
      params.push(from);
    }
    if (to) {
      where += " AND e.expense_date <= ?";
      params.push(to);
    }

    db.all(
      `
    SELECT e.*, ec.name as category_name, o.name as outlet_name,
           emp.name as employee_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON e.category_id = ec.id
    LEFT JOIN outlets o ON e.outlet_id = o.id
    LEFT JOIN employees emp ON e.employee_id = emp.id
    ${where}
    ORDER BY e.expense_date DESC, e.created_at DESC
  `,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ expenses: rows });
      },
    );
  });

  app.post("/api/expenses", (req, res) => {
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
    db.run(
      `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date)
     VALUES (?,?,?,?,?,?,?,?)`,
      [
        category_id || null,
        outlet_id || null,
        shift_id || null,
        employee_id || null,
        parseFloat(amount),
        description || null,
        reference || null,
        expense_date || new Date().toISOString().slice(0, 10),
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      },
    );
  });

  app.put("/api/expenses/:id", (req, res) => {
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
    db.run(
      `UPDATE expenses SET category_id=?, outlet_id=?, shift_id=?, employee_id=?, amount=?,
     description=?, reference=?, expense_date=? WHERE id=?`,
      [
        category_id || null,
        outlet_id || null,
        shift_id || null,
        employee_id || null,
        parseFloat(amount),
        description || null,
        reference || null,
        expense_date || new Date().toISOString().slice(0, 10),
        req.params.id,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: true });
      },
    );
  });

  app.delete(
    "/api/expenses/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.run("DELETE FROM expenses WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: true });
      });
    },
  );

  // Summary: expenses by category for a date range (used by reports/dashboard)
  app.get("/api/expenses/summary", (req, res) => {
    const { from, to, outlet_id } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (from) {
      where += " AND e.expense_date >= ?";
      params.push(from);
    }
    if (to) {
      where += " AND e.expense_date <= ?";
      params.push(to);
    }
    if (outlet_id) {
      where += " AND e.outlet_id = ?";
      params.push(outlet_id);
    }

    db.all(
      `
    SELECT ec.name as category, SUM(e.amount) as total, COUNT(e.id) as count
    FROM expenses e
    LEFT JOIN expense_categories ec ON e.category_id = ec.id
    ${where}
    GROUP BY e.category_id
    ORDER BY total DESC
  `,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const grandTotal = rows.reduce((s, r) => s + r.total, 0);
        res.json({ summary: rows, grand_total: grandTotal });
      },
    );
  });

  // ─── BACKUP / RESTORE ────────────────────────────────────────────────────────

  const backupUploadDir = UPLOADS_DIR;

  const restoreStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, backupUploadDir),
    filename: (req, file, cb) => cb(null, `restore_${Date.now()}.db`),
  });
  const restoreUpload = multer({
    storage: restoreStorage,
    limits: { fileSize: 500 * 1024 * 1024 },
  });

  // GET /api/backup/download — stream the SQLite file
  app.get(
    "/api/backup/download",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    (req, res) => {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `oneshop_backup_${ts}.db`;
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-Type", "application/octet-stream");
      const stream = fs.createReadStream(DB_PATH);
      stream.on("error", (err) => res.status(500).json({ error: err.message }));
      stream.pipe(res);
      // Log the backup event after streaming begins
      const { performed_by } = req.query;
      const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
      db.run(
        "INSERT INTO backup_log (action, filename, size_bytes, performed_by) VALUES ('backup', ?, ?, ?)",
        [filename, size, performed_by || null],
      );
    },
  );

  // POST /api/backup/restore — upload a .db file and replace the live DB
  app.post(
    "/api/backup/restore",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    restoreUpload.single("backup_file"),
    (req, res) => {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      if (runtimeState.isRestoreInProgress) {
        return res.status(409).json({ error: "Restore already in progress" });
      }
      runtimeState.isRestoreInProgress = true;

      const uploadedPath = req.file.path;
      const { performed_by, note } = req.body;

      const cleanupAndFail = (status, message) => {
        try {
          if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        } catch (_) {
          // ignore cleanup errors
        }
        runtimeState.isRestoreInProgress = false;
        return res.status(status).json({ error: message });
      };

      try {
        const header = Buffer.alloc(16);
        const fd = fs.openSync(uploadedPath, "r");
        fs.readSync(fd, header, 0, 16, 0);
        fs.closeSync(fd);
        if (header.toString("ascii", 0, 6) !== "SQLite") {
          return cleanupAndFail(
            400,
            "Uploaded file is not a valid SQLite database",
          );
        }
      } catch (err) {
        return cleanupAndFail(
          400,
          "Failed to read uploaded file: " + err.message,
        );
      }

      const verifyDb = new sqlite3.Database(
        uploadedPath,
        sqlite3.OPEN_READONLY,
        (openErr) => {
          if (openErr) {
            return cleanupAndFail(
              400,
              "Failed to open uploaded database: " + openErr.message,
            );
          }

          verifyDb.get("PRAGMA quick_check", [], (qcErr, qcRow) => {
            verifyDb.close(() => {});
            if (qcErr)
              return cleanupAndFail(
                400,
                "Failed SQLite integrity check: " + qcErr.message,
              );
            const qc = qcRow ? Object.values(qcRow)[0] : null;
            if (String(qc).toLowerCase() !== "ok") {
              return cleanupAndFail(
                400,
                "Uploaded database failed integrity check",
              );
            }

            const ts = new Date()
              .toISOString()
              .replace(/[:.]/g, "-")
              .slice(0, 19);
            const snapshotPath = path.join(
              backupUploadDir,
              `oneshop_pre_restore_${ts}.db`,
            );
            const stagedPath = path.join(
              backupUploadDir,
              `oneshop_restore_staged_${Date.now()}.db`,
            );

            db.run("BEGIN IMMEDIATE", (lockErr) => {
              if (lockErr)
                return cleanupAndFail(
                  503,
                  "Could not acquire database lock for restore",
                );

              try {
                fs.copyFileSync(DB_PATH, snapshotPath);
                fs.copyFileSync(uploadedPath, stagedPath);
                fs.copyFileSync(stagedPath, DB_PATH);
                fs.unlinkSync(uploadedPath);
                fs.unlinkSync(stagedPath);
              } catch (swapErr) {
                db.run("ROLLBACK");
                return cleanupAndFail(
                  500,
                  "Failed to replace database: " + swapErr.message,
                );
              }

              db.run("ROLLBACK");
              db.run(
                "INSERT INTO backup_log (action, filename, size_bytes, performed_by, note) VALUES ('restore', ?, ?, ?, ?)",
                [
                  req.file.originalname,
                  req.file.size,
                  performed_by || null,
                  note || null,
                ],
                () => {
                  // best-effort logging
                },
              );

              res.json({
                success: true,
                message:
                  "Database restored successfully. Backend will restart now. If not supervised, restart it manually.",
              });
              res.on("finish", () => {
                setTimeout(() => process.exit(0), 300);
              });
            });
          });
        },
      );
    },
  );

  // GET /api/backup/log — backup/restore history
  app.get(
    "/api/backup/log",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    (req, res) => {
      db.all(
        "SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 100",
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ log: rows });
        },
      );
    },
  );

  // ─── E-INVOICING ─────────────────────────────────────────────────────────────

  // Helper: generate next invoice number atomically (INV-YYYY-00001)
  function generateInvoiceNumber(cb) {
    const year = new Date().getFullYear();
    db.serialize(() => {
      db.run(
        "INSERT INTO invoice_sequences (year, last_seq) VALUES (?, 1) ON CONFLICT(year) DO UPDATE SET last_seq = last_seq + 1",
        [year],
        function (err) {
          if (err) return cb(err);
          db.get(
            "SELECT last_seq FROM invoice_sequences WHERE year = ?",
            [year],
            (err2, row) => {
              if (err2) return cb(err2);
              const seq = String(row.last_seq).padStart(5, "0");
              cb(null, `INV-${year}-${seq}`);
            },
          );
        },
      );
    });
  }

  function assignInvoiceNumberToSale(saleId, retriesLeft, cb) {
    generateInvoiceNumber((invErr, invoiceNumber) => {
      if (invErr || !invoiceNumber) {
        if (retriesLeft > 0)
          return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
        return cb(invErr || new Error("Failed to generate invoice number"));
      }

      db.run(
        "UPDATE sales SET invoice_number = ? WHERE id = ? AND invoice_number IS NULL",
        [invoiceNumber, saleId],
        function (updateErr) {
          if (updateErr) {
            if (retriesLeft > 0)
              return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
            return cb(updateErr);
          }

          if (this.changes > 0) return cb(null, invoiceNumber);

          db.get(
            "SELECT invoice_number FROM sales WHERE id = ?",
            [saleId],
            (rowErr, row) => {
              if (rowErr) {
                if (retriesLeft > 0)
                  return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
                return cb(rowErr);
              }
              if (row && row.invoice_number)
                return cb(null, row.invoice_number);
              if (retriesLeft > 0)
                return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
              return cb(new Error("Invoice number update affected zero rows"));
            },
          );
        },
      );
    });
  }

  function getInvoiceData(saleId, cb) {
    db.get(
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
     WHERE s.id = ?`,
      [saleId],
      (err, sale) => {
        if (err) return cb(err);
        if (!sale) return cb(null, null);
        db.all(
          `SELECT si.*, p.name as product_name, p.barcode,
                t.name as tax_name, t.rate as tax_rate
         FROM sale_items si
         JOIN products p ON si.product_id = p.id
         LEFT JOIN taxes t ON p.tax_id = t.id
         WHERE si.sale_id = ?`,
          [saleId],
          (err2, items) => {
            if (err2) return cb(err2);
            db.all(
              "SELECT * FROM sale_payments WHERE sale_id = ?",
              [saleId],
              (err3, payments) => {
                if (err3) return cb(err3);
                cb(null, {
                  sale,
                  items: items || [],
                  payments: payments || [],
                });
              },
            );
          },
        );
      },
    );
  }

  // GET /api/sales/:id/invoice — formal invoice data for a sale
  app.get("/api/sales/:id/invoice", (req, res) => {
    const { id } = req.params;
    getInvoiceData(id, (err, payload) => {
      if (err) return res.status(500).json({ error: err.message });
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
    });
  });

  // GET /api/sales/:id/invoice/export - normalized JSON export contract (v1.0)
  app.get(
    "/api/sales/:id/invoice/export",
    requireFeature("e_invoicing_export"),
    (req, res) => {
      const { id } = req.params;
      getInvoiceData(id, (err, payload) => {
        if (err) return res.status(500).json({ error: err.message });
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
      });
    },
  );

  // ─── 3.6 Auto DB Backup (daily, 7-copy retention) ────────────────────────────
};
