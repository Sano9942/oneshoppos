/**
 * ots-supplier-bills-undo.test.js — One Toy Store F9 step (f): undo a whole
 * bill. Owner decision (PHASE-F-PLAN F9, "Mistake after saving"): the same day,
 * Undo the whole bill (stock back, balance back) only while none of its pieces
 * is sold, then upload it again; after that the bill is corrected instead.
 *
 * Undo puts the shop back as it was before the bill:
 *   stock (pieces in out again, pieces sent back in again), cost and selling
 *   price (where nobody changed them since), the supplier's account (the bill,
 *   Not received, sent back), extra pieces waiting, codes learned, new toys
 *   made by the bill (removed, their shop code free again), the files (can be
 *   uploaded again). Money already paid on the spot really left: it stays on
 *   the supplier's account as a payment. The bill stays listed as "undone"
 *   with who, when and why; History shows the bill and its undo.
 *
 *   GET  /api/supplier-bills/today        bills saved today (shop date)
 *   POST /api/supplier-bills/:id/undo     { reason }
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, sup, outletId, leafCat, ball, car, doll, second;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (sql, params = []) => Number((await one(sql, params)).n);
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, "latin1");
const stockOf = async (pid) => Number((await one("SELECT COALESCE(SUM(quantity),0) AS q FROM outlet_stock WHERE product_id = $1", [pid])).q);
const prod = (pid) => one("SELECT price, cost_price, sku, barcode, deleted_at FROM products WHERE id = $1", [pid]);
const owed = async () => Number((await admin().get("/api/supplier-aging")).body.aging.find((r) => r.id === sup)?.total_due || 0);
const undo = (id, reason = "wrong supplier") => admin().post(`/api/supplier-bills/${id}/undo`).send({ reason });

function save(payload, files = []) {
  let r = admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
  for (const f of files) r = r.attach("files", f.buf, { filename: f.name, contentType: "application/pdf" });
  return r;
}
const line = (over) => ({ line_no: "1", page: 1, supplier_code: null, description: "", discount_pct: 0, split_into: 1, ...over });
const bill = (over = {}) => ({ supplier_id: sup, outlet_id: outletId, bill_date: "2026-10-16", layout: "hafiz_bill_no", ...over });

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`UNDO SUP ${S}`])).id;
  const parent = (await one("INSERT INTO categories (name) VALUES ($1) RETURNING id", [`Toys ${S}`])).id;
  leafCat = (await one("INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id", [`Cars ${S}`, parent])).id;
  const toy = async (name, stock) => {
    const id = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 1000, 100) RETURNING id", [name, `${name.slice(0, 2)}-${S}`])).id;
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)", [id, outletId, stock]);
    return id;
  };
  ball = await toy(`Ball ${S}`, 5);
  car = await toy(`Car ${S}`, -3); // below zero, as 225 of the shop's toys were
  doll = await toy(`Doll ${S}`, 10);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("undoing a bill the same day", () => {
  let first, owedBefore;
  const FILE = pdf(`undo ${S}`);
  const payload = () => bill({
    bill_number: `U1-${S}`,
    written_total: 3460,
    paid_now: { method: "cheque", amount: 1000, reference: "CHQ 1 Meezan" },
    lines: [
      line({ line_no: "1", supplier_code: "BL-1", billed_qty: 12, received_qty: 10, rate: 200, amount: 2400, toys: [{ product_id: ball, qty: 10, new_price: 1200 }] }),
      line({ line_no: "2", supplier_code: "CR-1", billed_qty: 2, received_qty: 3, rate: 500, amount: 1000, toys: [{ product_id: car, qty: 3 }] }),
      line({ line_no: "3", billed_qty: -1, received_qty: -1, rate: 300, amount: -300, toys: [{ product_id: doll, qty: -1 }] }),
      line({ line_no: "4", billed_qty: 1, received_qty: 1, rate: 360, amount: 360, is_new: true, toys: [],
        new_toy: { name: `Kite ${S}`, category_id: leafCat, is_brand: false, brand_name: null, price: 990, code: "", barcode: `KB-${S}` } }),
    ],
  });

  beforeAll(async () => {
    owedBefore = await owed();
    first = await save(payload(), [{ name: "bill.pdf", buf: FILE }]);
  });

  it("the bill was saved (stock, cost, price, money, new toy, codes)", async () => {
    expect(first.status).toBe(201);
    expect(await stockOf(ball)).toBe(15);
    expect(await stockOf(car)).toBe(0);
    expect(await stockOf(doll)).toBe(9);
    expect(Number((await prod(ball)).cost_price)).toBe(200);
    expect(Number((await prod(ball)).price)).toBe(1200);
  });

  it("is listed among today's bills", async () => {
    const r = await admin().get("/api/supplier-bills/today");
    expect(r.status).toBe(200);
    expect(r.body.bills.find((b) => b.id === first.body.bill.id)).toMatchObject({ supplier_name: `UNDO SUP ${S}`, bill_number: `U1-${S}`, status: "saved" });
  });

  describe("undo", () => {
    let res, kite;
    beforeAll(async () => {
      kite = await one("SELECT id, sku FROM products WHERE name = $1", [`Kite ${S}`]);
      res = await undo(first.body.bill.id, "uploaded under the wrong supplier");
    });

    it("is done, and the bill stays listed as undone with who, when and why", async () => {
      expect(res.status).toBe(200);
      const b = await one("SELECT status, undone_at, undo_reason, grn_id, supplier_invoice_id, supplier_return_id FROM supplier_bills WHERE id = $1", [first.body.bill.id]);
      expect(b).toMatchObject({ status: "undone", undo_reason: "uploaded under the wrong supplier", grn_id: null, supplier_invoice_id: null, supplier_return_id: null });
      expect(b.undone_at).toBeTruthy();
      const t = await admin().get("/api/supplier-bills/today");
      expect(t.body.bills.find((x) => x.id === first.body.bill.id)).toMatchObject({ status: "undone", undo_reason: "uploaded under the wrong supplier" });
    });

    it("stock back: pieces in go out again, pieces sent back come in again", async () => {
      expect(await stockOf(ball)).toBe(5);
      expect(await stockOf(car)).toBe(-3);
      expect(await stockOf(doll)).toBe(10);
    });

    it("cost and selling price back", async () => {
      const p = await prod(ball);
      expect(Number(p.cost_price)).toBe(100);
      expect(Number(p.price)).toBe(1000);
    });

    it("the supplier's account back, except the cheque already given (a payment on account)", async () => {
      expect(await count("SELECT COUNT(*) AS n FROM supplier_invoices WHERE supplier_id = $1", [sup])).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM supplier_account_entries WHERE supplier_id = $1 AND voided IS NOT TRUE", [sup])).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM supplier_returns WHERE supplier_id = $1", [sup])).toBe(0);
      const pay = await one("SELECT supplier_invoice_id, amount, voided FROM supplier_payments WHERE supplier_id = $1", [sup]);
      expect(pay.supplier_invoice_id).toBeNull();
      expect(pay.voided).not.toBe(true);
      expect(await owed()).toBe(Math.round((owedBefore - 1000) * 100) / 100);
      expect(res.body.paid_kept).toBe(1000);
    });

    it("no delivery note, no extra pieces waiting, no codes learned from it", async () => {
      expect(await count("SELECT COUNT(*) AS n FROM goods_received_notes WHERE supplier_id = $1", [sup])).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM supplier_waiting_items WHERE supplier_id = $1", [sup])).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM supplier_item_codes WHERE supplier_id = $1", [sup])).toBe(0);
    });

    it("the new toy made by the bill is removed and its shop code and barcode are free", async () => {
      const k = await prod(kite.id);
      expect(k.deleted_at).toBeTruthy();
      expect(k.sku).not.toBe(kite.sku);
      expect(k.barcode).toBeNull();
    });

    it("History shows the bill and its undo", async () => {
      const h = await admin().get(`/api/products/${ball}/history/stock`);
      const moves = h.body.items || h.body.movements || [];
      expect(moves[0]).toMatchObject({ kind: "bill_undone", ref_type: "supplier_bill", ref_id: first.body.bill.id });
      expect(Number(moves[0].qty_change)).toBe(-10);
      expect(moves.some((m) => m.kind === "delivery")).toBe(true);
    });

    it("the same bill can be uploaded again: same file, same number, the new toy gets its code back", async () => {
      const again = await save(payload(), [{ name: "bill.pdf", buf: FILE }]);
      expect(again.status).toBe(201);
      const k2 = await one("SELECT sku FROM products WHERE name = $1 AND deleted_at IS NULL", [`Kite ${S}`]);
      expect(k2.sku).toBe(kite.sku);
      expect(await stockOf(ball)).toBe(15);
      second = again.body.bill;
    });

    it("an undone bill can't be undone again", async () => {
      expect((await undo(first.body.bill.id)).status).toBe(409);
    });
  });
});

describe("when undo is refused", () => {
  it("once a piece went out (sold) after the bill was saved", async () => {
    await db.query("UPDATE outlet_stock SET quantity = quantity - 1 WHERE product_id = $1 AND outlet_id = $2", [ball, outletId]);
    await db.query("UPDATE stock_movements SET kind = 'sale' WHERE id = (SELECT MAX(id) FROM stock_movements WHERE product_id = $1)", [ball]);
    const r = await undo(second.id);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(new RegExp(`Ball ${S}.*sold`, "i"));
    expect(r.body.error).toMatch(/correct the bill/i);
    expect(await stockOf(ball)).toBe(14);
    expect((await one("SELECT status FROM supplier_bills WHERE id = $1", [second.id])).status).toBe("saved");
  });

  it("on a later day", async () => {
    const r1 = await save(bill({ bill_number: `U2-${S}`, written_total: 100,
      lines: [line({ billed_qty: 1, received_qty: 1, rate: 100, amount: 100, toys: [{ product_id: doll, qty: 1 }] })] }));
    expect(r1.status).toBe(201);
    await db.query("UPDATE supplier_bills SET saved_at = saved_at - INTERVAL '2 days' WHERE id = $1", [r1.body.bill.id]);
    const r = await undo(r1.body.bill.id);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/only on the day/i);
  });

  it("without a reason", async () => {
    const r1 = await save(bill({ bill_number: `U3-${S}`, written_total: 100,
      lines: [line({ billed_qty: 1, received_qty: 1, rate: 100, amount: 100, toys: [{ product_id: doll, qty: 1 }] })] }));
    expect((await undo(r1.body.bill.id, "  ")).status).toBe(400);
  });

  it("without the 'Receive supplier bills' permission", async () => {
    expect((await makeRequest(app, CASHIER_ID).post(`/api/supplier-bills/${second.id}/undo`).send({ reason: "x" })).status).toBe(403);
    expect((await makeRequest(app, CASHIER_ID).get("/api/supplier-bills/today")).status).toBe(403);
  });
});
