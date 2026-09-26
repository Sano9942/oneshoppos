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
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
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

// ─── D20 ────────────────────────────────────────────────────────────────────
describe("D20 — stockout-risk report", () => {
  it("loads (it 500'd on every shop: ORDER BY used an output alias inside a CASE)", async () => {
    await db.query("INSERT INTO feature_flags (key, enabled) VALUES ('reports_inventory_health_plus', true) ON CONFLICT (key) DO UPDATE SET enabled = true");
    const res = await admin().get("/api/reports/stockout-risk");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
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
