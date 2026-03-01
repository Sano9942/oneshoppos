/**
 * supplier-payables.test.js — Integration tests for supplier invoices and payments
 *
 * Tests: /api/supplier-invoices, /api/supplier-invoices/:id/pay, /api/supplier-aging
 */

const { createTestApp, closeDb, dbAll, dbGet, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID } = require("../helpers/request");

let app, db;
let invoiceId;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;

  // Create a PO, receive it to auto-create a supplier invoice
  const poRes = await makeRequest(app, MANAGER_ID)
    .post("/api/purchase-orders")
    .send({
      supplier_id: 1,
      total_cost: 1000,
      items: [{ product_id: 1, quantity: 10, cost_price: 100 }],
    });

  await makeRequest(app, MANAGER_ID)
    .post(`/api/purchase-orders/${poRes.body.id}/receive`)
    .send({ outlet_id: 1 });

  // Wait for async invoice creation (B6 — outside txn)
  await new Promise((r) => setTimeout(r, 100));

  const inv = await dbGet(db, "SELECT id FROM supplier_invoices WHERE po_id = ?", [poRes.body.id]);
  invoiceId = inv.id;
});

afterAll(async () => {
  await closeDb(db);
});

describe("GET /api/supplier-invoices", () => {
  it("returns invoices with amount_paid and amount_due", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/supplier-invoices");
    expect(res.status).toBe(200);
    expect(res.body.invoices).toBeDefined();
    expect(res.body.invoices.length).toBeGreaterThan(0);

    const inv = res.body.invoices.find((i) => i.id === invoiceId);
    expect(inv).toBeDefined();
    expect(inv.amount).toBe(1000);
    expect(inv.amount_paid).toBe(0);
    expect(inv.amount_due).toBe(1000);
  });
});

describe("POST /api/supplier-invoices/:id/pay", () => {
  it("partial payment keeps status pending/partial", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/supplier-invoices/${invoiceId}/pay`)
      .send({ amount: 400, payment_method: "Cash", paid_by: MANAGER_ID });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial");
  });

  it("second partial summing to full → status paid", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/supplier-invoices/${invoiceId}/pay`)
      .send({ amount: 600, payment_method: "Bank Transfer", paid_by: MANAGER_ID });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
  });

  it("payment on fully paid invoice returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/supplier-invoices/${invoiceId}/pay`)
      .send({ amount: 100, payment_method: "Cash" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already.*paid/i);
  });

  it("overpayment returns 400", async () => {
    // Create another invoice to test overpayment
    const poRes = await makeRequest(app, MANAGER_ID)
      .post("/api/purchase-orders")
      .send({
        supplier_id: 2,
        total_cost: 200,
        items: [{ product_id: 3, quantity: 1, cost_price: 200 }],
      });
    await makeRequest(app, MANAGER_ID)
      .post(`/api/purchase-orders/${poRes.body.id}/receive`)
      .send({ outlet_id: 1 });
    await new Promise((r) => setTimeout(r, 100));

    const inv = await dbGet(db, "SELECT id FROM supplier_invoices WHERE po_id = ?", [poRes.body.id]);

    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/supplier-invoices/${inv.id}/pay`)
      .send({ amount: 500, payment_method: "Cash" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds/i);
  });
});

describe("GET /api/supplier-invoices/:id — Detail with payments", () => {
  it("returns invoice with payment history", async () => {
    const res = await makeRequest(app, ADMIN_ID).get(`/api/supplier-invoices/${invoiceId}`);
    expect(res.status).toBe(200);
    expect(res.body.invoice).toBeDefined();
    expect(res.body.payments).toBeDefined();
    expect(res.body.payments.length).toBe(2); // 400 + 600
  });
});

describe("GET /api/supplier-aging — Aging Report", () => {
  it("returns supplier aging with unpaid invoices", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/supplier-aging");
    expect(res.status).toBe(200);
    expect(res.body.aging).toBeDefined();
    // At least one supplier with invoiced amount
    expect(res.body.aging.length).toBeGreaterThan(0);
  });
});
