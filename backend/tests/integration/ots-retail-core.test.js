/**
 * ots-retail-core.test.js — regression tests for the retail-core defects found
 * by the One Toy Store pilot acceptance run (tools/onetoystore-pilot/shop-day.mjs,
 * docs/onetoystore-pilot/PROGRESS.md, defects D1–D12).
 *
 * Every test here failed against main at dd4cde7c and documents one defect.
 * registerAll: true, because D1 only exists in the real route wiring (two
 * modules register the same URL; mount order decides who wins).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  // Real Shopify webhook utils (signature, replay window, idempotency key), not
  // the harness stubs: the blocker-1 tests go through the actual webhook checks.
  const shopifyUtils = require("../../shopify/utils");
  ({ app, db, cleanup } = await createTestApp({
    registerAll: true,
    deps: {
      verifyWebhookSignature: shopifyUtils.verifyWebhookSignature,
      evaluateWebhookTimestampWindow: shopifyUtils.evaluateWebhookTimestampWindow,
      buildWebhookIdempotencyKey: shopifyUtils.buildWebhookIdempotencyKey,
    },
  }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function openTill(outletId = 1, float = 500) {
  const open = await one("SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1", [outletId]);
  let shiftId = open?.id;
  if (!shiftId) {
    const res = await admin().post("/api/shifts/open").send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: float });
    expect(res.status).toBe(200);
    shiftId = res.body.shift_id ?? res.body.id;
  }
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
  return shiftId;
}

async function closeAnyOpenTill() {
  for (const s of await all("SELECT id FROM cash_shifts WHERE status = 'open'")) {
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [s.id]);
  }
}

async function sell(body) {
  return admin().post("/api/sales").send({ outlet_id: 1, employee_id: ADMIN_ID, ...body });
}

// ─── D1 ─────────────────────────────────────────────────────────────────────
describe("D1 — approving a PO from the Purchase Orders screen", () => {
  it("POST /api/purchase-orders/:id/approve with the screen's empty body approves a Draft PO", async () => {
    const po = await admin().post("/api/purchase-orders").send({
      supplier_id: 1, items: [{ product_id: 1, quantity: 5, cost_price: 60 }],
    });
    expect(po.status).toBe(200);
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;

    // PurchaseOrdersRedesign.jsx approvePO(): api.post(`/api/purchase-orders/${poId}/approve`, {})
    const res = await admin().post(`/api/purchase-orders/${poId}/approve`).send({});
    expect(res.status).toBe(200);
    expect((await one("SELECT status FROM purchase_orders WHERE id = $1", [poId])).status).toBe("Approved");
  });

  it("the approvals-module flow (submit → approve with action) still works", async () => {
    const po = await admin().post("/api/purchase-orders").send({
      supplier_id: 1, items: [{ product_id: 2, quantity: 1, cost_price: 120 }],
    });
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;
    expect((await admin().post(`/api/purchase-orders/${poId}/submit`).send({})).status).toBe(200);
    const res = await admin().post(`/api/purchase-orders/${poId}/approve`).send({ action: "approved", action_by: "Owner" });
    expect(res.status).toBe(200);
    expect((await one("SELECT status FROM purchase_orders WHERE id = $1", [poId])).status).toBe("Approved");
  });
});

// ─── D2 ─────────────────────────────────────────────────────────────────────
describe("D2 — the cost booked on a sale comes from the product, not the screen", () => {
  beforeAll(async () => { await openTill(); });

  it("a cart line without cost_price (e.g. a resumed parked bill) is booked at the product's cost", async () => {
    const res = await sell({ cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Card", amount: 100 }] });
    expect(res.status).toBe(200);
    const line = await one("SELECT cost_price_at_sale FROM sale_items WHERE sale_id = $1", [res.body.saleId]);
    expect(num(line.cost_price_at_sale)).toBe(60);
  });

  it("a cart line carrying a stale/wrong cost_price is still booked at the product's current cost", async () => {
    const res = await sell({ cartItems: [{ id: 2, quantity: 1, price: 200, cost_price: 1 }], payments: [{ method: "Card", amount: 200 }] });
    expect(res.status).toBe(200);
    const line = await one("SELECT cost_price_at_sale FROM sale_items WHERE sale_id = $1", [res.body.saleId]);
    expect(num(line.cost_price_at_sale)).toBe(120);
  });

  it("a variant line is booked at the variant's cost", async () => {
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, barcode, price, cost_price, stock) VALUES (3, 'GC-RED', 'GC-RED-BC', 500, 333, 5) RETURNING id`,
    );
    await db.query("INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 5)", [v.id]);
    const res = await sell({ cartItems: [{ id: 3, variant_id: v.id, quantity: 1, price: 500 }], payments: [{ method: "Card", amount: 500 }] });
    expect(res.status).toBe(200);
    const line = await one("SELECT cost_price_at_sale FROM sale_items WHERE sale_id = $1", [res.body.saleId]);
    expect(num(line.cost_price_at_sale)).toBe(333);
  });
});

// ─── D3 ─────────────────────────────────────────────────────────────────────
describe("D3 — change given back is not booked as cash taken", () => {
  let shiftId;
  beforeAll(async () => { await closeAnyOpenTill(); shiftId = await openTill(1, 1000); });

  it("cash tendered above the total is stored net of change", async () => {
    // Bill 200, customer hands over 500, gets 300 change.
    const res = await sell({ cartItems: [{ id: 1, quantity: 2, price: 100 }], payments: [{ method: "Cash", amount: 500 }], shift_id: shiftId });
    expect(res.status).toBe(200);
    const pays = await all("SELECT payment_method, amount FROM sale_payments WHERE sale_id = $1", [res.body.saleId]);
    expect(pays.map((p) => [p.payment_method, num(p.amount)])).toEqual([["Cash", 200]]);
  });

  it("split card + cash with change: change comes out of the cash part", async () => {
    // Bill 200: card 150, cash handed over 100 → change 50, cash kept 50.
    const res = await sell({ cartItems: [{ id: 2, quantity: 1, price: 200 }], payments: [{ method: "Card", amount: 150 }, { method: "Cash", amount: 100 }], shift_id: shiftId });
    expect(res.status).toBe(200);
    const pays = await all("SELECT payment_method, amount FROM sale_payments WHERE sale_id = $1 ORDER BY payment_method", [res.body.saleId]);
    expect(pays.map((p) => [p.payment_method, num(p.amount)])).toEqual([["Card", 150], ["Cash", 50]]);
  });

  it("the till then expects float + cash actually kept", async () => {
    const res = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 1250 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const shift = await one("SELECT expected_cash, variance FROM cash_shifts WHERE id = $1", [shiftId]);
    expect(num(shift.expected_cash)).toBe(1250); // 1000 float + 200 + 50
    expect(num(shift.variance)).toBe(0);
  });
});

// ─── D4 ─────────────────────────────────────────────────────────────────────
describe("D4 — variant opening stock", () => {
  let productId, variantId;
  beforeAll(async () => {
    await closeAnyOpenTill();
    await openTill();
    const res = await admin().post("/api/products").send({
      name: "Die-cast Single", sku: "DC-SINGLE", price: 450, cost_price: 260, has_variants: true, outlet_id: 1,
      variants: [{ sku: "DC-TWIN", barcode: "DC-TWIN-BC", price: 450, cost_price: 260, initial_stock: 5 }],
    });
    expect(res.status).toBe(200);
    productId = res.body.id;
    variantId = (await one("SELECT id FROM product_variants WHERE product_id = $1", [productId])).id;
  });

  it("opening stock lands in the per-outlet variant row and the product's outlet total", async () => {
    expect(num((await one("SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [variantId]))?.quantity)).toBe(5);
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1", [productId]))?.quantity)).toBe(5);
  });

  it("the same variant can be sold twice", async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await sell({ cartItems: [{ id: productId, variant_id: variantId, quantity: 1, price: 450 }], payments: [{ method: "Card", amount: 450 }] });
      expect(res.status).toBe(200);
    }
    expect(num((await one("SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [variantId])).quantity)).toBe(3);
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1", [productId])).quantity)).toBe(3);
  });
});

// ─── D5 ─────────────────────────────────────────────────────────────────────
describe("D5 — scanning a variant's own barcode", () => {
  it("POS scan resolves a variant barcode to its product and variant", async () => {
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, barcode, price, cost_price, stock) VALUES (2, 'WB-BLUE', 'WB-BLUE-BC', 210, 125, 3) RETURNING id`,
    );
    const res = await admin().get("/api/products/scan/WB-BLUE-BC");
    expect(res.status).toBe(200);
    expect(res.body.product.id).toBe(2);
    expect(res.body.variant?.id).toBe(v.id);
    expect(num(res.body.variant?.price)).toBe(210);
  });

  it("stock-count scan accepts a variant barcode and counts that variant", async () => {
    const sc = await admin().post("/api/stock-counts").send({ outlet_id: 1 });
    const id = sc.body.stockCount.id;
    const res = await admin().post(`/api/stock-counts/${id}/scan`).send({ barcode: "WB-BLUE-BC" });
    expect(res.status).toBe(200);
    expect(res.body.item.variant_id).not.toBeNull();
    await db.query("UPDATE stock_counts SET status = 'cancelled' WHERE id = $1", [id]);
  });
});

// ─── D7 ─────────────────────────────────────────────────────────────────────
describe("D7 — scanning the same item repeatedly in a stock count", () => {
  it("adds to one line whose system qty is the on-hand", async () => {
    const sc = await admin().post("/api/stock-counts").send({ outlet_id: 1 });
    const id = sc.body.stockCount.id;
    const onHand = num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1")).quantity);
    for (let i = 0; i < 3; i += 1) {
      expect((await admin().post(`/api/stock-counts/${id}/scan`).send({ barcode: "PROD-004" })).status).toBe(200);
    }
    const lines = await all("SELECT system_qty, counted_qty FROM stock_count_items WHERE stock_count_id = $1 AND product_id = 4", [id]);
    expect(lines.map((l) => [num(l.counted_qty), num(l.system_qty)])).toEqual([[3, onHand]]);
    await db.query("UPDATE stock_counts SET status = 'cancelled' WHERE id = $1", [id]);
  });
});

// ─── D8 ─────────────────────────────────────────────────────────────────────
describe("D8 — receiving more than was ordered", () => {
  it("is refused once the PO line is fully received", async () => {
    const po = await admin().post("/api/purchase-orders").send({ supplier_id: 2, items: [{ product_id: 5, quantity: 5, cost_price: 45 }] });
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;
    await db.query("UPDATE purchase_orders SET status = 'Approved' WHERE id = $1", [poId]);
    const before = num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1")).quantity);
    expect((await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 5, qty_received: 3 }] })).status).toBe(200);
    // 2nd delivery: the GRN dialog pre-fills the full ordered qty (5) again. Only 2 are outstanding.
    const over = await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 5, qty_received: 5 }] });
    expect(over.status).toBe(400);
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1")).quantity)).toBe(before + 3);
    // Receiving exactly the outstanding 2 completes the PO.
    expect((await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 5, qty_received: 2 }] })).status).toBe(200);
    expect((await one("SELECT status FROM purchase_orders WHERE id = $1", [poId])).status).toBe("Received");
  });

  it("a receive with no items list receives only what is still outstanding", async () => {
    const po = await admin().post("/api/purchase-orders").send({ supplier_id: 2, items: [{ product_id: 4, quantity: 10, cost_price: 30 }] });
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;
    await db.query("UPDATE purchase_orders SET status = 'Approved' WHERE id = $1", [poId]);
    const before = num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1")).quantity);
    await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 4, qty_received: 4 }] });
    expect((await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1 })).status).toBe(200);
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1")).quantity)).toBe(before + 10);
  });
});

// ─── D9, D10 ────────────────────────────────────────────────────────────────
describe("D9/D10 — sales summary payment split and profit summary discounts", () => {
  let saleId;
  beforeAll(async () => {
    await closeAnyOpenTill();
    await openTill();
    await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'reports_profit_layer'");
    await db.query("INSERT INTO feature_flags (key, enabled) VALUES ('reports_profit_layer', true) ON CONFLICT (key) DO UPDATE SET enabled = true");
    // Two lines (Snack D 50 + Drink E 75 = 125), Rs 25 bill discount → 100; paid 30 cash + 70 card.
    const res = await sell({
      cartItems: [{ id: 4, quantity: 1, price: 50 }, { id: 5, quantity: 1, price: 75 }],
      discount_amount: 25, discount_type: "fixed",
      payments: [{ method: "Cash", amount: 30 }, { method: "Card", amount: 70 }],
    });
    expect(res.status).toBe(200);
    saleId = res.body.saleId;
  });

  it("D9: a split bill is attributed to each method by what was actually paid", async () => {
    const res = await admin().get(`/api/reports/sales-summary?date_from=${today()}&date_to=${today()}`);
    expect(res.status).toBe(200);
    const paid = await all(
      `SELECT sp.payment_method, SUM(sp.amount) AS total FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
        WHERE s.voided = false GROUP BY sp.payment_method`,
    );
    for (const p of paid) {
      const row = res.body.payment_methods.find((m) => m.method === p.payment_method);
      expect([p.payment_method, Number(row?.total)]).toEqual([p.payment_method, num(p.total)]);
    }
  });

  it("D10: profit summary counts each bill's discount once, not once per line", async () => {
    const res = await admin().get(`/api/reports/profit-summary?date_from=${today()}&date_to=${today()}`);
    expect(res.status).toBe(200);
    const { d } = await one("SELECT COALESCE(SUM(discount_amount), 0) AS d FROM sales WHERE voided = false");
    expect(Number(res.body.summary.discount_amount)).toBe(num(d));
  });

  it("D10: dashboard gross profit takes bill discounts off", async () => {
    const before = await admin().get("/api/reports/dashboard");
    expect(before.status).toBe(200);
    // Snack D: price 50, cost 30, no tax. Rs 10 bill discount → profit 50 − 30 − 10 = 10.
    const res = await sell({
      cartItems: [{ id: 4, quantity: 1, price: 50 }],
      discount_amount: 10, discount_type: "fixed", payments: [{ method: "Card", amount: 40 }],
    });
    expect(res.status).toBe(200);
    const after = await admin().get("/api/reports/dashboard");
    expect(Math.round((after.body.todayGrossProfit - before.body.todayGrossProfit) * 100) / 100).toBe(10);
  });
});

// ─── D11 ────────────────────────────────────────────────────────────────────
describe("D11 — purchase reports with a PO received in two deliveries", () => {
  it("item-wise purchases counts the ordered qty once", async () => {
    const po = await admin().post("/api/purchase-orders").send({ supplier_id: 1, items: [{ product_id: 3, quantity: 4, cost_price: 300 }] });
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;
    await db.query("UPDATE purchase_orders SET status = 'Approved' WHERE id = $1", [poId]);
    await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 3, qty_received: 1 }] });
    await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 3, qty_received: 3 }] });

    const res = await admin().get(`/api/reports/itemwise-purchases?date_from=${today()}&date_to=${today()}`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i) => Number(i.product_id) === 3);
    const ordered = await one(
      `SELECT SUM(poi.quantity) AS q, SUM(poi.quantity * poi.cost_price) AS v FROM purchase_order_items poi WHERE poi.product_id = 3`,
    );
    expect([Number(row.qty_ordered), Number(row.ordered_cost)]).toEqual([num(ordered.q), num(ordered.v)]);
  });

  it("total purchases reports each PO's ordered and received value once", async () => {
    const res = await admin().get(`/api/reports/total-purchases?date_from=${today()}&date_to=${today()}`);
    expect(res.status).toBe(200);
    const ordered = await one("SELECT COALESCE(SUM(quantity * cost_price), 0) AS v FROM purchase_order_items");
    const received = await one("SELECT COALESCE(SUM(qty_received * cost_price), 0) AS v FROM grn_items");
    expect([Number(res.body.summary.ordered_cost), Number(res.body.summary.received_cost)]).toEqual([num(ordered.v), num(received.v)]);
  });
});

// ─── D12 ────────────────────────────────────────────────────────────────────
describe("D12 — payables report and the supplier ledger agree after a supplier return", () => {
  it("supplier outstanding in the payables report = the ledger balance", async () => {
    const po = await admin().post("/api/purchase-orders").send({ supplier_id: 1, items: [{ product_id: 1, quantity: 10, cost_price: 60 }] });
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;
    await db.query("UPDATE purchase_orders SET status = 'Approved' WHERE id = $1", [poId]);
    await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 1, qty_received: 10 }] });
    const ret = await admin().post("/api/supplier-returns").send({ supplier_id: 1, outlet_id: 1, items: [{ product_id: 1, quantity: 2, unit_price: 60 }] });
    expect(ret.status).toBe(200);

    const ledger = await admin().get("/api/supplier-ledger/1");
    expect(ledger.status).toBe(200);
    const pr = await admin().get("/api/reports/payables-receivables");
    expect(pr.status).toBe(200);
    const fromReport = pr.body.supplier_ap.filter((r) => r.supplier_name === "Supplier A").reduce((a, r) => a + Number(r.outstanding), 0);
    const ledgerBal = Number(ledger.body.closing_balance ?? ledger.body.balance ?? ledger.body.summary?.balance);
    expect(fromReport).toBe(ledgerBal);
  });
});

// ─── D16 ────────────────────────────────────────────────────────────────────
describe("D16 — paying a supplier invoice in two instalments", () => {
  it("marks the invoice paid when the 2nd instalment clears it", async () => {
    const po = await admin().post("/api/purchase-orders").send({ supplier_id: 2, items: [{ product_id: 5, quantity: 20, cost_price: 45 }] });
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;
    await db.query("UPDATE purchase_orders SET status = 'Approved' WHERE id = $1", [poId]);
    const grn = await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: 5, qty_received: 20 }] });
    expect(grn.status).toBe(200);
    const inv = await one("SELECT id, amount FROM supplier_invoices WHERE grn_id = $1", [grn.body.grn_id]);
    expect(num(inv.amount)).toBe(900);
    expect((await admin().post(`/api/supplier-invoices/${inv.id}/pay`).send({ amount: 500 })).status).toBe(200);
    expect((await admin().post(`/api/supplier-invoices/${inv.id}/pay`).send({ amount: 400 })).status).toBe(200);
    expect((await one("SELECT status FROM supplier_invoices WHERE id = $1", [inv.id])).status).toBe("paid");
  });
});

// ─── D17 ────────────────────────────────────────────────────────────────────
describe("D17 — profit reports take returns off", () => {
  // Snack D: price 50, cost 30, no tax. Selling 2 then returning 1 gives back 50 − 30 = 20 profit.
  let saleId;
  const profitSummary = async () => (await admin().get(`/api/reports/profit-summary?date_from=${today()}&date_to=${today()}`)).body.summary;
  const dashboardProfit = async () => (await admin().get("/api/reports/dashboard")).body.todayGrossProfit;
  const r2 = (n) => Math.round(n * 100) / 100;

  beforeAll(async () => {
    await closeAnyOpenTill();
    await openTill();
    await db.query("INSERT INTO feature_flags (key, enabled) VALUES ('reports_profit_layer', true) ON CONFLICT (key) DO UPDATE SET enabled = true");
    const res = await sell({ cartItems: [{ id: 4, quantity: 2, price: 50 }], payments: [{ method: "Card", amount: 100 }] });
    expect(res.status).toBe(200);
    saleId = res.body.saleId;
  });

  it("a restocked return takes its refund off net profit and gives its cost back", async () => {
    const psBefore = await profitSummary();
    const dashBefore = await dashboardProfit();
    const ret = await admin().post("/api/returns").send({
      original_sale_id: saleId, outlet_id: 1, employee_id: ADMIN_ID, total_refund: 50, refund_method: "Card",
      items: [{ product_id: 4, quantity: 1, refund_price: 50 }],
    });
    expect(ret.status).toBe(200);
    const psAfter = await profitSummary();
    expect(r2(Number(psBefore.net_profit) - Number(psAfter.net_profit))).toBe(20);
    expect(r2(Number(psAfter.returns_value) - Number(psBefore.returns_value || 0))).toBe(50);
    expect(r2(Number(psAfter.returns_profit) - Number(psBefore.returns_profit || 0))).toBe(20);
    expect(r2(dashBefore - (await dashboardProfit()))).toBe(20);
  });

  it("a written-off return (not put back in stock) takes the whole refund off", async () => {
    const psBefore = await profitSummary();
    const ret = await admin().post("/api/returns").send({
      original_sale_id: saleId, outlet_id: 1, employee_id: ADMIN_ID, total_refund: 50, refund_method: "Card",
      items: [{ product_id: 4, quantity: 1, refund_price: 50 }],
    });
    expect(ret.status).toBe(200);
    const retId = ret.body.returnId ?? ret.body.id ?? ret.body.return_id;
    await db.query("UPDATE return_items SET restock_flag = false WHERE return_id = $1", [retId]);
    const psAfter = await profitSummary();
    expect(r2(Number(psBefore.net_profit) - Number(psAfter.net_profit))).toBe(50);
  });
});

// ─── D21 ────────────────────────────────────────────────────────────────────
describe("D21 — profit by product and by outlet take returns off", () => {
  // Drink E: price 75, cost 45. Returning 1 (restocked) gives back 75 − 45 = 30 profit.
  const q = `date_from=${today()}&date_to=${today()}`;
  const byProduct = async () => (await admin().get(`/api/reports/profit-by-product?${q}&limit=500`)).body.items.find((r) => r.product_id === 5);
  const byOutlet = async () => (await admin().get(`/api/reports/profit-by-outlet?${q}`)).body.items.find((r) => r.outlet_id === 1);
  const r2 = (n) => Math.round(n * 100) / 100;
  let saleId;

  beforeAll(async () => {
    await closeAnyOpenTill();
    await openTill();
    await db.query("INSERT INTO feature_flags (key, enabled) VALUES ('reports_profit_layer', true) ON CONFLICT (key) DO UPDATE SET enabled = true");
    const res = await sell({ cartItems: [{ id: 5, quantity: 2, price: 75 }], payments: [{ method: "Card", amount: 150 }] });
    expect(res.status).toBe(200);
    saleId = res.body.saleId;
  });

  it("a return comes off that product's and that outlet's profit", async () => {
    const pBefore = await byProduct();
    const oBefore = await byOutlet();
    const ret = await admin().post("/api/returns").send({
      original_sale_id: saleId, outlet_id: 1, employee_id: ADMIN_ID, total_refund: 75, refund_method: "Card",
      items: [{ product_id: 5, quantity: 1, refund_price: 75 }],
    });
    expect(ret.status).toBe(200);
    const pAfter = await byProduct();
    const oAfter = await byOutlet();
    expect(r2(Number(pBefore.net_profit) - Number(pAfter.net_profit))).toBe(30);
    expect(r2(Number(pAfter.returns_value) - Number(pBefore.returns_value || 0))).toBe(75);
    expect(r2(Number(oBefore.net_profit) - Number(oAfter.net_profit))).toBe(30);
  });

  it("a product only returned in the period (sold earlier) still shows, with negative profit", async () => {
    const { id } = await one("INSERT INTO products (name, barcode, sku, price, cost_price, stock, status) VALUES ('Old Kite', 'D21-KITE', 'D21-KITE', 300, 100, 5, 'active') RETURNING id");
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 5)", [id]);
    const sale = await sell({ cartItems: [{ id, quantity: 1, price: 300 }], payments: [{ method: "Card", amount: 300 }] });
    expect(sale.status).toBe(200);
    await db.query("UPDATE sales SET timestamp = NOW() - INTERVAL '40 days' WHERE id = $1", [sale.body.saleId]);
    const ret = await admin().post("/api/returns").send({
      original_sale_id: sale.body.saleId, outlet_id: 1, employee_id: ADMIN_ID, total_refund: 300, refund_method: "Card",
      items: [{ product_id: id, quantity: 1, refund_price: 300 }],
    });
    expect(ret.status).toBe(200);
    const row = (await admin().get(`/api/reports/profit-by-product?${q}&limit=500`)).body.items.find((r) => r.product_id === id);
    expect(row).toBeTruthy();
    expect(Number(row.units_sold)).toBe(0);
    expect(Number(row.net_profit)).toBe(-200);
  });
});

// ─── D20 ────────────────────────────────────────────────────────────────────
describe("D20 — stockout-risk report", () => {
  it("loads (it 500'd on every shop: ORDER BY used an output alias inside a CASE)", async () => {
    await db.query("INSERT INTO feature_flags (key, enabled) VALUES ('reports_inventory_health_plus', true) ON CONFLICT (key) DO UPDATE SET enabled = true");
    const res = await admin().get("/api/reports/stockout-risk");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

// ─── D22 ────────────────────────────────────────────────────────────────────
describe("D22 — dead stock report", () => {
  let slowId, freshId;
  beforeAll(async () => {
    await closeAnyOpenTill();
    await openTill();
    const mk = async (name, bc) => (await one(
      `INSERT INTO products (name, barcode, sku, price, cost_price, stock, status) VALUES ($1, $2, $2, 200, 80, 10, 'active') RETURNING id`, [name, bc])).id;
    slowId = await mk("Slow Puzzle", "D22-SLOW");
    freshId = await mk("Fresh Puzzle", "D22-FRESH");
    for (const id of [slowId, freshId]) {
      await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 12) ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 12", [id]);
    }
    // Slow Puzzle: two bills, both 100 days ago. Fresh Puzzle: sold today.
    for (let i = 0; i < 2; i += 1) {
      const r = await sell({ cartItems: [{ id: slowId, quantity: 1, price: 200 }], payments: [{ method: "Card", amount: 200 }] });
      expect(r.status).toBe(200);
      await db.query("UPDATE sales SET timestamp = NOW() - INTERVAL '100 days' WHERE id = $1", [r.body.saleId]);
    }
    const f = await sell({ cartItems: [{ id: freshId, quantity: 1, price: 200 }], payments: [{ method: "Card", amount: 200 }] });
    expect(f.status).toBe(200);
  });

  it("lists an item unsold for 90+ days with its real stock and value (not multiplied by past sale lines)", async () => {
    const res = await admin().get("/api/reports/dead-stock?inactive_days=90");
    expect(res.status).toBe(200);
    const row = res.body.items.find((r) => r.product_id === slowId);
    const onHand = num((await one("SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1", [slowId])).quantity);
    expect(row).toBeTruthy();
    expect(num(row.stock_qty)).toBe(onHand);
    expect(num(row.stock_cost_value)).toBe(onHand * 80);
    expect(num(row.stock_retail_value)).toBe(onHand * 200);
    expect(row.days_since_sale).toBeGreaterThanOrEqual(99);
    expect(row.last_sold_at).toBeTruthy();
    expect(row.outlet_name).toBeTruthy();
  });

  it("does not list an item sold today", async () => {
    const res = await admin().get("/api/reports/dead-stock?inactive_days=90");
    expect(res.body.items.some((r) => r.product_id === freshId)).toBe(false);
  });
});

// ─── D23 ────────────────────────────────────────────────────────────────────
describe("D23 — Sales & Stock report", () => {
  // Yo-yo: price 150. Two real bills of 1 and one voided bill, all at outlet 1.
  // Then stock is 4 at each of the two outlets (equal on purpose).
  let id;
  const row = async (qs = "") => (await admin().get(`/api/reports/sales-stock?${qs}`)).body.items.find((r) => r.id === id);

  beforeAll(async () => {
    await closeAnyOpenTill();
    await openTill();
    ({ id } = await one("INSERT INTO products (name, barcode, sku, price, cost_price, stock, status) VALUES ('Yo-yo', 'D23-YOYO', 'D23-YOYO', 150, 60, 10, 'active') RETURNING id"));
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 10), ($1, 2, 4)", [id]);
    const saleIds = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await sell({ cartItems: [{ id, quantity: 1, price: 150 }], payments: [{ method: "Card", amount: 150 }] });
      expect(r.status).toBe(200);
      saleIds.push(r.body.saleId);
    }
    await db.query("UPDATE sales SET voided = true WHERE id = $1", [saleIds[2]]);
    await db.query("UPDATE outlet_stock SET quantity = 4 WHERE product_id = $1", [id]);
  });

  it("stock is the sum over outlets, sales skip voided bills, nothing is multiplied", async () => {
    const r = await row();
    expect(num(r.total_stock)).toBe(8);
    expect(num(r.units_sold)).toBe(2);
    expect(num(r.revenue)).toBe(300);
  });

  it("the outlet filter limits both stock and sales", async () => {
    const r = await row("outlet_id=2");
    expect(num(r.total_stock)).toBe(4);
    expect(num(r.units_sold)).toBe(0);
  });

  it("the date filter limits sales", async () => {
    const r = await row("date_from=2020-01-01&date_to=2020-01-31");
    expect(num(r.units_sold)).toBe(0);
    expect(num(r.total_stock)).toBe(8);
  });

  it("a deleted product is not listed", async () => {
    await db.query("UPDATE products SET deleted_at = NOW() WHERE id = $1", [id]);
    expect(await row()).toBeUndefined();
    await db.query("UPDATE products SET deleted_at = NULL WHERE id = $1", [id]);
  });
});

// ─── D6 ─────────────────────────────────────────────────────────────────────
// Last in the file on purpose: the full-count case zeroes the shop.
describe("D6 — completing a stock count of one shelf", () => {
  const stockOf = async (pid) => num((await one("SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1", [pid]))?.quantity ?? 0);
  const variantStockOf = async (vid) => num((await one("SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [vid]))?.quantity ?? 0);
  const setStock = (pid, q) => db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, $2)
     ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = EXCLUDED.quantity`, [pid, q]);
  const startCount = async () => (await admin().post("/api/stock-counts").send({ outlet_id: 1 })).body.stockCount.id;

  let variantProductId, variantId;
  beforeAll(async () => {
    await setStock(4, 7);
    await setStock(5, 9);
    await setStock(1, 6);
    const res = await admin().post("/api/products").send({
      name: "Count Car", sku: "CC-PARENT", price: 450, cost_price: 260, has_variants: true, outlet_id: 1,
      variants: [{ sku: "CC-RED", barcode: "CC-RED-BC", price: 450, cost_price: 260, initial_stock: 4 }],
    });
    expect(res.status).toBe(200);
    variantProductId = res.body.id;
    variantId = (await one("SELECT id FROM product_variants WHERE product_id = $1", [variantProductId])).id;
  });

  it("a shelf count only corrects the items that were scanned; the rest keep their stock", async () => {
    const id = await startCount();
    for (let i = 0; i < 2; i += 1) {
      expect((await admin().post(`/api/stock-counts/${id}/scan`).send({ barcode: "PROD-004" })).status).toBe(200);
    }
    const done = await admin().post(`/api/stock-counts/${id}/complete?auto_adjust=true`).send({});
    expect(done.status).toBe(200);
    expect(await stockOf(4)).toBe(2);
    expect(await stockOf(5)).toBe(9);
    expect(await variantStockOf(variantId)).toBe(4);
    expect(await stockOf(variantProductId)).toBe(4);
    expect(done.body.summary.items_with_variance).toBe(1);
    expect(done.body.summary.items_not_counted).toBeGreaterThan(0);
  });

  it("an item deliberately counted as 0 is set to 0", async () => {
    const id = await startCount();
    const line = await one("SELECT id FROM stock_count_items WHERE stock_count_id = $1 AND product_id = 5 AND variant_id IS NULL", [id]);
    expect((await admin().put(`/api/stock-counts/${id}/items/${line.id}`).send({ counted_qty: 0 })).status).toBe(200);
    expect((await admin().post(`/api/stock-counts/${id}/complete?auto_adjust=true`).send({})).status).toBe(200);
    expect(await stockOf(5)).toBe(0);
    expect(await stockOf(1)).toBe(6);
  });

  it("completing twice does not adjust twice", async () => {
    await setStock(4, 7);
    const id = await startCount();
    await admin().post(`/api/stock-counts/${id}/scan`).send({ barcode: "PROD-004" });
    const [a, b] = await Promise.all([
      admin().post(`/api/stock-counts/${id}/complete?auto_adjust=true`).send({}),
      admin().post(`/api/stock-counts/${id}/complete?auto_adjust=true`).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await stockOf(4)).toBe(1);
  });

  it("a full count zeroes everything not counted, including each variant, keeping variant and product totals in step", async () => {
    await setStock(1, 6);
    const id = await startCount();
    await admin().post(`/api/stock-counts/${id}/scan`).send({ barcode: "PROD-004" });
    const done = await admin().post(`/api/stock-counts/${id}/complete?auto_adjust=true&full_count=true`).send({});
    expect(done.status).toBe(200);
    expect(done.body.fullCount).toBe(true);
    expect(await stockOf(4)).toBe(1);
    expect(await stockOf(1)).toBe(0);
    expect(await variantStockOf(variantId)).toBe(0);
    expect(await stockOf(variantProductId)).toBe(0);
    expect(num((await one("SELECT stock FROM product_variants WHERE id = $1", [variantId])).stock)).toBe(0);
  });
});

// ─── Blocker 1: online orders reduce shop stock ─────────────────────────────
// docs/onetoystore-pilot/PROGRESS.md findings 1a–1f. Orders arrive through the
// real webhook route with a real HMAC signature.
describe("Blocker 1 — Shopify online orders move shop stock", () => {
  const crypto = require("crypto");
  const SECRET = "ots_whsec_test";
  const SHOP = "ots-test.myshopify.com";
  let hookSeq = 0;
  let plainId, skuOnlyId, mappedId, variantProductId, variantId;
  const stockOf = async (pid) => num((await one("SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1", [pid]))?.quantity ?? 0);
  const variantStockOf = async (vid) => num((await one("SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [vid]))?.quantity ?? 0);

  function sendHook(payload, { path = "/api/integrations/shopify/webhooks/orders-create", topic = "orders/create" } = {}) {
    const body = JSON.stringify(payload);
    const hmac = crypto.createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
    return makeRequest(app)
      .post(path)
      .set("content-type", "application/json")
      .set("x-shopify-webhook-id", `ots-hook-${++hookSeq}-${Date.now()}`)
      .set("x-shopify-shop-domain", SHOP)
      .set("x-shopify-topic", topic)
      .set("x-shopify-hmac-sha256", hmac)
      .send(body);
  }

  let orderSeq = 0;
  function order(lines, extra = {}) {
    orderSeq += 1;
    return {
      id: 7700000 + orderSeq,
      name: `#OTS${orderSeq}`,
      currency: "PKR",
      financial_status: "pending", // cash on delivery
      total_price: "1000.00",
      created_at: "2026-09-26T10:00:00Z",
      updated_at: "2026-09-26T10:00:00Z",
      cancelled_at: null,
      refunds: [],
      line_items: lines.map((l, i) => ({ id: 88000000 + orderSeq * 10 + i, quantity: 1, price: "500.00", ...l })),
      ...extra,
    };
  }

  beforeAll(async () => {
    await db.query("UPDATE shopify_connections SET is_active = false");
    await db.query(
      `INSERT INTO shopify_connections (shop_domain, access_token, webhook_secret, default_location_id, is_active)
       VALUES ($1, 'shpat_test', $2, 'loc-1', true)`, [SHOP, SECRET]);
    await db.query("INSERT INTO shopify_location_map (outlet_id, shopify_location_id) VALUES (1, 'loc-1') ON CONFLICT DO NOTHING");

    const mk = async (name, sku, qty) => {
      const p = await one(
        `INSERT INTO products (name, sku, barcode, price, cost_price, stock) VALUES ($1, $2, NULL, 500, 300, $3) RETURNING id`,
        [name, sku, qty]);
      await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, $2)", [p.id, qty]);
      return p.id;
    };
    plainId = await mk("OTS Plain Doll", null, 10);            // matched through the Shopify product map
    skuOnlyId = await mk("OTS Puzzle", "OTS-PUZZLE", 10);       // plain product, matched by its own SKU
    mappedId = await mk("OTS Kite", null, 10);                  // mapped; used by the lifecycle tests
    await db.query(
      `INSERT INTO shopify_product_map (product_id, variant_id, shopify_product_id, shopify_variant_id, is_active)
       VALUES ($1, NULL, 'sp-doll', 'sv-doll', true), ($2, NULL, 'sp-kite', 'sv-kite', true)`, [plainId, mappedId]);

    variantProductId = (await one(
      `INSERT INTO products (name, price, cost_price, stock, has_variants) VALUES ('OTS Hot Wheels', 500, 300, 6, true) RETURNING id`)).id;
    variantId = (await one(
      `INSERT INTO product_variants (product_id, sku, price, cost_price, stock) VALUES ($1, 'OTS-HW-RED', 500, 300, 6) RETURNING id`,
      [variantProductId])).id;
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 6)", [variantProductId]);
    await db.query("INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 6)", [variantId]);
    await db.query(
      `INSERT INTO shopify_product_map (product_id, variant_id, shopify_product_id, shopify_variant_id, is_active)
       VALUES ($1, $2, 'sp-hw', 'sv-hw-red', true)`, [variantProductId, variantId]);
  });

  it("1a: a cash-on-delivery (unpaid) order takes the stock off as soon as it arrives", async () => {
    const before = await stockOf(skuOnlyId);
    const res = await sendHook(order([{ sku: "OTS-PUZZLE", quantity: 2, variant_id: 555 }]));
    expect(res.status).toBe(200);
    expect(await stockOf(skuOnlyId)).toBe(before - 2);
  });

  it("1e: a line with no barcode is matched through the Shopify product map", async () => {
    const before = await stockOf(plainId);
    const res = await sendHook(order([{ variant_id: "sv-doll", product_id: "sp-doll", sku: "", quantity: 1 }], { financial_status: "paid" }));
    expect(res.status).toBe(200);
    expect(await stockOf(plainId)).toBe(before - 1);
  });

  it("1f: a variant line moves the variant's own shop stock, not just the product total", async () => {
    const vBefore = await variantStockOf(variantId);
    const pBefore = await stockOf(variantProductId);
    const res = await sendHook(order([{ variant_id: "sv-hw-red", sku: "", quantity: 2 }]));
    expect(res.status).toBe(200);
    expect(await variantStockOf(variantId)).toBe(vBefore - 2);
    expect(await stockOf(variantProductId)).toBe(pBefore - 2);
  });

  it("1d: a cancelled order puts the stock back, once", async () => {
    const o = order([{ variant_id: "sv-kite", quantity: 3 }]);
    const before = await stockOf(mappedId);
    expect((await sendHook(o)).status).toBe(200);
    expect(await stockOf(mappedId)).toBe(before - 3);

    const cancelled = { ...o, cancelled_at: "2026-09-26T11:00:00Z", updated_at: "2026-09-26T11:00:00Z" };
    expect((await sendHook(cancelled, { topic: "orders/cancelled" })).status).toBe(200);
    expect(await stockOf(mappedId)).toBe(before);
    expect((await one("SELECT order_status FROM web_orders WHERE external_order_id = $1", [String(o.id)])).order_status).toBe("cancelled");

    // Shopify also sends orders/updated for the same cancellation: no double put-back.
    expect((await sendHook(cancelled, { topic: "orders/updated" })).status).toBe(200);
    expect(await stockOf(mappedId)).toBe(before);
  });

  it("the same order delivered twice by Shopify (create + updated) only takes stock off once", async () => {
    const o = order([{ variant_id: "sv-kite", quantity: 1 }], { financial_status: "paid" });
    const before = await stockOf(mappedId);
    await sendHook(o, { topic: "orders/create" });
    await sendHook({ ...o, updated_at: "2026-09-26T10:05:00Z" }, { topic: "orders/updated" });
    expect(await stockOf(mappedId)).toBe(before - 1);
  });

  it("a refund that restocks 1 of 2 puts back 1; a refund without restock puts back nothing", async () => {
    const o = order([{ variant_id: "sv-kite", quantity: 2 }], { financial_status: "paid" });
    const lineId = o.line_items[0].id;
    const before = await stockOf(mappedId);
    await sendHook(o);
    expect(await stockOf(mappedId)).toBe(before - 2);

    const noRestock = {
      ...o, financial_status: "partially_refunded", updated_at: "2026-09-26T12:00:00Z",
      refunds: [{ id: 1, refund_line_items: [{ line_item_id: lineId, quantity: 1, restock_type: "no_restock" }] }],
    };
    await sendHook(noRestock, { topic: "orders/updated" });
    expect(await stockOf(mappedId)).toBe(before - 2);

    const restock = {
      ...noRestock, updated_at: "2026-09-26T12:10:00Z",
      refunds: [...noRestock.refunds, { id: 2, refund_line_items: [{ line_item_id: lineId, quantity: 1, restock_type: "return" }] }],
    };
    await sendHook(restock, { topic: "orders/updated" });
    expect(await stockOf(mappedId)).toBe(before - 1);
  });

  it("an older update arriving late does not undo a newer one", async () => {
    const o = order([{ variant_id: "sv-kite", quantity: 1 }], { financial_status: "paid" });
    const before = await stockOf(mappedId);
    await sendHook(o);
    await sendHook({ ...o, cancelled_at: "2026-09-26T13:00:00Z", updated_at: "2026-09-26T13:00:00Z" }, { topic: "orders/cancelled" });
    expect(await stockOf(mappedId)).toBe(before);
    // Shopify retries the earlier create after the cancel has landed.
    await sendHook(o, { topic: "orders/create" });
    expect(await stockOf(mappedId)).toBe(before);
  });

  it("1e: an unmatched line doesn't stop the matched lines, and the order names the line that needs attention", async () => {
    const before = await stockOf(mappedId);
    const o = order([{ variant_id: "sv-kite", quantity: 1 }, { sku: "NOT-IN-SANOPOS", title: "Mystery Box", quantity: 1 }], { financial_status: "paid" });
    const res = await sendHook(o);
    expect(res.status).toBe(200);
    expect(await stockOf(mappedId)).toBe(before - 1);
    const row = await one("SELECT stock_policy_note FROM web_orders WHERE external_order_id = $1", [String(o.id)]);
    expect(row.stock_policy_note).toMatch(/Mystery Box/);
  });

  it("1b: the per-shop webhook address is served before the login wall", async () => {
    // Shopify's call carries no SanoPOS login. In multi-tenant mode a route
    // mounted after the auth middleware answers 401 AUTH_REQUIRED before the
    // signature check can run (PROGRESS 1b), so the webhook must sit in front.
    const PATH = "/api/integrations/shopify/webhooks/orders/:tenantSlug";
    const stack = app.router?.stack || app._router.stack;
    const authIdx = stack.findIndex((l) => l.name === "loadEmployeePerms" || l.name === "loadTenantAndPerms");
    const hookIdx = stack.findIndex((l) =>
      l.route?.path === PATH || (l.handle?.stack || []).some((s) => s.route?.path === PATH));
    expect(authIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(authIdx);

    const before = await stockOf(skuOnlyId);
    const res = await sendHook(order([{ sku: "OTS-PUZZLE", quantity: 1 }]), { path: "/api/integrations/shopify/webhooks/orders/anyshop" });
    expect(res.status).toBe(200);
    expect(await stockOf(skuOnlyId)).toBe(before - 1);
  });

  it("a webhook with a bad signature changes nothing", async () => {
    const before = await stockOf(skuOnlyId);
    const res = await makeRequest(app)
      .post("/api/integrations/shopify/webhooks/orders-create")
      .set("x-shopify-webhook-id", `bad-${Date.now()}`)
      .set("x-shopify-shop-domain", SHOP)
      .set("x-shopify-hmac-sha256", "forged")
      .send(order([{ sku: "OTS-PUZZLE", quantity: 1 }]));
    expect(res.status).toBe(401);
    expect(await stockOf(skuOnlyId)).toBe(before);
  });

  it("OTS step 7: the online order's stock movement is tagged in the History with the Shopify order no", async () => {
    const payload = order([{ sku: "OTS-PUZZLE", quantity: 1 }]);
    expect((await sendHook(payload)).status).toBe(200);
    const m = await one(
      "SELECT kind, ref_type, ref_no, qty_change FROM stock_movements WHERE product_id = $1 AND variant_id IS NULL ORDER BY id DESC LIMIT 1",
      [skuOnlyId]);
    expect(m).toMatchObject({ kind: "online_order", ref_type: "web_order", ref_no: payload.name });
    expect(num(m.qty_change)).toBe(-1);
  });
});

// ─── D25 ────────────────────────────────────────────────────────────────────
// Saving a product with variants wrote each variant's stock from the number the
// edit screen had loaded (stock = v.stock || 0), so a sale made while the screen
// was open vanished from the count, and only the product_variants rollup moved
// (not the per-outlet row a sale checks). A product edit must never move stock:
// stock moves through sales, receiving, adjustments and counts only.
describe("D25 — editing a product with variants never touches stock", () => {
  let productId, red, blue;
  beforeAll(async () => {
    await closeAnyOpenTill();
    await openTill();
    const res = await admin().post("/api/products").send({
      name: "D25 Car", sku: "D25-CAR", price: 500, cost_price: 300, has_variants: true, outlet_id: 1,
      variants: [
        { sku: "D25-RED", barcode: "D25-RED-BC", price: 500, cost_price: 300, initial_stock: 6 },
        { sku: "D25-BLUE", barcode: "D25-BLUE-BC", price: 500, cost_price: 300, initial_stock: 4 },
      ],
    });
    expect(res.status).toBe(200);
    productId = res.body.id;
    [red, blue] = (await db.query("SELECT id, sku, barcode FROM product_variants WHERE product_id = $1 ORDER BY sku DESC", [productId])).rows;
    expect(red.sku).toBe("D25-RED");
  });

  const counts = async (variantId) => ({
    rollup: num((await one("SELECT stock FROM product_variants WHERE id = $1", [variantId])).stock),
    outlet: num((await one("SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [variantId])).quantity),
  });

  it("a sale made while the edit screen was open survives the save", async () => {
    // The edit screen loads: red 6, blue 4.
    const loaded = (await admin().get(`/api/products/${productId}/variants`)).body.variants;
    const loadedRed = loaded.find((v) => v.id === red.id);
    expect(num(loadedRed.stock)).toBe(6);

    // Meanwhile the counter sells one red.
    const sale = await sell({ cartItems: [{ id: productId, variant_id: red.id, quantity: 1, price: 500 }], payments: [{ method: "Card", amount: 500 }] });
    expect(sale.status).toBe(200);
    expect(await counts(red.id)).toEqual({ rollup: 5, outlet: 5 });

    // The owner changes red's price and saves, sending the stock the screen loaded.
    const res = await admin().put(`/api/products/${productId}`).send({
      variants: [
        { id: red.id, sku: red.sku, barcode: red.barcode, price: 550, cost_price: 300, stock: 6 },
        { id: blue.id, sku: blue.sku, barcode: blue.barcode, price: 500, cost_price: 300, stock: 4 },
      ],
    });
    expect(res.status).toBe(200);

    expect(await counts(red.id)).toEqual({ rollup: 5, outlet: 5 });
    expect(await counts(blue.id)).toEqual({ rollup: 4, outlet: 4 });
    expect(num((await one("SELECT price FROM product_variants WHERE id = $1", [red.id])).price)).toBe(550);
  });

  it("a variant row sent without stock keeps its stock (no reset to 0)", async () => {
    const res = await admin().put(`/api/products/${productId}`).send({
      variants: [{ id: blue.id, sku: blue.sku, barcode: blue.barcode, price: 520, cost_price: 300 }],
    });
    expect(res.status).toBe(200);
    expect(await counts(blue.id)).toEqual({ rollup: 4, outlet: 4 });
  });
});
