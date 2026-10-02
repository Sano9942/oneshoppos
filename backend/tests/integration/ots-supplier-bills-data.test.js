/**
 * ots-supplier-bills-data.test.js — One Toy Store pilot F9 step (a): the data.
 *
 * F9 = receive a supplier bill without a purchase order (PHASE-F-PLAN F9).
 * Step (a) adds the tables and wires the places that must read them at once:
 *   - extra barcodes per toy (one toy, one stock): till scan, till search,
 *     the till's offline copy, stock-count scan;
 *   - supplier codes per supplier per toy (one code may point to SEVERAL toys,
 *     owner 2026-10-02: an assorted line), looked up only within that supplier;
 *   - supplier bill + lines + files (the very same file refused while its bill
 *     is live, allowed again after an undo);
 *   - supplier account entries "Not received" (−), "Discount" (−) and
 *     "Correction" (±): in what we owe, the ledger and the payables report;
 *   - a delivery note (GRN) with its own supplier, no PO: on the ledger;
 *   - "Received, waiting for supplier's bill" list;
 *   - permission "Receive supplier bills".
 */
const crypto = require("crypto");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
let sup, sup2, car, carRed, outletId;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one(
    "INSERT INTO suppliers (name, payment_terms, opening_balance) VALUES ($1, 'credit', 10000) RETURNING id",
    [`F9 Baby Land ${S}`])).id;
  sup2 = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`F9 Hafiz ${S}`])).id;
  car = (await one(
    "INSERT INTO products (name, price, cost_price, sku, barcode) VALUES ($1, 900, 400, $2, $3) RETURNING id",
    [`F9 Racing Car Blue ${S}`, `F9C${S}`, `690${S}1`])).id;
  carRed = (await one(
    "INSERT INTO products (name, price, cost_price, sku) VALUES ($1, 900, 400, $2) RETURNING id",
    [`F9 Racing Car Red ${S}`, `F9R${S}`])).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("extra barcodes per toy (one toy, one stock)", () => {
  const extra = `8801${S}`;

  beforeAll(async () => {
    await db.query("INSERT INTO product_barcodes (product_id, barcode) VALUES ($1, $2)", [car, extra]);
  });

  it("a barcode is on one toy only", async () => {
    await expect(
      db.query("INSERT INTO product_barcodes (product_id, barcode) VALUES ($1, $2)", [carRed, extra])
    ).rejects.toThrow();
  });

  it("the till scan finds the toy by its extra barcode", async () => {
    const res = await admin().get(`/api/products/scan/${extra}`);
    expect(res.status).toBe(200);
    const p = res.body.product ?? res.body;
    expect(p.id).toBe(car);
  });

  it("the till search puts the toy first for its extra barcode", async () => {
    const res = await admin().get(`/api/products/search?query=${extra}`);
    expect(res.status).toBe(200);
    expect(res.body.products[0]?.id).toBe(car);
  });

  it("the till's offline copy carries the extra barcodes", async () => {
    const res = await admin().get("/api/products/catalogue");
    expect(res.status).toBe(200);
    const body = typeof res.body === "object" && res.body.products ? res.body : JSON.parse(res.text);
    const p = body.products.find((x) => x.id === car);
    expect(p.extra_barcodes).toEqual([extra]);
  });

  it("a stock count scan finds the toy by its extra barcode", async () => {
    const sc = await admin().post("/api/stock-counts").send({ outlet_id: outletId });
    expect([200, 201]).toContain(sc.status);
    const countId = sc.body.stockCount.id;
    const res = await admin().post(`/api/stock-counts/${countId}/scan`).send({ barcode: extra });
    expect(res.status).toBe(200);
    expect(res.body.item.product_id).toBe(car);
    const line = await one("SELECT counted_qty FROM stock_count_items WHERE stock_count_id = $1 AND product_id = $2", [countId, car]);
    expect(Number(line.counted_qty)).toBe(1);
  });
});

