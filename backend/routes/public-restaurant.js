const crypto = require("crypto");
const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const {
  isProductAvailableNow,
  filterAvailableProducts,
} = require("../services/menu-schedule-resolver");
const { getFeatureFlagsMap } = require("../middleware/feature-flags");

/**
 * Resolve a public token to either a counter-mode kiosk slot's current draft,
 * or a table-mode draft directly. Lazily mints a fresh draft for counter
 * slots whose `current_draft_order_id` is null (or stale). Returns null when
 * no active session matches the token.
 *
 * Shape:
 *   {
 *     mode: "counter" | "table",
 *     draftOrderId, outletId,
 *     tableLabel,           // null in counter mode
 *     slotId                // null in table mode
 *   }
 */
async function resolveKioskToken(db, token) {
  // Try counter slot first.
  const { rows: [slot] } = await db.query(
    `SELECT id, outlet_id, current_draft_order_id, revoked_at
     FROM restaurant_kiosk_slots
     WHERE slot_token = $1`,
    [token]
  );

  if (slot) {
    if (slot.revoked_at) return null;

    // Lazily mint a fresh draft if the slot has none, OR if the linked draft
    // is no longer open (e.g. customer just submitted; we nulled it but a
    // race let us see the old id, or the draft was cancelled out of band).
    let draftId = slot.current_draft_order_id;
    if (draftId) {
      const { rows: [d] } = await db.query(
        "SELECT id, status FROM draft_orders WHERE id = $1",
        [draftId]
      );
      if (!d || d.status !== "open") draftId = null;
    }

    if (!draftId) {
      const { rows: [draft] } = await db.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, source_channel, status, source_token_id)
         VALUES ($1, NULL, 'kiosk_counter', 'kiosk', 'open', $2)
         RETURNING id`,
        [slot.outlet_id, crypto.randomUUID()]
      );
      draftId = draft.id;
      await db.query(
        "UPDATE restaurant_kiosk_slots SET current_draft_order_id = $1, updated_at = NOW() WHERE id = $2",
        [draftId, slot.id]
      );
    }

    return {
      mode: "counter",
      draftOrderId: draftId,
      outletId: slot.outlet_id,
      tableLabel: null,
      slotId: slot.id,
    };
  }

  // Fall through to table-mode draft lookup. LEFT JOIN restaurant_tables so
  // that historic table-mode tokens still resolve even if the table label
  // is missing for any reason. Only retail/online drafts are filtered out.
  const { rows: [tokenRow] } = await db.query(
    `SELECT d.id AS draft_order_id, d.outlet_id, rt.label AS table_label
     FROM draft_orders d
     LEFT JOIN restaurant_tables rt ON rt.id = d.table_id
     WHERE d.source_token_id = $1 AND d.status = 'open'
       AND d.order_context IN ('dine_in','bar')`,
    [token]
  );
  if (!tokenRow) return null;
  return {
    mode: "table",
    draftOrderId: tokenRow.draft_order_id,
    outletId: tokenRow.outlet_id,
    tableLabel: tokenRow.table_label,
    slotId: null,
  };
}

module.exports = function registerPublicRestaurantRoutes(app, deps) {

  // GET /api/public/restaurant/menu/:token — public menu for QR / kiosk
  app.get("/api/public/restaurant/menu/:token", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db, tenant } = resolved;

      const ctx = await resolveKioskToken(db, req.params.token);
      if (!ctx) {
        return res.status(404).json({ error: "No active session found for this QR code" });
      }

      // Fetch published menu items for outlet. 2-R.1: hide products that
      // have been 86'd (sold-out). Retail tenants unaffected because
      // is_sold_out defaults to false.
      const { rows: itemsRaw } = await db.query(
        `SELECT p.id, p.name, p.description_html AS description, p.price, p.image_url,
                c.name AS category_name, c.id AS category_id
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.status = 'active' AND p.deleted_at IS NULL
           AND p.is_sold_out = false
         ORDER BY c.sort_order, c.name, p.name`
      );

      // 2-R.6 day-parting filter. Flag-gated so non-restaurant tenants and
      // restaurant tenants without the flag see the full menu.
      // Public route mounts before loadTenantAndPerms, so req.tenantId is
      // unset — use the resolved tenant.id from resolvePublicTenantDb.
      let items = itemsRaw;
      try {
        const flags = await getFeatureFlagsMap(tenant?.id);
        if (flags.phase4_restaurant_day_parting) {
          items = await filterAvailableProducts(db, itemsRaw, ctx.outletId);
        }
      } catch { /* if flags fetch fails, fall through with full menu */ }

      // Get company profile for branding
      const { rows: [profile] } = await db.query(
        "SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1"
      );

      res.json({
        mode: ctx.mode,
        table_label: ctx.tableLabel,
        company_name: profile?.company_name || "",
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
        items,
      });
    } catch (err) {
      // W40 fix: surface to Sentry but keep public response generic so we don't
      // leak DB / internal error messages to unauthenticated callers.
      try {
        if (process.env.SENTRY_DSN) {
          require("@sentry/node").captureException(err, {
            tags: { route: "public-restaurant", reqId: req.id },
          });
        }
      } catch { /* sentry best-effort */ }
      if (req.log) req.log.error({ err }, "public-restaurant route error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/restaurant/checks/:token/items — add item from QR / kiosk
  app.post("/api/public/restaurant/checks/:token/items", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db, tenant } = resolved;

      const { product_id, quantity, notes } = req.body || {};
      if (!product_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: "product_id and quantity >= 1 required" });
      }

      const ctx = await resolveKioskToken(db, req.params.token);
      if (!ctx) return res.status(404).json({ error: "No active check for this token" });

      // Get product. 2-R.1: refuse 86'd items with 422 so the guest UI can
      // show a friendly "unavailable" toast instead of a generic error.
      const { rows: [product] } = await db.query(
        "SELECT id, name, price, is_sold_out FROM products WHERE id = $1 AND status = 'active' AND deleted_at IS NULL",
        [product_id]
      );
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (product.is_sold_out) {
        return res.status(422).json({ error: "Item is currently unavailable" });
      }

      // 2-R.6 — refuse off-schedule adds when the flag is on.
      // Public route mounts before loadTenantAndPerms, so req.tenantId is
      // unset — use the resolved tenant.id from resolvePublicTenantDb.
      try {
        const flags = await getFeatureFlagsMap(tenant?.id);
        if (flags.phase4_restaurant_day_parting) {
          const available = await isProductAvailableNow(db, product.id, ctx.outletId);
          if (!available) {
            return res.status(422).json({ error: "Item not available at this time" });
          }
        }
      } catch { /* fall through if flag check fails */ }

      // Add item
      const { rows: [item] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [ctx.draftOrderId, product.id, product.name, quantity, product.price, notes || null]
      );

      // Recalculate totals
      const { recalcCheckTotals } = require("../services/restaurant-checks");
      await recalcCheckTotals(db, ctx.draftOrderId);

      res.status(201).json(item);
    } catch (err) {
      // W40 fix: surface to Sentry but keep public response generic so we don't
      // leak DB / internal error messages to unauthenticated callers.
      try {
        if (process.env.SENTRY_DSN) {
          require("@sentry/node").captureException(err, {
            tags: { route: "public-restaurant", reqId: req.id },
          });
        }
      } catch { /* sentry best-effort */ }
      if (req.log) req.log.error({ err }, "public-restaurant route error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/restaurant/checks/:token/submit — customer hits "Place Order"
  //
  // Counter mode: snapshot the draft into web_orders so the existing online
  // inbox accept/reject flow handles it (which fires sendToKitchen on accept).
  // Then null the slot's current_draft_order_id so the next /menu hit mints
  // a fresh draft for the next customer. The slot_token is unchanged — the
  // tablet's bookmark URL stays valid forever.
  //
  // Table mode: just stamp submitted_at on the draft and leave it open.
  // The server fires from the existing Checks page (no inbox involvement).
  app.post("/api/public/restaurant/checks/:token/submit", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const ctx = await resolveKioskToken(db, req.params.token);
      if (!ctx) return res.status(404).json({ error: "No active check for this token" });

      // Refuse empty-cart submits — keeps the inbox clean for staff.
      const { rows: items } = await db.query(
        `SELECT id, product_id, product_name, quantity, price
         FROM draft_order_items WHERE draft_order_id = $1`,
        [ctx.draftOrderId]
      );
      if (!items.length) {
        return res.status(409).json({ error: "Cart is empty" });
      }

      const { rows: [draft] } = await db.query(
        `SELECT id, outlet_id, subtotal, tax_total, discount_total, total
         FROM draft_orders WHERE id = $1`,
        [ctx.draftOrderId]
      );

      if (ctx.mode === "counter") {
        // Insert a web_orders + web_order_items snapshot so the inbox shows
        // it. Use a unique external_order_id (UNIQUE(source, external_order_id)).
        const externalId = `kiosk-${ctx.draftOrderId}-${Date.now()}`;
        const orderNumber = `K-${ctx.draftOrderId}`;

        await db.transaction(async (client) => {
          const { rows: [wo] } = await client.query(
            `INSERT INTO web_orders
               (source, external_order_id, external_order_number,
                outlet_id, subtotal, discount_total, tax_total, grand_total,
                payment_status, fulfillment_status, order_status, ordered_at)
             VALUES ('kiosk', $1, $2, $3, $4, $5, $6, $7, 'pending', 'unfulfilled', 'open', NOW())
             RETURNING id`,
            [
              externalId,
              orderNumber,
              draft.outlet_id,
              Number(draft.subtotal || 0),
              Number(draft.discount_total || 0),
              Number(draft.tax_total || 0),
              Number(draft.total || 0),
            ]
          );

          for (const it of items) {
            await client.query(
              `INSERT INTO web_order_items
                 (web_order_id, product_id, title, qty, unit_price, line_total)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                wo.id,
                it.product_id || null,
                it.product_name,
                Number(it.quantity || 1),
                Number(it.price || 0),
                Number(it.quantity || 1) * Number(it.price || 0),
              ]
            );
          }

          // Stamp + retire the draft. status='cancelled' keeps it out of
          // open-checks lists; submitted_at preserves the moment the
          // customer placed the order for any downstream auditing.
          await client.query(
            `UPDATE draft_orders
                SET submitted_at = NOW(), status = 'cancelled', updated_at = NOW()
              WHERE id = $1`,
            [ctx.draftOrderId]
          );

          // Free the slot for the next customer. slot_token does not change.
          await client.query(
            `UPDATE restaurant_kiosk_slots
                SET current_draft_order_id = NULL, updated_at = NOW()
              WHERE id = $1`,
            [ctx.slotId]
          );
        });

        return res.json({
          mode: "counter",
          order_number: orderNumber,
          total: Number(draft.total || 0),
          item_count: items.reduce((acc, i) => acc + Number(i.quantity || 0), 0),
        });
      }

      // Table mode — leave open, just stamp.
      await db.query(
        `UPDATE draft_orders SET submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [ctx.draftOrderId]
      );
      return res.json({
        mode: "table",
        check_id: ctx.draftOrderId,
        total: Number(draft.total || 0),
      });
    } catch (err) {
      // W40 fix: surface to Sentry but keep public response generic so we don't
      // leak DB / internal error messages to unauthenticated callers.
      try {
        if (process.env.SENTRY_DSN) {
          require("@sentry/node").captureException(err, {
            tags: { route: "public-restaurant", reqId: req.id },
          });
        }
      } catch { /* sentry best-effort */ }
      if (req.log) req.log.error({ err }, "public-restaurant route error");
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
