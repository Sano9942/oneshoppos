/**
 * One Toy Store pilot, Phase D: the iPOS item file comes in through the normal
 * product import (POST /api/import/products). The converter
 * (tools/onetoystore-pilot/ipos/ipos_convert.py) writes a `supplier` column
 * holding the supplier's NAME. Before this fix the importer only read
 * `supplier_id` and silently dropped a `supplier` column, so every imported
 * item lost its supplier with no error (D35).
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
let toysId;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  toysId = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`TOYS AND TOYS LAHORE ${S}`])).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const csv = (lines) => Buffer.from(lines.join("\n") + "\n");
const post = (lines, preview) =>
  admin().post(`/api/import/products${preview ? "?preview=1" : ""}`).attach("file", csv(lines), "ipos-products.csv");
const HEAD = "name,sku,barcode,selling_price,cost_price,category,brand,supplier,stock_quantity";

describe("supplier by name", () => {
  it("links the item to the supplier named in the `supplier` column (any case, extra spaces)", async () => {
    const res = await post([HEAD, `IP Mask,IP-MASK-${S},,1150,395,,,  toys and toys lahore ${S.toLowerCase()} ,0`]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ imported: 1, errors: [] });
    const p = await one("SELECT supplier_id FROM products WHERE sku = $1", [`IP-MASK-${S}`]);
    expect(p.supplier_id).toBe(toysId);
  });

  it("a supplier name that doesn't exist is a row error, not a silent blank", async () => {
    const res = await post([HEAD, `IP Cube,IP-CUBE-${S},,1190,400,,,NO SUCH SUPPLIER ${S},0`], true);
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r) => r._row === 2);
    expect(row._errors).toContain(`supplier "NO SUCH SUPPLIER ${S}" not found`);
  });

  it("a blank supplier imports with no supplier", async () => {
    const res = await post([HEAD, `IP Mustache,IP-MUST-${S},,50,19.35,,,,0`]);
    expect(res.body).toMatchObject({ imported: 1, errors: [] });
    const p = await one("SELECT supplier_id, cost_price FROM products WHERE sku = $1", [`IP-MUST-${S}`]);
    expect(p.supplier_id).toBeNull();
    expect(Number(p.cost_price)).toBe(19.35);
  });

  it("supplier_id still works as before", async () => {
    const res = await post(["name,sku,selling_price,supplier_id", `IP Kite,IP-KITE-${S},300,${toysId}`]);
    expect(res.body).toMatchObject({ imported: 1, errors: [] });
    expect((await one("SELECT supplier_id FROM products WHERE sku = $1", [`IP-KITE-${S}`])).supplier_id).toBe(toysId);
  });
});

describe("iPOS codes", () => {
  it("keeps a code's leading zeros in the SKU", async () => {
    const res = await post([HEAD, `IP Zero,0107${S},,1150,395,,,,0`]);
    expect(res.body).toMatchObject({ imported: 1, errors: [] });
    expect(await one("SELECT name FROM products WHERE sku = $1", [`0107${S}`])).toMatchObject({ name: "IP Zero" });
  });
});
