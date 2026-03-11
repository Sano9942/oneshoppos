/**
 * Order service — web-order upsert and stock-policy logic.
 * Extracted from routes/orders.js so shopify route modules can also
 * call upsertWebOrderFromShopifyPayload without a ReferenceError.
 *
 * Postgres async/await version.
 */
module.exports = function createOrderService(db, getActiveShopifyConnection) {

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

  async function resolveWebOrderOutletId(order) {
    if (order?.outlet_id) return Number(order.outlet_id);

    const conn = await getActiveShopifyConnection();
    if (!conn?.default_location_id) {
      throw new Error(
        "Order has no outlet_id and no default Shopify location is configured",
      );
    }

    const { rows } = await db.query(
      "SELECT outlet_id FROM shopify_location_map WHERE shopify_location_id = $1 LIMIT 1",
      [String(conn.default_location_id)],
    );
    if (!rows[0]?.outlet_id) {
      throw new Error("No outlet mapping found for default Shopify location");
    }
    return Number(rows[0].outlet_id);
  }

  async function resolveWebOrderItemMapping(item) {
    const directProduct = item?.product_id ? Number(item.product_id) : null;
    const directVariant = item?.variant_id ? Number(item.variant_id) : null;
    if (directProduct) {
      return { product_id: directProduct, variant_id: directVariant };
    }

    const sku = String(item?.sku || "").trim();
    const barcode = String(item?.barcode || "").trim();

    // Try variant by SKU
    if (sku) {
      const { rows } = await db.query(
        "SELECT id as variant_id, product_id FROM product_variants WHERE sku = $1 LIMIT 1",
        [sku],
      );
      if (rows[0]?.product_id) {
        return {
          product_id: Number(rows[0].product_id),
          variant_id: Number(rows[0].variant_id),
        };
      }
    }

    // Try variant by barcode
    if (barcode) {
      const { rows } = await db.query(
        "SELECT id as variant_id, product_id FROM product_variants WHERE barcode = $1 LIMIT 1",
        [barcode],
      );
      if (rows[0]?.product_id) {
        return {
          product_id: Number(rows[0].product_id),
          variant_id: Number(rows[0].variant_id),
        };
      }
    }

    // Try product by barcode
    if (barcode) {
      const { rows } = await db.query(
        "SELECT id as product_id FROM products WHERE barcode = $1 LIMIT 1",
        [barcode],
      );
      if (rows[0]?.product_id) {
        return {
          product_id: Number(rows[0].product_id),
          variant_id: null,
        };
      }
    }

    return null;
  }

  async function applyWebOrderStockPolicy(webOrderId) {
    const { rows: [order] } = await db.query(
      "SELECT * FROM web_orders WHERE id = $1",
      [webOrderId],
    );
    if (!order) throw new Error("Web order not found");

    const applied = order.stock_applied === true;
    const shouldApply = shouldApplyWebOrderStock(order);
    const shouldReverse = shouldReverseWebOrderStock(order);

    if (shouldApply && applied) return { action: "noop_already_applied" };
    if (shouldReverse && !applied) return { action: "noop_already_reversed" };
    if (!shouldApply && !shouldReverse) return { action: "noop_state_not_actionable" };

    const direction = shouldApply ? -1 : 1;
    const nextAppliedState = shouldApply ? true : false;
    const actionLabel = shouldApply ? "apply" : "reverse";

    let resolvedOutletId;
    try {
      resolvedOutletId = await resolveWebOrderOutletId(order);
    } catch (outletErr) {
      await db.query(
        "UPDATE web_orders SET stock_policy_note = $1 WHERE id = $2",
        [String(outletErr.message || "Failed resolving outlet"), webOrderId],
      );
      throw outletErr;
    }

    const { rows: items } = await db.query(
      "SELECT * FROM web_order_items WHERE web_order_id = $1 ORDER BY id ASC",
      [webOrderId],
    );
    if (!items || items.length === 0) return { action: "noop_no_items" };

    const resolved = [];
    const unresolved = [];

    for (const current of items) {
      const mapped = await resolveWebOrderItemMapping(current);
      if (!mapped?.product_id) {
        unresolved.push(current.id);
        continue;
      }
      await db.query(
        "UPDATE web_order_items SET product_id = COALESCE(product_id, $1), variant_id = COALESCE(variant_id, $2) WHERE id = $3",
        [mapped.product_id, mapped.variant_id || null, current.id],
      );
      resolved.push({
        item_id: current.id,
        product_id: mapped.product_id,
        variant_id: mapped.variant_id || null,
        qty: Number(current.qty || 0),
      });
    }

    if (unresolved.length > 0) {
      const note = `Unmapped items (${unresolved.length}) - stock policy not applied`;
      await db.query(
        "UPDATE web_orders SET stock_policy_note = $1 WHERE id = $2",
        [note, webOrderId],
      );
      throw new Error(note);
    }

    await db.transaction(async (client) => {
      for (const r of resolved) {
        const delta = direction * Number(r.qty || 0);
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
          [r.product_id, resolvedOutletId, delta, delta],
        );
      }

      await client.query(
        `UPDATE web_orders
         SET stock_applied = $1,
             stock_applied_at = NOW(),
             stock_policy_note = $2,
             outlet_id = COALESCE(outlet_id, $3),
             updated_at = NOW()
         WHERE id = $4`,
        [nextAppliedState, `Stock policy ${actionLabel}d`, resolvedOutletId, webOrderId],
      );
    });

    return {
      action: actionLabel,
      outlet_id: resolvedOutletId,
      item_count: resolved.length,
    };
  }

  async function upsertWebOrderFromShopifyPayload(payload) {
    const source = "shopify";
    const externalOrderId = String(payload?.id || payload?.order_id || "");
    if (!externalOrderId) {
      throw new Error("Missing Shopify order id");
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

    const webOrderId = await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO web_orders (
          source, external_order_id, external_order_number, currency,
          subtotal, discount_total, tax_total, shipping_total, grand_total,
          payment_status, fulfillment_status, order_status, ordered_at, raw_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', $12, $13)
        ON CONFLICT(source, external_order_id) DO UPDATE SET
          external_order_number = EXCLUDED.external_order_number,
          currency = EXCLUDED.currency,
          subtotal = EXCLUDED.subtotal,
          discount_total = EXCLUDED.discount_total,
          tax_total = EXCLUDED.tax_total,
          shipping_total = EXCLUDED.shipping_total,
          grand_total = EXCLUDED.grand_total,
          payment_status = EXCLUDED.payment_status,
          fulfillment_status = EXCLUDED.fulfillment_status,
          ordered_at = EXCLUDED.ordered_at,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = NOW()`,
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
      );

      const { rows: [row] } = await client.query(
        "SELECT id FROM web_orders WHERE source = $1 AND external_order_id = $2",
        [source, externalOrderId],
      );
      if (!row) throw new Error("Failed to resolve web order");
      const orderId = row.id;

      await client.query(
        "DELETE FROM web_order_items WHERE web_order_id = $1",
        [orderId],
      );

      for (const item of lineItems) {
        const qty = parseInt(item.quantity || 0, 10);
        const unitPrice = parseFloat(item.price || 0);
        const discount = parseFloat(item.total_discount || 0);
        const tax = parseFloat(item.total_tax || 0);
        const lineTotal = qty * unitPrice - discount + tax;
        await client.query(
          `INSERT INTO web_order_items (
            web_order_id, sku, barcode, title, qty, unit_price, discount, tax, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [orderId, item.sku || null, item.barcode || null, item.title || null,
           qty, unitPrice, discount, tax, lineTotal],
        );
      }

      return orderId;
    });

    // Apply stock policy outside the transaction (it uses its own transaction)
    let stockPolicy;
    try {
      stockPolicy = await applyWebOrderStockPolicy(webOrderId);
    } catch (policyErr) {
      stockPolicy = { error: policyErr.message };
    }

    return {
      web_order_id: webOrderId,
      item_count: lineItems.length,
      stock_policy: stockPolicy || null,
    };
  }

  return { upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy };
};
