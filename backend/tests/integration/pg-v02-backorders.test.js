/**
 * pg-v02-backorders.test.js — V02 wholesale depth: backorders / partial fulfillment.
 *
 * Covers the P0 plus the hardening items from the V02 plan:
 *   1. Shortfall 400 carries the structured offer hint (backorder_available)
 *      on the /api/sales surface (POS + field share the same code path).
 *   2. Accepted split: clamped cart + backorder_items → sale invoices only
 *      the fulfilled slice; backorder rows carry the remainder at the
 *      ORDER-time snapshot price; credit exposure counts fulfilled only.
 *   3. Conversion via the STANDARD sale path (cartItems[].backorder_id):
 *      snapshot price enforced (drift 400), remaining qty enforced under
 *      FOR UPDATE (over-fulfill 400), qty_fulfilled/status transitions.
 *   4. MOQ validates the ORDERED total (clamped + backordered), and
 *      conversion never re-validates MOQ.
 *   5. Credit-limit race: the authoritative in-transaction FOR UPDATE gate
 *      (services/credit.js) blocks the second of two concurrent on-account
 *      writers that would jointly exceed a hard limit.
 *   6. Storefront/portal signal: calculateQuote availabilityErrors carry
 *      numeric available/requested for the offer UI.
 *
 * Sales go through the field-rep path (field_visit_uuid) to bypass the
 * isolated-schema clock-in blocker — same pattern as the completion-04 suite.
 */

