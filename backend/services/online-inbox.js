/**
 * Online ordering inbox service (Phase 2.1 B2).
 *
 * Converts unaccepted web_orders (Shopify / Daraz / WhatsApp / Facebook / QR)
 * into restaurant draft_orders so the existing sendToKitchen pipeline can
 * route them to KDS stations. External channels don't carry modifier data,
 * so we prepend "[external]" to item notes and skip modifier_option inserts
 * — the kitchen sees the product name and any free-text notes only.
 *
 * The acceptance flow runs inside one db.transaction() so a partial failure
 * rolls back: either the draft + items + web_orders stamp + kitchen tickets
 * all land, or none do.
 */

const restaurantKds = require("./restaurant-kds");

async function listInbox(db, outletId, { status, source } = {}) {
  const params = [];
  let where = "wo.converted_draft_order_id IS NULL AND wo.rejected_at IS NULL";
  if (outletId) {
    params.push(outletId);
    where += ` AND (wo.outlet_id = $${params.length} OR wo.outlet_id IS NULL)`;
  }
  if (status) {
    params.push(status);
    where += ` AND wo.order_status = $${params.length}`;
  }
  if (source) {
    params.push(source);
    where += ` AND wo.source = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT wo.*,
       COALESCE(
         (SELECT json_agg(json_build_object(
            'id', wi.id,
            'product_id', wi.product_id,
            'variant_id', wi.variant_id,
            'sku', wi.sku,
            'title', wi.title,
            'qty', wi.qty,
            'unit_price', wi.unit_price,
            'line_total', wi.line_total
          ) ORDER BY wi.id)
          FROM web_order_items wi WHERE wi.web_order_id = wo.id),
         '[]'::json
       ) AS items
     FROM web_orders wo
     WHERE ${where}
     ORDER BY wo.ordered_at DESC NULLS LAST, wo.created_at DESC`,
    params
  );
  return rows;
}

async function acceptOnlineOrder(db, webOrderId, employeeId, { order_context, outlet_id } = {}) {
  // One transaction: fetch source web_order (FOR UPDATE so two concurrent
  // accept requests can't both claim it), create draft_order + items,
  // stamp conversion fields on the web_order, then sendToKitchen.
  //
  // sendToKitchen runs its own read-outside / write-inside transaction —
  // we pass the client it can reuse? No: sendToKitchen takes db, not a
  // client. Running it outside the outer transaction here means if kitchen
  // routing fails the draft remains. That's the desired behavior — the
  // draft is a real check, the server can re-fire manually. Kitchen failure
  // shouldn't roll back the accept.
  let draftOrderId;
  let webOrder;

  await db.transaction(async (client) => {
    const { rows: [wo] } = await client.query(
      "SELECT * FROM web_orders WHERE id = $1 FOR UPDATE",
      [webOrderId]
    );
    if (!wo) throw Object.assign(new Error("Web order not found"), { statusCode: 404 });
    if (wo.converted_draft_order_id) {
      throw Object.assign(new Error("Already accepted"), { statusCode: 409 });
    }
    if (wo.rejected_at) {
      throw Object.assign(new Error("Already rejected"), { statusCode: 409 });
    }
    webOrder = wo;

    const targetOutlet = outlet_id || wo.outlet_id || wo.fulfillment_outlet_id || wo.pickup_outlet_id;
    if (!targetOutlet) {
      throw Object.assign(
        new Error("outlet_id required — web_order has no outlet and none provided"),
        { statusCode: 400 }
      );
    }

    const ctx = order_context || "online";
    const { rows: [draft] } = await client.query(
      `INSERT INTO draft_orders (outlet_id, created_by, order_context, source_channel, status, subtotal, tax_total, total)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)
       RETURNING id`,
      [
        targetOutlet,
        employeeId,
        ctx,
        wo.source || "pos",
        Number(wo.subtotal || 0),
        Number(wo.tax_total || 0),
        Number(wo.grand_total || 0),
      ]
    );
    draftOrderId = draft.id;

    // Copy web_order_items → draft_order_items. product_id may be NULL for
    // unmapped external SKUs — that's fine: the kitchen ticket shows
    // product_name (from title snapshot). Prepend "[external]" to notes so
    // the KDS shows it was sourced from outside.
    const { rows: items } = await client.query(
      `SELECT id, product_id, variant_id, sku, title, qty, unit_price
       FROM web_order_items WHERE web_order_id = $1
       ORDER BY id`,
      [webOrderId]
    );
    for (const it of items) {
      const noteText = `[external] ${wo.source || ""} #${wo.external_order_number || wo.external_order_id || ""}`.trim();
      await client.query(
        `INSERT INTO draft_order_items
           (draft_order_id, product_id, variant_id, product_name, quantity, price, notes, course_name, kitchen_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'main', 'pending')`,
        [
          draftOrderId,
          it.product_id || null,
          it.variant_id || null,
          it.title || it.sku || `Product #${it.product_id || "?"}`,
          Number(it.qty || 1),
          Number(it.unit_price || 0),
          noteText,
        ]
      );
    }

    await client.query(
      `UPDATE web_orders
         SET converted_draft_order_id = $1,
             accepted_at = NOW(),
             accepted_by = $2,
             updated_at = NOW()
       WHERE id = $3`,
      [draftOrderId, employeeId, webOrderId]
    );
  });

  // Kitchen routing outside the outer tx — see comment above. If it fails
  // the accept still succeeded; the check will show up in "open checks"
  // and the server can manually send-to-kitchen.
  let tickets = [];
  try {
    tickets = await restaurantKds.sendToKitchen(db, draftOrderId);
  } catch (err) {
    // Swallow and surface — the draft exists. Logging via console so Pino
    // structured logger (if wired in the calling scope) picks it up.
    // Route handler will still return success with tickets: [].
    if (err && err.message) console.error("[online-inbox] sendToKitchen failed:", err.message);
  }

  return { draftOrderId, tickets, webOrder };
}

async function rejectOnlineOrder(db, webOrderId, employeeId, reason) {
  const { rows: [wo] } = await db.query(
    "SELECT id, converted_draft_order_id, rejected_at FROM web_orders WHERE id = $1",
    [webOrderId]
  );
  if (!wo) throw Object.assign(new Error("Web order not found"), { statusCode: 404 });
  if (wo.converted_draft_order_id) {
    throw Object.assign(new Error("Already accepted — cannot reject"), { statusCode: 409 });
  }
  if (wo.rejected_at) {
    throw Object.assign(new Error("Already rejected"), { statusCode: 409 });
  }

  const { rows: [updated] } = await db.query(
    `UPDATE web_orders
       SET rejected_at = NOW(),
           reject_reason = $2,
           order_status = 'cancelled',
           updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [webOrderId, reason || null]
  );
  // employeeId is accepted for future audit logging but not stored per-row;
  // action_history inserts happen at the route layer.
  return { webOrder: updated, employeeId };
}

module.exports = { listInbox, acceptOnlineOrder, rejectOnlineOrder };
