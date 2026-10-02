/**
 * ots-supplier-bills-save.test.js — One Toy Store F9 step (c2): saving a
 * checked supplier bill (POST /api/supplier-bills, multipart: payload + files).
 * Owner decisions (PHASE-F-PLAN F9):
 *   - stock up by what ARRIVED, on the shop's stock ledger (History shows the
 *     supplier's bill);
 *   - cost = the latest bill's price after discounts (line discount, the
 *     whole-bill discount spread by value), ÷ N for a pack split into N;
 *   - the FULL bill onto the supplier's account; missing pieces = a separate
 *     "Not received" minus entry; extra pieces kept = stock in now, on the
 *     "waiting for supplier's bill" list (no money);
 *   - minus lines = goods sent back (a supplier return: stock out, balance down);
 *   - lines must add up to the total written on the bill, unless "supplier's
 *     total is different" is ticked with a note (owner picks the amount);
 *   - the very same file can't be on two live bills;
 *   - the supplier's codes are learned for next time;
 *   - Paid now: cheque / bank transfer = a supplier payment; cash from the till
 *     = the till's Paid out → Pay supplier (needs an open shift).
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, sup, outletId, ball, carRed, carBlue, rattle, doll;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const stockOf = async (pid) => Number((await one("SELECT COALESCE(SUM(quantity),0) AS q FROM outlet_stock WHERE product_id = $1", [pid])).q);
const costOf = async (pid) => Number((await one("SELECT cost_price FROM products WHERE id = $1", [pid])).cost_price);
const owed = async () => Number((await admin().get("/api/supplier-aging")).body.aging.find((r) => r.id === sup).total_due);

const product = async (name, stock = 0) => {
  const id = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 1000, 100) RETURNING id", [name, `${name.slice(0, 3)}-${S}`])).id;
  if (stock) await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)", [id, outletId, stock]);
  return id;
};

function save(payload, files = []) {
  let r = admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
  for (const f of files) r = r.attach("files", f.buf, { filename: f.name, contentType: "application/pdf" });
  return r;
}
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, "latin1");

const base = (over = {}) => ({
  supplier_id: sup,
  outlet_id: outletId,
  bill_number: `B-${S}`,
  bill_date: "2026-10-01",
  layout: "hafiz_bill_no",
  written_total: 0,
  bill_discount: 0,
  lines: [],
  ...over,
});
const line = (over) => ({ line_no: "1", page: 1, supplier_code: null, description: "", discount_pct: 0, split_into: 1, ...over });

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one("INSERT INTO suppliers (name, payment_terms, credit_days) VALUES ($1, 'credit', 30) RETURNING id", [`F9 SAVE ${S}`])).id;
  ball = await product(`Ball ${S}`, 5);
  carRed = await product(`Car Red ${S}`);
  carBlue = await product(`Car Blue ${S}`);
  rattle = await product(`Rattle ${S}`);
  doll = await product(`Doll ${S}`, 10);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("a plain bill", () => {
  let res;
  beforeAll(async () => {
    res = await save(base({
      written_total: 2184, // what the bill says: lines after the 5 % line discount
      lines: [
        // 12 balls at 160 less 5 % → 152 a piece
        line({ line_no: "1", supplier_code: "BL-1", billed_qty: 12, received_qty: 12, rate: 160, discount_pct: 5, amount: 1920, toys: [{ product_id: ball, qty: 12 }] }),
        // a pack of 6 rattles at 360, split into pieces → 6 pieces at 60
        line({ line_no: "2", supplier_code: "RT-6", billed_qty: 1, received_qty: 1, rate: 360, amount: 360, split_into: 6, toys: [{ product_id: rattle, qty: 6 }] }),
      ],
    }), [{ name: "bill.pdf", buf: pdf(`plain ${S}`) }]);
  });

  it("is saved", () => {
    expect(res.status).toBe(201);
    expect(res.body.bill).toMatchObject({ status: "saved", bill_number: `B-${S}` });
  });

  it("puts the pieces into stock at the chosen branch", async () => {
    expect(await stockOf(ball)).toBe(17);
    expect(await stockOf(rattle)).toBe(6);
  });

  it("replaces the cost with the bill's cost after discount, ÷ pieces for a split pack", async () => {
    expect(await costOf(ball)).toBe(152);
    expect(await costOf(rattle)).toBe(60);
  });

  it("puts the bill (after the line discount) on the supplier's account", async () => {
    // 12 × 152 = 1,824 + 360 = 2,184 (the 5 % is the supplier's own discount on the line)
    expect(await owed()).toBe(2184);
    const inv = await one("SELECT invoice_number, amount, due_date FROM supplier_invoices WHERE id = $1", [res.body.bill.supplier_invoice_id]);
    expect(inv).toMatchObject({ invoice_number: `B-${S}`, due_date: "2026-10-31" });
  });

  it("makes a delivery note with the supplier and no PO; History names the bill", async () => {
    const g = await one("SELECT supplier_id, po_id, supplier_bill_id FROM goods_received_notes WHERE id = $1", [res.body.bill.grn_id]);
    expect(g).toMatchObject({ supplier_id: sup, po_id: null, supplier_bill_id: res.body.bill.id });
    const h = await admin().get(`/api/products/${ball}/history/stock`);
    const moves = h.body.items || h.body.movements || [];
    expect(moves[0]).toMatchObject({ qty_change: expect.anything(), kind: "delivery", ref_type: "supplier_bill" });
    expect(String(moves[0].ref_no)).toContain(`B-${S}`);
  });

  it("learns the supplier's codes, with the split", async () => {
    const codes = (await db.query("SELECT code, product_id, split_into FROM supplier_item_codes WHERE supplier_id = $1 ORDER BY code", [sup])).rows;
    expect(codes).toEqual([
      { code: "BL-1", product_id: ball, split_into: 1 },
      { code: "RT-6", product_id: rattle, split_into: 6 },
    ]);
  });

  it("keeps the file; the very same file again is refused", async () => {
    const f = await one("SELECT file_name, sha256, storage_key, active FROM supplier_bill_files WHERE bill_id = $1", [res.body.bill.id]);
    expect(f).toMatchObject({ file_name: "bill.pdf", active: true });
    expect(f.storage_key).toBeTruthy();
    const again = await save(base({ bill_number: `B2-${S}`, written_total: 0, lines: [] }), [{ name: "copy.pdf", buf: pdf(`plain ${S}`) }]);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already on bill/i);
  });
});

describe("short, extra, assorted, sent back, bill discount", () => {
  let res, before;
  beforeAll(async () => {
    before = await owed();
    res = await save(base({
      bill_number: `C-${S}`,
      bill_discount: 99, // 1 % of the lines' 9,900, spread over the lines by value
      written_total: 9801,
      lines: [
        // billed 10 balls, 8 in the carton
        line({ line_no: "1", billed_qty: 10, received_qty: 8, rate: 500, amount: 5000, toys: [{ product_id: ball, qty: 8 }] }),
        // an assorted line: 4 cars billed, 5 came (1 extra kept), red 3 + blue 2
        line({ line_no: "2", supplier_code: "CAR-A", billed_qty: 4, received_qty: 5, rate: 1500, amount: 6000, toys: [{ product_id: carRed, qty: 3 }, { product_id: carBlue, qty: 2 }] }),
        // 2 dolls sent back
        line({ line_no: "3", billed_qty: -2, received_qty: -2, rate: 550, amount: -1100, toys: [{ product_id: doll, qty: -2 }] }),
      ],
    }));
  });

  it("is saved", () => {
    expect(res.status).toBe(201);
  });

  it("stock moves by what arrived / went back", async () => {
    expect(await stockOf(ball)).toBe(25); // 17 + 8
    expect(await stockOf(carRed)).toBe(3);
    expect(await stockOf(carBlue)).toBe(2);
    expect(await stockOf(doll)).toBe(8); // 10 − 2
  });

  it("cost after the bill discount share (1 %)", async () => {
    expect(await costOf(ball)).toBe(495);
    expect(await costOf(carRed)).toBe(1485);
  });

  it("account: full bill on, not received off, sent back off; extra piece not billed", async () => {
    const entries = (await db.query("SELECT kind, amount FROM supplier_account_entries WHERE supplier_bill_id = $1", [res.body.bill.id])).rows;
    expect(entries.map((e) => [e.kind, Number(e.amount)])).toEqual([["not_received", -990]]); // 2 × 495
    const ret = await one("SELECT total_value FROM supplier_returns WHERE id = $1", [res.body.bill.supplier_return_id]);
    expect(Number(ret.total_value)).toBe(1089); // 2 × 550 less 1 %
    // invoice = positive lines less the 1 %: (5,000 + 6,000) × 0.99 = 10,890
    // owed change = 10,890 − 990 − 1,089 = 8,811
    expect(await owed()).toBe(Math.round((before + 8811) * 100) / 100);
  });

  it("the extra piece waits for the supplier's bill", async () => {
    const w = (await db.query("SELECT product_id, qty, unit_cost, status FROM supplier_waiting_items WHERE received_bill_id = $1", [res.body.bill.id])).rows;
    expect(w.map((x) => [x.product_id, Number(x.qty), Number(x.unit_cost), x.status])).toEqual([[carBlue, 1, 1485, "waiting"]]);
  });

  it("an assorted code is learned for every toy on the line", async () => {
    const codes = (await db.query("SELECT product_id FROM supplier_item_codes WHERE supplier_id = $1 AND code = 'CAR-A' ORDER BY product_id", [sup])).rows;
    expect(codes.map((c) => c.product_id)).toEqual([carRed, carBlue].sort((a, b) => a - b));
  });
});

describe("refusals", () => {
  it("lines that don't add up to the written total, unless ticked with a note", async () => {
    const lines = [line({ billed_qty: 1, received_qty: 1, rate: 100, amount: 100, toys: [{ product_id: ball, qty: 1 }] })];
    const bad = await save(base({ bill_number: `D-${S}`, written_total: 150, lines }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/total/i);
    const noNote = await save(base({ bill_number: `D-${S}`, written_total: 150, total_differs: true, lines }));
    expect(noNote.status).toBe(400);
    const before = await owed();
    const ok = await save(base({ bill_number: `D-${S}`, written_total: 150, total_differs: true, total_note: "they added 50 freight", account_amount: 150, lines }));
    expect(ok.status).toBe(201);
    expect(await owed()).toBe(before + 150);
  });

  it("pieces not shared out on an assorted line", async () => {
    const r = await save(base({ bill_number: `E-${S}`, written_total: 300, lines: [
      line({ billed_qty: 2, received_qty: 2, rate: 150, amount: 300, toys: [{ product_id: carRed, qty: 1 }, { product_id: carBlue, qty: 0 }] }),
    ] }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/line 1/i);
  });

  it("new toys wait for their code and price (next step)", async () => {
    const r = await save(base({ bill_number: `F-${S}`, written_total: 100, lines: [
      line({ billed_qty: 1, received_qty: 1, rate: 100, amount: 100, is_new: true, new_name: "Kite", toys: [] }),
    ] }));
    expect(r.status).toBe(400);
  });

  it("needs the 'Receive supplier bills' permission", async () => {
    const r = await makeRequest(app, CASHIER_ID).post("/api/supplier-bills").field("payload", JSON.stringify(base()));
    expect(r.status).toBe(403);
  });
});

describe("paid now", () => {
  it("by cheque: a supplier payment against this bill", async () => {
    const before = await owed();
    const r = await save(base({ bill_number: `G-${S}`, written_total: 1000,
      paid_now: { method: "cheque", amount: 1000, reference: "CHQ 123456 Alfalah" },
      lines: [line({ billed_qty: 2, received_qty: 2, rate: 500, amount: 1000, toys: [{ product_id: ball, qty: 2 }] })] }));
    expect(r.status).toBe(201);
    const p = await one("SELECT payment_method, reference, amount, supplier_invoice_id FROM supplier_payments WHERE id = $1", [r.body.bill.supplier_payment_id]);
    expect(p).toMatchObject({ payment_method: "Cheque", reference: "CHQ 123456 Alfalah", supplier_invoice_id: r.body.bill.supplier_invoice_id });
    expect(await owed()).toBe(before);
  });

  it("cash from the till needs an open shift and becomes the till's Pay supplier", async () => {
    const lines = [line({ billed_qty: 1, received_qty: 1, rate: 700, amount: 700, toys: [{ product_id: ball, qty: 1 }] })];
    const noShift = await save(base({ bill_number: `H-${S}`, written_total: 700, paid_now: { method: "till_cash", amount: 700 }, lines }));
    expect(noShift.status).toBe(409);
    const shift = (await one(
      "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status) VALUES ($1, $2, 0, 'open') RETURNING id", [outletId, ADMIN_ID])).id;
    const r = await save(base({ bill_number: `H-${S}`, written_total: 700, paid_now: { method: "till_cash", amount: 700, shift_id: shift }, lines }));
    expect(r.status).toBe(201);
    const p = await one("SELECT kind, amount, shift_id FROM till_payouts WHERE id = $1", [r.body.bill.till_payout_id]);
    expect(p).toMatchObject({ kind: "supplier", shift_id: shift });
    expect(Number(p.amount)).toBe(700);
  });
});

describe("a typed bill with no file", () => {
  it("can be saved (handwritten bills are typed in)", async () => {
    const r = await save(base({ bill_number: `T-${S}`, layout: null, written_total: 100,
      lines: [line({ billed_qty: 1, received_qty: 1, rate: 100, amount: 100, toys: [{ product_id: ball, qty: 1 }] })] }));
    expect(r.status).toBe(201);
  });
});
