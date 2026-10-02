/**
 * ots-supplier-bills-newtoys.test.js — One Toy Store F9 step (d): new toys on
 * a supplier bill, and price changes for toys whose cost changed.
 * Owner decisions (PHASE-F-PLAN F9):
 *   - every new toy gets a shop code from ONE running number, 31000 up, max 5
 *     digits; a code must not equal any SKU with or without leading zeros
 *     (7556 vs 07556), nor a barcode in use; the shop may type its own code;
 *   - category (a bottom-level one) and Brand / Non-brand are required; a brand
 *     not yet in SanoPOS is added (spelling differences like "Fisher Price" vs
 *     "Fisher-Price" are the same brand);
 *   - the selling price comes from the check screen (price rules there); the
 *     toy's cost = this bill's cost per piece; the supplier's code is learned;
 *   - a maker's barcode scanned on the check screen goes on the toy;
 *   - an existing toy's price changes only when the check screen says so;
 *   - the saved bill hands back the labels list: new toys + price changes.
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup, sup, outletId, leafCat, parentCat, fisher, oldToy;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const productCount = async () => Number((await one("SELECT COUNT(*) AS n FROM products")).n);
const stockOf = async (pid) => Number((await one("SELECT COALESCE(SUM(quantity),0) AS q FROM outlet_stock WHERE product_id = $1", [pid])).q);

const save = (payload) => admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
let billNo = 0;
const bill = (lines, over = {}) => {
  const total = lines.reduce((a, l) => a + l.amount, 0);
  billNo += 1;
  return { supplier_id: sup, outlet_id: outletId, bill_number: `N${billNo}-${S}`, bill_date: "2026-10-03", written_total: total, lines, ...over };
};
const newLine = (toy, over = {}) => ({
  line_no: "1", page: 1, supplier_code: null, description: toy.name, discount_pct: 0, split_into: 1,
  billed_qty: 2, received_qty: 2, rate: 500, amount: 1000, is_new: true, toys: [],
  new_toy: { category_id: leafCat, is_brand: false, brand_name: null, price: 1380, code: "", barcode: "", ...toy },
  ...over,
});

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`F9 NEW ${S}`])).id;
  parentCat = (await one("INSERT INTO categories (name) VALUES ($1) RETURNING id", [`Vehicles ${S}`])).id;
  leafCat = (await one("INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id", [`Cars ${S}`, parentCat])).id;
  fisher = (await one("INSERT INTO brands (name) VALUES ('Fisher-Price') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id")).id;
  // Codes already taken, in every way the owner's data has them:
  await db.query("INSERT INTO products (name, sku, price) VALUES ($1, '031000', 100)", [`Zero-led ${S}`]); // 31000 with a leading zero
  await db.query("INSERT INTO products (name, sku, barcode, price) VALUES ($1, $2, '31001', 100)", [`Barcode ${S}`, `BC-${S}`]); // 31001 as a barcode
  const extra = (await one("INSERT INTO products (name, sku, price) VALUES ($1, $2, 100) RETURNING id", [`Extra ${S}`, `EX-${S}`])).id;
  await db.query("INSERT INTO product_barcodes (product_id, barcode) VALUES ($1, '31002')", [extra]); // 31002 as an extra barcode
  await db.query("INSERT INTO products (name, sku, price) VALUES ($1, '07556', 100)", [`Gun soft bullet ${S}`]);
  oldToy = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 900, 300) RETURNING id", [`Old car ${S}`, `OC-${S}`])).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("new toys on a bill", () => {
  let res, a, b;
  beforeAll(async () => {
    res = await save(bill([
      newLine({ name: `Tori car ${S}`, price: 1380, barcode: `6900${S}` }, { supplier_code: "TC-9" }),
      // a pack of 6 rattles at 600 split into pieces → cost 100 a piece
      newLine({ name: `Rattle piece ${S}`, price: 290, is_brand: true, brand_name: "Fisher Price" },
        { line_no: "2", billed_qty: 1, received_qty: 1, rate: 600, amount: 600, split_into: 6 }),
    ]));
    a = await one("SELECT * FROM products WHERE name = $1", [`Tori car ${S}`]);
    b = await one("SELECT * FROM products WHERE name = $1", [`Rattle piece ${S}`]);
  });

  it("is saved", () => {
    expect(res.status).toBe(201);
  });

  it("gives each new toy the next free shop code from 31000, skipping codes used with a leading zero or as a barcode", () => {
    expect(a.sku).toBe("31003");
    expect(b.sku).toBe("31004");
  });

  it("creates the toy with its price, this bill's cost per piece, category, supplier, barcode and stock", async () => {
    expect(a).toMatchObject({ category_id: leafCat, brand_id: null, supplier_id: sup, barcode: `6900${S}` });
    expect(Number(a.price)).toBe(1380);
    expect(Number(a.cost_price)).toBe(500);
    expect(await stockOf(a.id)).toBe(2);
    expect(Number(b.cost_price)).toBe(100);
    expect(await stockOf(b.id)).toBe(6);
  });

  it("uses the brand already there, whatever the spelling", () => {
    expect(b.brand_id).toBe(fisher);
  });

  it("learns the supplier's code and marks the line as a new toy", async () => {
    const c = await one("SELECT product_id FROM supplier_item_codes WHERE supplier_id = $1 AND code = 'TC-9'", [sup]);
    expect(c.product_id).toBe(a.id);
    const l = await one("SELECT product_id, is_new_product, sale_price FROM supplier_bill_lines WHERE bill_id = $1 AND line_no = '1'", [res.body.bill.id]);
    expect(l).toMatchObject({ product_id: a.id, is_new_product: true });
    expect(Number(l.sale_price)).toBe(1380);
  });

  it("hands back the labels list", () => {
    expect(res.body.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ product_id: a.id, sku: "31003", price: 1380, is_new: true }),
      expect.objectContaining({ product_id: b.id, sku: "31004", price: 290, is_new: true }),
    ]));
  });

  it("the next bill carries on with the running number", async () => {
    const r = await save(bill([newLine({ name: `Walker ${S}` })]));
    expect(r.status).toBe(201);
    expect(r.body.labels[0].sku).toBe("31005");
  });
});

describe("a brand not in SanoPOS yet, and a code typed by the shop", () => {
  it("adds the brand and keeps the typed code", async () => {
    const r = await save(bill([newLine({ name: `Bottle ${S}`, is_brand: true, brand_name: `Nuby ${S}`, code: "45001" })]));
    expect(r.status).toBe(201);
    const p = await one("SELECT p.sku, b.name AS brand FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.name = $1", [`Bottle ${S}`]);
    expect(p).toEqual({ sku: "45001", brand: `Nuby ${S}` });
  });
});

describe("a new toy that can't be saved: nothing is created", () => {
  const cases = [
    ["no category", { category_id: null }, /category/i],
    ["a category that has sub-categories", () => ({ category_id: parentCat }), /category/i],
    ["Brand without saying which", { is_brand: true, brand_name: "" }, /brand/i],
    ["Brand / Non-brand not chosen", { is_brand: null }, /brand/i],
    ["no selling price", { price: 0 }, /price/i],
    ["no name", { name: "" }, /name/i],
    ["a typed code that is an SKU with a leading zero", { code: "7556" }, /7556.*already/i],
    ["a typed code of 6 digits", { code: "123456" }, /5 digits/i],
    ["a scanned barcode already on another toy", { barcode: "31001" }, /31001.*already/i],
  ];
  it.each(cases)("%s", async (_label, over, msg) => {
    const before = await productCount();
    const o = typeof over === "function" ? over() : over;
    const r = await save(bill([newLine({ name: `Bad ${S}`, ...o })]));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(msg);
    expect(await productCount()).toBe(before);
  });

  it("the same typed code twice on one bill", async () => {
    const before = await productCount();
    const r = await save(bill([
      newLine({ name: `Twin A ${S}`, code: "45002" }),
      newLine({ name: `Twin B ${S}`, code: "45002" }, { line_no: "2" }),
    ]));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/45002/);
    expect(await productCount()).toBe(before);
  });
});

describe("an existing toy whose cost changed", () => {
  it("keeps its price unless the check screen says to change it", async () => {
    const r = await save(bill([{
      line_no: "1", page: 1, description: "Old car", discount_pct: 0, split_into: 1,
      billed_qty: 1, received_qty: 1, rate: 400, amount: 400, toys: [{ product_id: oldToy, qty: 1 }],
    }]));
    expect(r.status).toBe(201);
    expect(Number((await one("SELECT price FROM products WHERE id = $1", [oldToy])).price)).toBe(900);
    expect(r.body.labels).toEqual([]);
  });

  it("changes the price when told, and lists it for a new label", async () => {
    const r = await save(bill([{
      line_no: "1", page: 1, description: "Old car", discount_pct: 0, split_into: 1,
      billed_qty: 1, received_qty: 1, rate: 400, amount: 400, toys: [{ product_id: oldToy, qty: 1, new_price: 1100 }],
    }]));
    expect(r.status).toBe(201);
    expect(Number((await one("SELECT price FROM products WHERE id = $1", [oldToy])).price)).toBe(1100);
    expect(r.body.labels).toEqual([expect.objectContaining({ product_id: oldToy, price: 1100, old_price: 900, is_new: false })]);
    const open = await one("SELECT new_price FROM label_reprints WHERE product_id = $1 AND cleared_at IS NULL", [oldToy]);
    expect(Number(open.new_price)).toBe(1100);
  });
});
