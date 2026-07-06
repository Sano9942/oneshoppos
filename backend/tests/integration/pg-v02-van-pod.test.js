/**
 * pg-v02-van-pod.test.js — V02 wholesale depth: van sales + proof of delivery.
 *
 * Van model: a van IS an outlet (outlet_type='van'), so load-out is a plain
 * depot→van stock move and sell-from-van is the standard POST /api/sales with
 * outlet_id = the van. Covered here:
 *   1. Van creation is flag-gated and exempt from multi-outlet flag seeding.
 *   2. open-day opens (idempotently) the cash shift the sale path requires.
 *   3. Rep sells from the van; /api/van/mine reflects stock + today totals.
 *   4. Day-end reconcile: draft (expected recomputed server-side) → manager
 *      confirm → variance stock adjustment (reason 'van_reconcile') + cash
 *      shift closed with variance.
 *   5. POD: loadsheet stop marked delivered stamps the pod_* columns; failed
 *      stop + return-to-stock restores outlet_stock and re-opens fulfillment.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("V02 — van sales + POD", () => {
  let app, db, deps, cleanup;
  let vanId, customerId;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    require("../../routes/outlets")(app, deps);
    require("../../routes/van")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/fulfillment")(app, deps);

    const { rows: c } = await db.query(
      "INSERT INTO customers (name) VALUES ('Van Route Buyer') RETURNING id"
    );
    customerId = c[0].id;
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("1. van creation requires the flag, then succeeds without multi-outlet seeding", async () => {
    // Flag off → 403.
    let res = await request(app)
      .post("/api/outlets")
      .set("x-employee-id", "1")
      .send({ name: "Van 1", outlet_type: "van", van_rep_employee_id: 1 });
    expect(res.status).toBe(403);
    expect(res.body.flag).toBe("wholesale_van_sales");

    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('wholesale_van_sales', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );

    res = await request(app)
      .post("/api/outlets")
      .set("x-employee-id", "1")
      .send({ name: "Van 1", outlet_type: "van", van_rep_employee_id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.outlet_type).toBe("van");
    // Factory seeds 2 store outlets; adding a van must NOT trip the
    // multi-outlet seed (vans aren't selling locations).
    expect(res.body.multi_outlet_flags_seeded).toBe(false);
    vanId = res.body.id;
  });

  it("2. open-day opens the van's cash shift idempotently", async () => {
    let res = await request(app)
      .post(`/api/van/${vanId}/open-day`)
      .set("x-employee-id", "1")
      .send({ opening_float: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.already_open).toBe(false);

    res = await request(app)
      .post(`/api/van/${vanId}/open-day`)
      .set("x-employee-id", "1")
      .send({ opening_float: 999 });
    expect(res.status).toBe(200);
    expect(res.body.already_open).toBe(true);
    expect(Number(res.body.shift.opening_float)).toBe(1000); // original kept
  });

  it("3. load-out (depot→van stock) then rep sells 5 from the van", async () => {
    // Load-out: 20 units of product 1 onto the van (the transfer machinery
    // is exercised elsewhere; the van only cares that outlet_stock moved).
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, $1, 20)
       ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 20`,
      [vanId]
    );

    // Field-rep sale from the van (field path skips the clock-in check;
    // the open-day shift satisfies the shift requirement).
    const uuid = `v02-van-${Date.now()}`;
    await db.query(
      `INSERT INTO field_visits (employee_id, customer_id, status, client_uuid, checked_in_at)
       VALUES (1, $1, 'ordered', $2, NOW())`,
      [customerId, uuid]
    );
    const sale = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .send({
        outlet_id: vanId,
        employee_id: 1,
        customer_id: customerId,
        cartItems: [{ id: 1, name: "P1", price: 100, quantity: 5, cost_price: 1 }],
        payments: [{ method: "Cash", amount: 500 }],
        field_visit_uuid: uuid,
      });
    expect(sale.status).toBe(200);

    const mine = await request(app)
      .get("/api/van/mine")
      .set("x-employee-id", "1");
    expect(mine.status).toBe(200);
    expect(mine.body.van.id).toBe(vanId);
    const line = mine.body.stock.find((s) => s.product_id === 1);
    expect(Number(line.quantity)).toBe(15);
    expect(mine.body.today.sale_count).toBe(1);
    expect(Number(mine.body.today.sales_total)).toBe(500);
    expect(mine.body.open_shift).toBeTruthy();
  });

  it("4. day-end reconcile: count 14 vs expected 15 → variance adjustment + shift closed", async () => {
    // Draft: rep counts 14 (one unit short). Expected recomputed server-side.
    const draft = await request(app)
      .post(`/api/van/${vanId}/reconcile`)
      .set("x-employee-id", "1")
      .send({
        lines: [{ product_id: 1, counted: 14 }],
        cash_counted: 1490, // expected 1000 float + 500 cash sales = 1500
        variance_reason: "one damaged in transit; Rs 10 short",
      });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe("draft");
    const lines = Array.isArray(draft.body.lines) ? draft.body.lines : JSON.parse(draft.body.lines);
    expect(Number(lines[0].expected)).toBe(15);
    expect(Number(lines[0].variance)).toBe(-1);
    expect(Number(draft.body.cash_expected)).toBe(1500);

    // Manager confirm → stock corrected to the counted truth, adjustment
    // row written, cash shift closed with the Rs 10 variance.
    const confirm = await request(app)
      .post(`/api/van-reconciliations/${draft.body.id}/confirm`)
      .set("x-employee-id", "1")
      .send({});
    expect(confirm.status).toBe(200);
    expect(confirm.body.reconciliation.status).toBe("confirmed");
    expect(confirm.body.closed_shift_id).toBeTruthy();

    const { rows: [os] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = $1",
      [vanId]
    );
    expect(Number(os.quantity)).toBe(14);

    const { rows: [adj] } = await db.query(
      "SELECT * FROM stock_adjustments WHERE outlet_id = $1 AND reason = 'van_reconcile'",
      [vanId]
    );
    expect(adj).toBeDefined();
    expect(Number(adj.quantity_change)).toBe(-1);

    const { rows: [shift] } = await db.query(
      "SELECT status, closing_cash, expected_cash, variance FROM cash_shifts WHERE id = $1",
      [confirm.body.closed_shift_id]
    );
    expect(shift.status).toBe("closed");
    expect(Number(shift.closing_cash)).toBe(1490);
    expect(Number(shift.expected_cash)).toBe(1500);
    expect(Number(shift.variance)).toBe(-10);

    // Confirm is one-shot.
    const again = await request(app)
      .post(`/api/van-reconciliations/${draft.body.id}/confirm`)
      .set("x-employee-id", "1")
      .send({});
    expect(again.status).toBe(400);
  });

  // ── POD ────────────────────────────────────────────────────────────

  async function seedOrderOnLoadsheet({ orderSuffix, qty }) {
    const { rows: [order] } = await db.query(
      `INSERT INTO web_orders
         (source, external_order_id, delivery_method, fulfillment_outlet_id,
          customer_name_snapshot, customer_phone_snapshot,
          subtotal, grand_total, payment_status, fulfillment_status, order_status,
          public_order_token, ordered_at)
       VALUES ('storefront', $1, 'ship_to_customer', 1, 'POD Buyer', '0300-0000000',
               500, 500, 'pending', 'fulfilled', 'open', $2, NOW())
       RETURNING id`,
      [`pod_${orderSuffix}`, `tok_${orderSuffix}`]
    );
    await db.query(
      `INSERT INTO web_order_items (web_order_id, product_id, title, qty, unit_price, line_total)
       VALUES ($1, 2, 'P2', $2, 100, $3)`,
      [order.id, qty, qty * 100]
    );
    const { rows: [ls] } = await db.query(
      `INSERT INTO loadsheets (loadsheet_number, outlet_id, status, created_by)
       VALUES ($1, 1, 'handed_over', 1) RETURNING id`,
      [`LS-${orderSuffix}`]
    );
    await db.query(
      `INSERT INTO loadsheet_orders (loadsheet_id, web_order_id) VALUES ($1, $2)`,
      [ls.id, order.id]
    );
    return { orderId: order.id, loadsheetId: ls.id };
  }

  it("5. POD delivered stamps the stop; requires receiver name", async () => {
    const { orderId, loadsheetId } = await seedOrderOnLoadsheet({ orderSuffix: "del1", qty: 2 });

    let res = await request(app)
      .post(`/api/fulfillment/loadsheets/${loadsheetId}/orders/${orderId}/pod`)
      .set("x-employee-id", "1")
      .send({ status: "delivered" }); // missing receiver
    expect(res.status).toBe(400);

    res = await request(app)
      .post(`/api/fulfillment/loadsheets/${loadsheetId}/orders/${orderId}/pod`)
      .set("x-employee-id", "1")
      .send({ status: "delivered", receiver_name: "Shopkeeper Bhai" });
    expect(res.status).toBe(200);
    expect(res.body.stop.pod_status).toBe("delivered");
    expect(res.body.stop.pod_receiver_name).toBe("Shopkeeper Bhai");
    expect(res.body.stop.pod_at).toBeTruthy();

    // Delivered stop can't be re-stamped.
    res = await request(app)
      .post(`/api/fulfillment/loadsheets/${loadsheetId}/orders/${orderId}/pod`)
      .set("x-employee-id", "1")
      .send({ status: "failed", failed_reason: "nope" });
    expect(res.status).toBe(400);
  });

  it("6. failed stop → return-to-stock restores outlet_stock and re-opens fulfillment", async () => {
    const { orderId, loadsheetId } = await seedOrderOnLoadsheet({ orderSuffix: "fail1", qty: 3 });

    // Return-to-stock before the stop failed → rejected.
    let res = await request(app)
      .post(`/api/fulfillment/loadsheets/${loadsheetId}/orders/${orderId}/return-to-stock`)
      .set("x-employee-id", "1")
      .send({});
    expect(res.status).toBe(400);

    res = await request(app)
      .post(`/api/fulfillment/loadsheets/${loadsheetId}/orders/${orderId}/pod`)
      .set("x-employee-id", "1")
      .send({ status: "failed", failed_reason: "shop closed" });
    expect(res.status).toBe(200);
    expect(res.body.stop.pod_status).toBe("failed");

    const { rows: [before] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1"
    );

    res = await request(app)
      .post(`/api/fulfillment/loadsheets/${loadsheetId}/orders/${orderId}/return-to-stock`)
      .set("x-employee-id", "1")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.restocked_items).toBe(1);

    const { rows: [after] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1"
    );
    expect(Number(after.quantity)).toBe(Number(before.quantity) + 3);

    const { rows: [wo] } = await db.query(
      "SELECT fulfillment_status FROM web_orders WHERE id = $1", [orderId]
    );
    expect(wo.fulfillment_status).toBe("unfulfilled");

    // Idempotency: second restock rejected.
    res = await request(app)
      .post(`/api/fulfillment/loadsheets/${loadsheetId}/orders/${orderId}/return-to-stock`)
      .set("x-employee-id", "1")
      .send({});
    expect(res.status).toBe(400);
  });
});
