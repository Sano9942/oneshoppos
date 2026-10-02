/**
 * ots-supplier-bills-match.test.js — One Toy Store F9 step (c1): which toy is
 * each bill line? POST /api/supplier-bills/match, in this order:
 *   1 supplier_code  the supplier's own code, learned on earlier bills
 *                    (only within THAT supplier; may be several toys = an
 *                    assorted line) → chosen
 *   2 barcode        a barcode printed on the bill (global: products.barcode,
 *                    SKU, extra barcodes) → chosen
 *   3 name_code      a toy whose name ends in the code ("HSB JENGA GAME-53557",
 *                    how iPOS names carried it) → suggested, owner confirms
 *   4 similar        a similar name among this supplier's toys → suggested
 * Nothing is saved.
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
let tt, other, jenga, luggage, archery, carRed, carBlue, dino;

const product = async (name, sku, extra = {}) => (await one(
  `INSERT INTO products (name, sku, price, cost_price, supplier_id, barcode) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
  [name, sku, extra.price ?? 1000, extra.cost ?? 400, extra.supplier ?? null, extra.barcode ?? null])).id;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  tt = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`TOYS AND TOYS ${S}`])).id;
  other = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`OTHER ${S}`])).id;
  jenga = await product(`HSB JENGA GAME-53557`, `M1${S}`, { supplier: tt });
  luggage = await product(`MUSIC LUGGAGE W-MIC ${S}`, `M2${S}`, { supplier: tt });
  // our SKU 1083 is another toy: the supplier's 1083 must not find it
  archery = await product(`ARCHERY SET ${S}`, "1083", { supplier: other });
  carRed = await product(`RC CAR RED ${S}`, `M3${S}`, { supplier: tt });
  carBlue = await product(`RC CAR BLUE ${S}`, `M4${S}`, { supplier: tt, barcode: `6901${S}` });
  dino = await product(`DINOSAUR WALKING TOY ${S}`, `M5${S}`, { supplier: tt });
  await db.query(
    `INSERT INTO supplier_item_codes (supplier_id, product_id, code, split_into) VALUES
       ($1, $2, '1083', 1), ($1, $3, 'RC-77', 1), ($1, $4, 'RC-77', 1)`, [tt, luggage, carRed, carBlue]);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const match = (supplier_id, lines) => admin().post("/api/supplier-bills/match").send({ supplier_id, lines });

describe("POST /api/supplier-bills/match", () => {
  it("finds a toy by this supplier's code, never by our SKU", async () => {
    const res = await match(tt, [{ key: "1", supplier_code: "1083", description: "MUSIC LUGGAGE W-MIC" }]);
    expect(res.status).toBe(200);
    const [l] = res.body.lines;
    expect(l.matches.map((m) => [m.product_id, m.how])).toEqual([[luggage, "supplier_code"]]);
    expect(l.chosen).toEqual([luggage]);
    expect(l.matches.some((m) => m.product_id === archery)).toBe(false);
  });

  it("an assorted code gives all its toys, all chosen (qty to split)", async () => {
    const res = await match(tt, [{ key: "a", supplier_code: "rc-77", description: "RC CAR ASST" }]);
    const [l] = res.body.lines;
    expect(l.chosen.sort()).toEqual([carRed, carBlue].sort());
    expect(l.matches.every((m) => m.how === "supplier_code")).toBe(true);
  });

  it("the same code at another supplier finds nothing of this supplier's", async () => {
    const res = await match(other, [{ key: "1", supplier_code: "RC-77", description: "" }]);
    expect(res.body.lines[0].matches).toEqual([]);
  });

  it("a printed barcode finds the toy anywhere (main or extra barcode)", async () => {
    await db.query("INSERT INTO product_barcodes (product_id, barcode) VALUES ($1, $2)", [dino, `8801${S}`]);
    const res = await match(tt, [
      { key: "b1", supplier_code: "X1", barcode: `6901${S}`, description: "" },
      { key: "b2", supplier_code: "X2", barcode: `8801${S}`, description: "" },
    ]);
    expect(res.body.lines.map((l) => [l.chosen, l.matches[0]?.how])).toEqual([[[carBlue], "barcode"], [[dino], "barcode"]]);
  });

  it("a toy whose name ends in the code is suggested, not chosen", async () => {
    const res = await match(tt, [{ key: "n", supplier_code: "53557", description: "HASBRO JENGA IN TUBE" }]);
    const [l] = res.body.lines;
    expect(l.matches[0]).toMatchObject({ product_id: jenga, how: "name_code" });
    expect(l.chosen).toEqual([]);
  });

  it("a similar name among this supplier's toys is suggested", async () => {
    const res = await match(tt, [{ key: "s", supplier_code: "ZZ-1", description: "DINOSAUR WALKING TOY" }]);
    const [l] = res.body.lines;
    expect(l.matches[0]).toMatchObject({ product_id: dino, how: "similar" });
    expect(l.chosen).toEqual([]);
  });

  it("returns each toy's price, cost, code and the remembered split", async () => {
    await db.query("UPDATE supplier_item_codes SET split_into = 6 WHERE supplier_id = $1 AND code = '1083'", [tt]);
    const res = await match(tt, [{ key: "1", supplier_code: "1083", description: "" }]);
    expect(res.body.lines[0].matches[0]).toMatchObject({ name: `MUSIC LUGGAGE W-MIC ${S}`, price: 1000, cost_price: 400, split_into: 6 });
  });

  it("step (d): a line that may be a new toy gets the most similar toy's category and brand as a suggestion", async () => {
    const cat = (await one("INSERT INTO categories (name) VALUES ($1) RETURNING id", [`Dinos ${S}`])).id;
    const brand = (await one("INSERT INTO brands (name) VALUES ($1) RETURNING id", [`DinoCo ${S}`])).id;
    await db.query("UPDATE products SET category_id = $1, brand_id = $2 WHERE id = $3", [cat, brand, dino]);
    const res = await match(tt, [{ key: "d", supplier_code: "ZZ-2", description: "DINOSAUR WALKING TOY BIG" }]);
    const [l] = res.body.lines;
    expect(l.chosen).toEqual([]);
    expect(l.like).toMatchObject({ category_id: cat, brand_id: brand, brand_name: `DinoCo ${S}` });
    expect(l.matches[0]).toMatchObject({ category_id: cat, brand_name: `DinoCo ${S}` });
  });

  it("needs the 'Receive supplier bills' permission", async () => {
    const res = await makeRequest(app, CASHIER_ID).post("/api/supplier-bills/match").send({ supplier_id: tt, lines: [] });
    expect(res.status).toBe(403);
  });
});
