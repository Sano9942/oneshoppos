/**
 * Order service — web-order upsert and stock-policy logic.
 * Extracted from routes/orders.js so shopify route modules can also
 * call upsertWebOrderFromShopifyPayload without a ReferenceError.
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

  return { upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy };
};
