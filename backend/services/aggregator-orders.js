"use strict";

/**
 * Delivery-aggregator order pipeline (V03 food-service depth).
 *
 * ONE home for turning an inbound foodpanda / Careem order into a kitchen
 * ticket AND a booked sale, so a delivery-led PK QSR never re-enters an order
 * on a tablet (the demo-killer the local competitor attacks).
 *
 * Pipeline:
 *   webhook (routes/webhooks.js, signature-verified, pre-tenant)
 *     → resolveTenantForStore()      resolve tenant by aggregator store id
 *     → normalizeOrder()             payload → internal shape (price from payload)
 *     → ingestOrder()                INSERT web_orders (idempotent on source+ext id)
 *     → [auto-accept] acceptAndSettle()
 *          → online-inbox.acceptOnlineOrder()  draft_order + KDS ticket (zero re-entry)
 *          → settleAggregatorSale()            sale + stock/recipe decrement + tax
 *
 * Why a NEW sales writer (settleAggregatorSale) instead of reusing pay-at-table's
 * settle: pay-at-table's handleRestaurantPayWebhook creates the sale row but does
 * NOT decrement stock or fire the recipe (kit) engine — a documented open gap
 * (cross_surface_traps_plan01: "pay-at-table no decrement"). Aggregator orders
 * MUST decrement identically to POS or the recipe/theoretical reports built in
 * this same plan are garbage. So this path is added to the sales-writer census
 * and hardened: tax snapshot + kit-engine recipe decrement + plate-cost capture.
 *
 * Aggregator vs POS decrement difference: the order is already placed and paid on
 * the platform — an out-of-stock ingredient can NOT roll the sale back (the
 * kitchen still has to cook it, or it was 86'd upstream via availability push).
 * So decrements are UNCONDITIONAL (stock may go negative — a signal, not a
 * blocker), unlike POS which throws insufficient_stock.
 */

const crypto = require("crypto");
const kitEngine = require("./kit-engine");
const { resolveTaxSnapshot } = require("./tax-snapshot");
const inbox = require("./online-inbox");
const { decryptSecret } = require("./crypto");
const logger = require("./logger").child({ component: "aggregator-orders" });

const AGGREGATOR_SOURCES = Object.freeze(["foodpanda", "careem"]);

const ADAPTERS = {
  foodpanda: require("./marketplace/foodpanda-client"),
  careem: require("./marketplace/careem-client"),
};

// Header names the platforms sign with. Kept broad so a config override or a
// platform rename doesn't silently drop the signature (fail-closed relies on
// finding SOME signature header).
const SIGNATURE_HEADERS = {
  foodpanda: ["x-foodpanda-signature", "x-fp-signature", "x-signature"],
  careem: ["x-careem-signature", "x-signature"],
};
const TIMESTAMP_HEADERS = {
  foodpanda: ["x-foodpanda-timestamp", "x-fp-timestamp", "x-timestamp"],
  careem: ["x-careem-timestamp", "x-timestamp"],
};

function isAggregatorSource(source) {
  return AGGREGATOR_SOURCES.includes(String(source || "").toLowerCase());
}

function getAdapterClass(source) {
  return ADAPTERS[String(source || "").toLowerCase()] || null;
}

function normalizeOrder(source, payload) {
  const Adapter = getAdapterClass(source);
  if (!Adapter) throw Object.assign(new Error(`Unknown aggregator source: ${source}`), { code: "unknown_source" });
  return Adapter.normalizeOrder(payload);
}

/**
 * Lenient store-id extraction — needed BEFORE signature verification (the secret
 * lives on the tenant's integration config, which is keyed by store id). Never
 * throws: returns null when unresolvable so the route can 400 without a stack.
 */
function extractStoreId(source, payload) {
  const p = payload || {};
  if (String(source).toLowerCase() === "careem") {
    return String(p.branchId ?? p.branch_id ?? p.store_id ?? p.outletCode ?? "").trim() || null;
  }
  return String(
    p.vendor?.id ?? p.vendor?.code ?? p.vendorId ?? p.vendor_code ?? p.store_id ?? ""
  ).trim() || null;
}