describe("supplier codes (per supplier, per toy)", () => {
  it("one supplier code can point to several toys (an assorted line)", async () => {
    await db.query(
      "INSERT INTO supplier_item_codes (supplier_id, product_id, code) VALUES ($1, $2, 'RC-77'), ($1, $3, 'RC-77')",
      [sup, car, carRed]);
    const { rows } = await db.query(
      "SELECT product_id FROM supplier_item_codes WHERE supplier_id = $1 AND LOWER(code) = LOWER('rc-77') ORDER BY product_id",
      [sup]);
    expect(rows.map((r) => r.product_id)).toEqual([car, carRed].sort((a, b) => a - b));
  });

  it("the same code at another supplier is a different thing", async () => {
    await db.query("INSERT INTO supplier_item_codes (supplier_id, product_id, code) VALUES ($1, $2, 'RC-77')", [sup2, carRed]);
    const { rows } = await db.query("SELECT product_id FROM supplier_item_codes WHERE supplier_id = $1", [sup2]);
    expect(rows.map((r) => r.product_id)).toEqual([carRed]);
  });

  it("the same toy can't have the same code twice at one supplier; a leading zero is a different code", async () => {
    await expect(
      db.query("INSERT INTO supplier_item_codes (supplier_id, product_id, code) VALUES ($1, $2, 'rc-77')", [sup, car])
    ).rejects.toThrow();
    await db.query("INSERT INTO supplier_item_codes (supplier_id, product_id, code) VALUES ($1, $2, '07556')", [sup, car]);
    await db.query("INSERT INTO supplier_item_codes (supplier_id, product_id, code) VALUES ($1, $2, '7556')", [sup, car]);
  });

  it("remembers 'split into N' (at least 1)", async () => {
    await expect(
      db.query("INSERT INTO supplier_item_codes (supplier_id, product_id, code, split_into) VALUES ($1, $2, 'X', 0)", [sup, car])
    ).rejects.toThrow();
    const r = await one(
      "INSERT INTO supplier_item_codes (supplier_id, product_id, code, split_into) VALUES ($1, $2, 'RATTLE-6', 6) RETURNING split_into",
      [sup, carRed]);
    expect(r.split_into).toBe(6);
  });
});

describe("supplier bill, lines, files", () => {
  let bill;
  const sha = crypto.createHash("sha256").update(`file-${S}`).digest("hex");

  it("a bill starts as a draft and holds lines with the bill's own S.No", async () => {
    bill = (await one(
      `INSERT INTO supplier_bills (supplier_id, outlet_id, bill_number, bill_date, created_by)
       VALUES ($1, $2, '01', '2026-10-02', $3) RETURNING id, status`, [sup, outletId, ADMIN_ID]));
    expect(bill.status).toBe("draft");
    await db.query(
      `INSERT INTO supplier_bill_lines (bill_id, sort_order, line_no, page, supplier_code, description, product_id,
                                        billed_qty, received_qty, rate, discount_pct, amount, unit_cost)
       VALUES ($1, 1, '1', 1, 'RC-77', 'Racing car asst', $2, 12, 11, 160, 5, 1824, 152),
              ($1, 2, '2', 1, NULL, 'Return: doll', $3, -2, -2, 300, 0, -600, 300)`,
      [bill.id, car, carRed]);
    const { rows } = await db.query("SELECT line_no, billed_qty, received_qty FROM supplier_bill_lines WHERE bill_id = $1 ORDER BY sort_order", [bill.id]);
    expect(rows.map((r) => [r.line_no, Number(r.billed_qty), Number(r.received_qty)])).toEqual([["1", 12, 11], ["2", -2, -2]]);
  });

  it("a draft changes nothing on the supplier's account", async () => {
    const t = await one("SELECT COUNT(*)::int AS n FROM supplier_invoices WHERE supplier_id = $1", [sup]);
    expect(t.n).toBe(0);
  });

  it("only draft / saved / undone", async () => {
    await expect(db.query("UPDATE supplier_bills SET status = 'posted' WHERE id = $1", [bill.id])).rejects.toThrow();
  });

  it("the very same file is refused while its bill is live; allowed again after an undo", async () => {
    await db.query(
      "INSERT INTO supplier_bill_files (bill_id, file_name, content_type, size_bytes, sha256) VALUES ($1, 'a.pdf', 'application/pdf', 100, $2)",
      [bill.id, sha]);
    const other = (await one("INSERT INTO supplier_bills (supplier_id, bill_number) VALUES ($1, '02') RETURNING id", [sup])).id;
    await expect(db.query(
      "INSERT INTO supplier_bill_files (bill_id, file_name, content_type, size_bytes, sha256) VALUES ($1, 'b.pdf', 'application/pdf', 100, $2)",
      [other, sha])).rejects.toThrow();
    await db.query("UPDATE supplier_bills SET status = 'undone' WHERE id = $1", [bill.id]);
    await db.query("UPDATE supplier_bill_files SET active = false WHERE bill_id = $1", [bill.id]);
    await db.query(
      "INSERT INTO supplier_bill_files (bill_id, file_name, content_type, size_bytes, sha256) VALUES ($1, 'b.pdf', 'application/pdf', 100, $2)",
      [other, sha]);
  });
});

