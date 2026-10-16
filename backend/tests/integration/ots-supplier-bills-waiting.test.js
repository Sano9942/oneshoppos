/**
 * ots-supplier-bills-waiting.test.js — One Toy Store F9 step (f) 6/6: extra
 * pieces kept on one bill are matched when the supplier's bill for them comes
 * (owner 2026-10-17, Claude's suggestion):
 *
 *   - a later bill's line says which waiting extras it bills ("These are those
 *     pieces", pre-ticked on the check screen): its received count includes
 *     them, stock goes up only by the pieces arriving now (not twice), the full
 *     bill goes on the supplier's account, the waiting rows become Billed
 *     (part of a row: the row is split);
 *   - Waiting for supplier's bill list; "No bill coming (free)" with a note:
 *     pieces stay in stock, nothing on the account;
 *   - undoing the later bill puts its matched rows back to Waiting;
 *   - a correction on a matched line counts the matched pieces as received.
 *
 *   GET  /api/supplier-bills/waiting
 *   POST /api/supplier-bills/waiting/:id/free   { note }
 *   POST /api/supplier-bills                    line.waiting = [{ id, qty }]
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup, sup, other, outletId, ball, car, doll;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const stockOf = async (pid) => Number((await one("SELECT COALESCE(SUM(quantity),0) AS q FROM outlet_stock WHERE product_id = $1", [pid])).q);
const costOf = async (pid) => Number((await one("SELECT cost_price FROM products WHERE id = $1", [pid])).cost_price);
const owed = async () => Number((await admin().get("/api/supplier-aging")).body.aging.find((r) => r.id === sup)?.total_due || 0);
const waitingOf = async (pid) => Number((await one(
  "SELECT COALESCE(SUM(qty),0) AS q FROM supplier_waiting_items WHERE product_id = $1 AND status = 'waiting'", [pid])).q);
const itemOf = (pid, billId) => one(
  "SELECT * FROM supplier_waiting_items WHERE product_id = $1 AND received_bill_id = $2 AND status = 'waiting' ORDER BY id LIMIT 1", [pid, billId]);

const save = (payload) => admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
const line = (over) => ({ page: 1, supplier_code: null, description: "", discount_pct: 0, split_into: 1, ...over });
const bill = (no, total, lines, over = {}) => ({
  supplier_id: sup, outlet_id: outletId, bill_number: `${no}-${S}`, bill_date: "2026-10-17", written_total: total, lines, ...over,
});

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`WAIT SUP ${S}`])).id;
  other = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`OTHER SUP ${S}`])).id;
  const toy = async (name, stock) => {
    const id = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 1000, 100) RETURNING id", [name, `${name.slice(0, 2)}-${S}`])).id;
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)", [id, outletId, stock]);
    return id;
  };
  ball = await toy(`Ball ${S}`, 0);
  car = await toy(`Car ${S}`, 0);
  doll = await toy(`Doll ${S}`, 0);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("extra pieces waiting for the supplier's bill", () => {
  let first;

  beforeAll(async () => {
    first = await save(bill("W1", 1200, [
      line({ line_no: "1", billed_qty: 10, received_qty: 12, rate: 100, amount: 1000, toys: [{ product_id: ball, qty: 12 }] }),
      line({ line_no: "2", billed_qty: 1, received_qty: 2, rate: 200, amount: 200, toys: [{ product_id: car, qty: 2 }] }),
    ]));
    expect(first.status).toBe(201);
  });

  it("the extras are on the waiting list with the bill they came on", async () => {
    expect(await stockOf(ball)).toBe(12);
    const r = await admin().get("/api/supplier-bills/waiting");
    expect(r.status).toBe(200);
    const b = r.body.items.find((x) => x.product_id === ball);
    expect(b).toMatchObject({ supplier_id: sup, supplier_name: `WAIT SUP ${S}`, name: `Ball ${S}`, bill_number: `W1-${S}`, received_bill_id: first.body.bill.id });
    expect(Number(b.qty)).toBe(2);
    expect(Number(b.days)).toBe(0);
    expect(r.body.items.find((x) => x.product_id === car)).toBeTruthy();
  });

  describe("the supplier's bill for them comes", () => {
    let item, res, owedBefore;
    beforeAll(async () => {
      item = await itemOf(ball, first.body.bill.id);
      owedBefore = await owed();
      res = await save(bill("W2", 240, [
        line({ line_no: "1", billed_qty: 2, received_qty: 2, rate: 120, amount: 240,
          waiting: [{ id: item.id, qty: 2 }], toys: [{ product_id: ball, qty: 0 }] }),
      ]));
    });

    it("saves: stock not added twice, the full bill on the account, cost = the new rate", async () => {
      expect(res.status).toBe(201);
      expect(await stockOf(ball)).toBe(12);
      expect(await owed()).toBeCloseTo(owedBefore + 240, 2);
      expect(await costOf(ball)).toBe(120);
      const e = await one("SELECT COUNT(*)::int AS n FROM supplier_account_entries WHERE supplier_bill_id = $1", [res.body.bill.id]);
      expect(e.n).toBe(0); // nothing "not received"
    });

    it("the waiting row is Billed by that bill and line", async () => {
      const w = await one("SELECT * FROM supplier_waiting_items WHERE id = $1", [item.id]);
      const ln = await one("SELECT id FROM supplier_bill_lines WHERE bill_id = $1", [res.body.bill.id]);
      expect(w).toMatchObject({ status: "billed", matched_bill_id: res.body.bill.id, matched_line_id: ln.id });
      expect(w.matched_at).toBeTruthy();
      expect(await waitingOf(ball)).toBe(0);
      const open = await admin().get(`/api/supplier-bills/${res.body.bill.id}`);
      expect(Number(open.body.bill.lines[0].matched_qty)).toBe(2);
    });

    it("a waiting row can't be matched twice", async () => {
      const r = await save(bill("W3", 240, [
        line({ line_no: "1", billed_qty: 2, received_qty: 2, rate: 120, amount: 240,
          waiting: [{ id: item.id, qty: 2 }], toys: [{ product_id: ball, qty: 0 }] }),
      ]));
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/already/i);
    });

    it("one more ball turned up on that bill (correction): it's an extra, the matched 2 count as received", async () => {
      const ln = await one("SELECT id FROM supplier_bill_lines WHERE bill_id = $1", [res.body.bill.id]);
      const r = await admin().post(`/api/supplier-bills/${res.body.bill.id}/corrections`)
        .send({ kind: "pieces", line_id: ln.id, received_qty: 3, note: "one more in the box" });
      expect(r.status).toBe(200);
      expect(await stockOf(ball)).toBe(13);
      expect(await waitingOf(ball)).toBe(1);
      expect(Number(r.body.correction.amount)).toBe(0);
    });
  });

  it("refuses: another supplier's extras, more than waiting, more than billed", async () => {
    const carItem = await itemOf(car, first.body.bill.id);
    let r = await save(bill("X1", 200, [
      line({ line_no: "1", billed_qty: 1, received_qty: 1, rate: 200, amount: 200, waiting: [{ id: carItem.id, qty: 1 }], toys: [{ product_id: car, qty: 0 }] }),
    ], { supplier_id: other }));
    expect(r.status).toBe(400);
    r = await save(bill("X2", 400, [
      line({ line_no: "1", billed_qty: 2, received_qty: 2, rate: 200, amount: 400, waiting: [{ id: carItem.id, qty: 2 }], toys: [{ product_id: car, qty: 0 }] }),
    ]));
    expect(r.status).toBe(400);
    r = await save(bill("X3", 0, [
      line({ line_no: "1", billed_qty: 0, received_qty: 1, rate: 0, amount: 0, waiting: [{ id: carItem.id, qty: 1 }], toys: [{ product_id: car, qty: 0 }] }),
    ]));
    expect(r.status).toBe(400);
    expect(await waitingOf(car)).toBe(1);
  });

  describe("No bill coming (free)", () => {
    it("needs a note; then the pieces stay in stock, nothing on the account, off the list", async () => {
      const carItem = await itemOf(car, first.body.bill.id);
      const before = await owed();
      let r = await admin().post(`/api/supplier-bills/waiting/${carItem.id}/free`).send({ note: " " });
      expect(r.status).toBe(400);
      r = await admin().post(`/api/supplier-bills/waiting/${carItem.id}/free`).send({ note: "supplier says it's a gift" });
      expect(r.status).toBe(200);
      const w = await one("SELECT status, note, matched_at FROM supplier_waiting_items WHERE id = $1", [carItem.id]);
      expect(w.status).toBe("free");
      expect(w.note).toMatch(/supplier says it's a gift/);
      expect(w.matched_at).toBeTruthy();
      expect(await stockOf(car)).toBe(2);
      expect(await owed()).toBeCloseTo(before, 2);
      const list = await admin().get("/api/supplier-bills/waiting");
      expect(list.body.items.find((x) => x.id === carItem.id)).toBeUndefined();
      r = await admin().post(`/api/supplier-bills/waiting/${carItem.id}/free`).send({ note: "again" });
      expect(r.status).toBe(409);
    });
  });

  describe("part of a waiting row, and undoing the later bill", () => {
    let dollBill, later;
    beforeAll(async () => {
      dollBill = await save(bill("D1", 100, [
        line({ line_no: "1", billed_qty: 1, received_qty: 4, rate: 100, amount: 100, toys: [{ product_id: doll, qty: 4 }] }),
      ]));
      const item = await itemOf(doll, dollBill.body.bill.id);
      later = await save(bill("D2", 500, [
        line({ line_no: "1", billed_qty: 5, received_qty: 5, rate: 100, amount: 500, waiting: [{ id: item.id, qty: 2 }], toys: [{ product_id: doll, qty: 3 }] }),
      ]));
    });

    it("2 of the 3 waiting dolls are billed; 3 more arrive now", async () => {
      expect(later.status).toBe(201);
      expect(await stockOf(doll)).toBe(7);
      expect(await waitingOf(doll)).toBe(1);
      const billed = await one("SELECT COALESCE(SUM(qty),0)::float AS q FROM supplier_waiting_items WHERE product_id = $1 AND status = 'billed' AND matched_bill_id = $2", [doll, later.body.bill.id]);
      expect(billed.q).toBe(2);
    });

    it("undoing the later bill takes out only what arrived on it and puts the 2 back to Waiting", async () => {
      const r = await admin().post(`/api/supplier-bills/${later.body.bill.id}/undo`).send({ reason: "wrong bill" });
      expect(r.status).toBe(200);
      expect(await stockOf(doll)).toBe(4);
      expect(await waitingOf(doll)).toBe(3);
    });
  });
});
