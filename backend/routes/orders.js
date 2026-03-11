const { toUtcStart, toUtcEnd } = require("../utils/tz");

module.exports = function registerOrderRoutes(app, deps) {
  const {
    db, requirePerm, requireAnyPerm, createNotification, notifyLowStockForSale,
    path, fs, UPLOADS_DIR, runtimeState,
    verifyConnection, fetchShopifyLocations, adjustShopifyInventory,
    fetchShopifyVariantCatalog, fetchShopifyProductsFull,
    fetchInventoryLevel, fetchInventoryLevelsBatch, fetchRecentOrders,
    retryDelayMinutesWithJitter, evaluateWebhookTimestampWindow,
    isRetryableInventoryEventStatus, buildWebhookIdempotencyKey,
    logShopifyEvent, DB_PATH, multer,
    SHOPIFY_MAX_RETRY_ATTEMPTS, decryptShopifySecret
  } = deps;

// --- ROUTES: ORDERS (Website order staging before live Shopify integration) ---

  app.get("/api/orders", requirePerm("manage_orders"), async (req, res) => {
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
    let paramIdx = 1;

    if (source) {
      where.push(`wo.source = $${paramIdx++}`);
      params.push(source);
    }
    if (order_status) {
      where.push(`wo.order_status = $${paramIdx++}`);
      params.push(order_status);
    }
    if (payment_status) {
      where.push(`wo.payment_status = $${paramIdx++}`);
      params.push(payment_status);
    }
    if (fulfillment_status) {
      where.push(`wo.fulfillment_status = $${paramIdx++}`);
      params.push(fulfillment_status);
    }
    const tz = req.company?.timezone || "UTC";
    if (date_from) {
      where.push(`wo.ordered_at >= $${paramIdx++}`);
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push(`wo.ordered_at < $${paramIdx++}`);
      params.push(toUtcEnd(date_to, tz));
    }
    if (search) {
      where.push(
        `(wo.external_order_number ILIKE $${paramIdx} OR wo.external_order_id ILIKE $${paramIdx + 1} OR COALESCE(c.name,'') ILIKE $${paramIdx + 2})`,
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIdx += 3;
    }

    try {
      const { rows } = await db.query(
        `SELECT wo.*,
              c.name as customer_name,
              o.name as outlet_name,
              COUNT(woi.id) as item_count
       FROM web_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       LEFT JOIN outlets o ON wo.outlet_id = o.id
       LEFT JOIN web_order_items woi ON woi.web_order_id = wo.id
       WHERE ${where.join(" AND ")}
       GROUP BY wo.id, c.name, o.name
       ORDER BY COALESCE(wo.ordered_at, wo.created_at) DESC`,
        params,
      );
      res.json({ orders: rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Product-level media list (variant_id NULL records)
  app.get("/api/products/:id/media", async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT id, product_id, variant_id, url, alt_text, position, created_at
       FROM product_media
       WHERE product_id = $1 AND variant_id IS NULL
       ORDER BY position ASC, id ASC`,
        [id],
      );
      res.json({ media: rows || [] });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        return res.json({ media: [] });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/products/:id/media",
    requirePerm("manage_inventory"),
    async (req, res) => {
      const { id } = req.params;
      const { url, alt_text = null, position = 0 } = req.body || {};
      if (!url || !String(url).trim()) {
        return res.status(400).json({ error: "url is required" });
      }
      try {
        const { rows } = await db.query(
          "INSERT INTO product_media (product_id, variant_id, url, alt_text, position) VALUES ($1, NULL, $2, $3, $4) RETURNING id",
          [id, String(url).trim(), alt_text, Number(position) || 0],
        );
        res.json({
          id: rows[0].id,
          product_id: Number(id),
          url,
          alt_text,
          position: Number(position) || 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.delete(
    "/api/products/:id/media/:mediaId",
    requirePerm("manage_inventory"),
    async (req, res) => {
      const { id, mediaId } = req.params;
      try {
        const { rows: [row] } = await db.query(
          "SELECT id, url FROM product_media WHERE id = $1 AND product_id = $2 AND variant_id IS NULL",
          [mediaId, id],
        );
        if (!row) return res.status(404).json({ error: "Media not found" });

        await db.query("DELETE FROM product_media WHERE id = $1", [mediaId]);

        const url = String(row.url || "");
        if (url.startsWith("/uploads/products/")) {
          const filename = path.basename(url);
          // In multi-tenant mode, resolve from tenant's uploads directory
          const uploadsDir = req.tenantDir
            ? path.join(req.tenantDir, "uploads", "products")
            : deps.PRODUCT_UPLOADS_DIR;
          const filePath = path.join(uploadsDir, filename);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (_) {
              /* ignore file cleanup errors */
            }
          }
        }
        res.json({ deleted: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Upload a product image file to R2 — resized to 800x800 WebP before upload
  const { uploadToR2 } = require("../utils/r2");
  const sharp = require("sharp");

  const productImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB raw upload limit
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
    async (req, res) => {
      if (!req.file)
        return res.status(400).json({ error: "No image uploaded" });
      try {
        // Resize to max 800x800, convert to WebP (~50-150KB output)
        const resized = await sharp(req.file.buffer)
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        const filename = `product_${Date.now()}_${Math.round(Math.random() * 1e6)}.webp`;
        const key = `products/${filename}`;
        const url = await uploadToR2(resized, key, "image/webp");
        res.json({ url, filename, original_name: req.file.originalname, size: resized.length });
      } catch (err) {
        res.status(500).json({ error: "Upload failed: " + err.message });
      }
    },
  );

  app.get("/api/orders/:id", requirePerm("manage_orders"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: [order] } = await db.query(
        `SELECT wo.*, c.name as customer_name, o.name as outlet_name
       FROM web_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       LEFT JOIN outlets o ON wo.outlet_id = o.id
       WHERE wo.id = $1`,
        [id],
      );
      if (!order) return res.status(404).json({ error: "Order not found" });

      const { rows: items } = await db.query(
        "SELECT * FROM web_order_items WHERE web_order_id = $1 ORDER BY id ASC",
        [id],
      );
      const { rows: transactions } = await db.query(
        "SELECT * FROM web_order_transactions WHERE web_order_id = $1 ORDER BY processed_at DESC, id DESC",
        [id],
      );
      const { rows: fulfillments } = await db.query(
        "SELECT * FROM web_order_fulfillments WHERE web_order_id = $1 ORDER BY fulfilled_at DESC, id DESC",
        [id],
      );
      res.json({
        order,
        items: items || [],
        transactions: transactions || [],
        fulfillments: fulfillments || [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/orders", requirePerm("manage_orders"), async (req, res) => {
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

    try {
      const webOrderId = await db.transaction(async (client) => {
        let insertResult;
        try {
          insertResult = await client.query(
            `INSERT INTO web_orders (
              source, external_order_id, external_order_number, customer_id, outlet_id, currency,
              subtotal, discount_total, tax_total, shipping_total, grand_total,
              payment_status, fulfillment_status, order_status, ordered_at, raw_payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
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
          );
        } catch (insertErr) {
          if (String(insertErr.message || "").includes("unique") || String(insertErr.code || "") === "23505") {
            const err = new Error("Order already exists for this source");
            err.statusCode = 409;
            throw err;
          }
          throw insertErr;
        }

        const orderId = insertResult.rows[0].id;

        if (items && items.length > 0) {
          for (const item of items) {
            const qty = parseInt(item.qty || item.quantity || 0);
            const unitPrice = parseFloat(item.unit_price || item.price || 0);
            const discount = parseFloat(item.discount || 0);
            const tax = parseFloat(item.tax || 0);
            const lineTotal =
              item.line_total !== undefined
                ? parseFloat(item.line_total || 0)
                : qty * unitPrice - discount + tax;
            await client.query(
              `INSERT INTO web_order_items (
                web_order_id, product_id, variant_id, sku, barcode, title, qty,
                unit_price, discount, tax, line_total
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                orderId,
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
              ],
            );
          }
        }

        return orderId;
      });

      const policy = await applyWebOrderStockPolicyAsync(webOrderId);
      res.json({
        id: webOrderId,
        message: "Order created",
        stock_policy: policy || null,
      });
    } catch (err) {
      if (err.statusCode === 409) {
        return res.status(409).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.put(
    "/api/orders/:id/status",
    requirePerm("manage_orders"),
    async (req, res) => {
      const { id } = req.params;
      const { order_status, payment_status, fulfillment_status } =
        req.body || {};
      try {
        const { rowCount } = await db.query(
          `UPDATE web_orders
       SET order_status = COALESCE($1, order_status),
           payment_status = COALESCE($2, payment_status),
           fulfillment_status = COALESCE($3, fulfillment_status),
           updated_at = NOW()
       WHERE id = $4`,
          [
            order_status || null,
            payment_status || null,
            fulfillment_status || null,
            id,
          ],
        );
        if (rowCount === 0)
          return res.status(404).json({ error: "Order not found" });
        const policy = await applyWebOrderStockPolicyAsync(id);
        res.json({
          message: "Order status updated",
          stock_policy: policy || null,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/orders/mark-complete",
    requirePerm("manage_orders"),
    async (req, res) => {
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

      const placeholders = normalizedIds.map((_, i) => `$${i + 1}`).join(",");
      const sql = set_paid
        ? `UPDATE web_orders
       SET order_status = 'closed',
           fulfillment_status = 'fulfilled',
           payment_status = 'paid',
           updated_at = NOW()
       WHERE id IN (${placeholders})`
        : `UPDATE web_orders
       SET order_status = 'closed',
           fulfillment_status = 'fulfilled',
           updated_at = NOW()
       WHERE id IN (${placeholders})`;

      try {
        const { rowCount } = await db.query(sql, normalizedIds);
        res.json({
          message: "Orders marked complete",
          updated: rowCount || 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/orders/bulk-update",
    requirePerm("manage_orders"),
    async (req, res) => {
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
      let paramIdx = 1;
      if (order_status != null && String(order_status).trim() !== "") {
        updates.push(`order_status = $${paramIdx++}`);
        params.push(String(order_status).trim());
      }
      if (payment_status != null && String(payment_status).trim() !== "") {
        updates.push(`payment_status = $${paramIdx++}`);
        params.push(String(payment_status).trim());
      }
      if (
        fulfillment_status != null &&
        String(fulfillment_status).trim() !== ""
      ) {
        updates.push(`fulfillment_status = $${paramIdx++}`);
        params.push(String(fulfillment_status).trim());
      }
      if (updates.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one status field is required" });
      }

      updates.push("updated_at = NOW()");
      const placeholders = normalizedIds.map((_, i) => `$${paramIdx + i}`).join(",");
      params.push(...normalizedIds);
      const sql = `UPDATE web_orders SET ${updates.join(", ")} WHERE id IN (${placeholders})`;

      try {
        const { rowCount } = await db.query(sql, params);
        res.json({ message: "Orders updated", updated: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/orders/:id/transactions",
    requirePerm("manage_orders"),
    async (req, res) => {
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
      try {
        const { rows } = await db.query(
          `INSERT INTO web_order_transactions (
        web_order_id, external_txn_id, gateway, kind, status, amount, processed_at, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
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
        );
        res.json({ id: rows[0].id, message: "Transaction recorded" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/orders/:id/fulfillments",
    requirePerm("manage_orders"),
    async (req, res) => {
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
      try {
        const { rows } = await db.query(
          `INSERT INTO web_order_fulfillments (
        web_order_id, external_fulfillment_id, status, carrier, tracking_number, tracking_url, fulfilled_at, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
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
        );
        res.json({ id: rows[0].id, message: "Fulfillment recorded" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
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

  async function logActionHistory(req, actionType, description) {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return;
    try {
      const { rows: [row] } = await db.query(
        "SELECT name FROM employees WHERE id = $1",
        [employeeId],
      );
      const userName = row?.name || "System";
      await db.query(
        "INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3)",
        [userName, actionType, description],
      );
    } catch {
      // ignore action history errors
    }
  }

  async function getActiveShopifyConnection(cb) {
    try {
      const { rows: [row] } = await db.query(
        `SELECT *
       FROM shopify_connections
       WHERE is_active = true
       ORDER BY id DESC
       LIMIT 1`,
        [],
      );
      const result = row
        ? { ...row, access_token: decryptShopifySecret(row.access_token), webhook_secret: decryptShopifySecret(row.webhook_secret) }
        : null;
      if (typeof cb === "function") return cb(null, result);
      return result;
    } catch (err) {
      if (typeof cb === "function") return cb(err);
      throw err;
    }
  }

  const { upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy } = require('../shopify/order-service')(db, getActiveShopifyConnection);

  // Promisified wrapper for the callback-based applyWebOrderStockPolicy
  // Note: order-service.js still uses SQLite callbacks (db.get/db.run).
  // Until it's converted to Postgres, this wrapper catches TypeError gracefully.
  function applyWebOrderStockPolicyAsync(webOrderId) {
    return new Promise((resolve) => {
      try {
        applyWebOrderStockPolicy(webOrderId, (policyErr, policy) => {
          if (policyErr) {
            resolve({ error: policyErr.message });
          } else {
            resolve(policy || null);
          }
        });
      } catch (err) {
        resolve({ error: err.message });
      }
    });
  }

  async function enqueueInventorySyncEvents(changes, context = {}) {
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

    if (normalized.length === 0) return { queued: 0, skipped: 0 };

    const conn = await getActiveShopifyConnection();
    if (!conn)
      return {
        queued: 0,
        skipped: normalized.length,
        reason: "no_connection",
      };

    let queued = 0;
    let skipped = 0;

    for (const item of normalized) {
      const { rows: [loc] } = await db.query(
        `SELECT shopify_location_id
       FROM shopify_location_map
       WHERE outlet_id = $1`,
        [item.outlet_id],
      );

      const { rows: [map] } = await db.query(
        `SELECT shopify_inventory_item_id, product_id, variant_id
       FROM shopify_product_map
       WHERE is_active = true
         AND (
           (variant_id IS NOT NULL AND variant_id = $1)
           OR (variant_id IS NULL AND product_id = $2)
         )
       ORDER BY CASE WHEN variant_id IS NOT NULL THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
        [item.variant_id || -1, item.product_id],
      );

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
        await db.query(
          `INSERT INTO external_sync_events (
            direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at, attempt_count
          ) VALUES ('outbound', 'inventory', $1, 'failed_mapping', $2, $3, NOW(), NOW(), 0)
          ON CONFLICT DO NOTHING`,
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
        );
        skipped += 1;
        continue;
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

      const { rowCount } = await db.query(
        `INSERT INTO external_sync_events (
          direction, entity_type, idempotency_key, status, payload, created_at, attempt_count, next_retry_at
        ) VALUES ('outbound', 'inventory', $1, 'pending', $2, NOW(), 0, NOW())
        ON CONFLICT DO NOTHING`,
        [idempotencyKey, payload],
      );
      if (rowCount > 0) queued += 1;
      else skipped += 1;
    }

    return { queued, skipped };
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

  async function processPendingShopifyInventoryEvents(limit = 25) {
    const conn = await getActiveShopifyConnection();
    if (!conn)
      return {
        processed: 0,
        failed: 0,
        skipped: 0,
        reason: "no_connection",
      };

    const { rows } = await db.query(
      `SELECT id, payload, attempt_count
     FROM external_sync_events
     WHERE direction = 'outbound'
       AND entity_type = 'inventory'
       AND status IN ('pending', 'retry')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY id ASC
     LIMIT $1`,
      [limit],
    );

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
        await db.query(
          `UPDATE external_sync_events
         SET status = 'dead_letter',
             error_message = $1,
             last_attempt_at = NOW(),
             processed_at = NOW()
         WHERE id = $2`,
          ["Invalid payload for Shopify inventory sync", row.id],
        );
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
          await db.query(
            `UPDATE external_sync_events
           SET status = $1,
               error_message = $2,
               attempt_count = $3,
               last_attempt_at = NOW(),
               next_retry_at = CASE
                 WHEN $4::boolean THEN NULL
                 ELSE NOW() + ($5 || ' minutes')::interval
               END,
               processed_at = CASE WHEN $4::boolean THEN NOW() ELSE NULL END
           WHERE id = $6`,
            [
              terminal ? "dead_letter" : "retry",
              msg || "Shopify user error",
              nextAttempt,
              terminal,
              delayMins,
              row.id,
            ],
          );
        } else {
          processed += 1;
          await db.query(
            `UPDATE external_sync_events
           SET status = 'processed',
               error_message = NULL,
               attempt_count = COALESCE(attempt_count, 0) + 1,
               last_attempt_at = NOW(),
               next_retry_at = NULL,
               processed_at = NOW()
           WHERE id = $1`,
            [row.id],
          );
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
        await db.query(
          `UPDATE external_sync_events
         SET status = $1,
             error_message = $2,
             attempt_count = $3,
             last_attempt_at = NOW(),
             next_retry_at = CASE
               WHEN $4::boolean THEN NULL
               ELSE NOW() + ($5 || ' minutes')::interval
             END,
             processed_at = CASE WHEN $4::boolean THEN NOW() ELSE NULL END
         WHERE id = $6`,
          [
            terminal ? "dead_letter" : "retry",
            String(err?.message || "Shopify sync failed"),
            nextAttempt,
            terminal,
            delayMins,
            row.id,
          ],
        );
      }
    }

    await db.query(
      `UPDATE shopify_connections
     SET last_sync_at = NOW(),
         last_error = $1,
         updated_at = NOW()
     WHERE id = $2`,
      [failed > 0 ? `${failed} event(s) failed` : null, conn.id],
    );

    return { processed, failed, skipped };
  }

  return { processPendingShopifyInventoryEvents, enqueueInventorySyncEvents, upsertWebOrderFromShopifyPayload };
};