function pickHeader(headers, names) {
  if (!headers) return null;
  for (const n of names) {
    const v = headers[n] || headers[n.toLowerCase()];
    if (v) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}

/**
 * Verify an aggregator webhook: HMAC-SHA256 (base64) over the raw body compared
 * in constant time, plus a replay window on the platform timestamp. Fail-CLOSED:
 * no secret configured → reject (we never accept an unverified order, unlike the
 * legacy Meta/Daraz handlers). Modelled on the in-repo Shopify webhook verifier.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyWebhook({ source, rawBody, headers, secret, replayWindowMs = 5 * 60 * 1000, nowMs = Date.now() }) {
  const key = String(secret || "");
  if (!key) return { ok: false, reason: "no_secret_configured" };

  const provided = pickHeader(headers, SIGNATURE_HEADERS[source] || SIGNATURE_HEADERS.foodpanda);
  if (!provided) return { ok: false, reason: "missing_signature" };

  // Replay guard — reject stale/future-skewed timestamps. Only enforced when the
  // platform sends a timestamp (fail-open on absence, fail-closed on staleness).
  const tsHeader = pickHeader(headers, TIMESTAMP_HEADERS[source] || TIMESTAMP_HEADERS.foodpanda);
  if (tsHeader) {
    const ts = Number.isFinite(Number(tsHeader))
      ? Number(tsHeader) * (String(tsHeader).length <= 10 ? 1000 : 1) // epoch s or ms
      : Date.parse(String(tsHeader));
    if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_timestamp" };
    const age = nowMs - ts;
    if (age > replayWindowMs || age < -replayWindowMs) return { ok: false, reason: "replay_window" };
  }

  const expected = crypto.createHmac("sha256", key).update(String(rawBody || ""), "utf8").digest("base64");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(String(provided), "utf8");
  if (left.length !== right.length) return { ok: false, reason: "invalid_signature" };
  if (!crypto.timingSafeEqual(left, right)) return { ok: false, reason: "invalid_signature" };
  return { ok: true };
}

/**
 * Load + decrypt an aggregator integration config for a tenant db.
 * Returns null when not connected/active.
 */
async function loadIntegrationConfig(db, source) {
  const { rows: [row] } = await db.query(
    `SELECT provider, api_key, webhook_secret, config_json, is_active, sync_enabled
       FROM integration_settings WHERE provider = $1`,
    [source]
  );
  if (!row) return null;
  let configJson = {};
  try { configJson = row.config_json ? JSON.parse(row.config_json) : {}; } catch { configJson = {}; }
  return {
    provider: row.provider,
    api_key: row.api_key ? decryptSecret(row.api_key) : null,
    webhook_secret: row.webhook_secret ? decryptSecret(row.webhook_secret) : null,
    config_json: configJson,
    store_id: configJson.store_id || configJson.vendor_code || configJson.vendor_id || configJson.branch_id || null,
    auto_accept: configJson.auto_accept === true || configJson.auto_accept === "true",
    is_active: row.is_active === true,
  };
}

/**
 * Resolve the tenant that owns an aggregator store id. Mirrors the payment
 * webhook's cross-tenant scan (routes/webhooks.js:resolveTenantDbForGatewayRef)
 * since aggregator webhooks are mounted pre-tenant with no slug in the payload.
 *
 * @returns {{ db, tenant, config } | null}
 */
async function resolveTenantForStore(deps, source, storeId) {
  const masterDb = require("../master-db-pg");
  const tenantDbMgr = require("../tenant-db-manager-pg");
  const wanted = String(storeId || "").trim();
  if (!wanted) return null;

  let tenants = [];
  try {
    const { rows } = await masterDb.query("SELECT id, slug FROM tenants WHERE status = 'active' ORDER BY id");
    tenants = rows;
  } catch (err) {
    logger.error({ err }, "aggregator tenant list failed");
    return null;
  }

  for (const t of tenants) {
    let db;
    try { db = await tenantDbMgr.getDb(t.id); } catch { continue; }
    let config;
    try { config = await loadIntegrationConfig(db, source); }
    catch (err) {
      if (!/does not exist/i.test(err.message)) logger.warn({ err, slug: t.slug }, "aggregator config load error");
      continue;
    }
    if (config && config.is_active && String(config.store_id || "") === wanted) {
      return { db, tenant: t, config };
    }
  }
  return null;
}

/**
 * Record an order that could not be processed (malformed payload, tenant not
 * found, conversion failure) so it is NEVER dropped silently. Lands in
 * external_sync_events (visible in /admin/dead-letters), idempotent on key.
 */
async function deadLetter(db, { source, externalId, reason, payload }) {
  const key = `aggregator_${source}_${externalId || "unknown"}_${reason}`.slice(0, 240);
  try {
    await db.query(
      `INSERT INTO external_sync_events
         (direction, entity_type, idempotency_key, status, error_message, payload, created_at)
       VALUES ('inbound', 'aggregator_order', $1, 'dead_letter', $2, $3, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key, String(reason || "").slice(0, 500), JSON.stringify(payload || {})]
    );
  } catch (err) {
    logger.error({ err, source, externalId }, "aggregator dead-letter insert failed");
  }
  return { deadLettered: true, key };
}

async function resolveProductIdBySku(db, sku) {
  if (!sku) return null;
  // No status filter — an 86'd/inactive menu item must still resolve so its
  // stock/recipe decrements (the kitchen is still making it).
  const { rows } = await db.query(
    `SELECT id FROM products WHERE sku = $1
     UNION ALL SELECT id FROM products WHERE barcode = $1
     LIMIT 1`,
    [String(sku)]
  );
  return rows[0]?.id || null;
}

/**
 * Insert a normalized aggregator order into web_orders / web_order_items.
 * Idempotent on the EXISTING web_orders UNIQUE(source, external_order_id) — a
 * redelivered webhook (aggregators retry on timeout) inserts nothing and returns
 * { duplicate: true } so the kitchen never gets two tickets for one order.
 *
 * SKU→product_id is resolved per line (best-effort) so the settle path can
 * decrement; unmapped lines still show on the KDS ticket by title.
 */
async function ingestOrder(db, { normalized, rawPayload, outletId }) {
  const n = normalized;
  const result = await db.transaction(async (client) => {
    const { rows: [inserted] } = await client.query(
      `INSERT INTO web_orders
         (source, external_order_id, external_order_number, outlet_id, currency,
          subtotal, discount_total, tax_total, grand_total,
          payment_status, order_status, ordered_at, raw_payload,
          customer_name_snapshot, customer_phone_snapshot, delivery_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'paid','open',$10,$11,$12,$13,$14)
       ON CONFLICT (source, external_order_id) DO NOTHING
       RETURNING id`,
      [
        n.source, n.external_order_id, n.external_order_number, outletId || null, n.currency || "PKR",
        n.subtotal || 0, n.discount_total || 0, n.tax_total || 0, n.grand_total || 0,
        n.ordered_at || new Date().toISOString(), JSON.stringify(rawPayload || n),
        n.customer?.name || null, n.customer?.phone || null, n.expedition_type || "delivery",
      ]
    );
    if (!inserted) return { webOrderId: null, duplicate: true };

    const webOrderId = inserted.id;
    for (const it of n.items || []) {
      const productId = await resolveProductIdBySku(client, it.sku);
      await client.query(
        `INSERT INTO web_order_items
           (web_order_id, product_id, sku, title, qty, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [webOrderId, productId, it.sku || null, it.title || null,
         Number(it.qty || 1), Number(it.unit_price || 0), Number(it.line_total || 0)]
      );
    }
    return { webOrderId, duplicate: false };
  });
  return result;
}

