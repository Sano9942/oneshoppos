/**
 * ots-online-change.test.js — One Toy Store pilot D59 (docs/onetoystore-pilot/PROGRESS.md).
 *
 * A customer sends more than the bill by transfer and is handed the
 * difference from the drawer. Seen 2026-10-01 INV-00078: bill 2,650,
 * JazzCash 2,780, Rs 130 cash back. Owner, 2026-10-19: record it on the bill
 * — the Online line keeps the full 2,780 (matches the phone statement) and a
 * Cash line of −130 is the change out of the drawer, so the lines still add
 * up to the bill and Close Shift expects 130 less cash on its own.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const JAZZ = "Online - JazzCash";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const ITEM = 4; // no tax, so totals are plain arithmetic

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function openTill(float) {
  for (const s of await all("SELECT id FROM cash_shifts WHERE status = 'open'")) {
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [s.id]);
  }
  const res = await admin().post("/api/shifts/open").send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: float });
  expect(res.status).toBe(200);
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: 1 });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
  return res.body.shift_id;
}

async function sell(price, payments) {
  const res = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: [{ id: ITEM, quantity: 1, price }],
    payments,
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

const lines = async (saleId) =>
  (await all("SELECT payment_method, amount FROM sale_payments WHERE sale_id = $1 ORDER BY id", [saleId]))
    .map((p) => ({ method: p.payment_method, amount: num(p.amount) }));

describe("D59 — transfer overpaid, change from the drawer", () => {
  let shiftId, overpaid, partCash;

  beforeAll(async () => {
    shiftId = await openTill(1000);
    overpaid = await sell(2650, [{ method: JAZZ, amount: 2780 }]);
    // With cash on the bill too, the change still comes off the cash first.
    partCash = await sell(2650, [{ method: "Cash", amount: 1000 }, { method: JAZZ, amount: 1780 }]);
  });

  it("keeps the full transfer and books the change as Cash −130", async () => {
    expect(await lines(overpaid)).toEqual([
      { method: JAZZ, amount: 2780 },
      { method: "Cash", amount: -130 },
    ]);
  });

  it("the bill still reads as a JazzCash bill, total 2,650", async () => {
    const s = await one("SELECT payment_method, total_amount FROM sales WHERE id = $1", [overpaid]);
    expect(s.payment_method).toBe(JAZZ);
    expect(num(s.total_amount)).toBe(2650);
  });

  it("with cash on the bill, the change comes off the cash and the transfer stays whole", async () => {
    expect(await lines(partCash)).toEqual([
      { method: "Cash", amount: 870 },
      { method: JAZZ, amount: 1780 },
    ]);
  });

  it("the shift's payment summary shows the full transfers and the cash net of change", async () => {
    const res = await admin().get(`/api/reports/payment-summary?session_id=${shiftId}`);
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.payments.map((p) => [p.payment_method, num(p.total)]));
    expect(by).toEqual({ [JAZZ]: 4560, Cash: 740 }); // 2,780 + 1,780; 870 − 130
  });

  it("Close Shift expects the float plus cash less the change handed out", async () => {
    // 1,000 float + 870 cash − 130 change = 1,740.
    const close = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 1740 });
    expect(close.status).toBe(200);
    expect(num(close.body.expected_cash)).toBe(1740);
    expect(num(close.body.variance)).toBe(0);
  });
});