// Captured for restore; the storefront test deletes MULTI_TENANT after
// createTestApp so public-tenant-context resolves the single-tenant branch
// (same pattern as pg-batch-phase1-storefront-contracts.test.js).
const origMultiTenant = process.env.MULTI_TENANT;

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("V02 — backorders / partial fulfillment", () => {
  let app, db, deps, cleanup, schemaName;
  let buyer;        // warn-mode customer for split tests
  let hardBuyer;    // hard-block customer for the race test

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    require("../../routes/customers")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/backorders")(app, deps);
    require("../../routes/customer-invoices")(app, deps);
    // Storefront must see the single-tenant branch of public-tenant-context —
    // delete AFTER createTestApp (dotenv reload) and BEFORE its first require.
    delete process.env.MULTI_TENANT;
    require("../../routes/storefront")(app, deps);

    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('wholesale_backorders', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );

    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });

    const { rows: b } = await db.query(
      `INSERT INTO customers (name, credit_limit, credit_block_mode, payment_terms_days)
       VALUES ('Backorder Buyer', 0, 'warn', 30) RETURNING id`
    );
    buyer = b[0].id;
    const { rows: h } = await db.query(
      `INSERT INTO customers (name, credit_limit, credit_block_mode, payment_terms_days)
       VALUES ('Hard Limit Buyer', 10000, 'hard', 30) RETURNING id`
    );
    hardBuyer = h[0].id;

    // H1 (WS1b) — the sale path now re-resolves each line's price server-side
    // and rejects an undercharge vs catalog. These carts price P1/P2/P3 at
    // 50/100/10 (the backorder snapshot amounts these tests assert on), so
    // align the catalog to match. (Tests 5–6 exercise the storefront path,
    // which already reprices server-side, and are unaffected.)
    await db.query("UPDATE products SET price = 50 WHERE id = 1");
    await db.query("UPDATE products SET price = 100 WHERE id = 2");
    await db.query("UPDATE products SET price = 10 WHERE id = 3");

    // Deterministic stock for product 2 at outlet 1.
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (2, 1, 60)
       ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 60`
    );
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
    if (origMultiTenant !== undefined) process.env.MULTI_TENANT = origMultiTenant;
  });

  let uuidSeq = 0;
  async function fieldVisit(customerId) {
    const uuid = `v02-bo-${Date.now()}-${uuidSeq++}`;
    await db.query(
      `INSERT INTO field_visits (employee_id, customer_id, status, client_uuid, checked_in_at)
       VALUES (1, $1, 'ordered', $2, NOW())`,
      [customerId, uuid]
    );
    return uuid;
  }

  function postSale(body) {
    return request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({ outlet_id: 1, employee_id: 1, ...body });
  }

  async function outstandingFor(customerId) {
    const { rows: [agg] } = await db.query(
      `SELECT COALESCE(SUM(balance_due), 0)::numeric AS outstanding
       FROM customer_invoices
       WHERE customer_id = $1 AND status NOT IN ('paid','cancelled','void')`,
      [customerId]
    );
    return Number(agg.outstanding);
  }

  it("1. shortfall 400 carries the structured backorder offer hint", async () => {
    const uuid = await fieldVisit(buyer);
    const res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 2, name: "P2", price: 100, quantity: 100, cost_price: 1 }],
      payments: [{ method: "Cash", amount: 10000 }],
      field_visit_uuid: uuid,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_stock");
    expect(Number(res.body.available)).toBe(60);
    expect(Number(res.body.requested)).toBe(100);
    expect(res.body.backorder_available).toBe(true);
  });

  it("1b. no offer without an identified customer", async () => {
    const uuid = await fieldVisit(buyer);
    const res = await postSale({
      cartItems: [{ id: 2, name: "P2", price: 100, quantity: 100, cost_price: 1 }],
      payments: [{ method: "Cash", amount: 10000 }],
      field_visit_uuid: uuid,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_stock");
    expect(res.body.backorder_available).toBe(false);
  });

  let splitSaleId, backorderId;

  it("2. accepted split: 60 invoiced + 40 backordered at snapshot price; credit counts fulfilled only", async () => {
    const uuid = await fieldVisit(buyer);
    const res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 2, name: "P2", price: 100, quantity: 60, cost_price: 1 }],
      payments: [{ method: "Credit", amount: 6000 }],
      field_visit_uuid: uuid,
      backorder_items: [{ product_id: 2, quantity: 40, unit_price: 100 }],
    });
    expect(res.status).toBe(200);
    splitSaleId = res.body.saleId;
    expect(Array.isArray(res.body.backorders)).toBe(true);
    expect(res.body.backorders).toHaveLength(1);
    backorderId = res.body.backorders[0].id;

    const { rows: [bo] } = await db.query("SELECT * FROM backorders WHERE id = $1", [backorderId]);
    expect(bo.status).toBe("open");
    expect(Number(bo.qty_ordered)).toBe(40);
    expect(Number(bo.qty_fulfilled)).toBe(0);
    expect(Number(bo.unit_price)).toBe(100);
    expect(bo.source_type).toBe("field_order"); // field-rep origin keeps its own tag
    expect(Number(bo.source_id)).toBe(Number(splitSaleId));
    expect(Number(bo.customer_id)).toBe(Number(buyer));

    // Stock fully consumed by the fulfilled slice.
    const { rows: [os] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1"
    );
    expect(Number(os.quantity)).toBe(0);

    // Credit rule: the backorder is NOT AR — exposure equals the fulfilled
    // (invoiced) amount only.
    expect(await outstandingFor(buyer)).toBe(6000);
  });

  it("2b. backorder_items without a customer is rejected", async () => {
    const uuid = await fieldVisit(buyer);
    const res = await postSale({
      cartItems: [{ id: 1, name: "P1", price: 50, quantity: 1, cost_price: 1 }],
      payments: [{ method: "Cash", amount: 50 }],
      field_visit_uuid: uuid,
      backorder_items: [{ product_id: 1, quantity: 5, unit_price: 50 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BACKORDER_REQUIRES_CUSTOMER");
  });

  it("3. conversion honors the snapshot price and remaining qty; goes through the standard sale path", async () => {
    // GRN arrives: restock 50.
    await db.query("UPDATE outlet_stock SET quantity = 50 WHERE product_id = 2 AND outlet_id = 1");

    // Price drift rejected — conversion must never re-price.
    let res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 2, name: "P2", price: 120, quantity: 10, cost_price: 1, backorder_id: backorderId }],
      payments: [{ method: "Cash", amount: 1200 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BACKORDER_PRICE_DRIFT");

    // Over-fulfill rejected.
    res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 2, name: "P2", price: 100, quantity: 45, cost_price: 1, backorder_id: backorderId }],
      payments: [{ method: "Cash", amount: 4500 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BACKORDER_OVERFULFILL");

    // Partial conversion (30 of 40) — clock-in check is skipped for
    // conversions, shift still required (open from beforeAll).
    res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 2, name: "P2", price: 100, quantity: 30, cost_price: 1, backorder_id: backorderId }],
      payments: [{ method: "Credit", amount: 3000 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.convertedBackorders).toHaveLength(1);
    expect(res.body.arInvoice).toBeTruthy(); // standard path: AR invoice created

    const { rows: [bo] } = await db.query("SELECT * FROM backorders WHERE id = $1", [backorderId]);
    expect(bo.status).toBe("partial");
    expect(Number(bo.qty_fulfilled)).toBe(30);

    const { rows: fulfillments } = await db.query(
      "SELECT * FROM backorder_fulfillments WHERE backorder_id = $1", [backorderId]
    );
    expect(fulfillments).toHaveLength(1);
    expect(Number(fulfillments[0].qty)).toBe(30);
    expect(fulfillments[0].sale_item_id).not.toBeNull();

    // Stock decremented through the standard FOR UPDATE gate.
    const { rows: [os] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1"
    );
    expect(Number(os.quantity)).toBe(20);

    // Remaining 10 → full fulfillment flips status.
    res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 2, name: "P2", price: 100, quantity: 10, cost_price: 1, backorder_id: backorderId }],
      payments: [{ method: "Cash", amount: 1000 }],
    });
    expect(res.status).toBe(200);
    const { rows: [done] } = await db.query("SELECT status, qty_fulfilled FROM backorders WHERE id = $1", [backorderId]);
    expect(done.status).toBe("fulfilled");
    expect(Number(done.qty_fulfilled)).toBe(40);
  });

  it("4. MOQ validates ordered total (clamped + backordered); conversion skips MOQ", async () => {
    await db.query("UPDATE products SET min_order_qty = 50 WHERE id = 3");
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (3, 1, 20)
       ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 20`
    );

    // Clamped qty alone (20 < MOQ 50) → violation.
    let uuid = await fieldVisit(buyer);
    let res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 3, name: "P3", price: 10, quantity: 20, cost_price: 1 }],
      payments: [{ method: "Cash", amount: 200 }],
      field_visit_uuid: uuid,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MOQ_VIOLATION");

    // Clamped 20 + backordered 30 = ordered 50 → MOQ met, split accepted.
    uuid = await fieldVisit(buyer);
    res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 3, name: "P3", price: 10, quantity: 20, cost_price: 1 }],
      payments: [{ method: "Cash", amount: 200 }],
      field_visit_uuid: uuid,
      backorder_items: [{ product_id: 3, quantity: 30, unit_price: 10 }],
    });
    expect(res.status).toBe(200);
    const bo3 = res.body.backorders[0];

    // Conversion below MOQ passes — the ORDER met MOQ; fulfillment is
    // never re-validated.
    await db.query("UPDATE outlet_stock SET quantity = 30 WHERE product_id = 3 AND outlet_id = 1");
    res = await postSale({
      customer_id: buyer,
      cartItems: [{ id: 3, name: "P3", price: 10, quantity: 5, cost_price: 1, backorder_id: bo3.id }],
      payments: [{ method: "Cash", amount: 50 }],
    });
    expect(res.status).toBe(200);
  });

  it("5. credit-limit race: FOR UPDATE gate blocks the second concurrent on-account writer", async () => {
    // Two REAL clients simulate two cashiers mid-transaction. Client A locks
    // the customer row (passes: 0 + 6000 <= 10000) and holds its transaction
    // open; client B's gate must BLOCK on the row lock, then — after A
    // commits its AR invoice — see 6000 + 6000 > 10000 and throw.
    const dbPg = require("../../db-pg");
    const credit = require("../../services/credit");
    const a = await dbPg.getClient();
    const b = await dbPg.getClient();
    try {
      await a.query(`SET search_path = '${schemaName}'`);
      await b.query(`SET search_path = '${schemaName}'`);

      await a.query("BEGIN");
      const gateA = await credit.assertCreditWithinLimit(a, { customerId: hardBuyer, amount: 6000 });
      expect(gateA.overLimit).toBe(false);

      // B starts while A holds the lock.
      const bOutcome = (async () => {
        await b.query("BEGIN");
        try {
          await credit.assertCreditWithinLimit(b, { customerId: hardBuyer, amount: 6000 });
          return "passed";
        } catch (e) {
          return e.code || e.message;
        } finally {
          await b.query("ROLLBACK");
        }
      })();

      // Give B time to reach (and block on) the FOR UPDATE.
      await new Promise((r) => setTimeout(r, 300));

      // A books its AR and commits — B unblocks and re-reads exposure.
      await a.query(
        `INSERT INTO customer_invoices (invoice_number, customer_id, status, subtotal, total_amount, balance_due)
         VALUES ('INV-RACE-A', $1, 'sent', 6000, 6000, 6000)`,
        [hardBuyer]
      );
      await a.query("COMMIT");

      expect(await bOutcome).toBe("CREDIT_LIMIT_EXCEEDED");
    } finally {
      try { await a.query("ROLLBACK"); } catch { /* already committed */ }
      a.release();
      b.release();
    }
  });

  it("6. storefront/portal signal: quote availabilityErrors carry numeric available/requested", async () => {
    const { calculateQuote } = require("../../services/quote");
    const { rows: [ch] } = await db.query("SELECT id FROM sales_channels WHERE code = 'storefront'");
    await db.query(
      `INSERT INTO channel_publications (channel_id, product_id, variant_id, is_published)
       VALUES ($1, 4, NULL, true) ON CONFLICT DO NOTHING`,
      [ch.id]
    );
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (4, 1, 7)
       ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 7`
    );

    const quote = await calculateQuote(
      db,
      [{ productId: 4, variantId: null, qty: 12 }],
      "pickup",
      1,
      ch.id,
      null,
      { taxMode: "none" }
    );
    expect(quote.availabilityErrors).toHaveLength(1);
    expect(Number(quote.availabilityErrors[0].available)).toBe(7);
    expect(Number(quote.availabilityErrors[0].requested)).toBe(12);
  });

  it("6b. storefront checkout split: clamped cart + backorder_items → web_order + backorder at the QUOTE price", async () => {
    const { rows: [ch] } = await db.query("SELECT id FROM sales_channels WHERE code = 'storefront'");
    // Product 4 published (from test 6), stock 7 at outlet 1. Signed-in
    // buyer's cart clamped to 7 with 5 backordered.
    const { rows: [cart] } = await db.query(
      `INSERT INTO storefront_carts (cart_token, customer_id, channel_id)
       VALUES ('v02-bo-cart', $1, $2) RETURNING id`,
      [buyer, ch.id]
    );
    await db.query(
      `INSERT INTO storefront_cart_items (cart_id, product_id, quantity) VALUES ($1, 4, 7)`,
      [cart.id]
    );

    const res = await request(app)
      .post("/api/storefront/checkout")
      .send({
        cart_token: "v02-bo-cart",
        delivery_method: "pickup",
        pickup_outlet_id: 1,
        customer_name: "Portal Buyer",
        customer_phone: "0300-1234567",
        customer_email: "portal@example.test",
        backorder_items: [{ product_id: 4, quantity: 5, unit_price: 999999 /* ignored — server reprices */ }],
      });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.backorders)).toBe(true);
    expect(res.body.backorders).toHaveLength(1);

    const { rows: [bo] } = await db.query(
      "SELECT * FROM backorders WHERE id = $1", [res.body.backorders[0].id]
    );
    expect(bo.source_type).toBe("web_order");
    expect(Number(bo.qty_ordered)).toBe(5);
    expect(Number(bo.customer_id)).toBe(Number(buyer));
    // Server-authoritative pricing: the quote line's unit price, never the
    // client-sent number.
    const { rows: [p4] } = await db.query("SELECT price FROM products WHERE id = 4");
    expect(Number(bo.unit_price)).toBe(Number(p4.price));

    // Stock consumed only for the fulfilled slice.
    const { rows: [os] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1"
    );
    expect(Number(os.quantity)).toBe(0);
  });

  it("6c. anonymous storefront checkout gets no backorder offer", async () => {
    const { rows: [ch] } = await db.query("SELECT id FROM sales_channels WHERE code = 'storefront'");
    await db.query(
      `INSERT INTO storefront_carts (cart_token, customer_id, channel_id)
       VALUES ('v02-anon-cart', NULL, $1) RETURNING id`,
      [ch.id]
    );
    const { rows: [cart] } = await db.query("SELECT id FROM storefront_carts WHERE cart_token = 'v02-anon-cart'");
    await db.query(
      `INSERT INTO storefront_cart_items (cart_id, product_id, quantity) VALUES ($1, 4, 3)`,
      [cart.id]
    );
    // Stock is 0 after 6b — availability error, but no offer for anonymous.
    const res = await request(app)
      .post("/api/storefront/checkout")
      .send({
        cart_token: "v02-anon-cart",
        delivery_method: "pickup",
        pickup_outlet_id: 1,
        customer_name: "Guest",
        customer_phone: "0300-0000001",
        customer_email: "guest@example.test",
      });
    expect(res.status).toBe(400);
    expect(res.body.backorder_available).toBe(false);
  });

  it("8. ledger audit: Σ invoices − Σ payments == Σ balance_due for the walkthrough buyer", async () => {
    // The feedback_audit_ledger_before_building bar: a new sale-creating path
    // (backorder conversion) must not reintroduce a reconciliation gap.
    const { rows: [inv] } = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric AS total
         FROM customer_invoices
        WHERE customer_id = $1 AND status NOT IN ('cancelled','void')`,
      [buyer]
    );
    const { rows: [pay] } = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'credit_reversal' THEN p.amount ELSE p.amount END), 0)::numeric AS total
         FROM customer_invoice_payments p
         JOIN customer_invoices i ON i.id = p.invoice_id
        WHERE i.customer_id = $1 AND i.status NOT IN ('cancelled','void')`,
      [buyer]
    );
    const { rows: [due] } = await db.query(
      `SELECT COALESCE(SUM(balance_due), 0)::numeric AS total
         FROM customer_invoices
        WHERE customer_id = $1 AND status NOT IN ('cancelled','void')`,
      [buyer]
    );
    expect(Number(inv.total) - Number(pay.total)).toBeCloseTo(Number(due.total), 2);
  });

  it("7. backorders list + summary + suggestions endpoints work oldest-first", async () => {
    const list = await request(app)
      .get("/api/backorders")
      .set("x-employee-id", "1");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.backorders)).toBe(true);

    const summary = await request(app)
      .get("/api/backorders/summary")
      .set("x-employee-id", "1");
    expect(summary.status).toBe(200);
    expect(summary.body.totals).toBeDefined();

    // Two open backorders for product 5, staggered creation → suggestions
    // must allocate oldest-first.
    await db.query(
      `INSERT INTO backorders (customer_id, source_type, source_id, product_id, outlet_id, qty_ordered, unit_price, status, created_at)
       VALUES ($1, 'sale', 999, 5, 1, 30, 10, 'open', NOW() - INTERVAL '2 days'),
              ($1, 'sale', 998, 5, 1, 30, 10, 'open', NOW() - INTERVAL '1 day')`,
      [buyer]
    );
    const sug = await request(app)
      .get("/api/backorders/suggestions?product_id=5&qty=40")
      .set("x-employee-id", "1");
    expect(sug.status).toBe(200);
    expect(sug.body.suggestions).toHaveLength(2);
    expect(Number(sug.body.suggestions[0].allocate_qty)).toBe(30); // oldest gets filled first
    expect(Number(sug.body.suggestions[1].allocate_qty)).toBe(10);
    expect(Number(sug.body.unallocated_qty)).toBe(0);
  });
});
