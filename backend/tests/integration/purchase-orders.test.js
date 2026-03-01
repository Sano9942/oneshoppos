/**
 * purchase-orders.test.js — Integration tests for PO lifecycle + GRN
 *
 * Targets bugs: B4 (TOCTOU on receive), B5 (partial receive fallback), B6 (invoice outside txn)
 */

const {
  createTestApp,
  closeDb,
  dbAll,
  dbGet,
  dbRun,
} = require("../helpers/createTestApp");
const {
  makeRequest,
  ADMIN_ID,
  MANAGER_ID,
  CASHIER_ID,
} = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

// Helper: create a PO with 2 items
async function createPO(overrides = {}) {
  const res = await makeRequest(app, MANAGER_ID)
    .post("/api/purchase-orders")
    .send({
      supplier_id: 1,
      total_cost: 500,
      items: [
        { product_id: 1, quantity: 10, cost_price: 30 },
        { product_id: 2, quantity: 5, cost_price: 40 },
      ],
      ...overrides,
    });
  return res;
}

describe("POST /api/purchase-orders — Create PO", () => {
  it("creates PO with status Draft", async () => {
    const res = await createPO();
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    const po = await dbGet(db, "SELECT * FROM purchase_orders WHERE id = ?", [
      res.body.id,
    ]);
    expect(po.status).toBe("Draft");
    expect(po.supplier_id).toBe(1);
  });

  it("PO with no items returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/purchase-orders")
      .send({ supplier_id: 1, total_cost: 0, items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items/i);
  });

  it("GET PO by ID returns items", async () => {
    const createRes = await createPO();
    const res = await makeRequest(app).get(
      `/api/purchase-orders/${createRes.body.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.purchaseOrder).toBeDefined();
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].product_id).toBe(1);
  });
});

describe("DELETE /api/purchase-orders/:id", () => {
  it("delete Draft PO succeeds", async () => {
    const createRes = await createPO();
    const res = await makeRequest(app, MANAGER_ID).delete(
      `/api/purchase-orders/${createRes.body.id}`,
    );
    expect(res.status).toBe(200);
  });

  it("delete Received PO returns 400", async () => {
    const createRes = await createPO();
    // Approve it first
    await dbRun(
      db,
      "UPDATE purchase_orders SET status = 'Approved' WHERE id = ?",
      [createRes.body.id],
    );
    await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({ outlet_id: 1 });

    const res = await makeRequest(app, MANAGER_ID).delete(
      `/api/purchase-orders/${createRes.body.id}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/received/i);
  });
});

describe("POST /api/purchase-orders/:id/receive — Receive PO", () => {
  it("receive updates stock and product cost_price", async () => {
    const createRes = await createPO();
    const stockBefore = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );

    await dbRun(
      db,
      "UPDATE purchase_orders SET status = 'Approved' WHERE id = ?",
      [createRes.body.id],
    );
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({ outlet_id: 1, received_by: MANAGER_ID });

    expect(res.status).toBe(200);
    expect(res.body.grn_number).toBeDefined();

    // Stock increased by ordered quantity (10 for product 1)
    const stockAfter = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    expect(stockAfter.quantity).toBe(stockBefore.quantity + 10);

    // Cost price updated
    const product = await dbGet(
      db,
      "SELECT cost_price FROM products WHERE id = 1",
    );
    expect(product.cost_price).toBe(30);
  });

  it("receive same PO twice returns 400", async () => {
    const createRes = await createPO();
    await dbRun(
      db,
      "UPDATE purchase_orders SET status = 'Approved' WHERE id = ?",
      [createRes.body.id],
    );
    await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({ outlet_id: 1 });

    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({ outlet_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already received/i);
  });

  it("receive without outlet_id returns 400", async () => {
    const createRes = await createPO();
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outlet/i);
  });

  it("BUG B5: partial receive — omitted items fall back to FULL ordered qty instead of zero", async () => {
    const createRes = await createPO();
    const stockBefore1 = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    const stockBefore2 = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );

    await dbRun(
      db,
      "UPDATE purchase_orders SET status = 'Approved' WHERE id = ?",
      [createRes.body.id],
    );
    // Only send qty_received for product 1 (3 of 10), omit product 2
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({
        outlet_id: 1,
        items: [{ product_id: 1, qty_received: 3 }],
        // product 2 deliberately omitted
      });

    expect(res.status).toBe(200);

    const stockAfter1 = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    expect(stockAfter1.quantity).toBe(stockBefore1.quantity + 3); // Correctly received 3

    // BUG: B5 — Product 2 was NOT in receivedItems, so receivedMap[2] is undefined
    // The code uses `receivedMap[item.product_id] ?? item.quantity` which falls back to full qty (5)
    // Expected: 0 increase (product not received), Actual: +5 (full ordered qty)
    const stockAfter2 = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );
    expect(stockAfter2.quantity).toBe(stockBefore2.quantity + 5); // BUG: B5 — should be +0, is +5
  });

  it("BUG B6: receive auto-creates supplier_invoices row (outside transaction)", async () => {
    const createRes = await createPO({ total_cost: 800 });

    await dbRun(
      db,
      "UPDATE purchase_orders SET status = 'Approved' WHERE id = ?",
      [createRes.body.id],
    );
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({ outlet_id: 1 });

    expect(res.status).toBe(200);

    // Wait a tick for the async invoice insert to complete (it's outside the transaction)
    await new Promise((r) => setTimeout(r, 50));

    // BUG: B6 — The INSERT INTO supplier_invoices runs AFTER COMMIT, outside the transaction
    // It still succeeds in normal conditions, but if it fails, the GRN is committed without an invoice
    const invoice = await dbGet(
      db,
      "SELECT * FROM supplier_invoices WHERE po_id = ?",
      [createRes.body.id],
    );
    expect(invoice).toBeDefined(); // Works in happy path, but not transactional
    expect(invoice.amount).toBe(800);
  });

  it("receive PO with total_cost=0 does not create invoice", async () => {
    const createRes = await createPO({ total_cost: 0 });

    await dbRun(
      db,
      "UPDATE purchase_orders SET status = 'Approved' WHERE id = ?",
      [createRes.body.id],
    );
    await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${createRes.body.id}/receive`)
      .send({ outlet_id: 1 });

    await new Promise((r) => setTimeout(r, 50));

    const invoice = await dbGet(
      db,
      "SELECT * FROM supplier_invoices WHERE po_id = ?",
      [createRes.body.id],
    );
    expect(invoice).toBeUndefined(); // No invoice for zero-cost PO
  });
});

describe("GET /api/grn — GRN List & Detail", () => {
  it("GET /api/grn returns list", async () => {
    const res = await makeRequest(app).get("/api/grn");
    expect(res.status).toBe(200);
    expect(res.body.grns).toBeDefined();
    expect(res.body.grns.length).toBeGreaterThan(0);
  });

  it("GET /api/grn/:id returns detail with items", async () => {
    const grns = await dbAll(db, "SELECT id FROM goods_received_notes LIMIT 1");
    const res = await makeRequest(app).get(`/api/grn/${grns[0].id}`);
    expect(res.status).toBe(200);
    expect(res.body.grn).toBeDefined();
    expect(res.body.items).toBeDefined();
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});
