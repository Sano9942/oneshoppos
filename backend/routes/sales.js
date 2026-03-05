const { toUtcStart, toUtcEnd } = require("../utils/tz");

module.exports = function registerSalesRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, createNotification, notifyLowStockForSale, path, fs, UPLOADS_DIR } = deps;

  // --- HELPERS (inlined because these functions live in other route modules) ---

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
        if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
        return cb(invErr || new Error("Failed to generate invoice number"));
      }
      db.run(
        "UPDATE sales SET invoice_number = ? WHERE id = ? AND invoice_number IS NULL",
        [invoiceNumber, saleId],
        function (updateErr) {
          if (updateErr) {
            if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
            return cb(updateErr);
          }
          if (this.changes > 0) return cb(null, invoiceNumber);
          db.get("SELECT invoice_number FROM sales WHERE id = ?", [saleId], (rowErr, row) => {
            if (rowErr) {
              if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
              return cb(rowErr);
            }
            if (row && row.invoice_number) return cb(null, row.invoice_number);
            if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
            return cb(new Error("Invoice number update affected zero rows"));
          });
        },
      );
    });
  }

  // enqueueInventorySyncEvents is a Shopify sync helper defined in orders.js.
  // For sales, we call it as a no-op if unavailable (sync is non-blocking).
  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const ordersModule = deps.enqueueInventorySyncEvents;
      if (typeof ordersModule === "function") return ordersModule(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

  function getActiveShiftForOutlet(outletId) {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT * FROM cash_shifts WHERE outlet_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
        [Number(outletId)],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        },
      );
    });
  }

  function getEmployeeCheckoutStatus(employeeId, outletId) {
    const today = new Date().toLocaleDateString("sv-SE");
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM attendance_sessions
         WHERE employee_id = ? AND outlet_id = ? AND session_end IS NULL
           AND date(session_start, 'localtime') = ?
         ORDER BY session_start DESC
         LIMIT 1`,
        [Number(employeeId), Number(outletId), today],
        (err, openSession) => {
          if (err) return reject(err);
          if (openSession) {
            return resolve(
              openSession.session_type === "work" ? "clocked_in" : "on_break",
            );
          }
          db.get(
            `SELECT COUNT(*) AS cnt
             FROM attendance_sessions
             WHERE employee_id = ? AND outlet_id = ?
               AND date(session_start, 'localtime') = ?`,
            [Number(employeeId), Number(outletId), today],
            (countErr, countRow) => {
              if (countErr) return reject(countErr);
              resolve(Number(countRow?.cnt || 0) > 0 ? "clocked_out" : "not_clocked_in");
            },
          );
        },
      );
    });
  }

// --- SALES HISTORY ROUTES ---

  // GET all sales (paginated, filterable)
  app.get("/api/sales", (req, res) => {
    const {
      page = 1,
      limit = 50,
      search = "",
      date_from = "",
      date_to = "",
      outlet_id = "",
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let conditions = ["s.voided IS NULL OR s.voided = 0"];
    let params = [];

    if (search) {
      conditions.push(
        "(CAST(s.id AS TEXT) LIKE ? OR e.name LIKE ? OR o.name LIKE ? OR s.invoice_number LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const tz = req.company?.timezone || "UTC";
    if (date_from) {
      conditions.push("s.timestamp >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      conditions.push("s.timestamp < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    if (outlet_id) {
      conditions.push("s.outlet_id = ?");
      params.push(Number(outlet_id));
    }

    const where = conditions.join(" AND ");

    const countQuery = `SELECT COUNT(*) as total FROM sales s
    LEFT JOIN outlets o ON s.outlet_id = o.id
    LEFT JOIN employees e ON s.employee_id = e.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE ${where}`;

    db.get(countQuery, params, (err, countRow) => {
      if (err) return res.status(500).json({ error: err.message });

      const total = countRow?.total || 0;
      const listParams = [...params, parseInt(limit), offset];

      const listQuery = `
      SELECT s.id, s.timestamp, s.total_amount, s.payment_method, s.voided, s.void_reason,
             COALESCE(s.discount_amount, 0) as discount_amount, s.discount_type,
             s.invoice_number, s.outlet_id,
             o.name as outlet_name, e.name as employee_name,
             c.name as customer_name,
             COUNT(si.id) as item_count
      FROM sales s
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN employees e ON s.employee_id = e.id
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE ${where}
      GROUP BY s.id
      ORDER BY s.timestamp DESC
      LIMIT ? OFFSET ?`;

      db.all(listQuery, listParams, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          sales: rows,
          total,
          pages: Math.ceil(total / parseInt(limit)),
          page: parseInt(page),
        });
      });
    });
  });

  // GET a single sale with full line items and payments
  app.get("/api/sales/:id", (req, res) => {
    const { id } = req.params;

    db.get(
      `SELECT s.*, o.name as outlet_name, e.name as employee_name
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     WHERE s.id = ?`,
      [id],
      (err, sale) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sale) return res.status(404).json({ error: "Sale not found" });

        db.all(
          `SELECT si.*, p.name as product_name, p.barcode
         FROM sale_items si JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = ?`,
          [id],
          (err, items) => {
            if (err) return res.status(500).json({ error: err.message });

            db.all(
              "SELECT * FROM sale_payments WHERE sale_id = ?",
              [id],
              (err, payments) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ sale, items, payments });
              },
            );
          },
        );
      },
    );
  });

  // VOID a sale — marks as voided and restores stock to outlet
  app.put(
    "/api/sales/:id/void",
    requireAnyPerm(["void_sales", "pos_void"]),
    (req, res) => {
      const { id } = req.params;
      const { void_reason } = req.body;

      if (!void_reason)
        return res.status(400).json({ error: "void_reason is required" });

      // Fetch the sale first to check it exists and isn't already voided
      db.get("SELECT * FROM sales WHERE id = ?", [id], (err, sale) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sale) return res.status(404).json({ error: "Sale not found" });
        if (sale.voided)
          return res.status(400).json({ error: "Sale is already voided" });
        if (!sale.outlet_id)
          return res
            .status(400)
            .json({ error: "Cannot void sales without outlet attribution" });

        // Fetch line items to restore stock
        db.all(
          "SELECT * FROM sale_items WHERE sale_id = ?",
          [id],
          (err, items) => {
            if (err) return res.status(500).json({ error: err.message });

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");

              // Mark the sale as voided
              db.run(
                "UPDATE sales SET voided = 1, void_reason = ? WHERE id = ?",
                [void_reason, id],
                function (err) {
                  if (err) {
                    db.run("ROLLBACK");
                    return res
                      .status(500)
                      .json({ error: "Failed to void sale" });
                  }
                },
              );

              // Restore stock for each item back to the outlet
              const restoreStmt = db.prepare(
                `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
              );
              items.forEach((item) => {
                restoreStmt.run(
                  item.product_id,
                  sale.outlet_id,
                  item.quantity,
                  item.quantity,
                );
              });
              restoreStmt.finalize();

              db.run("COMMIT", (err) => {
                if (err)
                  return res
                    .status(500)
                    .json({ error: "Failed to commit void transaction" });
                const syncChanges = items.map((item) => ({
                  product_id: item.product_id,
                  variant_id: item.variant_id || null,
                  outlet_id: sale.outlet_id,
                  delta: Number(item.quantity || 0),
                  reason: "void",
                  reference_type: "sale_void",
                  reference_id: id,
                }));
                enqueueInventorySyncEvents(syncChanges, {}, () => {});
                res.json({
                  message: "Sale voided successfully. Stock has been restored.",
                });
              });
            });
          },
        );
      });
    },
  );

  // Process a Sale (Cart Checkout)
  app.post("/api/sales", async (req, res) => {
    const {
      cartItems,
      paymentMethod,
      payments,
      outlet_id,
      employee_id,
      customer_id,
      discount_amount = 0,
      discount_type = "fixed",
      points_earned = 0,
      points_redeemed = 0,
      notes = null,
    } = req.body;

    const authenticatedEmployeeId =
      Number(req.headers["x-employee-id"] || employee_id || 0) || null;

    // Validation
    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }
    if (!outlet_id) {
      return res
        .status(400)
        .json({ error: "Outlet ID is required for checkout" });
    }
    if (!authenticatedEmployeeId) {
      return res.status(401).json({ error: "Login is required for checkout" });
    }

    try {
      const activeShift = await getActiveShiftForOutlet(outlet_id);
      if (!activeShift) {
        return res.status(400).json({
          error: "Cannot checkout because no open shift exists for this outlet",
          code: "shift_not_open",
        });
      }

      const attendanceStatus = await getEmployeeCheckoutStatus(
        authenticatedEmployeeId,
        outlet_id,
      );
      if (attendanceStatus !== "clocked_in") {
        const message =
          attendanceStatus === "on_break"
            ? "Cannot checkout while on break. Clock back in first."
            : "Cannot checkout because the employee is not clocked in for this outlet";
        return res.status(400).json({
          error: message,
          code: "employee_not_clocked_in",
          attendance_status: attendanceStatus,
        });
      }
    } catch (validationErr) {
      return res.status(500).json({ error: validationErr.message });
    }

    // 1. Calculate Expected Total (subtotal minus discount)
    const subtotal = cartItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );
    const discountValue =
      discount_type === "percent"
        ? (subtotal * parseFloat(discount_amount || 0)) / 100
        : parseFloat(discount_amount || 0);
    const totalAmount =
      subtotal - discountValue - parseFloat(points_redeemed || 0);

    // Determine the actual payments to record
    let finalPayments = payments;
    let mainPaymentMethod = paymentMethod || "Cash";

    if (!finalPayments || finalPayments.length === 0) {
      finalPayments = [{ method: mainPaymentMethod, amount: totalAmount }];
    } else if (finalPayments.length > 1) {
      mainPaymentMethod = "Split";
    } else if (finalPayments.length === 1) {
      mainPaymentMethod = finalPayments[0].method;
    }

    // Start Transaction Logic
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      // 2. Insert into Sales Table (outlet_id + employee_id + customer_id + discount + points)
      db.run(
        "INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, points_earned, points_redeemed, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          totalAmount,
          mainPaymentMethod,
          outlet_id,
          authenticatedEmployeeId,
          customer_id || null,
          discountValue,
          discount_type,
          points_earned,
          points_redeemed,
          notes || null,
        ],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res
              .status(500)
              .json({ error: "Failed to create sale record" });
          }

          const saleId = this.lastID;
          const itemsStmt = db.prepare(
            "INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale, cost_price_at_sale) VALUES (?, ?, ?, ?, ?, ?)",
          );
          const stockStmt = db.prepare(`
                    UPDATE outlet_stock 
                    SET quantity = quantity - ? 
                    WHERE product_id = ? AND outlet_id = ?
                `);
          const variantStockStmt = db.prepare(`
                    UPDATE product_variants 
                    SET stock = stock - ? 
                    WHERE id = ?
                `);
          const paymentsStmt = db.prepare(
            "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)",
          );

          let hasError = false;

          // 3. Loop through cart to insert Line Items AND deduct stock
          cartItems.forEach((item) => {
            itemsStmt.run(
              saleId,
              item.original_product_id || item.id,
              item.variant_id || null,
              item.quantity,
              item.price,
              item.cost_price || 0,
              (err) => {
                if (err) hasError = true;
              },
            );

            if (item.variant_id) {
              variantStockStmt.run(item.quantity, item.variant_id, (err) => {
                if (err) hasError = true;
              });
              stockStmt.run(item.quantity, item.original_product_id || item.id, outlet_id, (err) => {
                if (err) hasError = true;
              });
            } else {
              stockStmt.run(item.quantity, item.id, outlet_id, (err) => {
                if (err) hasError = true;
              });
            }
          });

          // 4. Insert Payments
          finalPayments.forEach((payment) => {
            paymentsStmt.run(saleId, payment.method, payment.amount, (err) => {
              if (err) hasError = true;
            });
          });

          itemsStmt.finalize();
          stockStmt.finalize();
          variantStockStmt.finalize();
          paymentsStmt.finalize();

          // Update customer points if applicable
          if (customer_id && (points_earned > 0 || points_redeemed > 0)) {
            db.run(
              "UPDATE customers SET loyalty_points = loyalty_points + ? - ? WHERE id = ?",
              [points_earned, points_redeemed, customer_id],
              (err) => {
                if (err) hasError = true;
              },
            );
          }

          // Debit wallet for any Wallet payments
          const walletPayments = finalPayments.filter(
            (p) => p.method === "Wallet",
          );
          if (customer_id && walletPayments.length > 0) {
            const walletTotal = walletPayments.reduce(
              (s, p) => s + p.amount,
              0,
            );
            db.run(
              "UPDATE customers SET balance = COALESCE(balance, 0) - ? WHERE id = ?",
              [walletTotal, customer_id],
              (err) => {
                if (err) hasError = true;
              },
            );
            db.run(
              "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, reference_id, note) VALUES (?, 'debit', ?, 'sale', ?, ?)",
              [customer_id, walletTotal, saleId, `Debit for Sale #${saleId}`],
              (err) => {
                if (err) hasError = true;
              },
            );
          }

          // 5. Commit or Rollback
          if (hasError) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: "Transaction failed" });
          }

          db.run("COMMIT", (err) => {
            if (err)
              return res.status(500).json({ error: "Failed to commit sale" });
            const syncChanges = cartItems.map((item) => ({
              product_id:
                item.original_product_id || item.product_id || item.id,
              variant_id: item.variant_id || null,
              outlet_id,
              delta: -1 * Number(item.quantity || 0),
              reason: "sale",
              reference_type: "sale",
              reference_id: saleId,
            }));
            enqueueInventorySyncEvents(syncChanges, {}, () => {});
            notifyLowStockForSale(cartItems, outlet_id);
            assignInvoiceNumberToSale(saleId, 1, (invErr, invoiceNumber) => {
              if (invErr) {
                return res.status(500).json({
                  error: "Sale committed but invoice finalization failed",
                  saleId,
                  details: invErr.message,
                });
              }
              res.json({
                message: "Sale completed successfully",
                saleId,
                totalAmount,
                invoiceNumber: invoiceNumber || null,
                payments: finalPayments,
              });
            });
          });
        },
      );
    });
  });
};
