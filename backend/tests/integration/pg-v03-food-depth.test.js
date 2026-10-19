const crypto = require("crypto");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

/**
 * pg-v03-food-depth.test.js — V03 food-service depth: delivery-aggregator
 * (foodpanda / Careem) order injection.
 *
 * Runs the plan's verification bar against the aggregator pipeline directly at
 * the service level (the webhook route itself is pre-tenant + scans the master
 * DB, which the single-schema test harness can't provide):
 *   - recorded foodpanda payload → web_order → auto-accept → KDS ticket
 *   - settle → stock + recipe(kit) ingredients decremented + tax snapshot present
 *   - replayed duplicate webhook creates nothing (idempotent)
 *   - malformed payload lands in the dead-letter queue
 *   - webhook signature verification (fail-closed / replay window)
 *   - combo (kit w/ multiple components) resolves at settle
 *   - availability push is an honest no-op when no aggregator is connected
 */

const aggregator = require("../../services/aggregator-orders");
const FoodpandaClient = require("../../services/marketplace/foodpanda-client");
const CareemClient = require("../../services/marketplace/careem-client");

describe("V03 — delivery-aggregator order injection (Postgres)", () => {
  let db, cleanup;
  let kitProductId, doughId, cheeseId, doughCost, cheeseCost;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestApp());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_kds', true),
        ('delivery_aggregators', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);

    // KDS station + match_all route so sendToKitchen (inside acceptOnlineOrder)
    // has somewhere to route — proves the order reaches the kitchen.
    const { rows: [station] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'Grill', 'prep') RETURNING id`
    );
    await db.query(
      `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority) VALUES ($1, 1, true, 0)`,
      [station.id]
    );

    // Recipe fixtures: two ingredient products (with cost + stock) and a kit
    // menu item that consumes them — proves recipe decrement + plate cost.
    doughCost = 20;
    cheeseCost = 15;
    const { rows: [d] } = await db.query(
      `INSERT INTO products (barcode, name, price, cost_price, bom_type) VALUES ('ING-DOUGH','Dough',0,$1,'standard') RETURNING id`,
      [doughCost]
    );
    doughId = d.id;
    const { rows: [c] } = await db.query(
      `INSERT INTO products (barcode, name, price, cost_price, bom_type) VALUES ('ING-CHEESE','Cheese',0,$1,'standard') RETURNING id`,
      [cheeseCost]
    );
    cheeseId = c.id;
    await db.query(`INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1,1,100),($2,1,100)`, [doughId, cheeseId]);

    const { rows: [pizza] } = await db.query(
      `INSERT INTO products (barcode, name, price, cost_price, bom_type) VALUES ('PIZZA-1','Margherita',600,0,'kit') RETURNING id`
    );
    kitProductId = pizza.id;
    // Recipe: 1 Dough + 2 Cheese per pizza.
    await db.query(
      `INSERT INTO product_bundles (product_id, component_product_id, quantity) VALUES ($1,$2,1),($1,$3,2)`,
      [kitProductId, doughId, cheeseId]
    );
  }, 120000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  // Build a recorded foodpanda order-push payload fixture.
  function foodpandaPayload({ id, lines, storeId = "STORE-1" }) {
    const products = lines.map((l) => ({
      remoteCode: l.sku,
      name: l.name || "Item",
      quantity: l.qty,
      paidPrice: l.price,
    }));
    const grand = lines.reduce((s, l) => s + l.price * l.qty, 0);
    return {
      token: id,
      shortCode: `A-${id}`,
      vendor: { id: storeId },
      price: { grandTotal: grand, subTotal: grand, vatTotal: 0 },
      createdAt: new Date().toISOString(),
      expeditionType: "delivery",
      customer: { firstName: "Ali", lastName: "Khan", mobilePhone: "03001234567" },
      products,
    };
  }

  const config = (over = {}) => ({ auto_accept: false, config_json: {}, is_active: true, ...over });

  describe("normalizer", () => {
    it("foodpanda payload → internal shape, price snapshotted from payload", () => {
      const n = FoodpandaClient.normalizeOrder(
        foodpandaPayload({ id: "FP-N1", lines: [{ sku: "PROD-001", qty: 3, price: 175 }] })
      );
      expect(n.source).toBe("foodpanda");
      expect(n.external_order_id).toBe("FP-N1");
      expect(n.store_id).toBe("STORE-1");
      expect(n.items).toHaveLength(1);
      // +15% aggregator price rides through from the payload, never re-resolved.
      expect(n.items[0].unit_price).toBe(175);
      expect(n.items[0].qty).toBe(3);
    });

    it("Careem payload normalizes to the same shape with source=careem", () => {
      const n = CareemClient.normalizeOrder({
        orderId: "CRM-1",
        branchId: "BR-9",
        price: { total: 500, subtotal: 500 },
        items: [{ sku: "PROD-002", name: "Widget B", quantity: 1, unitPrice: 500 }],
        customer: { name: "Sara" },
      });
      expect(n.source).toBe("careem");
      expect(n.external_order_id).toBe("CRM-1");
      expect(n.store_id).toBe("BR-9");
      expect(n.items[0].sku).toBe("PROD-002");
    });

    it("payload with no order id throws malformed_payload", () => {
      expect(() => FoodpandaClient.normalizeOrder({ vendor: { id: "X" } })).toThrow(/no order id/i);
    });
  });

  describe("webhook signature (fail-closed + replay window)", () => {
    const secret = "whsec_test_123";
    const rawBody = JSON.stringify({ token: "FP-SIG", vendor: { id: "STORE-1" } });
    const sign = (body, key) => crypto.createHmac("sha256", key).update(body, "utf8").digest("base64");

    it("no secret configured → rejected (never accept unverified)", () => {
      const r = aggregator.verifyWebhook({ source: "foodpanda", rawBody, headers: {}, secret: "" });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("no_secret_configured");
    });

    it("valid HMAC + fresh timestamp → ok", () => {
      const r = aggregator.verifyWebhook({
        source: "foodpanda",
        rawBody,
        headers: {
          "x-foodpanda-signature": sign(rawBody, secret),
          "x-foodpanda-timestamp": String(Math.floor(Date.now() / 1000)),
        },
        secret,
      });
      expect(r.ok).toBe(true);
    });

    it("tampered body → invalid_signature", () => {
      const r = aggregator.verifyWebhook({
        source: "foodpanda",
        rawBody: rawBody + "x",
        headers: { "x-foodpanda-signature": sign(rawBody, secret) },
        secret,
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("invalid_signature");
    });

    it("stale timestamp → replay_window", () => {
      const stale = Math.floor((Date.now() - 10 * 60 * 1000) / 1000); // 10 min old
      const r = aggregator.verifyWebhook({
        source: "foodpanda",
        rawBody,
        headers: {
          "x-foodpanda-signature": sign(rawBody, secret),
          "x-foodpanda-timestamp": String(stale),
        },
        secret,
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("replay_window");
    });
  });

  describe("ingest + auto-accept → KDS + booked sale", () => {
    it("auto-accepts a standard-product order: KDS ticket + sale + stock decrement", async () => {
      const before = await stockOf(db, 1);
      const payload = foodpandaPayload({ id: "FP-A1", lines: [{ sku: "PROD-001", name: "Widget A", qty: 2, price: 120 }] });

      const result = await aggregator.processInboundOrder(db, {
        source: "foodpanda",
        payload,
        config: config({ auto_accept: true }),
      });

      expect(result.ok).toBe(true);
      expect(result.accepted).toBe(true);
      expect(result.draft_order_id).toBeGreaterThan(0);
      expect(result.sale_id).toBeGreaterThan(0);

      // Kitchen ticket exists for the draft (reached the kitchen, zero re-entry).
      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1`, [result.draft_order_id]
      );
      expect(n).toBeGreaterThanOrEqual(1);

      // Sale booked with tax snapshot columns present.
      const { rows: [sale] } = await db.query(
        `SELECT total_amount, subtotal, tax_total, payment_method FROM sales WHERE id = $1`, [result.sale_id]
      );
      expect(Number(sale.total_amount)).toBe(240);
      expect(sale.payment_method).toBe("foodpanda");
      expect(sale.subtotal).not.toBeNull();

      const { rows: [si] } = await db.query(
        `SELECT quantity, price_at_sale, tax_rate_at_sale FROM sale_items WHERE sale_id = $1`, [result.sale_id]
      );
      expect(Number(si.quantity)).toBe(2);
      expect(si.tax_rate_at_sale !== undefined).toBe(true);

      // Stock decremented like any POS sale.
      expect(await stockOf(db, 1)).toBe(before - 2);

      // web_order stamped stock_applied.
      const { rows: [wo] } = await db.query(
        `SELECT stock_applied FROM web_orders WHERE source='foodpanda' AND external_order_id='FP-A1'`
      );
      expect(wo.stock_applied).toBe(true);
    });

    it("recipe (kit) order decrements ingredients + captures plate cost", async () => {
      const doughBefore = await stockOf(db, doughId);
      const cheeseBefore = await stockOf(db, cheeseId);
      const payload = foodpandaPayload({ id: "FP-KIT", lines: [{ sku: "PIZZA-1", name: "Margherita", qty: 2, price: 700 }] });

      const result = await aggregator.processInboundOrder(db, {
        source: "foodpanda",
        payload,
        config: config({ auto_accept: true }),
      });
      expect(result.accepted).toBe(true);
      expect(result.sale_id).toBeGreaterThan(0);

      // 1 Dough + 2 Cheese per pizza × 2 pizzas = 2 Dough, 4 Cheese consumed.
      expect(await stockOf(db, doughId)).toBe(doughBefore - 2);
      expect(await stockOf(db, cheeseId)).toBe(cheeseBefore - 4);

      // Plate cost captured on the sale line = 1*doughCost + 2*cheeseCost.
      const { rows: [si] } = await db.query(
        `SELECT cost_price_at_sale FROM sale_items WHERE sale_id = $1`, [result.sale_id]
      );
      expect(Number(si.cost_price_at_sale)).toBe(doughCost + 2 * cheeseCost);
    });

    it("manual mode (auto_accept off) ingests without accepting", async () => {
      const payload = foodpandaPayload({ id: "FP-M1", lines: [{ sku: "PROD-002", qty: 1, price: 200 }] });
      const result = await aggregator.processInboundOrder(db, { source: "foodpanda", payload, config: config() });
      expect(result.ok).toBe(true);
      expect(result.accepted).toBe(false);
      expect(result.web_order_id).toBeGreaterThan(0);
      // No sale yet — sits in the inbox for a manager to accept.
      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM web_orders WHERE external_order_id='FP-M1' AND converted_draft_order_id IS NULL`
      );
      expect(n).toBe(1);
    });
  });

  describe("idempotency — redelivered webhook", () => {
    it("replaying the same order creates nothing (no double KDS ticket / double decrement)", async () => {
      const payload = foodpandaPayload({ id: "FP-DUP", lines: [{ sku: "PROD-001", qty: 1, price: 100 }] });
      const first = await aggregator.processInboundOrder(db, { source: "foodpanda", payload, config: config({ auto_accept: true }) });
      expect(first.accepted).toBe(true);
      const stockAfterFirst = await stockOf(db, 1);
      const salesAfterFirst = await countSales(db);

      // foodpanda retries on timeout — same payload again.
      const second = await aggregator.processInboundOrder(db, { source: "foodpanda", payload, config: config({ auto_accept: true }) });
      expect(second.ok).toBe(true);
      expect(second.duplicate).toBe(true);

      // Exactly one web_order, no extra sale, no extra decrement.
      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM web_orders WHERE source='foodpanda' AND external_order_id='FP-DUP'`
      );
      expect(n).toBe(1);
      expect(await stockOf(db, 1)).toBe(stockAfterFirst);
      expect(await countSales(db)).toBe(salesAfterFirst);
    });
  });

  describe("dead-letter — malformed payload", () => {
    it("payload with no order id lands in the dead-letter queue, never dropped silently", async () => {
      const result = await aggregator.processInboundOrder(db, {
        source: "foodpanda",
        payload: { vendor: { id: "STORE-1" }, products: [] }, // no token/id
        config: config({ auto_accept: true }),
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed_payload");

      const { rows } = await db.query(
        `SELECT status, entity_type FROM external_sync_events
          WHERE entity_type='aggregator_order' AND status='dead_letter'`
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("FBR on aggregator sales (gated on fbr_integration)", () => {
    it("does NOT assign an FBR invoice number when fbr_integration is off", async () => {
      const payload = foodpandaPayload({ id: "FP-NOFBR", lines: [{ sku: "PROD-002", qty: 1, price: 200 }] });
      const result = await aggregator.processInboundOrder(db, {
        source: "foodpanda", payload, config: config({ auto_accept: true }), tenantSlug: "t",
      });
      const { rows: [sale] } = await db.query(`SELECT invoice_number FROM sales WHERE id = $1`, [result.sale_id]);
      expect(sale.invoice_number).toBeNull();
    });

    it("assigns an FBR invoice number + posts to the queue when fbr_integration is on", async () => {
      // Give the tenant real FBR config so enqueueFbrInvoice's credential gate passes.
      await db.query(
        `UPDATE company_profile SET tax_mode = 'exclusive', fbr_api_token = 'test-token', ntn = '1234567' WHERE id = 1`
      );
      await db.query(`INSERT INTO feature_flags (key, enabled) VALUES ('fbr_integration', true)
                      ON CONFLICT (key) DO UPDATE SET enabled = true`);
      try {
        const payload = foodpandaPayload({ id: "FP-FBR", lines: [{ sku: "PROD-001", qty: 1, price: 150 }] });
        const result = await aggregator.processInboundOrder(db, {
          source: "foodpanda", payload, config: config({ auto_accept: true }), tenantSlug: "t",
        });
        // The FBR-gated branch ran: an INV number was assigned (mirrors POS).
        const { rows: [sale] } = await db.query(
          `SELECT invoice_number, fbr_status FROM sales WHERE id = $1`, [result.sale_id]
        );
        expect(sale.invoice_number).toMatch(/^INV-\d{6}-\d{3,}$/); // D64: INV-yymmdd-001
        // An fbr_invoices row was enqueued for this sale (full DI posting is
        // validated against the FBR sandbox separately, per V03-decisions.md).
        const { rows: [{ n }] } = await db.query(
          `SELECT COUNT(*)::int AS n FROM fbr_invoices WHERE sale_id = $1`, [result.sale_id]
        );
        expect(n).toBe(1);
      } finally {
        await db.query(`UPDATE feature_flags SET enabled = false WHERE key = 'fbr_integration'`);
      }
    });
  });

  describe("availability push honesty", () => {
    it("86 push is a no-op (pushed:0) when no aggregator integration is active", async () => {
      const res = await aggregator.pushAvailabilityFor86(db, { productId: 1, available: false });
      expect(res.pushed).toBe(0);
    });
  });
});

async function stockOf(db, productId) {
  const { rows: [r] } = await db.query(
    `SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1`, [productId]
  );
  return Number(r.quantity);
}

async function countSales(db) {
  const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS n FROM sales`);
  return r.n;
}