describe("supplier account: Not received, Discount, Correction", () => {
  const aging = async () => (await admin().get("/api/supplier-aging")).body.aging.find((r) => r.id === sup);
  const ledger = async () => (await admin().get(`/api/supplier-ledger/${sup}`)).body;

  beforeAll(async () => {
    await db.query("INSERT INTO supplier_invoices (supplier_id, invoice_number, amount) VALUES ($1, $2, 5000)", [sup, `F9-B1-${S}`]);
  });

  it("Not received and Discount must lower the balance (negative); Correction either way", async () => {
    await expect(db.query(
      "INSERT INTO supplier_account_entries (supplier_id, kind, amount) VALUES ($1, 'not_received', 450)", [sup])).rejects.toThrow();
    await expect(db.query(
      "INSERT INTO supplier_account_entries (supplier_id, kind, amount) VALUES ($1, 'discount', 0)", [sup])).rejects.toThrow();
    await expect(db.query(
      "INSERT INTO supplier_account_entries (supplier_id, kind, amount) VALUES ($1, 'credit', -1)", [sup])).rejects.toThrow();
    await db.query(
      `INSERT INTO supplier_account_entries (supplier_id, kind, amount, note) VALUES
         ($1, 'not_received', -450, '3 cars not in the carton'),
         ($1, 'discount', -300, '3 % on 6 months'),
         ($1, 'correction', 100, 'rate typed wrong')`, [sup]);
  });

  it("what we owe = opening + bills − payments − returns + these entries", async () => {
    expect(Number((await aging()).total_due)).toBe(14350); // 10,000 + 5,000 − 450 − 300 + 100
  });

  it("a voided entry no longer counts", async () => {
    const e = await one(
      "INSERT INTO supplier_account_entries (supplier_id, kind, amount) VALUES ($1, 'discount', -1000) RETURNING id", [sup]);
    expect(Number((await aging()).total_due)).toBe(13350);
    await db.query("UPDATE supplier_account_entries SET voided = true WHERE id = $1", [e.id]);
    expect(Number((await aging()).total_due)).toBe(14350);
  });

  it("the ledger shows each entry under its own heading and agrees", async () => {
    const l = await ledger();
    const byType = (t) => l.entries.filter((e) => e.type === t);
    expect(byType("not_received")[0]).toMatchObject({ debit: 0, credit: 450, reference: "Not received" });
    expect(byType("discount")[0]).toMatchObject({ debit: 0, credit: 300, reference: "Discount" });
    expect(byType("correction")[0]).toMatchObject({ debit: 100, credit: 0, reference: "Correction" });
    expect(l.closing_balance).toBe(14350);
  });

  it("the payables report agrees", async () => {
    const res = await admin().get(`/api/reports/payables-receivables?supplier_id=${sup}`);
    expect(res.status).toBe(200);
    const lines = res.body.supplier_ap.filter((r) => r.supplier_name === `F9 Baby Land ${S}`);
    const owed = Math.round(lines.reduce((a, r) => a + Number(r.outstanding), 0) * 100) / 100;
    expect(owed).toBe(14350);
  });
});

describe("delivery without a PO, and the waiting list", () => {
  let grnId;

  it("a delivery note can carry its own supplier with no PO, and shows on that supplier's ledger", async () => {
    grnId = (await one(
      "INSERT INTO goods_received_notes (grn_number, outlet_id, supplier_id) VALUES ($1, $2, $3) RETURNING id",
      [`GRN-F9-${S}`, outletId, sup2])).id;
    const l = (await admin().get(`/api/supplier-ledger/${sup2}`)).body;
    expect(l.entries.some((e) => e.type === "grn" && e.reference === `GRN-F9-${S}`)).toBe(true);
  });

  it("extra pieces kept wait for the supplier's bill (waiting / billed / free)", async () => {
    const w = await one(
      "INSERT INTO supplier_waiting_items (supplier_id, product_id, qty, unit_cost, grn_id) VALUES ($1, $2, 2, 152, $3) RETURNING status",
      [sup2, car, grnId]);
    expect(w.status).toBe("waiting");
    await expect(db.query(
      "INSERT INTO supplier_waiting_items (supplier_id, product_id, qty, unit_cost) VALUES ($1, $2, 0, 152)", [sup2, car])).rejects.toThrow();
  });
});

describe("permission", () => {
  it("'Receive supplier bills' is in the role editor's list", async () => {
    const res = await admin().get("/api/permissions-catalog");
    expect(res.status).toBe(200);
    const all = JSON.stringify(res.body);
    expect(all).toContain("receive_supplier_bills");
  });
});
