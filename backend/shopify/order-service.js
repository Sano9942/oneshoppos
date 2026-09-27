/**
 * Order service — web-order upsert and stock-policy logic.
 * Extracted from routes/orders.js so shopify route modules can also
 * call upsertWebOrderFromShopifyPayload without a ReferenceError.
 *
 * Stock policy (One Toy Store pilot, blocker 1 — docs/onetoystore-pilot/PROGRESS.md 1a–1f):
 * an order holds its items off the shelf from the moment it arrives, paid or
 * cash-on-delivery, exactly as Shopify reduces its own stock at order time. It
 * lets go when the order is cancelled / voided, and line by line when Shopify
 * restocks a refund. What each order currently holds is recorded in
 * web_order_stock; every call diffs "wanted" against that and moves only the
 * difference through services/stock-ledger.js, so repeated and out-of-order
 * webhooks can't take stock off twice.
 *
 * Postgres async/await version.
 */
const stockLedger = require("../services/stock-ledger");

// Shopify refund_line_items.restock_type values that put units back on the shelf.
const RESTOCK_TYPES = new Set(["return", "cancel", "legacy_restock"]);

const lower = (v) => String(v || "").toLowerCase();

module.exports = function createOrderService(db, getActiveShopifyConnection) {

  function isOrderHoldingStock(order) {
    const payment = lower(order?.payment_status);
    const orderStatus = lower(order?.order_status);
    if (["cancelled", "canceled"].includes(orderStatus)) return false;
    if (["voided", "failed"].includes(payment)) return false;
    // A Shopify refund releases stock only through its restocked lines
    // (web_order_items.restocked_qty); a refund without restock means the
    // goods did not come back. Manual orders carry no line detail, so a full
    // refund there still releases everything.
    if (lower(order?.source) !== "shopify" && payment === "refunded") return false;
    return true;
  }

  async function resolveWebOrderOutletId(order, q = db) {
    if (order?.outlet_id) return Number(order.outlet_id);

    const conn = await getActiveShopifyConnection();
    if (!conn?.default_location_id) {
      throw new Error(
        "Order has no outlet_id and no default Shopify location is configured",
      );
    }

    const { rows } = await q.query(
      "SELECT outlet_id FROM shopify_location_map WHERE shopify_location_id = $1 LIMIT 1",
      [String(conn.default_location_id)],
    );
    if (!rows[0]?.outlet_id) {
      throw new Error("No outlet mapping found for default Shopify location");
    }
    return Number(rows[0].outlet_id);
  }

  /**
   * Match an order line to a SanoPOS product/variant.
   * item.product_id / item.variant_id are SanoPOS ids (manual orders, or a line
   * already matched). shopify_variant_id / shopify_product_id are Shopify's ids
   * from the order payload, looked up in shopify_product_map first — Shopify
   * order lines carry no barcode, so the map is the reliable link (1e).
   */
  async function resolveWebOrderItemMapping(item, q = db) {
    const directProduct = item?.product_id ? Number(item.product_id) : null;
    const directVariant = item?.variant_id ? Number(item.variant_id) : null;
    if (directProduct) {
      return { product_id: directProduct, variant_id: directVariant };
    }

    const shopifyVariant = String(item?.shopify_variant_id || "").trim();
    if (shopifyVariant) {
      const { rows } = await q.query(
        `SELECT product_id, variant_id FROM shopify_product_map
          WHERE shopify_variant_id = $1 AND COALESCE(is_active, true) AND product_id IS NOT NULL
          ORDER BY id DESC LIMIT 1`,
        [shopifyVariant],
      );
      if (rows[0]) {
        return {
          product_id: Number(rows[0].product_id),
          variant_id: rows[0].variant_id ? Number(rows[0].variant_id) : null,
        };
      }
    }

    const sku = String(item?.sku || "").trim();
    const barcode = String(item?.barcode || "").trim();

    // Variant by SKU
    if (sku) {
      const { rows } = await q.query(
        "SELECT id as variant_id, product_id FROM product_variants WHERE sku = $1 LIMIT 1",
        [sku],
      );
      if (rows[0]?.product_id) {
        return {
          product_id: Number(rows[0].product_id),
          variant_id: Number(rows[0].variant_id),
        };
      }
      // Plain product (no variants) by its own SKU
      const { rows: prod } = await q.query(
        `SELECT id FROM products
          WHERE sku = $1 AND COALESCE(has_variants, false) = false
          ORDER BY id LIMIT 1`,
        [sku],
      );
      if (prod[0]) return { product_id: Number(prod[0].id), variant_id: null };
    }

    // Variant by barcode
    if (barcode) {
      const { rows } = await q.query(
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

    // Product by barcode
    if (barcode) {
      const { rows } = await q.query(
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

  function outletError(err) {
    return Object.assign(new Error(String(err?.message || "Failed resolving outlet")), { outletResolution: true });
  }

  async function applyWebOrderStockPolicy(webOrderId) {
    let result;
    try {
      result = await db.transaction(async (client) => {
        // Row lock: orders/create and orders/updated for the same order often
        // arrive together; they must see each other's web_order_stock rows.
        const { rows: [order] } = await client.query(
          "SELECT * FROM web_orders WHERE id = $1 FOR UPDATE",
          [webOrderId],
        );
        if (!order) throw new Error("Web order not found");

        const { rows: items } = await client.query(
          "SELECT * FROM web_order_items WHERE web_order_id = $1 ORDER BY id ASC",
          [webOrderId],
        );
        const { rows: heldRows } = await client.query(
          "SELECT * FROM web_order_stock WHERE web_order_id = $1 FOR UPDATE",
          [webOrderId],
        );
        const holding = isOrderHoldingStock(order);

        // What the order should hold now, per product/variant.
        const wanted = new Map();
        const unmatched = [];
        if (holding) {
          for (const item of items) {
            const qty = Math.max(0, Number(item.qty || 0) - Number(item.restocked_qty || 0));
            if (!(qty > 0)) continue;
            const mapped = await resolveWebOrderItemMapping(item, client);
            if (!mapped?.product_id) {
              unmatched.push(item.title || item.sku || `line ${item.id}`);
              continue;
            }
            if (!item.product_id) {
              await client.query(
                "UPDATE web_order_items SET product_id = $1, variant_id = $2 WHERE id = $3",
                [mapped.product_id, mapped.variant_id || null, item.id],
              );
            }
            const key = `${mapped.product_id}:${mapped.variant_id || 0}`;
            const cur = wanted.get(key) || { product_id: mapped.product_id, variant_id: mapped.variant_id || null, qty: 0 };
            cur.qty += qty;
            wanted.set(key, cur);
          }
        }

        let outletId = order.outlet_id ? Number(order.outlet_id) : null;
        if (wanted.size > 0 && !outletId) {
          try {
            outletId = await resolveWebOrderOutletId(order, client);
          } catch (err) {
            throw outletError(err);
          }
        }

        // Diff wanted (at outletId) against what is held (at whatever outlet).
        const rows = new Map();
        for (const h of heldRows) {
          const key = `${h.product_id}:${h.variant_id || 0}@${h.outlet_id}`;
          rows.set(key, { product_id: h.product_id, variant_id: h.variant_id, outlet_id: h.outlet_id, held: Number(h.qty), want: 0 });
        }
        for (const w of wanted.values()) {
          const key = `${w.product_id}:${w.variant_id || 0}@${outletId}`;
          const r = rows.get(key) || { product_id: w.product_id, variant_id: w.variant_id, outlet_id: outletId, held: 0, want: 0 };
          r.want = w.qty;
          rows.set(key, r);
        }

        const moves = [];
        // Put-backs first, then take-offs.
        const ordered = [...rows.values()].sort((a, b) => (a.want - a.held) - (b.want - b.held));
        for (const r of ordered) {
          const delta = r.want - r.held;
          if (delta === 0) continue;
          const ref = { refType: "web_order", refId: webOrderId };
          if (delta < 0) {
            await stockLedger.incrementStock(client, {
              productId: r.product_id, variantId: r.variant_id, outletId: r.outlet_id, qty: -delta, ...ref,
            });
          } else {
            // The ledger updates outlet_stock in place; make sure the row exists.
            await client.query(
              `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, 0)
               ON CONFLICT (product_id, outlet_id) DO NOTHING`,
              [r.product_id, r.outlet_id],
            );
            // No gate: the customer already bought it online; the shelf may go negative.
            await stockLedger.decrementStock(client, {
              productId: r.product_id, variantId: r.variant_id, outletId: r.outlet_id, qty: delta,
              gate: false, movementType: "sale", ...ref,
            });
          }
          moves.push({ product_id: r.product_id, variant_id: r.variant_id, outlet_id: r.outlet_id, change: -delta });

          if (r.want > 0) {
            await client.query(
              `INSERT INTO web_order_stock (web_order_id, product_id, variant_id, outlet_id, qty)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (web_order_id, product_id, COALESCE(variant_id, 0), outlet_id)
               DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
              [webOrderId, r.product_id, r.variant_id, r.outlet_id, r.want],
            );
          } else {
            await client.query(
              `DELETE FROM web_order_stock
                WHERE web_order_id = $1 AND product_id = $2 AND COALESCE(variant_id, 0) = $3 AND outlet_id = $4`,
              [webOrderId, r.product_id, r.variant_id || 0, r.outlet_id],
            );
          }
        }

        const heldBefore = heldRows.some((h) => Number(h.qty) > 0);
        const heldAfter = [...rows.values()].some((r) => r.want > 0);
        let action;
        if (moves.length === 0) {
          if (!holding) action = "noop_already_reversed";
          else if (heldAfter || order.stock_applied === true) action = "noop_already_applied";
          else if (items.length === 0) action = "noop_no_items";
          else action = "noop_state_not_actionable";
        } else if (!heldBefore) action = "apply";
        else if (!heldAfter) action = "reverse";
        else action = "adjust";

        const notes = [];
        if (unmatched.length > 0) {
          notes.push(`${unmatched.length} line(s) not matched to a SanoPOS product, stock not moved for: ${unmatched.join(", ")}`);
        }
        if (moves.length > 0) notes.push(`Stock ${{ apply: "applied", reverse: "reversed", adjust: "adjusted" }[action]}`);
        const note = notes.length ? notes.join(". ") : order.stock_policy_note;

        await client.query(
          `UPDATE web_orders
           SET stock_applied = $1,
               stock_applied_at = CASE WHEN $2 THEN NOW() ELSE stock_applied_at END,
               stock_policy_note = $3,
               outlet_id = COALESCE(outlet_id, $4),
               updated_at = NOW()
           WHERE id = $5`,
          [heldAfter, moves.length > 0, note, outletId, webOrderId],
        );
        // OTS step 7: these stock moves → History, as this Shopify order.
        await require("../services/product-history").tagChanges(client, {
          kind: "online_order", refType: "web_order", refId: webOrderId,
          refNo: order.external_order_number || null, note: action || null,
        });

        return {
          action,
          outlet_id: outletId,
          item_count: items.length,
          moves,
          unmatched,
        };
      });
    } catch (err) {
      if (err.outletResolution) {
        await db.query(
          "UPDATE web_orders SET stock_policy_note = $1 WHERE id = $2",
          [err.message, webOrderId],
        );
      }
      throw err;
    }
    return result;
  }

  // Units Shopify put back on the shelf per line_item id, across all refunds.
  function restockedByLine(payload) {
    const out = new Map();
    for (const refund of Array.isArray(payload?.refunds) ? payload.refunds : []) {
      for (const rli of Array.isArray(refund?.refund_line_items) ? refund.refund_line_items : []) {
        const restocked = RESTOCK_TYPES.has(lower(rli?.restock_type)) || rli?.restock === true;
        if (!restocked) continue;
        const id = String(rli?.line_item_id ?? rli?.line_item?.id ?? "");
        if (!id) continue;
        out.set(id, (out.get(id) || 0) + Number(rli.quantity || 0));
      }
    }
    return out;
  }

  const payloadTime = (p) => {
    const t = Date.parse(p?.updated_at || "");
    return Number.isNaN(t) ? null : t;
  };

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
    // Shopify marks a cancellation with cancelled_at (1d). A cancelled order
    // can't be reopened in Shopify, so 'cancelled' is sticky below.
    const orderStatus = payload?.cancelled_at ? "cancelled" : "open";
    const orderedAt = payload?.created_at || new Date().toISOString();
    const rawPayload = JSON.stringify(payload || {});
    const lineItems = Array.isArray(payload?.line_items)
      ? payload.line_items
      : [];
    const restocked = restockedByLine(payload);

    const txResult = await db.transaction(async (client) => {
      // Shopify doesn't guarantee delivery order: a retried orders/create can
      // land after orders/cancelled. Ignore anything older than what we have.
      const { rows: [existing] } = await client.query(
        "SELECT id, raw_payload FROM web_orders WHERE source = $1 AND external_order_id = $2 FOR UPDATE",
        [source, externalOrderId],
      );
      if (existing) {
        let prevTime = null;
        try { prevTime = payloadTime(JSON.parse(existing.raw_payload || "{}")); } catch { /* unreadable → accept */ }
        const incomingTime = payloadTime(payload);
        if (prevTime !== null && incomingTime !== null && incomingTime < prevTime) {
          return { orderId: existing.id, stale: true };
        }
      }

      await client.query(
        `INSERT INTO web_orders (
          source, external_order_id, external_order_number, currency,
          subtotal, discount_total, tax_total, shipping_total, grand_total,
          payment_status, fulfillment_status, order_status, ordered_at, raw_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
          order_status = CASE WHEN EXCLUDED.order_status = 'cancelled' THEN 'cancelled' ELSE web_orders.order_status END,
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
          orderStatus,
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

      // Lines are rebuilt from the payload each time; what the order holds
      // off the shelf lives in web_order_stock, not on these rows.
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
        const lineId = item.id != null ? String(item.id) : null;
        const mapped = await resolveWebOrderItemMapping({
          shopify_variant_id: item.variant_id != null ? String(item.variant_id) : "",
          sku: item.sku,
          barcode: item.barcode,
        }, client);
        await client.query(
          `INSERT INTO web_order_items (
            web_order_id, product_id, variant_id, sku, barcode, title, qty,
            unit_price, discount, tax, line_total, external_line_id, restocked_qty
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [orderId, mapped?.product_id || null, mapped?.variant_id || null,
           item.sku || null, item.barcode || null, item.title || null,
           qty, unitPrice, discount, tax, lineTotal,
           lineId, Math.min(qty, lineId ? restocked.get(lineId) || 0 : 0)],
        );
      }

      return { orderId, stale: false };
    });
    const webOrderId = txResult.orderId;

    if (txResult.stale) {
      return {
        web_order_id: webOrderId,
        item_count: lineItems.length,
        stale: true,
        stock_policy: { action: "noop_stale_update" },
      };
    }

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
