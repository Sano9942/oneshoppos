/**
 * One Toy Store pilot: paying suppliers ON ACCOUNT (D13) and what we owe them.
 *
 * Owner, 2026-09-28: credit suppliers are paid lump sums (cash by hand or bank
 * transfer) whenever money is available, not bill by bill; a lump sum lowers the
 * supplier's balance only (no bill is marked paid). Each supplier can carry an
 * opening balance from the paper registers.
 *
 * One definition of "what we owe" everywhere:
 *   opening balance + bills − payments (not voided, on account or per bill) − returns
 *
 * Also covers what was found next to it:
 *   D37 the ledger over a date range started at 0 instead of bringing the earlier
 *       balance forward, so "closing balance" was the period's movement;
 *   D38 the aging list counted a bill once per payment made on it, ignored
 *       returns, and ignored voided-ness.
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
let sup, bill1, bill2;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  const res = await admin().post("/api/suppliers").send({
    name: `SA Toys ${S}`, payment_terms: "credit", credit_days: 60, opening_balance: 20000,
  });
  expect([200, 201]).toContain(res.status);
  sup = res.body.id ?? res.body.supplier?.id;
  bill1 = (await one(
    "INSERT INTO supplier_invoices (supplier_id, invoice_number, amount, created_at) VALUES ($1, $2, 30000, NOW() - interval '40 days') RETURNING id",
    [sup, `SA-B1-${S}`])).id;
  bill2 = (await one(
    "INSERT INTO supplier_invoices (supplier_id, invoice_number, amount, created_at) VALUES ($1, $2, 10000, NOW() - interval '5 days') RETURNING id",
    [sup, `SA-B2-${S}`])).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const aging = async () => (await admin().get("/api/supplier-aging")).body.aging.find((r) => r.id === sup);
const ledger = async (q = "") => (await admin().get(`/api/supplier-ledger/${sup}${q}`)).body;

describe("opening balance", () => {
  it("is stored on the supplier and counts in what we owe", async () => {
    expect(Number((await one("SELECT opening_balance FROM suppliers WHERE id = $1", [sup])).opening_balance)).toBe(20000);
    expect(Number((await aging()).total_due)).toBe(60000); // 20,000 + 30,000 + 10,000
  });

  it("can be changed from the supplier edit", async () => {
    const res = await admin().put(`/api/suppliers/${sup}`).send({ name: `SA Toys ${S}`, payment_terms: "credit", credit_days: 60, opening_balance: 25000 });
    expect(res.status).toBe(200);
    expect(Number((await aging()).total_due)).toBe(65000);
    await admin().put(`/api/suppliers/${sup}`).send({ name: `SA Toys ${S}`, payment_terms: "credit", credit_days: 60, opening_balance: 20000 });
  });

  it("an edit that doesn't send opening_balance keeps it", async () => {
    await admin().put(`/api/suppliers/${sup}`).send({ name: `SA Toys ${S}`, payment_terms: "credit", credit_days: 60 });
    expect(Number((await one("SELECT opening_balance FROM suppliers WHERE id = $1", [sup])).opening_balance)).toBe(20000);
  });

  it("is the first line of the ledger", async () => {
    const l = await ledger();
    const open = l.entries.find((e) => e.type === "opening");
    expect(open).toMatchObject({ debit: 20000, credit: 0 });
  });
});

describe("paying on account (D13)", () => {
  let payId;

  it("records a lump sum against the supplier, not a bill", async () => {
    const res = await admin().post(`/api/suppliers/${sup}/payments`).send({
      amount: 45000, payment_method: "Bank Transfer", reference: `TRX-${S}`, notes: "on account",
    });
    expect(res.status).toBe(201);
    payId = res.body.payment.id;
    const p = await one("SELECT supplier_id, supplier_invoice_id, amount FROM supplier_payments WHERE id = $1", [payId]);
    expect(p).toMatchObject({ supplier_id: sup, supplier_invoice_id: null });
    expect(Number(p.amount)).toBe(45000);
  });

  it("lowers the balance by the amount; no bill is marked paid", async () => {
    expect(Number((await aging()).total_due)).toBe(15000); // 60,000 − 45,000
    const bills = (await db.query("SELECT status FROM supplier_invoices WHERE id = ANY($1)", [[bill1, bill2]])).rows;
    expect(bills.map((b) => b.status)).toEqual(["unpaid", "unpaid"]);
  });

  it("shows as ONE payment line in the ledger, and the ledger balance agrees with aging", async () => {
    const l = await ledger();
    const pays = l.entries.filter((e) => e.type === "payment");
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ credit: 45000, reference: `TRX-${S}` });
    expect(l.closing_balance).toBe(15000);
  });

  it("the payables report agrees", async () => {
    const res = await admin().get(`/api/reports/payables-receivables?supplier_id=${sup}`);
    expect(res.status).toBe(200);
    const lines = res.body.supplier_ap.filter((r) => r.supplier_name === `SA Toys ${S}`);
    const owed = Math.round(lines.reduce((a, r) => a + Number(r.outstanding), 0) * 100) / 100;
    expect(owed).toBe(15000);
  });

  it("paying more than is owed is allowed and leaves an advance (negative balance)", async () => {
    const res = await admin().post(`/api/suppliers/${sup}/payments`).send({ amount: 20000, payment_method: "Cash" });
    expect(res.status).toBe(201);
    expect(Number((await aging()).total_due)).toBe(-5000);
    await admin().post(`/api/supplier-payments/${res.body.payment.id}/void`).send({ reason: "test" });
  });

  it("voiding an on-account payment puts the balance back", async () => {
    const res = await admin().post(`/api/supplier-payments/${payId}/void`).send({ reason: "typed wrong" });
    expect(res.status).toBe(200);
    expect(Number((await aging()).total_due)).toBe(60000);
    expect((await ledger()).closing_balance).toBe(60000);
  });

  it("rejects a zero or missing amount, and an unknown supplier", async () => {
    expect((await admin().post(`/api/suppliers/${sup}/payments`).send({ amount: 0 })).status).toBe(400);
    expect((await admin().post(`/api/suppliers/99999999/payments`).send({ amount: 100 })).status).toBe(404);
  });
});

describe("D38: aging counts each bill once, and counts returns and voids", () => {
  it("a bill paid in two instalments is counted once", async () => {
    await admin().post(`/api/supplier-invoices/${bill2}/pay`).send({ amount: 4000, payment_method: "Cash" });
    await admin().post(`/api/supplier-invoices/${bill2}/pay`).send({ amount: 3000, payment_method: "Cash" });
    const a = await aging();
    expect(Number(a.total_invoiced)).toBe(40000);   // not 30,000 + 10,000 × 2
    expect(Number(a.total_paid)).toBe(7000);
    expect(Number(a.total_due)).toBe(53000);         // 20,000 + 40,000 − 7,000
  });

  it("a supplier return lowers what we owe, as in the ledger", async () => {
    await db.query("INSERT INTO supplier_returns (supplier_id, total_value, reason) VALUES ($1, 2000, 'broken')", [sup]);
    expect(Number((await aging()).total_due)).toBe(51000);
    expect((await ledger()).closing_balance).toBe(51000);
  });
});

describe("D37: a ledger over a date range brings the earlier balance forward", () => {
  it("closing balance for 'last 10 days' is still everything owed", async () => {
    const from = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const l = await ledger(`?from=${from}`);
    const bf = l.entries.find((e) => e.type === "brought_forward");
    expect(bf).toBeDefined();
    expect(bf.date).toBe(from); // the chosen day, not a UTC time that reads as the day before
    expect(bf.running_balance).toBe(50000); // opening 20,000 + bill1 30,000 (40 days ago)
    expect(l.closing_balance).toBe(51000);
  });
});

describe("every place that reads supplier payments counts on-account payments and skips voided ones", () => {
  let other, pay, voidedBillPay, billX;
  beforeAll(async () => {
    other = (await admin().post("/api/suppliers").send({ name: `SA Other ${S}`, payment_terms: "credit", credit_days: 30 })).body.id;
    billX = (await one("INSERT INTO supplier_invoices (supplier_id, invoice_number, amount) VALUES ($1, $2, 8000) RETURNING id", [other, `SA-X-${S}`])).id;
    pay = (await admin().post(`/api/suppliers/${other}/payments`).send({ amount: 3000, payment_method: "Bank Transfer", reference: `OA-${S}` })).body.payment;
    // a per-bill payment that is then voided
    await admin().post(`/api/supplier-invoices/${billX}/pay`).send({ amount: 1000, payment_method: "Cash" });
    voidedBillPay = (await one("SELECT id FROM supplier_payments WHERE supplier_invoice_id = $1", [billX])).id;
    await admin().post(`/api/supplier-payments/${voidedBillPay}/void`).send({ reason: "wrong" });
  });

  it("supplier list: running_balance = what we owe", async () => {
    const res = await admin().get("/api/suppliers");
    expect(Number(res.body.suppliers.find((s) => s.id === other).running_balance)).toBe(5000);
  });

  it("a voided payment no longer counts as paid on its bill (list + paying the rest)", async () => {
    const res = await admin().get(`/api/supplier-invoices?supplier_id=${other}`);
    expect(Number(res.body.invoices[0].amount_paid)).toBe(0);
    const payAll = await admin().post(`/api/supplier-invoices/${billX}/pay`).send({ amount: 8000, payment_method: "Cash" });
    expect(payAll.status).toBe(200); // refused before: the voided 1,000 still counted
    const last = await one("SELECT id FROM supplier_payments WHERE supplier_invoice_id = $1 AND voided IS NOT TRUE", [billX]);
    await admin().post(`/api/supplier-payments/${last.id}/void`).send({ reason: "undo" });
  });

  it("supplier payments report: the on-account payment is listed with its supplier; the voided one is not; aging = what we owe", async () => {
    const res = await admin().get(`/api/reports/supplier-payments-invoices?supplier_id=${other}`);
    expect(res.status).toBe(200);
    const ids = res.body.payments.map((p) => p.id);
    expect(ids).toContain(pay.id);
    expect(ids).not.toContain(voidedBillPay);
    expect(res.body.payments.find((p) => p.id === pay.id).supplier_name).toBe(`SA Other ${S}`);
    expect(Number(res.body.aging.find((a) => a.id === other).total_due)).toBe(5000);
  });

  it("settlement overview: money paid to suppliers includes on-account, excludes voided", async () => {
    const res = await admin().get(`/api/reports/settlement-overview?supplier_id=${other}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.summary.supplier_payments)).toBe(3000);
  });

  it("accounting: total owed to suppliers and payment history agree", async () => {
    const hist = await admin().get("/api/accounting/supplier-payments");
    expect(hist.status).toBe(200);
    const row = hist.body.payments.find((p) => p.id === pay.id);
    expect(row).toMatchObject({ supplier_name: `SA Other ${S}` });
    expect(hist.body.payments.find((p) => p.id === voidedBillPay)).toBeUndefined();
    const aging = (await admin().get("/api/supplier-aging")).body.aging;
    const owed = Math.round(aging.reduce((a, r) => a + Number(r.total_due), 0) * 100) / 100;
    const apar = await admin().get("/api/accounting/ap-ar");
    expect(apar.status).toBe(200);
    expect(Number(apar.body.total_ap)).toBe(owed);
    const bs = await admin().get("/api/accounting/balance-sheet");
    expect(bs.status).toBe(200);
  });

  it("D39: clearing a post-dated cheque to a supplier records a payment on account for that supplier", async () => {
    const before = Number((await admin().get("/api/suppliers")).body.suppliers.find((s) => s.id === other).running_balance);
    const chq = await admin().post("/api/accounting/cheques").send({
      cheque_number: `CHQ-${S}`, type: "payable", party_type: "supplier", party_id: other,
      amount: 1500, issue_date: "2026-09-01", maturity_date: "2026-09-20",
    });
    expect(chq.status).toBe(200);
    expect((await admin().put(`/api/accounting/cheques/${chq.body.id}/deposit`).send({})).status).toBe(200);
    const clear = await admin().put(`/api/accounting/cheques/${chq.body.id}/clear`).send({});
    expect(clear.status).toBe(200);
    const after = Number((await admin().get("/api/suppliers")).body.suppliers.find((s) => s.id === other).running_balance);
    expect(after).toBe(before - 1500);
  });
});

describe("D40: voiding a payment made against a bill", () => {
  it("succeeds and puts the bill back to unpaid", async () => {
    const s2 = (await admin().post("/api/suppliers").send({ name: `SA Void ${S}` })).body.id;
    const b = (await one("INSERT INTO supplier_invoices (supplier_id, invoice_number, amount) VALUES ($1, $2, 500) RETURNING id", [s2, `SA-V-${S}`])).id;
    expect((await admin().post(`/api/supplier-invoices/${b}/pay`).send({ amount: 500 })).body.status).toBe("paid");
    const p = await one("SELECT id FROM supplier_payments WHERE supplier_invoice_id = $1", [b]);
    const res = await admin().post(`/api/supplier-payments/${p.id}/void`).send({ reason: "test" });
    expect(res.status).toBe(200);
    expect(res.body.new_invoice_status).toBe("unpaid");
    expect((await one("SELECT status FROM supplier_invoices WHERE id = $1", [b])).status).toBe("unpaid");
  });
});

describe("purchase order credit-limit warning uses what we owe", () => {
  it("counts the opening balance, and a payment on account clears the warning", async () => {
    const s3 = (await admin().post("/api/suppliers").send({
      name: `SA Limit ${S}`, payment_terms: "credit", credit_days: 30, credit_limit: 10000, opening_balance: 9000,
    })).body.id;
    const po = (amt) => admin().post("/api/purchase-orders").send({
      supplier_id: s3, total_cost: amt, items: [{ product_id: 1, quantity: 1, cost_price: amt }],
    });
    const first = await po(2000);
    expect(first.status).toBe(200);
    expect(first.body.warning).toMatch(/Credit limit exceeded. Outstanding: 9000.00/);
    await admin().post(`/api/suppliers/${s3}/payments`).send({ amount: 5000, payment_method: "Cash" });
    const second = await po(2000);
    expect(second.body.warning).toBeUndefined();
  });
});

describe("payment date", () => {
  it("today's date keeps the time it was paid; an earlier date lands on that day in the shop's timezone", async () => {
    const s4 = (await admin().post("/api/suppliers").send({ name: `SA Date ${S}` })).body.id;
    const tz = (await one("SELECT timezone FROM company_profile LIMIT 1"))?.timezone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const t = await admin().post(`/api/suppliers/${s4}/payments`).send({ amount: 10, paid_at: today });
    const tRow = await one("SELECT paid_at FROM supplier_payments WHERE id = $1", [t.body.payment.id]);
    expect(Math.abs(Date.now() - new Date(tRow.paid_at).getTime())).toBeLessThan(120000);
    const p = await admin().post(`/api/suppliers/${s4}/payments`).send({ amount: 10, paid_at: "2026-09-01" });
    const pRow = await one("SELECT (paid_at AT TIME ZONE $2)::date::text AS local_day FROM supplier_payments WHERE id = $1", [p.body.payment.id, tz]);
    expect(pRow.local_day).toBe("2026-09-01");
  });
});
