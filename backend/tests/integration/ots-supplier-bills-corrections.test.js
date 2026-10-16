/**
 * ots-supplier-bills-corrections.test.js — One Toy Store F9 step (f) 5/6:
 * corrections after a supplier bill is saved (owner decision 2026-10-16, all
 * four kinds, one "Correct this bill" box, a note always required):
 *
 *   (a) pieces   pieces received changed: stock ±, Not received money ±,
 *                extra pieces waiting ±
 *   (c) rate     wrong rate: cost per piece + the supplier's account ±
 *   (d) money    money only: ± on the supplier's account
 *   (b) toy      wrong toy: pieces move from one toy to another, cost follows
 *
 * Every change goes in as a correction (the line carries the corrected
 * figures, the correction row keeps before / after); History shows it as
 * "bill_corrected"; the account gets a "correction" entry. Corrections work
 * after toys were sold (unlike Undo); a corrected bill can no longer be undone.
 *
 *   POST /api/supplier-bills/:id/corrections  { kind, note, line_id, … }
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup, sup, outletId, ball, car, doll, robot;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const stockOf = async (pid) => Number((await one("SELECT COALESCE(SUM(quantity),0) AS q FROM outlet_stock WHERE product_id = $1", [pid])).q);
const costOf = async (pid) => Number((await one("SELECT cost_price FROM products WHERE id = $1", [pid])).cost_price);
const owed = async () => Number((await admin().get("/api/supplier-aging")).body.aging.find((r) => r.id === sup)?.total_due || 0);
const correct = (id, body) => admin().post(`/api/supplier-bills/${id}/corrections`).send(body);
const waiting = async (pid) => Number((await one(
  "SELECT COALESCE(SUM(qty),0) AS q FROM supplier_waiting_items WHERE product_id = $1 AND status = 'waiting'", [pid])).q);

function save(payload) {
  return admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
}
const line = (over) => ({ page: 1, supplier_code: null, description: "", discount_pct: 0, split_into: 1, ...over });

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`FIX SUP ${S}`])).id;
  const toy = async (name, stock) => {
    const id = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 1000, 100) RETURNING id", [name, `${name.slice(0, 2)}-${S}`])).id;
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)", [id, outletId, stock]);
    return id;
  };
  ball = await toy(`Ball ${S}`, 5);
  car = await toy(`Car ${S}`, 0);
  doll = await toy(`Doll ${S}`, 1);
  robot = await toy(`Robot ${S}`, 0);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("correcting a saved bill", () => {
  let bill, lines, owedBefore;
  const lineNo = (no) => lines.find((l) => l.line_no === no);

  beforeAll(async () => {
    owedBefore = await owed();
    const r = await save({
      supplier_id: sup, outlet_id: outletId, bill_number: `C1-${S}`, bill_date: "2026-10-16", layout: "hafiz_bill_no",
      written_total: 3800,
      lines: [
        line({ line_no: "1", supplier_code: "BL-1", billed_qty: 12, received_qty: 10, rate: 200, amount: 2400, toys: [{ product_id: ball, qty: 10 }] }),
        line({ line_no: "2", billed_qty: 2, received_qty: 2, rate: 500, amount: 1000, toys: [{ product_id: car, qty: 2 }] }),
        line({ line_no: "3", billed_qty: 4, received_qty: 4, rate: 100, amount: 400, toys: [{ product_id: doll, qty: 2 }, { product_id: robot, qty: 2 }] }),
      ],
    });
    expect(r.status).toBe(201);
    bill = r.body.bill;
    lines = (await admin().get(`/api/supplier-bills/${bill.id}`)).body.bill.lines;
  });

  it("starts as saved: 10 balls in, 2 not received (Rs 400 off the account)", async () => {
    expect(await stockOf(ball)).toBe(15);
    expect(await owed()).toBeCloseTo(owedBefore + 3400, 2);
  });

  it("refuses a correction without a note, or of an unknown kind", async () => {
    let r = await correct(bill.id, { kind: "money", amount: 100, note: "  " });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/note/i);
    r = await correct(bill.id, { kind: "price", note: "x" });
    expect(r.status).toBe(400);
  });

  describe("(a) pieces received changed", () => {
    it("the 2 missing balls turned up: stock +2, the Rs 400 is owed again", async () => {
      const r = await correct(bill.id, { kind: "pieces", line_id: lineNo("1").id, received_qty: 12, note: "2 found in the second carton" });
      expect(r.status).toBe(200);
      expect(await stockOf(ball)).toBe(17);
      expect(await owed()).toBeCloseTo(owedBefore + 3800, 2);
      const l = await one("SELECT received_qty FROM supplier_bill_lines WHERE id = $1", [lineNo("1").id]);
      expect(Number(l.received_qty)).toBe(12);
      const c = await one("SELECT kind, note, before, after, amount FROM supplier_bill_corrections WHERE bill_id = $1 ORDER BY id DESC LIMIT 1", [bill.id]);
      expect(c).toMatchObject({ kind: "pieces", note: "2 found in the second carton" });
      expect(Number(c.before.received_qty)).toBe(10);
      expect(Number(c.after.received_qty)).toBe(12);
      expect(Number(c.amount)).toBe(400);
      const e = await one("SELECT kind, amount FROM supplier_account_entries WHERE supplier_bill_id = $1 ORDER BY id DESC LIMIT 1", [bill.id]);
      expect(e.kind).toBe("correction");
      expect(Number(e.amount)).toBe(400);
    });

    it("History shows the correction with the bill and the note", async () => {
      const m = await one(
        "SELECT kind, ref_type, ref_id, ref_no, note, qty_change FROM stock_movements WHERE product_id = $1 ORDER BY id DESC LIMIT 1", [ball]);
      expect(m).toMatchObject({ kind: "bill_corrected", ref_type: "supplier_bill", ref_id: bill.id, note: "2 found in the second carton" });
      expect(m.ref_no).toMatch(/corrected/);
      expect(Number(m.qty_change)).toBe(2);
    });

    it("one more car than billed: stock +1, kept as an extra piece waiting, nothing owed", async () => {
      const before = await owed();
      const r = await correct(bill.id, { kind: "pieces", line_id: lineNo("2").id, received_qty: 3, note: "an extra car in the box" });
      expect(r.status).toBe(200);
      expect(await stockOf(car)).toBe(3);
      expect(await waiting(car)).toBe(1);
      expect(await owed()).toBeCloseTo(before, 2);
    });

    it("back to 1 car received: stock −2, extra gone, 1 not received (Rs 500 off)", async () => {
      const before = await owed();
      const r = await correct(bill.id, { kind: "pieces", line_id: lineNo("2").id, received_qty: 1, note: "counted again: only 1" });
      expect(r.status).toBe(200);
      expect(await stockOf(car)).toBe(1);
      expect(await waiting(car)).toBe(0);
      expect(await owed()).toBeCloseTo(before - 500, 2);
    });

    it("an assorted line says which toy the pieces changed on", async () => {
      const before = await owed();
      let r = await correct(bill.id, { kind: "pieces", line_id: lineNo("3").id, received_qty: 3, note: "one robot short" });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/which toy/i);
      r = await correct(bill.id, {
        kind: "pieces", line_id: lineNo("3").id, received_qty: 3, note: "one robot short",
        toys: [{ product_id: doll, qty: 2 }, { product_id: robot, qty: 1 }],
      });
      expect(r.status).toBe(200);
      expect(await stockOf(robot)).toBe(1);
      expect(await stockOf(doll)).toBe(3);
      expect(await owed()).toBeCloseTo(before - 100, 2);
    });

    it("works after toys were sold (stock may go below zero)", async () => {
      await db.query("UPDATE outlet_stock SET quantity = 0 WHERE product_id = $1", [robot]);
      const r = await correct(bill.id, {
        kind: "pieces", line_id: lineNo("3").id, received_qty: 2, note: "the other robot was a display piece",
        toys: [{ product_id: doll, qty: 2 }, { product_id: robot, qty: 0 }],
      });
      expect(r.status).toBe(200);
      expect(await stockOf(robot)).toBe(-1);
    });
  });

  describe("(c) wrong rate", () => {
    it("car 500 → 450: cost per piece 450, the account −50 for the 1 car received", async () => {
      const before = await owed();
      const r = await correct(bill.id, { kind: "rate", line_id: lineNo("2").id, rate: 450, note: "agreed rate is 450" });
      expect(r.status).toBe(200);
      expect(await costOf(car)).toBe(450);
      expect(await owed()).toBeCloseTo(before - 50, 2);
      const l = await one("SELECT rate, amount, unit_cost FROM supplier_bill_lines WHERE id = $1", [lineNo("2").id]);
      expect(Number(l.rate)).toBe(450);
      expect(Number(l.amount)).toBe(900);
      expect(Number(l.unit_cost)).toBe(450);
    });

    it("a cost changed since by someone else is left alone", async () => {
      await db.query("UPDATE products SET cost_price = 470 WHERE id = $1", [car]);
      const r = await correct(bill.id, { kind: "rate", line_id: lineNo("2").id, rate: 480, note: "no, 480" });
      expect(r.status).toBe(200);
      expect(await costOf(car)).toBe(470);
    });
  });

  describe("(d) money only", () => {
    it("± on the supplier's account, nothing else", async () => {
      const before = await owed();
      const stock = await stockOf(ball);
      let r = await correct(bill.id, { kind: "money", amount: 0, note: "nothing" });
      expect(r.status).toBe(400);
      r = await correct(bill.id, { kind: "money", amount: -250, note: "discount promised on the phone" });
      expect(r.status).toBe(200);
      expect(await owed()).toBeCloseTo(before - 250, 2);
      expect(await stockOf(ball)).toBe(stock);
      const c = await one("SELECT kind, line_id, amount FROM supplier_bill_corrections WHERE bill_id = $1 ORDER BY id DESC LIMIT 1", [bill.id]);
      expect(c).toMatchObject({ kind: "money", line_id: null });
      expect(Number(c.amount)).toBe(-250);
    });
  });

  describe("(b) wrong toy", () => {
    it("all 12 balls were dolls: pieces move, cost follows, the supplier's code points to the doll", async () => {
      const before = await owed();
      const r = await correct(bill.id, { kind: "toy", line_id: lineNo("1").id, from_product_id: ball, to_product_id: doll, note: "BL-1 is the doll" });
      expect(r.status).toBe(200);
      expect(await stockOf(ball)).toBe(5);
      expect(await stockOf(doll)).toBe(15);
      expect(await costOf(doll)).toBe(200);
      expect(await costOf(ball)).toBe(100); // back to its cost before the bill
      expect(await owed()).toBeCloseTo(before, 2);
      const code = await one("SELECT product_id FROM supplier_item_codes WHERE supplier_id = $1 AND code = 'BL-1'", [sup]);
      expect(code.product_id).toBe(doll);
      const l = await one("SELECT product_id FROM supplier_bill_lines WHERE id = $1", [lineNo("1").id]);
      expect(l.product_id).toBe(doll);
    });

    it("refuses a toy that is not on the line, or the same toy twice", async () => {
      let r = await correct(bill.id, { kind: "toy", line_id: lineNo("2").id, from_product_id: ball, to_product_id: doll, note: "x" });
      expect(r.status).toBe(400);
      r = await correct(bill.id, { kind: "toy", line_id: lineNo("2").id, from_product_id: car, to_product_id: car, note: "x" });
      expect(r.status).toBe(400);
    });
  });

  it("Open shows the corrections with who made them", async () => {
    const r = await admin().get(`/api/supplier-bills/${bill.id}`);
    expect(r.status).toBe(200);
    const kinds = r.body.bill.corrections.map((c) => c.kind);
    expect(kinds).toEqual(["pieces", "pieces", "pieces", "pieces", "pieces", "rate", "rate", "money", "toy"]);
    expect(r.body.bill.corrections[0]).toMatchObject({ note: "2 found in the second carton", line_no: "1" });
    expect(r.body.bill.corrections[0]).toHaveProperty("employee_name");
  });

  it("a corrected bill can no longer be undone", async () => {
    const r = await admin().post(`/api/supplier-bills/${bill.id}/undo`).send({ reason: "try" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/correct/i);
  });

  it("an undone bill can't be corrected", async () => {
    const r2 = await save({
      supplier_id: sup, outlet_id: outletId, bill_number: `C2-${S}`, bill_date: "2026-10-16", written_total: 100,
      lines: [line({ line_no: "1", billed_qty: 1, received_qty: 1, rate: 100, amount: 100, toys: [{ product_id: car, qty: 1 }] })],
    });
    expect(r2.status).toBe(201);
    expect((await admin().post(`/api/supplier-bills/${r2.body.bill.id}/undo`).send({ reason: "test" })).status).toBe(200);
    const r = await correct(r2.body.bill.id, { kind: "money", amount: 10, note: "x" });
    expect(r.status).toBe(409);
  });
});