/**
 * Next tenant invoice number. Mirrors routes/sales.js:generateInvoiceNumber so
 * an aggregator sale gets the same INV-YYYY-NNNNN sequence a POS sale would —
 * needed for the FBR invoice payload.
 */
async function generateInvoiceNumber(client) {
  const year = new Date().getFullYear();
  await client.query(
    "INSERT INTO invoice_sequences (year, last_seq) VALUES ($1, 1) ON CONFLICT(year) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1",
    [year]
  );
  const { rows: [row] } = await client.query(
    "SELECT last_seq FROM invoice_sequences WHERE year = $1", [year]
  );
  return `INV-${year}-${String(row.last_seq).padStart(5, "0")}`;
}

/**
 * Plate cost of a recipe (kit) = Σ(component qty × component cost_price). Used to
 * snapshot cost_price_at_sale so menu-engineering food-cost % is real for
 * recipes, not the (usually zero) parent product's own cost.
 */
async function plateCost(client, productId) {
  const { rows: [r] } = await client.query(
    `SELECT COALESCE(SUM(pb.quantity * COALESCE(cp.cost_price, 0)), 0) AS cost
       FROM product_bundles pb
       JOIN products cp ON cp.id = pb.component_product_id
      WHERE pb.product_id = $1`,
    [productId]
  );
  return Number(r?.cost || 0);
}

