/**
 * ots-bill-numbers.test.js — One Toy Store pilot D64 (docs/onetoystore-pilot/PROGRESS.md).
 *
 * Bill numbers carry the shop date the bill was RUNG: INV-yymmdd-001, the
 * count restarting each day. Every shop (owner, 2026-10-19). An offline bill
 * takes the day it was rung, not the day it synced. Old bills keep their
 * numbers (nothing renumbers them; lookups are by the number as stored).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const { saleInvoiceNumber, formatSaleInvoiceNumber } = require("../../services/invoice-number");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
let seq = 0;
const key = () => `ots-billno-${Date.now()}-${++seq}`;

// The test app's shop clock is UTC.
const ymd = (d) => d.toISOString().slice(2, 10).replace(/-/g, "");

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  const open = await one("SELECT id FROM cash_shifts WHERE outlet_id = 1 AND status = 'open' LIMIT 1");
  if (!open) {
    const res = await admin().post("/api/shifts/open").send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 500 });
    expect(res.status).toBe(200);
  }
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: 1 });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 1, 1000)
     ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 1000`,
  );
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

function sell(extra = {}) {
  return admin().post("/api/sales").send({
    outlet_id: 1,
    employee_id: ADMIN_ID,
    payment_method: "Cash",
    cartItems: [{ id: 1, quantity: 1, price: 100 }],
    ...extra,
  });
}

describe("D64 — the number format", () => {
  it("is INV-yymmdd- plus a 3-digit count, growing past 999", () => {
    expect(formatSaleInvoiceNumber("2026-10-02", 1)).toBe("INV-261002-001");
    expect(formatSaleInvoiceNumber("2026-10-02", 42)).toBe("INV-261002-042");
    expect(formatSaleInvoiceNumber("2026-10-02", 1000)).toBe("INV-261002-1000");
  });
});

describe("D64 — bills rung at the till", () => {
  it("the first bill of the day is -001 and the next -002", async () => {
    const today = ymd(new Date());
    const a = await sell();
    expect(a.status).toBe(200);
    const b = await sell();
    expect(b.status).toBe(200);
    expect(a.body.invoiceNumber).toBe(`INV-${today}-001`);
    expect(b.body.invoiceNumber).toBe(`INV-${today}-002`);
    const row = await one("SELECT invoice_number FROM sales WHERE invoice_number = $1", [b.body.invoiceNumber]);
    expect(row).toBeTruthy();
  });

  it("an offline bill takes the day it was rung, with that day's own count", async () => {
    const rung = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const res = await sell({ idempotency_key: key(), offline_sold_at: rung.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.invoiceNumber).toBe(`INV-${ymd(rung)}-001`);
  });

  it("the public receipt link finds a bill by the new number", async () => {
    const res = await sell();
    expect(res.status).toBe(200);
    const r = await makeRequest(app).get(`/api/receipts/${res.body.invoiceNumber}/public`);
    expect(r.status).toBe(200);
    expect(r.body.invoice_number ?? r.body.sale?.invoice_number).toBe(res.body.invoiceNumber);
  });

  it("an old-style bill keeps its number", async () => {
    const { rows: [s] } = await db.query(
      `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, invoice_number)
       VALUES (100, 'Cash', 1, $1, 'INV-2026-00138') RETURNING id`, [ADMIN_ID]);
    await sell();
    expect((await one("SELECT invoice_number FROM sales WHERE id = $1", [s.id])).invoice_number).toBe("INV-2026-00138");
  });
});

describe("D64 — the shop's own date, not the server's", () => {
  it("00:30 in Karachi on 1 Jan is a 1 Jan bill (19:30 UTC on 31 Dec)", async () => {
    const n = await db.transaction((client) =>
      saleInvoiceNumber(client, { soldAt: new Date("2025-12-31T19:30:00Z"), timezone: "Asia/Karachi" }));
    expect(n).toBe("INV-260101-001");
    const m = await db.transaction((client) =>
      saleInvoiceNumber(client, { soldAt: new Date("2025-12-31T18:30:00Z"), timezone: "Asia/Karachi" }));
    expect(m).toBe("INV-251231-001");
  });
});
