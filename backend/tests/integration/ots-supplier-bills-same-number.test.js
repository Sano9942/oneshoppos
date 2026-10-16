/**
 * ots-supplier-bills-same-number.test.js — One Toy Store F9 step (f): the same
 * bill number twice. Owner decision (PHASE-F-PLAN F9, "Same bill twice", B):
 * same supplier + same bill number → warn and show the earlier bill, but allow
 * continuing (a supplier reuses "Bill No 01" on different dates). The very
 * same FILE again stays refused (ots-supplier-bills-save.test.js).
 *
 *   GET /api/supplier-bills/same-number?supplier_id=&bill_number=
 *        → the earlier live bills with that number (for the check screen)
 *   POST /api/supplier-bills with an earlier bill of that number
 *        → 409 SAME_BILL_NUMBER + the earlier bills, unless same_number_ok
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, sup, other, outletId, ball, first;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();

const save = (payload) => admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
const bill = (over = {}) => ({
  supplier_id: sup,
  outlet_id: outletId,
  bill_number: "Bill No 01",
  bill_date: "2026-10-01",
  written_total: 300,
  lines: [{ line_no: "1", billed_qty: 3, received_qty: 3, rate: 100, amount: 300, discount_pct: 0, split_into: 1, toys: [{ product_id: ball, qty: 3 }] }],
  ...over,
});
const sameNumber = (q) => admin().get("/api/supplier-bills/same-number").query(q);
const stockOf = async () => Number((await one("SELECT COALESCE(SUM(quantity),0) AS q FROM outlet_stock WHERE product_id = $1", [ball])).q);

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`HAFIZ ${S}`])).id;
  other = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`OTHER ${S}`])).id;
  ball = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 300, 100) RETURNING id", [`Ball ${S}`, `BL-${S}`])).id;
  const r = await save(bill());
  expect(r.status).toBe(201);
  first = r.body.bill;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("the check screen asks before saving", () => {
  it("lists the earlier bill of this supplier with that number (spaces and case ignored)", async () => {
    const r = await sameNumber({ supplier_id: sup, bill_number: "  bill no 01 " });
    expect(r.status).toBe(200);
    expect(r.body.bills).toHaveLength(1);
    expect(r.body.bills[0]).toMatchObject({ id: first.id, bill_number: "Bill No 01", bill_date: "2026-10-01", lines: 1 });
    expect(Number(r.body.bills[0].amount)).toBe(300);
  });

  it("nothing for another supplier, another number, or no number", async () => {
    expect((await sameNumber({ supplier_id: other, bill_number: "Bill No 01" })).body.bills).toEqual([]);
    expect((await sameNumber({ supplier_id: sup, bill_number: "Bill No 02" })).body.bills).toEqual([]);
    expect((await sameNumber({ supplier_id: sup, bill_number: "" })).body.bills).toEqual([]);
  });

  it("needs the 'Receive supplier bills' permission", async () => {
    const r = await makeRequest(app, CASHIER_ID).get("/api/supplier-bills/same-number").query({ supplier_id: sup, bill_number: "Bill No 01" });
    expect(r.status).toBe(403);
  });
});

describe("saving a second bill with the same number", () => {
  it("is stopped with the earlier bill shown, and changes nothing", async () => {
    const before = await stockOf();
    const r = await save(bill({ bill_date: "2026-10-09" }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("SAME_BILL_NUMBER");
    expect(r.body.error).toMatch(/already/i);
    expect(r.body.bills.map((b) => b.id)).toEqual([first.id]);
    expect(await stockOf()).toBe(before);
    expect(Number((await one("SELECT COUNT(*) AS n FROM supplier_bills WHERE supplier_id = $1", [sup])).n)).toBe(1);
  });

  it("is saved when the owner says it is a different bill", async () => {
    const before = await stockOf();
    const r = await save(bill({ bill_date: "2026-10-09", same_number_ok: true }));
    expect(r.status).toBe(201);
    expect(r.body.bill.bill_number).toBe("Bill No 01");
    expect(await stockOf()).toBe(before + 3);
    // Both now listed for a third one.
    expect((await sameNumber({ supplier_id: sup, bill_number: "Bill No 01" })).body.bills).toHaveLength(2);
  });

  it("the same number at another supplier is no question", async () => {
    const r = await save(bill({ supplier_id: other }));
    expect(r.status).toBe(201);
  });

  it("an undone bill doesn't count", async () => {
    await db.query("UPDATE supplier_bills SET status = 'undone' WHERE supplier_id = $1", [other]);
    expect((await sameNumber({ supplier_id: other, bill_number: "Bill No 01" })).body.bills).toEqual([]);
    expect((await save(bill({ supplier_id: other }))).status).toBe(201);
  });
});