/**
 * The hardened aggregator sales writer. Reads the accepted check's
 * draft_order_items, writes a sale + sale_items with the v83 per-line tax
 * snapshot, decrements stock (recipe/kit via kit-engine, standard via
 * outlet_stock) UNCONDITIONALLY, captures plate cost for kits, links the sale,
 * and marks the check completed + web_order stock_applied.
 *
 * FBR: intentionally NOT enqueued here — FBR is on the completion pause-list.
 * Whether aggregator sales post FBR invoices like POS sales is a separate
 * decision (see docs/fable5/vertical-depth/plans/V03-fbr-proposal.md). The hook
 * point is marked below.
 */
async function settleAggregatorSale(db, { webOrder, draftOrderId, employeeId, tenantSlug }) {
  return db.transaction(async (client) => {
    // Idempotency: if this web_order already booked stock, don't double-book.
    const { rows: [wo] } = await client.query(
      `SELECT id, outlet_id, stock_applied, source, external_order_number
         FROM web_orders WHERE id = $1 FOR UPDATE`,
      [webOrder.id]
    );
    if (!wo) throw new Error("web_order missing");
    if (wo.stock_applied === true) {
      return { saleId: null, alreadySettled: true };
    }

    const { rows: [draft] } = await client.query(
      `SELECT id, outlet_id, customer_id, created_by FROM draft_orders WHERE id = $1`,
      [draftOrderId]
    );
    if (!draft) throw new Error("draft_order missing");
    const outletId = draft.outlet_id || wo.outlet_id;

    const { rows: items } = await client.query(
      `SELECT doi.product_id, doi.variant_id, doi.quantity, doi.price,
              COALESCE(p.cost_price, 0) AS cost_price,
              COALESCE(p.bom_type, 'standard') AS bom_type
         FROM draft_order_items doi
         LEFT JOIN products p ON p.id = doi.product_id
        WHERE doi.draft_order_id = $1
        ORDER BY doi.id`,
      [draftOrderId]
    );

    // v83 per-line tax snapshot — shared cascade (services/tax-snapshot). Webhook
    // context has no req; tax_mode comes straight from company_profile.
    let taxMode = "none";
    try {
      const { rows: [cp] } = await client.query("SELECT tax_mode FROM company_profile LIMIT 1");
      if (cp?.tax_mode) taxMode = cp.tax_mode;
    } catch { /* not-yet-migrated tenant */ }
    const taxSnapshot = await resolveTaxSnapshot(client, {
      items: items.map((it) => ({ productId: it.product_id, price: it.price, quantity: it.quantity })),
      taxMode,
    });

    const grandTotal = Number(webOrder.grand_total || taxSnapshot.subtotal + taxSnapshot.taxTotal);

    // Pick a shift for attribution — prefer the outlet's open shift.
    const { rows: [shift] } = await client.query(
      `SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [outletId]
    );
    let shiftId = shift?.id || null;
    if (!shiftId) {
      const { rows: [recent] } = await client.query(
        `SELECT id FROM cash_shifts WHERE outlet_id = $1 ORDER BY opened_at DESC LIMIT 1`,
        [outletId]
      );
      shiftId = recent?.id || null;
    }

    const { rows: [saleRow] } = await client.query(
      `INSERT INTO sales
         (total_amount, payment_method, outlet_id, employee_id, customer_id,
          discount_amount, discount_type, notes, shift_id, subtotal, tax_total, tax_inclusive)
       VALUES ($1, $2, $3, $4, $5, 0, 'fixed', $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        grandTotal,
        wo.source, // payment_method = 'foodpanda' / 'careem' — traceable channel
        outletId,
        employeeId || draft.created_by || null,
        draft.customer_id || null,
        `${wo.source} order #${wo.external_order_number || webOrder.external_order_id} (web_order ${webOrder.id})`,
        shiftId,
        taxSnapshot.subtotal,
        taxSnapshot.taxTotal,
        taxSnapshot.taxInclusive,
      ]
    );
    const saleId = saleRow.id;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const taxLine = taxSnapshot.lines[i] || { rate: 0, amount: 0, hsCode: null };

      // Plate-cost capture: a recipe (kit) menu item's true cost is Σ component
      // costs, not the parent's own cost_price — so menu-engineering food-cost %
      // is real for recipes.
      let costAtSale = Number(it.cost_price || 0);
      if (it.bom_type === "kit" && it.product_id) {
        costAtSale = await plateCost(client, it.product_id);
      }

      await client.query(
        `INSERT INTO sale_items
           (sale_id, product_id, variant_id, quantity, price_at_sale,
            cost_price_at_sale, tax_rate_at_sale, tax_amount_at_sale, hs_code_at_sale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [saleId, it.product_id, it.variant_id, it.quantity, it.price,
         costAtSale, Number(taxLine.rate || 0), Number(taxLine.amount || 0), taxLine.hsCode || null]
      );

      // ── Decrement (UNCONDITIONAL — prepaid order can't be blocked) ──
      if (!it.product_id) continue; // unmapped external SKU — on KDS by title, no stock row
      if (it.bom_type === "kit") {
        // Recipe/combo: decrement components. Build the decrement list directly
        // (not kit-engine.reserveComponents, which THROWS on shortfall) so the
        // sale is never rolled back for an out-of-stock ingredient.
        const comps = await kitEngine.loadComponents(client, it.product_id);
        const decrements = comps.map((c) => ({
          component_product_id: c.component_product_id,
          component_variant_id: c.component_variant_id,
          needed: kitEngine.roundQty(Number(c.quantity) * Number(it.quantity)),
        }));
        await kitEngine.decrementComponents(client, { outletId, decrements });
      } else if (it.variant_id) {
        await client.query(
          `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
             VALUES ($1, $2, 0 - $3::numeric)
             ON CONFLICT (variant_id, outlet_id)
             DO UPDATE SET quantity = variant_outlet_stock.quantity - $3::numeric`,
          [it.variant_id, outletId, Number(it.quantity)]
        );
        await client.query(`UPDATE product_variants SET stock = stock - $1 WHERE id = $2`,
          [Number(it.quantity), it.variant_id]);
        await client.query(
          `UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3`,
          [Number(it.quantity), it.product_id, outletId]);
      } else {
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
             VALUES ($1, $2, 0 - $3::numeric)
             ON CONFLICT (product_id, outlet_id)
             DO UPDATE SET quantity = outlet_stock.quantity - $3::numeric`,
          [it.product_id, outletId, Number(it.quantity)]);
      }
    }

    // FBR Digital Invoicing — enqueue exactly like the POS anonymous-sale path
    // (routes/sales.js), gated on fbr_integration so it's a no-op for non-FBR
    // tenants. Aggregator orders are B2C with no NTN/CNIC → posted as an
    // unregistered consumer (customer = null), same as a POS walk-in. Approved
    // 2026-07-06; live enablement still needs an FBR-sandbox test per V03-decisions.md.
    // Non-blocking: an FBR failure never rolls back the sale.
    try {
      const { rows: [ff] } = await client.query(
        "SELECT enabled FROM feature_flags WHERE key = 'fbr_integration'"
      );
      if (ff?.enabled) {
        const invoiceNumber = await generateInvoiceNumber(client);
        await client.query(
          "UPDATE sales SET invoice_number = $1 WHERE id = $2 AND invoice_number IS NULL",
          [invoiceNumber, saleId]
        );
        const { buildInvoicePayload, enqueueFbrInvoice } = require("./fbr");
        const { fetchCategoryIndexes } = require("../category-tree");
        const categoryTree = await fetchCategoryIndexes(client);
        const { rows: [company] } = await client.query("SELECT * FROM company_profile LIMIT 1");
        const { rows: fbrItems } = await client.query(
          `SELECT si.*, p.name AS product_name, p.category_id
             FROM sale_items si LEFT JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = $1`,
          [saleId]
        );
        const payload = buildInvoicePayload(
          { timestamp: new Date(), invoice_number: invoiceNumber },
          fbrItems, company, null, categoryTree
        );
        await enqueueFbrInvoice(client, { saleId, invoiceType: "sale", payload, tenantSlug });
        await client.query("UPDATE sales SET fbr_status = 'pending' WHERE id = $1", [saleId]);
      }
    } catch (fbrErr) {
      logger.error({ err: fbrErr, saleId }, "aggregator FBR enqueue failed (non-blocking)");
    }

    await client.query(
      `UPDATE draft_orders SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [draftOrderId]);
    await client.query(
      `UPDATE web_orders
         SET stock_applied = true, stock_applied_at = NOW(),
             stock_policy_note = 'aggregator settle', fulfillment_status = 'accepted', updated_at = NOW()
       WHERE id = $1`,
      [webOrder.id]);

    return { saleId, alreadySettled: false };
  });
}

/**
 * Accept an aggregator web_order into the kitchen AND book the sale. Reuses the
 * existing online-inbox accept path for the KDS half (zero re-entry), then runs
 * the hardened settle for the inventory/accounting half.
 */
async function acceptAndSettle(db, { webOrderId, employeeId, orderContext = "delivery", outletId, tenantSlug }) {
  const accept = await inbox.acceptOnlineOrder(db, webOrderId, employeeId, {
    order_context: orderContext,
    outlet_id: outletId,
  });
  let settle = null;
  try {
    settle = await settleAggregatorSale(db, {
      webOrder: accept.webOrder,
      draftOrderId: accept.draftOrderId,
      employeeId,
      tenantSlug,
    });
  } catch (err) {
    // The kitchen ticket already exists (accept succeeded). A settle failure is
    // logged + dead-lettered but never un-does the kitchen ticket.
    logger.error({ err, webOrderId }, "aggregator settle failed after accept");
    await deadLetter(db, {
      source: accept.webOrder?.source || "aggregator",
      externalId: accept.webOrder?.external_order_id,
      reason: `settle_failed: ${err.message}`,
      payload: { webOrderId, draftOrderId: accept.draftOrderId },
    });
  }
  return {
    draftOrderId: accept.draftOrderId,
    tickets: accept.tickets,
    saleId: settle?.saleId || null,
  };
}

/**
 * Resolve the acceptor employee for zero-touch auto-accept (no human clicks).
 * Prefers an admin, falls back to any active employee.
 */
async function resolveSystemEmployeeId(db) {
  const { rows } = await db.query(
    `SELECT id FROM employees WHERE deleted_at IS NULL
      ORDER BY (role = 'Administrator') DESC, id ASC LIMIT 1`
  );
  return rows[0]?.id || null;
}

/** Tenant's primary outlet fallback when the integration pins none. */
async function resolvePrimaryOutletId(db) {
  const { rows } = await db.query(
    `SELECT id FROM outlets WHERE is_active IS NOT FALSE ORDER BY id ASC LIMIT 1`
  );
  return rows[0]?.id || null;
}

/**
 * Full inbound-webhook orchestration for one aggregator order (tenant already
 * resolved + signature already verified by the route). Normalizes, ingests
 * (idempotent), and — if the tenant has auto-accept on — pushes straight to the
 * kitchen + books the sale. Returns a small status object for the webhook ack.
 */
async function processInboundOrder(db, { source, payload, config, tenantSlug }) {
  let normalized;
  try {
    normalized = normalizeOrder(source, payload);
  } catch (err) {
    await deadLetter(db, { source, externalId: payload?.token || payload?.code || payload?.orderId, reason: `malformed_payload: ${err.message}`, payload });
    return { ok: false, reason: "malformed_payload" };
  }

  // Map the aggregator store to an outlet: the config's pinned outlet, else the
  // tenant's primary outlet (covers the common single-outlet QSR that never
  // pins one — otherwise auto-accept would dead-letter every order).
  let outletId = config?.config_json?.outlet_id ? Number(config.config_json.outlet_id) : null;
  if (!outletId) outletId = await resolvePrimaryOutletId(db);

  let ingest;
  try {
    ingest = await ingestOrder(db, { normalized, rawPayload: payload, outletId });
  } catch (err) {
    await deadLetter(db, { source, externalId: normalized.external_order_id, reason: `ingest_failed: ${err.message}`, payload });
    return { ok: false, reason: "ingest_failed" };
  }

  if (ingest.duplicate) {
    return { ok: true, duplicate: true, external_order_id: normalized.external_order_id };
  }

  const result = { ok: true, web_order_id: ingest.webOrderId, external_order_id: normalized.external_order_id, accepted: false };

  if (config?.auto_accept) {
    try {
      const employeeId = await resolveSystemEmployeeId(db);
      const accepted = await acceptAndSettle(db, {
        webOrderId: ingest.webOrderId,
        employeeId,
        orderContext: normalized.expedition_type === "pickup" ? "takeout" : "delivery",
        outletId,
        tenantSlug,
      });
      result.accepted = true;
      result.draft_order_id = accepted.draftOrderId;
      result.sale_id = accepted.saleId;
    } catch (err) {
      // Never drop it silently — surfaces in inbox + dead-letters for manual accept.
      logger.error({ err, webOrderId: ingest.webOrderId }, "aggregator auto-accept failed");
      await deadLetter(db, { source, externalId: normalized.external_order_id, reason: `auto_accept_failed: ${err.message}`, payload });
      result.accepted = false;
      result.auto_accept_error = err.message;
    }
  }
  return result;
}

/**
 * Push an 86'd item's availability out to every active aggregator integration
 * for a tenant. One-way, best-effort, logged (never throws into the caller).
 */
async function pushAvailabilityFor86(db, { productId, available }) {
  const { rows: [prod] } = await db.query(
    `SELECT id, sku, barcode FROM products WHERE id = $1`, [productId]
  );
  if (!prod) return { pushed: 0 };
  const sku = prod.sku || prod.barcode || `SP-${prod.id}`;

  let pushed = 0;
  for (const source of AGGREGATOR_SOURCES) {
    let config;
    try { config = await loadIntegrationConfig(db, source); } catch { config = null; }
    if (!config || !config.is_active) continue;
    try {
      const Adapter = getAdapterClass(source);
      const adapter = new Adapter({
        api_key: config.api_key,
        webhook_secret: config.webhook_secret,
        config_json: config.config_json,
      });
      const res = await adapter.pushInventory([{ product_id: prod.id, sku, available: available !== false }]);
      logger.info({ source, productId, available, res }, "aggregator availability push");
      if (res && res.updated > 0) pushed += res.updated;
    } catch (err) {
      logger.warn({ err, source, productId }, "aggregator availability push failed");
    }
  }
  return { pushed };
}

module.exports = {
  AGGREGATOR_SOURCES,
  SIGNATURE_HEADERS,
  TIMESTAMP_HEADERS,
  isAggregatorSource,
  getAdapterClass,
  normalizeOrder,
  extractStoreId,
  verifyWebhook,
  loadIntegrationConfig,
  resolveTenantForStore,
  deadLetter,
  ingestOrder,
  plateCost,
  settleAggregatorSale,
  acceptAndSettle,
  processInboundOrder,
  pushAvailabilityFor86,
  resolveSystemEmployeeId,
  resolvePrimaryOutletId,
};
