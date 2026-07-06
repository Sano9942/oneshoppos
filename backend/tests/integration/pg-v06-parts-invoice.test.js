/**
 * pg-v06-parts-invoice.test.js — V06 P0 parts-on-tickets + itemized invoice.
 *
 * Against a real isolated Postgres schema:
 *   - add part → outlet_stock decrements (FOR UPDATE discipline), line snapshots
 *     price/cost; labor/fee lines carry no stock movement
 *   - serialized part flips its serial 'available' → 'sold'
 *   - insufficient stock rejects with a clear message, no partial decrement
 *   - remove part before invoice restocks (+ releases serial); cancel restocks
 *   - generateInvoiceFromTicket builds ITEMIZED lines (parts+labor−deposit), tax
 *     per line, deposit netted as a payment; stock NOT decremented again
 *     (the money-drop is fixed — total reflects parts+labor, not just the deposit)
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;
let customerId;
const OUTLET = 1;

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = $2`,
    [key, enabled]
  );
  const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");
  if (invalidateFeatureFlagCache) invalidateFeatureFlagCache(null);
}

async function stockOf(productId) {
  const { rows } = await db.query(
    "SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2", [productId, OUTLET]
  );
  return Number(rows[0]?.quantity ?? 0);
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app; db = result.db; deps = result.deps; cleanup = result.cleanup;

  require("../../middleware/feature-flags").init({ db });
  app.use((r, _res, next) => {
    const eid = r.headers["x-employee-id"];
    if (eid) r.employee = { id: Number(eid) };
    r.tenantSlug = "testco";
    r.company = { company_name: "Fixit Shop", timezone: "UTC" };
    next();
  });
  require("../../routes/service-tickets")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  await setFlag("phase4_workflow_tickets", true);
  await setFlag("customer_notifications", false);

  const { rows } = await db.query("INSERT INTO customers (name) VALUES ('Parts Test') RETURNING id");
  customerId = rows[0].id;

  // Deterministic stock for products 1 & 2 at the outlet.
  for (const pid of [1, 2]) {
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, 100)
       ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 100`,
      [pid, OUTLET]
    );
  }
}, 180000);

afterAll(async () => { if (cleanup) await cleanup(); }, 30000);

async function newTicket(extra = {}) {
  const res = await req.post("/api/service-tickets").send({
    title: "Repair job", customer_id: customerId, outlet_id: OUTLET, ...extra,
  });
  return res.body.id;
}

describe("V06 — parts decrement stock", () => {
  it("adding a part decrements outlet stock and snapshots price/cost", async () => {
    const ticketId = await newTicket();
    const before = await stockOf(1);
    const res = await req.post(`/api/service-tickets/${ticketId}/items`).send({
      item_type: "part", product_id: 1, quantity: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.stock_decremented).toBe(true);
    expect(Number(res.body.unit_price)).toBeGreaterThan(0); // defaulted from product
    expect(await stockOf(1)).toBe(before - 2);
  });

  it("labor and fee lines carry no stock movement", async () => {
    const ticketId = await newTicket();
    const before = await stockOf(1);
    const labor = await req.post(`/api/service-tickets/${ticketId}/items`).send({
      item_type: "labor", description: "Diagnostics", unit_price: 500,
    });
    expect(labor.status).toBe(201);
    expect(labor.body.stock_decremented).toBe(false);
    const fee = await req.post(`/api/service-tickets/${ticketId}/items`).send({
      item_type: "fee", description: "Handling", unit_price: 100,
    });
    expect(fee.status).toBe(201);
    expect(await stockOf(1)).toBe(before);
  });

  it("rejects a part with insufficient stock, no partial decrement", async () => {
    const ticketId = await newTicket();
    const before = await stockOf(1);
    const res = await req.post(`/api/service-tickets/${ticketId}/items`).send({
      item_type: "part", product_id: 1, quantity: 99999,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_stock");
    expect(await stockOf(1)).toBe(before);
  });
});

describe("V06 — serialized parts", () => {
  it("flips the chosen serial to 'sold' and decrements stock", async () => {
    const { rows } = await db.query(
      "INSERT INTO product_serial_numbers (product_id, serial_number, status) VALUES (2, 'SN-V06-1', 'available') RETURNING id"
    );
    const serialId = rows[0].id;
    const ticketId = await newTicket();
    const before = await stockOf(2);

    const res = await req.post(`/api/service-tickets/${ticketId}/items`).send({
      item_type: "part", product_id: 2, quantity: 1, product_serial_id: serialId,
    });
    expect(res.status).toBe(201);
    expect(await stockOf(2)).toBe(before - 1);

    const { rows: s } = await db.query("SELECT status FROM product_serial_numbers WHERE id = $1", [serialId]);
    expect(s[0].status).toBe("sold");
  });

  it("rejects a serial that is not available", async () => {
    const { rows } = await db.query(
      "INSERT INTO product_serial_numbers (product_id, serial_number, status) VALUES (2, 'SN-V06-2', 'sold') RETURNING id"
    );
    const ticketId = await newTicket();
    const res = await req.post(`/api/service-tickets/${ticketId}/items`).send({
      item_type: "part", product_id: 2, quantity: 1, product_serial_id: rows[0].id,
    });
    expect(res.status).toBe(400);
  });
});

describe("V06 — remove + cancel restock", () => {
  it("removing a part before invoice restocks (and releases its serial)", async () => {
    const { rows } = await db.query(
      "INSERT INTO product_serial_numbers (product_id, serial_number, status) VALUES (2, 'SN-V06-3', 'available') RETURNING id"
    );
    const serialId = rows[0].id;
    const ticketId = await newTicket();
    const before = await stockOf(2);
    const add = await req.post(`/api/service-tickets/${ticketId}/items`).send({
      item_type: "part", product_id: 2, quantity: 3, product_serial_id: serialId,
    });
    expect(await stockOf(2)).toBe(before - 3);

    const del = await req.delete(`/api/service-tickets/${ticketId}/items/${add.body.id}`);
    expect(del.status).toBe(200);
    expect(await stockOf(2)).toBe(before); // restored
    const { rows: s } = await db.query("SELECT status FROM product_serial_numbers WHERE id = $1", [serialId]);
    expect(s[0].status).toBe("available"); // released
  });

  it("cancelling a ticket restocks its un-invoiced parts", async () => {
    const ticketId = await newTicket();
    const before = await stockOf(1);
    await req.post(`/api/service-tickets/${ticketId}/items`).send({ item_type: "part", product_id: 1, quantity: 5 });
    expect(await stockOf(1)).toBe(before - 5);

    const cancel = await req.put(`/api/service-tickets/${ticketId}`).send({ status: "cancelled" });
    expect(cancel.status).toBe(200);
    expect(await stockOf(1)).toBe(before); // restocked on cancel
  });
});

describe("V06 — itemized invoice (money-drop fixed)", () => {
  it("builds itemized lines, nets the deposit, and does not re-decrement stock", async () => {
    const ticketId = await newTicket({ deposit_amount: 1000, deposit_method: "cash" });
    // parts + labor worth clearly more than the deposit
    await req.post(`/api/service-tickets/${ticketId}/items`).send({ item_type: "part", product_id: 1, quantity: 2, unit_price: 2000 });
    await req.post(`/api/service-tickets/${ticketId}/items`).send({ item_type: "labor", description: "Repair labor", unit_price: 1500 });

    const stockBeforeInvoice = await stockOf(1);

    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "approved" });
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "in_progress" });
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "completed" });

    const inv = await req.post(`/api/service-tickets/${ticketId}/generate-invoice`);
    expect(inv.status).toBe(201);
    const invoice = inv.body.invoice;

    // Itemized: 2 lines (part + labor), NOT one opaque deposit line.
    const { rows: lines } = await db.query(
      "SELECT count(*)::int c, COALESCE(SUM(line_total),0) AS sum FROM customer_invoice_items WHERE invoice_id = $1", [invoice.id]
    );
    expect(lines[0].c).toBe(2);

    // total reflects parts (2×2000) + labor (1500) = 5500 (before tax), well above the deposit.
    expect(Number(invoice.total_amount)).toBeGreaterThan(1000);
    expect(Number(invoice.subtotal)).toBe(5500);

    // deposit netted → balance = total − 1000.
    expect(Number(invoice.balance_due)).toBeCloseTo(Number(invoice.total_amount) - 1000, 2);
    expect(Number(invoice.amount_paid)).toBe(1000);

    // stock NOT decremented again at invoice (the flag guards).
    expect(await stockOf(1)).toBe(stockBeforeInvoice);
  });

  it("deposit-only ticket (no items) still invoices at the deposit amount", async () => {
    const ticketId = await newTicket({ deposit_amount: 800, deposit_method: "cash" });
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "approved" });
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "in_progress" });
    await req.put(`/api/service-tickets/${ticketId}`).send({ status: "completed" });
    const inv = await req.post(`/api/service-tickets/${ticketId}/generate-invoice`);
    expect(inv.status).toBe(201);
    expect(Number(inv.body.invoice.total_amount)).toBe(800);
    expect(Number(inv.body.invoice.balance_due)).toBe(0);
  });
});
