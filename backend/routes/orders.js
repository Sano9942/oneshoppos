module.exports = function registerOrderRoutes(app, deps) {
  const {
    db, requirePerm, requireAnyPerm, createNotification, notifyLowStockForSale,
    path, fs, UPLOADS_DIR, runtimeState,
    verifyConnection, fetchShopifyLocations, adjustShopifyInventory,
    fetchShopifyVariantCatalog, fetchShopifyProductsFull,
    fetchInventoryLevel, fetchInventoryLevelsBatch, fetchRecentOrders,
    retryDelayMinutesWithJitter, evaluateWebhookTimestampWindow,
    isRetryableInventoryEventStatus, buildWebhookIdempotencyKey,
    logShopifyEvent, DB_PATH, sqlite3
  } = deps;

  let processPendingShopifyInventoryEvents;

// --- ROUTES: ORDERS (Website order staging before live Shopify integration) ---

  app.get("/api/orders", requirePerm("manage_orders"), (req, res) => {
    const {
      source,
      order_status,
      payment_status,
      fulfillment_status,
      date_from,
      date_to,
      search,
    } = req.query;

    const where = ["1=1"];
    const params = [];

    if (source) {
      where.push("wo.source = ?");
      params.push(source);
    }
    if (order_status) {
      where.push("wo.order_status = ?");
      params.push(order_status);
    }
    if (payment_status) {
      where.push("wo.payment_status = ?");
      params.push(payment_status);
    }
    if (fulfillment_status) {
      where.push("wo.fulfillment_status = ?");
      params.push(fulfillment_status);
    }
    if (date_from) {
      where.push("date(wo.ordered_at,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(wo.ordered_at,'localtime') <= ?");
      params.push(date_to);
    }
    if (search) {
      where.push(
        "(wo.external_order_number LIKE ? OR wo.external_order_id LIKE ? OR COALESCE(c.name,'') LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    db.all(
      `SELECT wo.*,
            c.name as customer_name,
            o.name as outlet_name,
            COUNT(woi.id) as item_count
     FROM web_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     LEFT JOIN outlets o ON wo.outlet_id = o.id
     LEFT JOIN web_order_items woi ON woi.web_order_id = wo.id
     WHERE ${where.join(" AND ")}
     GROUP BY wo.id
     ORDER BY COALESCE(wo.ordered_at, wo.created_at) DESC`,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ orders: rows || [] });
      },
    );
  });

  // Product-level media list (variant_id NULL records)
  app.get("/api/products/:id/media", (req, res) => {
    const { id } = req.params;
    db.all(
      `SELECT id, product_id, variant_id, url, alt_text, position, created_at
     FROM product_media
     WHERE product_id = ? AND variant_id IS NULL
     ORDER BY position ASC, id ASC`,
      [id],
      (err, rows) => {
        if (err) {
          if (String(err.message || "").includes("no such table")) {
            return res.json({ media: [] });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ media: rows || [] });
      },
    );
  });

  app.post(
    "/api/products/:id/media",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id } = req.params;
      const { url, alt_text = null, position = 0 } = req.body || {};
      if (!url || !String(url).trim()) {
        return res.status(400).json({ error: "url is required" });
      }
      db.run(
        "INSERT INTO product_media (product_id, variant_id, url, alt_text, position) VALUES (?, NULL, ?, ?, ?)",
        [id, String(url).trim(), alt_text, Number(position) || 0],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            id: this.lastID,
            product_id: Number(id),
            url,
            alt_text,
            position: Number(position) || 0,
          });
        },
      );
    },
  );

  app.delete(
    "/api/products/:id/media/:mediaId",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id, mediaId } = req.params;
      db.get(
        "SELECT id, url FROM product_media WHERE id = ? AND product_id = ? AND variant_id IS NULL",
        [mediaId, id],
        (findErr, row) => {
          if (findErr) return res.status(500).json({ error: findErr.message });
          if (!row) return res.status(404).json({ error: "Media not found" });
          db.run(
            "DELETE FROM product_media WHERE id = ?",
            [mediaId],
            (delErr) => {
              if (delErr)
                return res.status(500).json({ error: delErr.message });
              const url = String(row.url || "");
              if (url.startsWith("/uploads/products/")) {
                const filename = path.basename(url);
                const filePath = path.join(PRODUCT_UPLOADS_DIR, filename);
                if (fs.existsSync(filePath)) {
                  try {
                    fs.unlinkSync(filePath);
                  } catch (_) {
                    /* ignore file cleanup errors */
                  }
                }
              }
              res.json({ deleted: true });
            },
          );
        },
      );
    },
  );

  // Upload a product image file and return a served URL
  const productImageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRODUCT_UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)
        ? ext
        : ".jpg";
      cb(
        null,
        `product_${Date.now()}_${Math.round(Math.random() * 1e6)}${safeExt}`,
      );
    },
  });

  const productImageUpload = multer({
    storage: productImageStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (!file || !file.mimetype) return cb(new Error("Invalid file"));
      if (!file.mimetype.startsWith("image/")) {
        return cb(new Error("Only image uploads are allowed"));
      }
      cb(null, true);
    },
  });

  app.post(
    "/api/uploads/product-image",
    requirePerm("manage_inventory"),
    productImageUpload.single("image"),
    (req, res) => {
      if (!req.file)
        return res.status(400).json({ error: "No image uploaded" });
      const relativeUrl = `/uploads/products/${req.file.filename}`;
      res.json({
        url: relativeUrl,
        filename: req.file.filename,
        original_name: req.file.originalname,
        size: req.file.size,
      });
    },
  );

  app.get("/api/orders/:id", requirePerm("manage_orders"), (req, res) => {
    const { id } = req.params;
    db.get(
      `SELECT wo.*, c.name as customer_name, o.name as outlet_name
     FROM web_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     LEFT JOIN outlets o ON wo.outlet_id = o.id
     WHERE wo.id = ?`,
      [id],
      (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: "Order not found" });

        db.all(
          "SELECT * FROM web_order_items WHERE web_order_id = ? ORDER BY id ASC",
          [id],
          (itemErr, items) => {
            if (itemErr)
              return res.status(500).json({ error: itemErr.message });
            db.all(
              "SELECT * FROM web_order_transactions WHERE web_order_id = ? ORDER BY processed_at DESC, id DESC",
              [id],
              (txnErr, transactions) => {
                if (txnErr)
                  return res.status(500).json({ error: txnErr.message });
                db.all(
                  "SELECT * FROM web_order_fulfillments WHERE web_order_id = ? ORDER BY fulfilled_at DESC, id DESC",
                  [id],
                  (fulErr, fulfillments) => {
                    if (fulErr)
                      return res.status(500).json({ error: fulErr.message });
                    res.json({
                      order,
                      items: items || [],
                      transactions: transactions || [],
                      fulfillments: fulfillments || [],
                    });
                  },
                );
              },
            );
          },
        );
      },
    );
  });

  app.post("/api/orders", requirePerm("manage_orders"), (req, res) => {
    const {
      source = "shopify",
      external_order_id,
      external_order_number,
      customer_id,
      outlet_id,
      currency = "PKR",
      subtotal = 0,
      discount_total = 0,
      tax_total = 0,
      shipping_total = 0,
      grand_total = 0,
      payment_status = "pending",
      fulfillment_status = "unfulfilled",
      order_status = "open",
      ordered_at,
      raw_payload = null,
      items = [],
    } = req.body || {};

    if (!external_order_id) {
      return res.status(400).json({ error: "external_order_id is required" });
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        `INSERT INTO web_orders (
          source, external_order_id, external_order_number, customer_id, outlet_id, currency,
          subtotal, discount_total, tax_total, shipping_total, grand_total,
          payment_status, fulfillment_status, order_status, ordered_at, raw_payload
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          source,
          String(external_order_id),
          external_order_number || null,
          customer_id || null,
          outlet_id || null,
          currency,
          parseFloat(subtotal || 0),
          parseFloat(discount_total || 0),
          parseFloat(tax_total || 0),
          parseFloat(shipping_total || 0),
          parseFloat(grand_total || 0),
          payment_status,
          fulfillment_status,
          order_status,
          ordered_at || new Date().toISOString(),
          raw_payload ? JSON.stringify(raw_payload) : null,
        ],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            if (
              String(err.message || "").includes("UNIQUE constraint failed")
            ) {
              return res
                .status(409)
                .json({ error: "Order already exists for this source" });
            }
            return res.status(500).json({ error: err.message });
          }
          const webOrderId = this.lastID;

          if (!items || items.length === 0) {
            return db.run("COMMIT", (commitErr) => {
              if (commitErr)
                return res.status(500).json({ error: commitErr.message });
              applyWebOrderStockPolicy(webOrderId, (policyErr, policy) => {
                return res.json({
                  id: webOrderId,
                  message: "Order created",
                  stock_policy: policyErr
                    ? { error: policyErr.message }
                    : policy || null,
                });
              });
            });
          }

          const stmt = db.prepare(
            `INSERT INTO web_order_items (
            web_order_id, product_id, variant_id, sku, barcode, title, qty,
            unit_price, discount, tax, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const item of items) {
            const qty = parseInt(item.qty || item.quantity || 0);
            const unitPrice = parseFloat(item.unit_price || item.price || 0);
            const discount = parseFloat(item.discount || 0);
            const tax = parseFloat(item.tax || 0);
            const lineTotal =
              item.line_total !== undefined
                ? parseFloat(item.line_total || 0)
                : qty * unitPrice - discount + tax;
            stmt.run([
              webOrderId,
              item.product_id || null,
              item.variant_id || null,
              item.sku || null,
              item.barcode || null,
              item.title || item.name || null,
              qty,
              unitPrice,
              discount,
              tax,
              lineTotal,
            ]);
          }
          stmt.finalize((finErr) => {
            if (finErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: finErr.message });
            }
            db.run("COMMIT", (commitErr) => {
              if (commitErr)
                return res.status(500).json({ error: commitErr.message });
              applyWebOrderStockPolicy(webOrderId, (policyErr, policy) => {
                return res.json({
                  id: webOrderId,
                  message: "Order created",
                  stock_policy: policyErr
                    ? { error: policyErr.message }
                    : policy || null,
                });
              });
            });
          });
        },
      );
    });
  });

  app.put(
    "/api/orders/:id/status",
    requirePerm("manage_orders"),
    (req, res) => {
      const { id } = req.params;
      const { order_status, payment_status, fulfillment_status } =
        req.body || {};
      db.run(
        `UPDATE web_orders
     SET order_status = COALESCE(?, order_status),
         payment_status = COALESCE(?, payment_status),
         fulfillment_status = COALESCE(?, fulfillment_status),
         updated_at = datetime('now','localtime')
     WHERE id = ?`,
        [
          order_status || null,
          payment_status || null,
          fulfillment_status || null,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Order not found" });
          applyWebOrderStockPolicy(id, (policyErr, policy) => {
            res.json({
              message: "Order status updated",
              stock_policy: policyErr
                ? { error: policyErr.message }
                : policy || null,
            });
          });
        },
      );
    },
  );

  app.post(
    "/api/orders/mark-complete",
    requirePerm("manage_orders"),
    (req, res) => {
      const { ids = [], set_paid = false } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids array is required" });
      }

      const normalizedIds = ids
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (normalizedIds.length === 0) {
        return res.status(400).json({ error: "No valid ids provided" });
      }

      const placeholders = normalizedIds.map(() => "?").join(",");
      const sql = set_paid
        ? `UPDATE web_orders
       SET order_status = 'closed',
           fulfillment_status = 'fulfilled',
           payment_status = 'paid',
           updated_at = datetime('now','localtime')
       WHERE id IN (${placeholders})`
        : `UPDATE web_orders
       SET order_status = 'closed',
           fulfillment_status = 'fulfilled',
           updated_at = datetime('now','localtime')
       WHERE id IN (${placeholders})`;

      db.run(sql, normalizedIds, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          message: "Orders marked complete",
          updated: this.changes || 0,
        });
      });
    },
  );

  app.post(
    "/api/orders/bulk-update",
    requirePerm("manage_orders"),
    (req, res) => {
      const {
        ids = [],
        order_status = null,
        payment_status = null,
        fulfillment_status = null,
      } = req.body || {};

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids array is required" });
      }

      const normalizedIds = ids
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (normalizedIds.length === 0) {
        return res.status(400).json({ error: "No valid ids provided" });
      }

      const updates = [];
      const params = [];
      if (order_status != null && String(order_status).trim() !== "") {
        updates.push("order_status = ?");
        params.push(String(order_status).trim());
      }
      if (payment_status != null && String(payment_status).trim() !== "") {
        updates.push("payment_status = ?");
        params.push(String(payment_status).trim());
      }
      if (
        fulfillment_status != null &&
        String(fulfillment_status).trim() !== ""
      ) {
        updates.push("fulfillment_status = ?");
        params.push(String(fulfillment_status).trim());
      }
      if (updates.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one status field is required" });
      }

      updates.push("updated_at = datetime('now','localtime')");
      const placeholders = normalizedIds.map(() => "?").join(",");
      const sql = `UPDATE web_orders SET ${updates.join(", ")} WHERE id IN (${placeholders})`;

      db.run(sql, [...params, ...normalizedIds], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Orders updated", updated: this.changes || 0 });
      });
    },
  );

  app.post(
    "/api/orders/:id/transactions",
    requirePerm("manage_orders"),
    (req, res) => {
      const { id } = req.params;
      const {
        external_txn_id,
        gateway,
        kind,
        status,
        amount = 0,
        processed_at,
        raw_payload,
      } = req.body || {};
      db.run(
        `INSERT INTO web_order_transactions (
      web_order_id, external_txn_id, gateway, kind, status, amount, processed_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          external_txn_id || null,
          gateway || null,
          kind || null,
          status || null,
          parseFloat(amount || 0),
          processed_at || new Date().toISOString(),
          raw_payload ? JSON.stringify(raw_payload) : null,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID, message: "Transaction recorded" });
        },
      );
    },
  );

  app.post(
    "/api/orders/:id/fulfillments",
    requirePerm("manage_orders"),
    (req, res) => {
      const { id } = req.params;
      const {
        external_fulfillment_id,
        status,
        carrier,
        tracking_number,
        tracking_url,
        fulfilled_at,
        raw_payload,
      } = req.body || {};
      db.run(
        `INSERT INTO web_order_fulfillments (
      web_order_id, external_fulfillment_id, status, carrier, tracking_number, tracking_url, fulfilled_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          external_fulfillment_id || null,
          status || null,
          carrier || null,
          tracking_number || null,
          tracking_url || null,
          fulfilled_at || new Date().toISOString(),
          raw_payload ? JSON.stringify(raw_payload) : null,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID, message: "Fulfillment recorded" });
        },
      );
    },
  );

  function maskSecret(secret) {
    let value = String(secret || "");
    try {
      value = decryptShopifySecret(value);
    } catch {
      // keep masked fallback for unreadable encrypted data
    }
    if (!value) return "";
    if (value.length <= 8) return "********";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  function logActionHistory(req, actionType, description, cb = () => {}) {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return cb();
    db.get(
      "SELECT name FROM employees WHERE id = ?",
      [employeeId],
      (err, row) => {
        const userName = err ? "System" : row?.name || "System";
        db.run(
          "INSERT INTO action_history (user_name, action_type, description) VALUES (?, ?, ?)",
          [userName, actionType, description],
          () => cb(),
        );
      },
    );
  }

  function getActiveShopifyConnection(cb) {
    db.get(
      `SELECT *
     FROM shopify_connections
     WHERE is_active = 1
     ORDER BY id DESC
     LIMIT 1`,
      [],
      (err, row) => {
        if (err || !row) return cb(err, row);
        try {
          const hydrated = {
            ...row,
            access_token: decryptShopifySecret(row.access_token),
            webhook_secret: decryptShopifySecret(row.webhook_secret),
          };
          return cb(null, hydrated);
        } catch (e) {
          return cb(e);
        }
      },
    );
  }

  function upsertWebOrderFromShopifyPayload(payload, cb) {
    const source = "shopify";
    const externalOrderId = String(payload?.id || payload?.order_id || "");
    if (!externalOrderId) {
      return cb(new Error("Missing Shopify order id"));
    }
    const externalOrderNumber = payload?.name || payload?.order_number || null;
    const currency = payload?.currency || "PKR";
    const subtotal = parseFloat(payload?.subtotal_price || 0);
    const discountTotal = parseFloat(payload?.total_discounts || 0);
    const taxTotal = parseFloat(payload?.total_tax || 0);
    const shippingTotal = parseFloat(
      payload?.total_shipping_price_set?.shop_money?.amount || 0,
    );
    const grandTotal = parseFloat(payload?.total_price || 0);
    const paymentStatus = payload?.financial_status || "pending";
    const fulfillmentStatus = payload?.fulfillment_status || "unfulfilled";
    const orderedAt = payload?.created_at || new Date().toISOString();
    const rawPayload = JSON.stringify(payload || {});
    const lineItems = Array.isArray(payload?.line_items)
      ? payload.line_items
      : [];

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        `INSERT INTO web_orders (
        source, external_order_id, external_order_number, currency,
        subtotal, discount_total, tax_total, shipping_total, grand_total,
        payment_status, fulfillment_status, order_status, ordered_at, raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      ON CONFLICT(source, external_order_id) DO UPDATE SET
        external_order_number = excluded.external_order_number,
        currency = excluded.currency,
        subtotal = excluded.subtotal,
        discount_total = excluded.discount_total,
        tax_total = excluded.tax_total,
        shipping_total = excluded.shipping_total,
        grand_total = excluded.grand_total,
        payment_status = excluded.payment_status,
        fulfillment_status = excluded.fulfillment_status,
        ordered_at = excluded.ordered_at,
        raw_payload = excluded.raw_payload,
        updated_at = datetime('now','localtime')`,
        [
          source,
          externalOrderId,
          externalOrderNumber,
          currency,
          subtotal,
          discountTotal,
          taxTotal,
          shippingTotal,
          grandTotal,
          paymentStatus,
          fulfillmentStatus,
          orderedAt,
          rawPayload,
        ],
        (err) => {
          if (err) {
            db.run("ROLLBACK");
            return cb(err);
          }
          db.get(
            "SELECT id FROM web_orders WHERE source = ? AND external_order_id = ?",
            [source, externalOrderId],
            (getErr, row) => {
              if (getErr || !row) {
                db.run("ROLLBACK");
                return cb(getErr || new Error("Failed to resolve web order"));
              }
              const webOrderId = row.id;
              db.run(
                "DELETE FROM web_order_items WHERE web_order_id = ?",
                [webOrderId],
                (delErr) => {
                  if (delErr) {
                    db.run("ROLLBACK");
                    return cb(delErr);
                  }
                  if (lineItems.length === 0) {
                    return db.run("COMMIT", (commitErr) => {
                      if (commitErr) return cb(commitErr);
                      return applyWebOrderStockPolicy(
                        webOrderId,
                        (policyErr, policy) => {
                          return cb(null, {
                            web_order_id: webOrderId,
                            item_count: 0,
                            stock_policy: policyErr
                              ? { error: policyErr.message }
                              : policy || null,
                          });
                        },
                      );
                    });
                  }
                  const stmt = db.prepare(
                    `INSERT INTO web_order_items (
                  web_order_id, sku, barcode, title, qty, unit_price, discount, tax, line_total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  );
                  for (const item of lineItems) {
                    const qty = parseInt(item.quantity || 0, 10);
                    const unitPrice = parseFloat(item.price || 0);
                    const discount = parseFloat(item.total_discount || 0);
                    const tax = parseFloat(item.total_tax || 0);
                    const lineTotal = qty * unitPrice - discount + tax;
                    stmt.run([
                      webOrderId,
                      item.sku || null,
                      item.barcode || null,
                      item.title || null,
                      qty,
                      unitPrice,
                      discount,
                      tax,
                      lineTotal,
                    ]);
                  }
                  stmt.finalize((finErr) => {
                    if (finErr) {
                      db.run("ROLLBACK");
                      return cb(finErr);
                    }
                    db.run("COMMIT", (commitErr) => {
                      if (commitErr) return cb(commitErr);
                      return applyWebOrderStockPolicy(
                        webOrderId,
                        (policyErr, policy) => {
                          return cb(null, {
                            web_order_id: webOrderId,
                            item_count: lineItems.length,
                            stock_policy: policyErr
                              ? { error: policyErr.message }
                              : policy || null,
                          });
                        },
                      );
                    });
                  });
                },
              );
            },
          );
        },
      );
    });
  }

  function shouldApplyWebOrderStock(order) {
    const payment = String(order?.payment_status || "").toLowerCase();
    const orderStatus = String(order?.order_status || "").toLowerCase();
    const paidStates = ["paid", "partially_paid", "authorized"];
    const blockedStates = ["cancelled", "canceled"];
    return paidStates.includes(payment) && !blockedStates.includes(orderStatus);
  }

  function shouldReverseWebOrderStock(order) {
    const payment = String(order?.payment_status || "").toLowerCase();
    const orderStatus = String(order?.order_status || "").toLowerCase();
    const reversalPayments = [
      "refunded",
      "partially_refunded",
      "voided",
      "failed",
    ];
    const reversalStatuses = ["cancelled", "canceled"];
    return (
      reversalPayments.includes(payment) ||
      reversalStatuses.includes(orderStatus)
    );
  }

  function resolveWebOrderOutletId(order, cb) {
    if (order?.outlet_id) return cb(null, Number(order.outlet_id));
    getActiveShopifyConnection((connErr, conn) => {
      if (connErr) return cb(connErr);
      if (!conn?.default_location_id) {
        return cb(
          new Error(
            "Order has no outlet_id and no default Shopify location is configured",
          ),
        );
      }
      db.get(
        "SELECT outlet_id FROM shopify_location_map WHERE shopify_location_id = ? LIMIT 1",
        [String(conn.default_location_id)],
        (mapErr, row) => {
          if (mapErr) return cb(mapErr);
          if (!row?.outlet_id) {
            return cb(
              new Error("No outlet mapping found for default Shopify location"),
            );
          }
          return cb(null, Number(row.outlet_id));
        },
      );
    });
  }

  function resolveWebOrderItemMapping(item, cb) {
    const directProduct = item?.product_id ? Number(item.product_id) : null;
    const directVariant = item?.variant_id ? Number(item.variant_id) : null;
    if (directProduct) {
      return cb(null, { product_id: directProduct, variant_id: directVariant });
    }

    const sku = String(item?.sku || "").trim();
    const barcode = String(item?.barcode || "").trim();

    const done = (result) => cb(null, result);

    const byVariantSku = () => {
      if (!sku) return byVariantBarcode();
      db.get(
        "SELECT id as variant_id, product_id FROM product_variants WHERE sku = ? LIMIT 1",
        [sku],
        (err, row) => {
          if (err) return cb(err);
          if (row?.product_id)
            return done({
              product_id: Number(row.product_id),
              variant_id: Number(row.variant_id),
            });
          return byVariantBarcode();
        },
      );
    };

    const byVariantBarcode = () => {
      if (!barcode) return byProductBarcode();
      db.get(
        "SELECT id as variant_id, product_id FROM product_variants WHERE barcode = ? LIMIT 1",
        [barcode],
        (err, row) => {
          if (err) return cb(err);
          if (row?.product_id)
            return done({
              product_id: Number(row.product_id),
              variant_id: Number(row.variant_id),
            });
          return byProductBarcode();
        },
      );
    };

    const byProductBarcode = () => {
      if (!barcode) return done(null);
      db.get(
        "SELECT id as product_id FROM products WHERE barcode = ? LIMIT 1",
        [barcode],
        (err, row) => {
          if (err) return cb(err);
          if (row?.product_id)
            return done({
              product_id: Number(row.product_id),
              variant_id: null,
            });
          return done(null);
        },
      );
    };

    byVariantSku();
  }

  function applyWebOrderStockPolicy(webOrderId, cb = () => {}) {
    db.get(
      "SELECT * FROM web_orders WHERE id = ?",
      [webOrderId],
      (orderErr, order) => {
        if (orderErr) return cb(orderErr);
        if (!order) return cb(new Error("Web order not found"));

        const applied = Number(order.stock_applied || 0) === 1;
        const shouldApply = shouldApplyWebOrderStock(order);
        const shouldReverse = shouldReverseWebOrderStock(order);

        if (shouldApply && applied)
          return cb(null, { action: "noop_already_applied" });
        if (shouldReverse && !applied)
          return cb(null, { action: "noop_already_reversed" });
        if (!shouldApply && !shouldReverse)
          return cb(null, { action: "noop_state_not_actionable" });

        const direction = shouldApply ? -1 : 1;
        const nextAppliedState = shouldApply ? 1 : 0;
        const actionLabel = shouldApply ? "apply" : "reverse";

        resolveWebOrderOutletId(order, (outletErr, resolvedOutletId) => {
          if (outletErr) {
            db.run(
              "UPDATE web_orders SET stock_policy_note = ? WHERE id = ?",
              [
                String(outletErr.message || "Failed resolving outlet"),
                webOrderId,
              ],
              () => cb(outletErr),
            );
            return;
          }

          db.all(
            "SELECT * FROM web_order_items WHERE web_order_id = ? ORDER BY id ASC",
            [webOrderId],
            (itemsErr, items) => {
              if (itemsErr) return cb(itemsErr);
              if (!items || items.length === 0)
                return cb(null, { action: "noop_no_items" });

              const resolved = [];
              const unresolved = [];
              let idx = 0;

              const resolveNext = () => {
                if (idx >= items.length) {
                  if (unresolved.length > 0) {
                    const note = `Unmapped items (${unresolved.length}) - stock policy not applied`;
                    return db.run(
                      "UPDATE web_orders SET stock_policy_note = ? WHERE id = ?",
                      [note, webOrderId],
                      () => cb(new Error(note)),
                    );
                  }

                  db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    const stockStmt = db.prepare(
                      `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                   VALUES (?, ?, ?)
                   ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
                    );
                    for (const r of resolved) {
                      const delta = direction * Number(r.qty || 0);
                      stockStmt.run([
                        r.product_id,
                        resolvedOutletId,
                        delta,
                        delta,
                      ]);
                    }
                    stockStmt.finalize((finErr) => {
                      if (finErr) {
                        db.run("ROLLBACK");
                        return cb(finErr);
                      }
                      db.run(
                        `UPDATE web_orders
                     SET stock_applied = ?,
                         stock_applied_at = datetime('now','localtime'),
                         stock_policy_note = ?,
                         outlet_id = COALESCE(outlet_id, ?),
                         updated_at = datetime('now','localtime')
                     WHERE id = ?`,
                        [
                          nextAppliedState,
                          `Stock policy ${actionLabel}d`,
                          resolvedOutletId,
                          webOrderId,
                        ],
                        (updErr) => {
                          if (updErr) {
                            db.run("ROLLBACK");
                            return cb(updErr);
                          }
                          db.run("COMMIT", (commitErr) => {
                            if (commitErr) return cb(commitErr);
                            return cb(null, {
                              action: actionLabel,
                              outlet_id: resolvedOutletId,
                              item_count: resolved.length,
                            });
                          });
                        },
                      );
                    });
                  });
                  return;
                }

                const current = items[idx];
                idx += 1;
                resolveWebOrderItemMapping(current, (mapErr, mapped) => {
                  if (mapErr) return cb(mapErr);
                  if (!mapped?.product_id) {
                    unresolved.push(current.id);
                    return resolveNext();
                  }
                  db.run(
                    "UPDATE web_order_items SET product_id = COALESCE(product_id, ?), variant_id = COALESCE(variant_id, ?) WHERE id = ?",
                    [mapped.product_id, mapped.variant_id || null, current.id],
                    () => {
                      resolved.push({
                        item_id: current.id,
                        product_id: mapped.product_id,
                        variant_id: mapped.variant_id || null,
                        qty: Number(current.qty || 0),
                      });
                      resolveNext();
                    },
                  );
                });
              };

              resolveNext();
            },
          );
        });
      },
    );
  }

  function enqueueInventorySyncEvents(changes, context = {}, cb = () => {}) {
    const normalized = (changes || [])
      .map((c) => ({
        product_id: c.product_id ? Number(c.product_id) : null,
        variant_id: c.variant_id ? Number(c.variant_id) : null,
        outlet_id: c.outlet_id ? Number(c.outlet_id) : null,
        delta: Number(c.delta || 0),
        reason: c.reason || context.reason || "correction",
        reference_type: c.reference_type || context.reference_type || null,
        reference_id: c.reference_id || context.reference_id || null,
      }))
      .filter((c) => c.product_id && c.outlet_id && c.delta !== 0);

    if (normalized.length === 0) return cb(null, { queued: 0, skipped: 0 });

    getActiveShopifyConnection((connErr, conn) => {
      if (connErr) return cb(connErr);
      if (!conn)
        return cb(null, {
          queued: 0,
          skipped: normalized.length,
          reason: "no_connection",
        });

      let idx = 0;
      let queued = 0;
      let skipped = 0;

      const step = () => {
        if (idx >= normalized.length) return cb(null, { queued, skipped });
        const item = normalized[idx];
        idx += 1;

        db.get(
          `SELECT shopify_location_id
         FROM shopify_location_map
         WHERE outlet_id = ?`,
          [item.outlet_id],
          (locErr, loc) => {
            if (locErr) return cb(locErr);
            db.get(
              `SELECT shopify_inventory_item_id, product_id, variant_id
             FROM shopify_product_map
             WHERE is_active = 1
               AND (
                 (variant_id IS NOT NULL AND variant_id = ?)
                 OR (variant_id IS NULL AND product_id = ?)
               )
             ORDER BY CASE WHEN variant_id IS NOT NULL THEN 0 ELSE 1 END, id DESC
             LIMIT 1`,
              [item.variant_id || -1, item.product_id],
              (mapErr, map) => {
                if (mapErr) return cb(mapErr);

                const idempotencyKey = [
                  "outbound_inventory",
                  item.reason || "correction",
                  item.reference_type || "none",
                  item.reference_id || "none",
                  item.product_id,
                  item.variant_id || 0,
                  item.outlet_id,
                ].join("_");

                if (
                  !loc?.shopify_location_id ||
                  !map?.shopify_inventory_item_id
                ) {
                  db.run(
                    `INSERT OR IGNORE INTO external_sync_events (
                    direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at, attempt_count
                  ) VALUES ('outbound', 'inventory', ?, 'failed_mapping', ?, ?, datetime('now','localtime'), datetime('now','localtime'), 0)`,
                    [
                      idempotencyKey,
                      "Missing Shopify product/location mapping",
                      JSON.stringify({
                        product_id: item.product_id,
                        variant_id: item.variant_id,
                        outlet_id: item.outlet_id,
                        delta: item.delta,
                      }),
                    ],
                    () => {
                      skipped += 1;
                      step();
                    },
                  );
                  return;
                }

                const payload = JSON.stringify({
                  product_id: item.product_id,
                  variant_id: item.variant_id,
                  outlet_id: item.outlet_id,
                  delta: item.delta,
                  reason: item.reason,
                  reference_type: item.reference_type,
                  reference_id: item.reference_id,
                  shopify_inventory_item_id: map.shopify_inventory_item_id,
                  shopify_location_id: loc.shopify_location_id,
                });

                db.run(
                  `INSERT OR IGNORE INTO external_sync_events (
                  direction, entity_type, idempotency_key, status, payload, created_at, attempt_count, next_retry_at
                ) VALUES ('outbound', 'inventory', ?, 'pending', ?, datetime('now','localtime'), 0, datetime('now','localtime'))`,
                  [idempotencyKey, payload],
                  function () {
                    if (this?.changes > 0) queued += 1;
                    else skipped += 1;
                    step();
                  },
                );
              },
            );
          },
        );
      };

      step();
    });
  }

  function normalizeShopifyInventoryReason(rawReason) {
    const reason = String(rawReason || "")
      .trim()
      .toLowerCase();
    const valid = new Set([
      "correction",
      "cycle_count_available",
      "damaged",
      "movement_canceled",
      "movement_created",
      "movement_received",
      "movement_updated",
      "other",
      "promotion",
      "quality_control",
      "received",
      "reservation_created",
      "reservation_deleted",
      "reservation_updated",
      "restock",
      "safety_stock",
      "shrinkage",
    ]);
    if (valid.has(reason)) return reason;

    const map = {
      sale: "shrinkage",
      void: "restock",
      return: "restock",
      supplier_return: "movement_updated",
      transfer_out: "movement_updated",
      transfer_in: "movement_updated",
      adjustment: "correction",
      po_receive: "received",
      manual_sync: "correction",
    };
    return map[reason] || "correction";
  }

  function processPendingShopifyInventoryEvents(limit = 25, cb = () => {}) {
    getActiveShopifyConnection((connErr, conn) => {
      if (connErr) return cb(connErr);
      if (!conn)
        return cb(null, {
          processed: 0,
          failed: 0,
          skipped: 0,
          reason: "no_connection",
        });

      db.all(
        `SELECT id, payload, attempt_count
       FROM external_sync_events
       WHERE direction = 'outbound'
         AND entity_type = 'inventory'
         AND status IN ('pending', 'retry')
         AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now','localtime'))
       ORDER BY id ASC
       LIMIT ?`,
        [limit],
        async (listErr, rows) => {
          if (listErr) return cb(listErr);
          let processed = 0;
          let failed = 0;
          let skipped = 0;

          for (const row of rows || []) {
            let parsed;
            try {
              parsed = JSON.parse(row.payload || "{}");
            } catch {
              parsed = {};
            }
            const delta = Number(parsed.delta || 0);
            const inventoryItemId = parsed.shopify_inventory_item_id || null;
            const locationId = parsed.shopify_location_id || null;
            if (!inventoryItemId || !locationId || delta === 0) {
              skipped += 1;
              logShopifyEvent("warn", "outbound_payload_invalid", {
                event_id: row.id,
                inventory_item_id: inventoryItemId,
                location_id: locationId,
                delta,
              });
              await new Promise((resolve) => {
                db.run(
                  `UPDATE external_sync_events
                 SET status = 'dead_letter',
                     error_message = ?,
                     last_attempt_at = datetime('now','localtime'),
                     processed_at = datetime('now','localtime')
                 WHERE id = ?`,
                  ["Invalid payload for Shopify inventory sync", row.id],
                  () => resolve(),
                );
              });
              continue;
            }

            try {
              const shopifyReason = normalizeShopifyInventoryReason(
                parsed.reason,
              );
              const result = await adjustShopifyInventory(
                conn,
                [
                  {
                    inventory_item_id: inventoryItemId,
                    location_id: locationId,
                    delta,
                  },
                ],
                shopifyReason,
              );
              if ((result.userErrors || []).length > 0) {
                failed += 1;
                const msg = result.userErrors.map((e) => e.message).join("; ");
                logShopifyEvent("warn", "outbound_user_error", {
                  event_id: row.id,
                  attempt: Number(row.attempt_count || 0) + 1,
                  error: msg || "Shopify user error",
                });
                const nextAttempt = Number(row.attempt_count || 0) + 1;
                const terminal = nextAttempt >= SHOPIFY_MAX_RETRY_ATTEMPTS;
                const delayMins = retryDelayMinutesWithJitter(nextAttempt);
                await new Promise((resolve) => {
                  db.run(
                    `UPDATE external_sync_events
                   SET status = ?,
                       error_message = ?,
                       attempt_count = ?,
                       last_attempt_at = datetime('now','localtime'),
                       next_retry_at = CASE
                         WHEN ? = 1 THEN NULL
                         ELSE datetime('now','localtime', '+' || ? || ' minutes')
                       END,
                       processed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
                   WHERE id = ?`,
                    [
                      terminal ? "dead_letter" : "retry",
                      msg || "Shopify user error",
                      nextAttempt,
                      terminal ? 1 : 0,
                      delayMins,
                      terminal ? 1 : 0,
                      row.id,
                    ],
                    () => resolve(),
                  );
                });
              } else {
                processed += 1;
                await new Promise((resolve) => {
                  db.run(
                    `UPDATE external_sync_events
                   SET status = 'processed',
                       error_message = NULL,
                       attempt_count = COALESCE(attempt_count, 0) + 1,
                       last_attempt_at = datetime('now','localtime'),
                       next_retry_at = NULL,
                       processed_at = datetime('now','localtime')
                   WHERE id = ?`,
                    [row.id],
                    () => resolve(),
                  );
                });
              }
            } catch (err) {
              failed += 1;
              logShopifyEvent("error", "outbound_sync_exception", {
                event_id: row.id,
                attempt: Number(row.attempt_count || 0) + 1,
                error: String(err?.message || "Shopify sync failed"),
              });
              const nextAttempt = Number(row.attempt_count || 0) + 1;
              const terminal = nextAttempt >= SHOPIFY_MAX_RETRY_ATTEMPTS;
              const delayMins = retryDelayMinutesWithJitter(nextAttempt);
              await new Promise((resolve) => {
                db.run(
                  `UPDATE external_sync_events
                 SET status = ?,
                     error_message = ?,
                     attempt_count = ?,
                     last_attempt_at = datetime('now','localtime'),
                     next_retry_at = CASE
                       WHEN ? = 1 THEN NULL
                       ELSE datetime('now','localtime', '+' || ? || ' minutes')
                     END,
                     processed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
                 WHERE id = ?`,
                  [
                    terminal ? "dead_letter" : "retry",
                    String(err?.message || "Shopify sync failed"),
                    nextAttempt,
                    terminal ? 1 : 0,
                    delayMins,
                    terminal ? 1 : 0,
                    row.id,
                  ],
                  () => resolve(),
                );
              });
            }
          }

          db.run(
            `UPDATE shopify_connections
           SET last_sync_at = datetime('now','localtime'),
               last_error = ?,
               updated_at = datetime('now','localtime')
           WHERE id = ?`,
            [failed > 0 ? `${failed} event(s) failed` : null, conn.id],
            () => cb(null, { processed, failed, skipped }),
          );
        },
      );
    });
  }

  return { processPendingShopifyInventoryEvents };
};
