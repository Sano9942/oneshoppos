/**
 * Storefront stock release on a payment that never completes — P0-1.
 *
 * WHAT WAS BROKEN, AND WHY NO TEST CAUGHT IT
 *
 * `routes/storefront.js` decrements `outlet_stock` at checkout, before payment.
 * The webhook's failure branch was supposed to give it back. It read from
 * `storefront_cart_reservations` — a table that has never existed in any
 * schema, in any migration, on any tenant (verified: 0 of 29 in production).
 * Every failed storefront payment therefore raised
 * `relation "storefront_cart_reservations" does not exist`, which landed in a
 * bare `catch { log }`, and the handler still answered the gateway `{ ok: true }`.
 * Stock was decremented and never returned, silently, with a success response.
 *
 * The second defect was hiding behind the first. The query read:
 *
 *     FROM storefront_cart_reservations r
 *     JOIN web_orders wo ON wo.id = $1
 *     WHERE r.status = 'converted' AND r.outlet_id IS NOT NULL
 *
 * There is no correlation between `r` and `wo` — `wo.id = $1` is a constant
 * filter, not a join condition. Had the table existed, this would have matched
 * EVERY converted reservation in the tenant and credited all of them back on
 * any single failed payment. Fixing the table name alone would have converted a
 * stock leak into unbounded stock inflation, which is why the third test below
 * exists and why it seeds a second, uninvolved order.
 *
 * These tests fail against the original implementation on all three counts:
 * missing table, missing correlation, and no idempotency.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { releaseStorefrontStock } = require("../../routes/webhooks");

let db, cleanup;
let outletId, productId, variantId;

async function stockAt(pid = productId) {
  const { rows } = await db.query(
    "SELECT quantity FROM outlet_stock WHERE outlet_id = $1 AND product_id = $2",
    [outletId, pid]
  );
  return Number(rows[0]?.quantity ?? 0);
}

async function makeOrder(externalId) {
  const { rows } = await db.query(
    `INSERT INTO web_orders (source, external_order_id, payment_status, outlet_id)
     VALUES ('storefront', $1, 'pending', $2) RETURNING id`,
    [externalId, outletId]
  );
  return rows[0].id;
}

/** Mirror what checkout does: decrement stock, then record a 'converted' row. */
async function reserveAndDecrement(webOrderId, qty, vId = null) {
  await db.query(
    "UPDATE outlet_stock SET quantity = quantity - $1 WHERE outlet_id = $2 AND product_id = $3",
    [qty, outletId, productId]
  );
  await db.query(
    `INSERT INTO inventory_reservations
       (reservation_key, web_order_id, product_id, variant_id, outlet_id, quantity, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'converted')`,
    [`order_${webOrderId}_item_${qty}_${vId ?? "x"}`, webOrderId, productId, vId, outletId, qty]
  );
}

async function reservationStatuses(webOrderId) {
  const { rows } = await db.query(
    "SELECT status FROM inventory_reservations WHERE web_order_id = $1 ORDER BY id",
    [webOrderId]
  );
  return rows.map((r) => r.status);
}

beforeAll(async () => {
  const result = await createTestApp();
  db = result.db;
  cleanup = result.cleanup;

  const { rows: outlets } = await db.query("SELECT id FROM outlets ORDER BY id LIMIT 1");
  outletId = outlets[0].id;

  const { rows: products } = await db.query(
    `INSERT INTO products (name, price, sku) VALUES ('Release Test Widget', 100, 'REL-1') RETURNING id`
  );
  productId = products[0].id;

  const { rows: variants } = await db.query(
    `INSERT INTO product_variants (product_id, sku, price, stock)
     VALUES ($1, 'REL-1-V', 100, 0) RETURNING id`,
    [productId]
  );
  variantId = variants[0].id;

  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, 100)
     ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 100`,
    [productId, outletId]
  );
});

afterAll(async () => { if (cleanup) await cleanup(); });

describe("releaseStorefrontStock", () => {
  test("returns the stock a failed order was holding, and marks the reservation released", async () => {
    const orderId = await makeOrder("rel-basic");
    const before = await stockAt();
    await reserveAndDecrement(orderId, 3);
    expect(await stockAt()).toBe(before - 3);

    const released = await db.transaction((client) => releaseStorefrontStock(client, orderId));

    expect(released).toBe(1);
    expect(await stockAt()).toBe(before);
    expect(await reservationStatuses(orderId)).toEqual(["released"]);
  });

  test("is idempotent — a redelivered webhook does not credit the stock twice", async () => {
    const orderId = await makeOrder("rel-idempotent");
    const before = await stockAt();
    await reserveAndDecrement(orderId, 4);

    const first = await db.transaction((c) => releaseStorefrontStock(c, orderId));
    const afterFirst = await stockAt();
    const second = await db.transaction((c) => releaseStorefrontStock(c, orderId));

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(afterFirst).toBe(before);
    expect(await stockAt()).toBe(before); // unchanged by the second call
  });

  test("releases ONLY the failed order's reservations, never another order's", async () => {
    // The regression guard for the missing correlation predicate. With the
    // original `JOIN web_orders wo ON wo.id = $1` the untouched order's
    // reservation would also be released and its stock credited back, so this
    // test fails loudly on any rewrite that drops `WHERE web_order_id = $1`.
    const failedOrder = await makeOrder("rel-failed");
    const healthyOrder = await makeOrder("rel-healthy");

    const before = await stockAt();
    await reserveAndDecrement(failedOrder, 2);
    await reserveAndDecrement(healthyOrder, 7);
    expect(await stockAt()).toBe(before - 9);

    const released = await db.transaction((c) => releaseStorefrontStock(c, failedOrder));

    expect(released).toBe(1);
    // Only the failed order's 2 units come back; the healthy order keeps its 7.
    expect(await stockAt()).toBe(before - 7);
    expect(await reservationStatuses(failedOrder)).toEqual(["released"]);
    expect(await reservationStatuses(healthyOrder)).toEqual(["converted"]);
  });

  test("does not credit variant stock, because checkout never debited it", async () => {
    // routes/storefront.js decrements outlet_stock only — it never touches
    // product_variants.stock or variant_outlet_stock, even on a variant line.
    // A release that credited them would turn a leak into inflation.
    const orderId = await makeOrder("rel-variant");
    const before = await stockAt();
    const { rows: v0 } = await db.query("SELECT stock FROM product_variants WHERE id = $1", [variantId]);

    await reserveAndDecrement(orderId, 5, variantId);
    await db.transaction((c) => releaseStorefrontStock(c, orderId));

    expect(await stockAt()).toBe(before);
    const { rows: v1 } = await db.query("SELECT stock FROM product_variants WHERE id = $1", [variantId]);
    expect(Number(v1[0].stock)).toBe(Number(v0[0].stock));
  });

  test("ignores reservations that are not 'converted'", async () => {
    const orderId = await makeOrder("rel-active-only");
    const before = await stockAt();
    // An 'active' (soft) reservation holds no decremented stock — releasing it
    // would credit units that were never taken.
    await db.query(
      `INSERT INTO inventory_reservations
         (reservation_key, web_order_id, product_id, outlet_id, quantity, status)
       VALUES ($1, $2, $3, $4, 6, 'active')`,
      [`order_${orderId}_soft`, orderId, productId, outletId]
    );

    const released = await db.transaction((c) => releaseStorefrontStock(c, orderId));

    expect(released).toBe(0);
    expect(await stockAt()).toBe(before);
    expect(await reservationStatuses(orderId)).toEqual(["active"]);
  });
});
