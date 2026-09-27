/**
 * One Toy Store pilot, Phase B step 6c: a price sheet updates the prices of
 * existing items (owner decisions 2026-09-27):
 *  - each row is matched by SKU, else by barcode, against products AND variants;
 *    a SKU and a barcode that point at two different items is a conflict;
 *  - only selling price and cost change; a blank cell keeps the current value;
 *  - rows that match nothing are shown as "not found" and never create items;
 *  - the preview shows old → new; applying takes only the rows the owner ticked,
 *    re-matched on the server;
 *  - changed prices land on "Labels to reprint" (the v141 trigger).
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();

let kite, ball, hw, hwRed, hwBlue;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  const make = async (body) => {
    const res = await admin().post("/api/products").send(body);
    expect([200, 201]).toContain(res.status);
    return res.body.id ?? res.body.product?.id ?? res.body.productId;
  };
  kite = await make({ name: "PI Kite", sku: `PI-KITE-${S}`, barcode: `PI-KITE-BC-${S}`, price: 300, cost_price: 150 });
  ball = await make({ name: "PI Ball", sku: `PI-BALL-${S}`, barcode: `PI-BALL-BC-${S}`, price: 200, cost_price: 90 });
  hw = await make({
    name: "PI Hot Wheels", price: 450, cost_price: 300, has_variants: true,
    variants: [
      { sku: `PI-HW-RED-${S}`, barcode: `PI-HW-RED-BC-${S}`, price: 450, cost_price: 300 },
      { sku: `PI-HW-BLU-${S}`, barcode: `PI-HW-BLU-BC-${S}`, price: 450, cost_price: 300 },
    ],
  });
  [hwRed, hwBlue] = (await db.query("SELECT id FROM product_variants WHERE product_id = $1 ORDER BY id", [hw])).rows.map((r) => r.id);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

beforeEach(async () => {
  await db.query("UPDATE products SET price = 300, cost_price = 150 WHERE id = $1", [kite]);
  await db.query("UPDATE products SET price = 200, cost_price = 90 WHERE id = $1", [ball]);
  await db.query("UPDATE product_variants SET price = 450, cost_price = 300 WHERE product_id = $1", [hw]);
  await db.query("DELETE FROM label_reprints");
});

const csv = (lines) => Buffer.from(lines.join("\n") + "\n");
const preview = (lines) => admin().post("/api/import/prices?preview=1").attach("file", csv(lines), "prices.csv");
const apply = (lines, rows) =>
  admin().post("/api/import/prices").field("rows", JSON.stringify(rows)).attach("file", csv(lines), "prices.csv");
const byRow = (res, n) => res.body.rows.find((r) => r._row === n);

describe("preview: matching", () => {
  it("matches a product by SKU and shows old → new price and cost", async () => {
    const res = await preview(["sku,barcode,name,selling_price,cost_price", `PI-KITE-${S},,,350,160`]);
    expect(res.status).toBe(200);
    expect(byRow(res, 2)).toMatchObject({
      status: "change", product_id: kite, variant_id: null, item_name: "PI Kite",
      old_price: 300, new_price: 350, old_cost: 150, new_cost: 160,
    });
    expect(res.body.summary).toMatchObject({ change: 1, unchanged: 0, not_found: 0, error: 0 });
  });

  it("matches by barcode when the row has no SKU, or its SKU matches nothing", async () => {
    const res = await preview([
      "sku,barcode,selling_price",
      `,PI-BALL-BC-${S},220`,
      `NO-SUCH-SKU,PI-KITE-BC-${S},330`,
    ]);
    expect(byRow(res, 2)).toMatchObject({ status: "change", product_id: ball, new_price: 220 });
    expect(byRow(res, 3)).toMatchObject({ status: "change", product_id: kite, new_price: 330 });
  });

  it("matches a variant by its own SKU or barcode", async () => {
    const res = await preview([
      "sku,barcode,selling_price",
      `PI-HW-RED-${S},,475`,
      `,PI-HW-BLU-BC-${S},495`,
    ]);
    expect(byRow(res, 2)).toMatchObject({ status: "change", product_id: hw, variant_id: hwRed, variant_label: `PI-HW-RED-${S}`, old_price: 450, new_price: 475 });
    expect(byRow(res, 3)).toMatchObject({ status: "change", product_id: hw, variant_id: hwBlue, new_price: 495 });
  });

  it("SKU and barcode pointing at two different items is a conflict", async () => {
    const res = await preview(["sku,barcode,selling_price", `PI-KITE-${S},PI-BALL-BC-${S},999`]);
    expect(byRow(res, 2).status).toBe("error");
    expect(byRow(res, 2)._errors.join(" ")).toMatch(/different items/);
  });

  it("a row that matches nothing is 'not found'", async () => {
    const res = await preview(["sku,barcode,selling_price", "GHOST-1,GHOST-BC,100"]);
    expect(byRow(res, 2).status).toBe("not_found");
  });

  it("the parent of a product with variants can't be priced; it says to use the variants", async () => {
    await db.query("UPDATE products SET sku = $1 WHERE id = $2", [`PI-HW-PARENT-${S}`, hw]);
    const res = await preview(["sku,selling_price", `PI-HW-PARENT-${S},500`]);
    expect(byRow(res, 2).status).toBe("error");
    expect(byRow(res, 2)._errors.join(" ")).toMatch(/variant/i);
  });

  it("the same item twice in a sheet: the second row is an error", async () => {
    const res = await preview(["sku,barcode,selling_price", `PI-KITE-${S},,310`, `,PI-KITE-BC-${S},320`]);
    expect(byRow(res, 2).status).toBe("change");
    expect(byRow(res, 3).status).toBe("error");
    expect(byRow(res, 3)._errors.join(" ")).toMatch(/row 2/);
  });
});

describe("preview: values", () => {
  it("a blank price or cost keeps the current value; same values are 'unchanged'", async () => {
    const res = await preview([
      "sku,selling_price,cost_price",
      `PI-KITE-${S},,170`,
      `PI-BALL-${S},200,90`,
    ]);
    expect(byRow(res, 2)).toMatchObject({ status: "change", old_price: 300, new_price: 300, old_cost: 150, new_cost: 170 });
    expect(byRow(res, 3).status).toBe("unchanged");
  });

  it("a non-number or negative price is an error; a row with neither price nor cost is an error", async () => {
    const res = await preview([
      "sku,selling_price,cost_price",
      `PI-KITE-${S},Rs 350,`,
      `PI-BALL-${S},-5,`,
      `PI-HW-RED-${S},,`,
    ]);
    expect(byRow(res, 2).status).toBe("error");
    expect(byRow(res, 3).status).toBe("error");
    expect(byRow(res, 4).status).toBe("error");
  });

  it("flags a selling price below cost, but still allows it", async () => {
    const res = await preview(["sku,selling_price", `PI-KITE-${S},140`]);
    expect(byRow(res, 2)).toMatchObject({ status: "change", below_cost: true });
  });

  it("the preview changes nothing", async () => {
    await preview(["sku,selling_price", `PI-KITE-${S},999`]);
    expect(num((await one("SELECT price FROM products WHERE id = $1", [kite])).price)).toBe(300);
  });
});

describe("apply", () => {
  const SHEET = () => [
    "sku,barcode,selling_price,cost_price",
    `PI-KITE-${S},,350,160`,
    `PI-BALL-${S},,250,`,
    `PI-HW-RED-${S},,475,310`,
    "GHOST-2,,100,",
  ];

  it("updates only the ticked rows, products and variants, and never creates items", async () => {
    const before = num((await one("SELECT COUNT(*) AS n FROM products")).n);
    const res = await apply(SHEET(), [2, 4, 5]); // Ball (row 3) unticked; row 5 matches nothing
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 2 });

    const k = await one("SELECT price, cost_price FROM products WHERE id = $1", [kite]);
    expect([num(k.price), num(k.cost_price)]).toEqual([350, 160]);
    expect(num((await one("SELECT price FROM products WHERE id = $1", [ball])).price)).toBe(200);
    const r = await one("SELECT price, cost_price FROM product_variants WHERE id = $1", [hwRed]);
    expect([num(r.price), num(r.cost_price)]).toEqual([475, 310]);
    expect(num((await one("SELECT price FROM product_variants WHERE id = $1", [hwBlue])).price)).toBe(450);
    expect(num((await one("SELECT COUNT(*) AS n FROM products")).n)).toBe(before);
  });

  it("changed prices land on Labels to reprint (old → new), variants as themselves", async () => {
    await apply(SHEET(), [2, 3, 4]);
    const { body } = await admin().get("/api/label-reprints");
    const mine = body.items.filter((i) => [kite, ball, hw].includes(i.product_id));
    const key = (i) => `${i.product_id}:${i.variant_id || 0}`;
    const got = Object.fromEntries(mine.map((i) => [key(i), [num(i.old_price), num(i.new_price)]]));
    expect(got).toEqual({
      [`${kite}:0`]: [300, 350],
      [`${ball}:0`]: [200, 250],
      [`${hw}:${hwRed}`]: [450, 475],
    });
  });

  it("a cost-only change does not put the item on Labels to reprint", async () => {
    await apply(["sku,cost_price", `PI-KITE-${S},155`], [2]);
    const { body } = await admin().get("/api/label-reprints");
    expect(body.items.some((i) => i.product_id === kite)).toBe(false);
    expect(num((await one("SELECT cost_price FROM products WHERE id = $1", [kite])).cost_price)).toBe(155);
  });

  it("ticked rows that are errors or not found are skipped, not applied", async () => {
    const res = await apply(["sku,barcode,selling_price", `PI-KITE-${S},PI-BALL-BC-${S},999`, "GHOST-3,,5"], [2, 3]);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(num((await one("SELECT price FROM products WHERE id = $1", [kite])).price)).toBe(300);
    expect(num((await one("SELECT price FROM products WHERE id = $1", [ball])).price)).toBe(200);
  });

  it("apply needs the ticked row list", async () => {
    const res = await admin().post("/api/import/prices").attach("file", csv(SHEET()), "p.csv");
    expect(res.status).toBe(400);
  });

  it("needs the import permission", async () => {
    const res = await makeRequest(app).post("/api/import/prices?preview=1").attach("file", csv(SHEET()), "p.csv");
    expect([401, 403]).toContain(res.status);
  });
});

describe("template", () => {
  it("GET /api/import/template/prices gives the price-sheet columns", async () => {
    const res = await admin().get("/api/import/template/prices");
    expect(res.status).toBe(200);
    expect(res.text.replace(/^﻿/, "").split(/\r?\n/)[0]).toBe("sku,barcode,name,selling_price,cost_price");
  });
});
