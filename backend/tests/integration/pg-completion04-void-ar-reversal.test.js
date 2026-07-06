/**
 * pg-completion04-void-ar-reversal.test.js -- completion plan 04 (wholesale)
 *
 * Regression guard for the credit/AR seam defect found during the completion-04
 * live walkthrough (2026-07-05): voiding an on-account (Credit tender) sale
 * restored stock but left the linked customer_invoices row 'sent' with full
 * balance_due, permanently overstating AR outstanding and consuming the
 * customer's credit limit for a sale that no longer exists.
 *
 * Fix: routes/sales.js PUT /api/sales/:id/void reverses the linked invoice
 * (status='void', balance_due=0 — the status the statement, ar-aging, and the
 * credit-exposure check all already exclude).
 *
 * Uses the field-rep sale path (field_visit_uuid) to reach POST /api/sales:
 * that path bypasses the outlet clock-in check, which is what forces the
 * sibling pg-wholesale-credit-limit.test.js suite to stay .skip in an isolated
 * test schema. Employee 1 (Admin/all_access) + a warn-mode customer under
 * limit keeps the credit gate out of the way — this test is about the void
 * reversal, not the block.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("completion-04 -- void reverses linked A/R invoice", () => {
  let app, db, deps, cleanup;
  let creditCustomer;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    require("../../routes/customers")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/products")(app, deps);
    require("../../routes/customer-invoices")(app, deps);
    require("../../routes/sales")(app, deps);

    // A sale still needs an open shift for the outlet (only the attendance
    // clock-in check is skipped for field-rep orders, not the shift check).
    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });

    const { rows: c } = await db.query(
      `INSERT INTO customers (name, credit_limit, credit_block_mode, payment_terms_days)
       VALUES ('Void Reversal Buyer', 100000, 'warn', 30) RETURNING id`
    );
    creditCustomer = c[0].id;
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  async function outstandingFor(customerId) {
    // Mirror the sales.js credit-exposure query exactly.
    const { rows: [agg] } = await db.query(
      `SELECT COALESCE(SUM(balance_due), 0)::numeric AS outstanding
       FROM customer_invoices
       WHERE customer_id = $1 AND status NOT IN ('paid','cancelled','void')`,
      [customerId]
    );
    return Number(agg.outstanding);
  }

  async function fieldCreditSale(amount) {
    const uuid = `c04-void-${Date.now()}-${Math.random()}`;
    await db.query(
      `INSERT INTO field_visits (employee_id, customer_id, status, client_uuid, checked_in_at)
       VALUES (1, $1, 'ordered', $2, NOW())`,
      [creditCustomer, uuid]
    );
    return request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        customer_id: creditCustomer,
        cartItems: [{ id: 1, name: "Item", price: amount, quantity: 1, cost_price: 1 }],
        payments: [{ method: "Credit", amount }],
        field_visit_uuid: uuid,
      });
  }

  it("void of a Credit-tender sale reverses the linked customer_invoice and frees AR/credit", async () => {
    const before = await outstandingFor(creditCustomer);

    const saleRes = await fieldCreditSale(4000);
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;
    expect(saleId).toBeDefined();

    const { rows: [sale] } = await db.query(
      "SELECT customer_invoice_id, voided FROM sales WHERE id = $1",
      [saleId]
    );
    expect(sale.customer_invoice_id).not.toBeNull();
    const invId = sale.customer_invoice_id;

    // Invoice opened at full balance; AR rose by the sale amount.
    const { rows: [invBefore] } = await db.query(
      "SELECT balance_due::numeric AS bal, status FROM customer_invoices WHERE id = $1",
      [invId]
    );
    expect(Number(invBefore.bal)).toBe(4000);
    expect(invBefore.status).toBe("sent");
    expect(await outstandingFor(creditCustomer)).toBe(before + 4000);

    // Void the sale.
    const voidRes = await request(app)
      .put(`/api/sales/${saleId}/void`)
      .set("x-employee-id", "1")
      .send({ void_reason: "test - void ar reversal" });
    expect(voidRes.status).toBe(200);

    // Linked invoice is reversed: status 'void', balance zeroed.
    const { rows: [invAfter] } = await db.query(
      "SELECT balance_due::numeric AS bal, status FROM customer_invoices WHERE id = $1",
      [invId]
    );
    expect(invAfter.status).toBe("void");
    expect(Number(invAfter.bal)).toBe(0);

    // AR outstanding / credit exposure returns to the pre-sale figure.
    expect(await outstandingFor(creditCustomer)).toBe(before);
  });

  it("void of a Cash sale does not create or touch any customer_invoice", async () => {
    const uuid = `c04-cash-${Date.now()}-${Math.random()}`;
    await db.query(
      `INSERT INTO field_visits (employee_id, customer_id, status, client_uuid, checked_in_at)
       VALUES (1, $1, 'ordered', $2, NOW())`,
      [creditCustomer, uuid]
    );
    const saleRes = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        customer_id: creditCustomer,
        cartItems: [{ id: 1, name: "Item", price: 1500, quantity: 1, cost_price: 1 }],
        payments: [{ method: "Cash", amount: 1500 }],
        field_visit_uuid: uuid,
      });
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    const { rows: [sale] } = await db.query(
      "SELECT customer_invoice_id FROM sales WHERE id = $1",
      [saleId]
    );
    expect(sale.customer_invoice_id).toBeNull();

    const arBefore = await outstandingFor(creditCustomer);
    const voidRes = await request(app)
      .put(`/api/sales/${saleId}/void`)
      .set("x-employee-id", "1")
      .send({ void_reason: "test - cash void no ar" });
    expect(voidRes.status).toBe(200);
    expect(await outstandingFor(creditCustomer)).toBe(arBefore);
  });
});
