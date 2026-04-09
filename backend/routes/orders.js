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

  const { validate } = require("../middleware/validate");
  const { BulkUpdateOrdersSchema, MarkCompleteSchema } = require("../schemas/orders");

// --- ROUTES: ORDERS (Website order staging before live Shopify integration) ---

  app.get("/api/orders/aging-summary", requireAnyPerm(["manage_orders", "view_reports"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT
           EXTRACT(DAY FROM NOW() - ordered_at)::integer AS age_days,
           wo.id,
           wo.external_order_number,
           c.name AS customer_name,
           wo.ordered_at
         FROM web_orders wo
         LEFT JOIN customers c ON wo.customer_id = c.id
         WHERE wo.order_status NOT IN ('closed', 'cancelled')`,
      );

      const buckets = { fresh: 0, aging: 0, stale: 0, critical: 0 };
      const critical_orders = [];

      for (const r of rows) {
        const age = Number(r.age_days) || 0;
        if (age <= 2) buckets.fresh++;
        else if (age <= 5) buckets.aging++;
        else if (age <= 10) buckets.stale++;
        else {
          buckets.critical++;
          critical_orders.push({
            id: r.id,
            external_order_number: r.external_order_number,
            customer_name: r.customer_name,
            ordered_at: r.ordered_at,
            age_days: age,
          });
        }
      }

      critical_orders.sort((a, b) => b.age_days - a.age_days);
      res.json({ buckets, critical_orders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/orders:
   *   get:
   *     summary: List all orders
   *     description: Returns orders with optional filtering by source, status, date range, and customer. Includes order items.
   *     tags: [Orders]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: source
   *         schema: { type: string, enum: [manual, shopify, woocommerce] }
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [pending, confirmed, shipped, delivered, cancelled] }
   *       - in: query
   *         name: from
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: to
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: customer_id
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Array of orders
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Order'
   *       401:
   *         description: Unauthorized
   */
  app.get("/api/orders", requirePerm("manage_orders"), async (req, res) => {
    const {
      source,
      order_status,
      payment_status,
      fulfillment_status,
      date_from,
      date_to,
      search,
      aging,
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
    if (aging === "stale") {
      where.push(`EXTRACT(DAY FROM NOW() - wo.ordered_at)::integer > 3`);
    } else if (aging === "critical") {
      where.push(`EXTRACT(DAY FROM NOW() - wo.ordered_at)::integer > 10`);
    }

    try {
      const { rows } = await db.query(
        `SELECT wo.*,
              c.name as customer_name,
              o.name as outlet_name,
              COUNT(woi.id) as item_count,
              EXTRACT(DAY FROM NOW() - wo.ordered_at)::integer AS aging_days
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

        // Clean up the underlying file (R2, local fallback, or legacy disk upload)
        const url = String(row.url || "");
        try {
          if (url.startsWith("/r2/")) {
            // R2 proxy URL: /r2/products/filename.webp → key = "products/filename.webp"
            const { deleteFromR2 } = require("../utils/r2");
            await deleteFromR2(url.slice(4));
          } else if (process.env.R2_PUBLIC_URL && url.startsWith(process.env.R2_PUBLIC_URL)) {
            // R2 public CDN URL
            const { deleteFromR2 } = require("../utils/r2");
            const key = url.slice(process.env.R2_PUBLIC_URL.replace(/\/$/, "").length + 1);
            await deleteFromR2(key);
          } else if (url.startsWith("exports/")) {
            // Local R2 fallback path
            const localPath = path.join(__dirname, "..", url);
            if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
          } else if (url.startsWith("/uploads/products/")) {
            // Legacy local disk upload
            const filename = path.basename(url);
            const uploadsDir = req.tenantDir
              ? path.join(req.tenantDir, "uploads", "products")
              : deps.PRODUCT_UPLOADS_DIR;
            const filePath = path.join(uploadsDir, filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          }
        } catch (_) {
          /* ignore file cleanup errors */
        }
        res.json({ deleted: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
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
    validate(MarkCompleteSchema),
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
    validate(BulkUpdateOrdersSchema),
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

  // ---------------------------------------------------------------------------
  // PUT /api/orders/:id/pickup-ready — mark order ready for pickup
  // ---------------------------------------------------------------------------
  app.put("/api/orders/:id/pickup-ready", requirePerm("manage_orders"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT id, delivery_method FROM web_orders WHERE id = $1`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: "Order not found" });
      if (rows[0].delivery_method !== "pickup") {
        return res.status(400).json({ error: "Order is not a pickup order" });
      }

      const { rows: updated } = await db.query(
        `UPDATE web_orders
         SET pickup_ready_at = NOW(),
             fulfillment_status = 'ready_for_pickup',
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      res.json(updated[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /api/orders/:id/picked-up — mark order as picked up
  // ---------------------------------------------------------------------------
  app.put("/api/orders/:id/picked-up", requirePerm("manage_orders"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT id, delivery_method FROM web_orders WHERE id = $1`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: "Order not found" });
      if (rows[0].delivery_method !== "pickup") {
        return res.status(400).json({ error: "Order is not a pickup order" });
      }

      const { rows: updated } = await db.query(
        `UPDATE web_orders
         SET picked_up_at = NOW(),
             fulfillment_status = 'fulfilled',
             order_status = 'closed',
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      res.json(updated[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

  async function getActiveShopifyConnection() {
    const { rows: [row] } = await db.query(
      `SELECT *
       FROM shopify_connections
       WHERE is_active = true
       ORDER BY id DESC
       LIMIT 1`,
      [],
    );
    if (!row) return null;
    return {
      ...row,
      access_token: decryptShopifySecret(row.access_token),
      webhook_secret: decryptShopifySecret(row.webhook_secret),
    };
  }

  const { upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy } = require('../shopify/order-service')(db, getActiveShopifyConnection);

  // applyWebOrderStockPolicy is now async — thin wrapper that catches errors gracefully
  async function applyWebOrderStockPolicyAsync(webOrderId) {
    try {
      return await applyWebOrderStockPolicy(webOrderId) || null;
    } catch (err) {
      return { error: err.message };
    }
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
                 ELSE NOW() + make_interval(mins => $5)
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
               ELSE NOW() + make_interval(mins => $5)
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

  // ── Endless Aisle: create a routed web_order from POS ──────────────
  app.post("/api/orders/endless-aisle", requirePerm("manage_orders"), async (req, res) => {
    const crypto = require("crypto");
    const {
      items, customerId, deliveryMethod, pickupOutletId,
      shippingAddress, customerContact,
    } = req.body || {};

    if (!items || !items.length) {
      return res.status(400).json({ error: "items array is required" });
    }
    if (!deliveryMethod) {
      return res.status(400).json({ error: "deliveryMethod is required" });
    }
    if (deliveryMethod === "ship_to_customer" && !shippingAddress) {
      return res.status(400).json({ error: "shippingAddress is required for ship_to_customer" });
    }
    if (deliveryMethod === "pickup" && !pickupOutletId) {
      return res.status(400).json({ error: "pickupOutletId is required for pickup orders" });
    }

    try {
      const result = await db.transaction(async (client) => {
        // Look up POS sales channel
        const { rows: [posChannel] } = await client.query(
          "SELECT id FROM sales_channels WHERE code = 'pos' LIMIT 1"
        );
        const channelId = posChannel ? posChannel.id : null;

        // Resolve product prices and check cross-outlet availability
        const enrichedItems = [];
        for (const item of items) {
          let unitPrice = 0;
          let sku = null;
          let barcode = null;
          let title = null;

          if (item.variantId) {
            const { rows: [variant] } = await client.query(
              "SELECT price, sku, barcode, name FROM product_variants WHERE id = $1 AND product_id = $2",
              [item.variantId, item.productId]
            );
            if (variant) {
              unitPrice = parseFloat(variant.price || 0);
              sku = variant.sku;
              barcode = variant.barcode;
              title = variant.name;
            }
          }
          if (!unitPrice) {
            const { rows: [product] } = await client.query(
              "SELECT price, sku, barcode, name FROM products WHERE id = $1",
              [item.productId]
            );
            if (!product) {
              throw Object.assign(new Error(`Product ${item.productId} not found`), { statusCode: 400 });
            }
            unitPrice = parseFloat(product.price || 0);
            sku = sku || product.sku;
            barcode = barcode || product.barcode;
            title = title || product.name;
          }

          // Check cross-outlet availability
          const { rows: stockRows } = await client.query(
            `SELECT os.outlet_id, os.quantity
             FROM outlet_stock os
             JOIN outlets o ON o.id = os.outlet_id AND o.is_active = true
             WHERE os.product_id = $1 AND os.quantity >= $2
             ORDER BY os.quantity DESC`,
            [item.productId, item.qty]
          );
          if (!stockRows.length) {
            throw Object.assign(
              new Error(`No outlet has sufficient stock for "${title}" (product ${item.productId})`),
              { statusCode: 400 }
            );
          }

          enrichedItems.push({
            productId: item.productId,
            variantId: item.variantId || null,
            qty: item.qty,
            unitPrice,
            sku,
            barcode,
            title,
            lineTotal: unitPrice * item.qty,
          });
        }

        const subtotal = enrichedItems.reduce((sum, i) => sum + i.lineTotal, 0);
        const externalOrderId = `ea_${crypto.randomUUID()}`;
        const publicOrderToken = crypto.randomUUID();

        // Create the web_order
        const { rows: [order] } = await client.query(
          `INSERT INTO web_orders (
            source, external_order_id, customer_id, channel_id,
            delivery_method, pickup_outlet_id, shipping_address_json,
            customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
            currency, subtotal, grand_total,
            payment_status, fulfillment_status, order_status,
            ordered_at, public_order_token
          ) VALUES (
            'pos_endless_aisle', $1, $2, $3,
            $4, $5, $6,
            $7, $8, $9,
            'PKR', $10, $10,
            'pending', 'unfulfilled', 'open',
            NOW(), $11
          ) RETURNING id, external_order_id, public_order_token`,
          [
            externalOrderId,
            customerId || null,
            channelId,
            deliveryMethod,
            pickupOutletId || null,
            shippingAddress ? JSON.stringify(shippingAddress) : null,
            customerContact?.name || null,
            customerContact?.phone || null,
            customerContact?.email || null,
            subtotal,
            publicOrderToken,
          ]
        );

        // Create web_order_items
        const insertedItems = [];
        for (const item of enrichedItems) {
          const { rows: [row] } = await client.query(
            `INSERT INTO web_order_items
               (web_order_id, product_id, variant_id, sku, barcode, title, qty, unit_price, line_total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [order.id, item.productId, item.variantId, item.sku, item.barcode, item.title, item.qty, item.unitPrice, item.lineTotal]
          );
          insertedItems.push({ ...item, webOrderItemId: row.id });
        }

        // Allocate each item to the best outlet, decrement stock, create reservations
        const reservationKey = `ea_${order.id}`;
        const allocations = [];

        for (const item of insertedItems) {
          let fulfillmentOutletId;

          if (deliveryMethod === "pickup") {
            fulfillmentOutletId = pickupOutletId;
          } else {
            // Ship-to-customer: pick active outlet with most stock
            const { rows: stockCandidates } = await client.query(
              `SELECT os.outlet_id, os.quantity
               FROM outlet_stock os
               JOIN outlets o ON o.id = os.outlet_id AND o.is_active = true
               WHERE os.product_id = $1 AND os.quantity >= $2
               ORDER BY os.quantity DESC
               LIMIT 1`,
              [item.productId, item.qty]
            );
            if (!stockCandidates.length) {
              throw Object.assign(
                new Error(`No outlet has sufficient stock for "${item.title}"`),
                { statusCode: 400 }
              );
            }
            fulfillmentOutletId = stockCandidates[0].outlet_id;
          }

          // Create allocation record
          const { rows: [alloc] } = await client.query(
            `INSERT INTO web_order_allocations
               (web_order_id, web_order_item_id, fulfillment_outlet_id,
                fulfillment_method, status, allocated_qty)
             VALUES ($1, $2, $3, $4, 'pending', $5)
             RETURNING *`,
            [order.id, item.webOrderItemId, fulfillmentOutletId, deliveryMethod, item.qty]
          );

          // Lock and decrement outlet_stock
          const { rows: [stock] } = await client.query(
            "SELECT id, quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE",
            [item.productId, fulfillmentOutletId]
          );
          if (!stock || stock.quantity < item.qty) {
            throw Object.assign(
              new Error(`Insufficient stock at fulfillment outlet for "${item.title}"`),
              { statusCode: 400 }
            );
          }
          await client.query(
            "UPDATE outlet_stock SET quantity = quantity - $1 WHERE id = $2",
            [item.qty, stock.id]
          );

          // Create converted reservation record
          await client.query(
            `INSERT INTO inventory_reservations
               (reservation_key, channel_id, web_order_id, product_id, variant_id, outlet_id, quantity, status, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'converted', NOW())`,
            [reservationKey, channelId, order.id, item.productId, item.variantId, fulfillmentOutletId, item.qty]
          );

          allocations.push(alloc);
        }

        return {
          orderId: order.id,
          externalOrderId: order.external_order_id,
          publicOrderToken: order.public_order_token,
          items: insertedItems.length,
          subtotal,
          allocations: allocations.map(a => ({
            itemId: a.web_order_item_id,
            outletId: a.fulfillment_outlet_id,
            method: a.fulfillment_method,
          })),
        };
      });

      res.status(201).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message });
    }
  });

  return { processPendingShopifyInventoryEvents, enqueueInventorySyncEvents, upsertWebOrderFromShopifyPayload };
};
