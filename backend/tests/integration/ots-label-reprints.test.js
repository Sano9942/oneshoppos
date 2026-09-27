/**
 * ots-label-reprints.test.js — One Toy Store pilot, Phase B step 6a:
 * "Labels to reprint". docs/onetoystore-pilot/PROGRESS.md, step 6.
 *
 * Owner decisions (2026-09-27):
 *  - ANY change to an item's selling price, from anywhere, marks it "label
 *    needs reprint". The mark lives in the database (a trigger on
 *    products.price / product_variants.price), so no writer can skip it:
 *    product edit, variant edit, Shopify import, scheduled changes, and any
 *    writer added later.
 *  - New items go on the list too ("new, Rs X") — except packages/services,
 *    and the parent of a product with variants (each variant is labelled).
 *  - The list shows the price on the last label → the current price. A price
 *    changed back to the label's price comes off the list.
 *  - Printing a label AT THE CURRENT PRICE clears it; "Label is fine" clears it
 *    without printing; the spreadsheet import's "already labelled" tick keeps
 *    imported items off the list (the iPOS switchover).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const { applyScheduledChange } = require("../../services/catalog-scheduler");

let app, db, cleanup;
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

// Start every test from an empty list (the seed data's own "new" rows included).
beforeEach(async () => {
  await db.query("DELETE FROM label_reprints");
});

async function list() {
  const res = await admin().get("/api/label-reprints");
  expect(res.status).toBe(200);
  return res.body.items;
}

async function makeProduct(name, price, extra = {}) {
  const res = await admin().post("/api/products").send({
    name,
    price,
    cost_price: Math.round(price / 2),
    barcode: `LR-${name.replace(/\W/g, "")}-${Date.now()}`,
    ...extra,
  });
  expect([200, 201]).toContain(res.status);
  return res.body.id ?? res.body.product?.id ?? res.body.productId;
}

describe("marking: every price writer puts the item on the list", () => {
  it("product edit: old → new price, with when", async () => {
    const id = await makeProduct("Kite A", 300);
    await db.query("DELETE FROM label_reprints");

    const res = await admin().put(`/api/products/${id}`).send({ name: "Kite A", price: 350 });
    expect(res.status).toBe(200);

    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ product_id: id, variant_id: null, name: "Kite A" });
    expect(num(items[0].old_price)).toBe(300);
    expect(num(items[0].new_price)).toBe(350);
    expect(items[0].is_new).toBe(false);
    expect(items[0].changed_at).toBeTruthy();
  });

  it("an edit that doesn't change the price doesn't list the item", async () => {
    const id = await makeProduct("Kite B", 300);
    await db.query("DELETE FROM label_reprints");
    await admin().put(`/api/products/${id}`).send({ name: "Kite B renamed", price: 300 });
    expect(await list()).toHaveLength(0);
  });

  it("two changes before a reprint: one row, label price → latest price", async () => {
    const id = await makeProduct("Kite C", 300);
    await db.query("DELETE FROM label_reprints");
    await admin().put(`/api/products/${id}`).send({ price: 320 });
    await admin().put(`/api/products/${id}`).send({ price: 340 });
    const items = await list();
    expect(items).toHaveLength(1);
    expect(num(items[0].old_price)).toBe(300);
    expect(num(items[0].new_price)).toBe(340);
  });

  it("price changed back to the label's price: off the list", async () => {
    const id = await makeProduct("Kite D", 300);
    await db.query("DELETE FROM label_reprints");
    await admin().put(`/api/products/${id}`).send({ price: 320 });
    await admin().put(`/api/products/${id}`).send({ price: 300 });
    expect(await list()).toHaveLength(0);
  });

  it("any other writer (the Shopify import's UPDATE): listed only when the price really moves", async () => {
    const id = await makeProduct("Kite E", 300);
    await db.query("DELETE FROM label_reprints");
    // Same shape as routes/shopify/import.js — it rewrites price on every import.
    await db.query("UPDATE products SET name = $1, price = $2 WHERE id = $3", ["Kite E", 300, id]);
    expect(await list()).toHaveLength(0);
    await db.query("UPDATE products SET name = $1, price = $2 WHERE id = $3", ["Kite E", 280, id]);
    const items = await list();
    expect(items).toHaveLength(1);
    expect(num(items[0].old_price)).toBe(300);
    expect(num(items[0].new_price)).toBe(280);
  });

  it("scheduled price change (catalog scheduler) lists the item", async () => {
    const id = await makeProduct("Kite F", 300);
    await db.query("DELETE FROM label_reprints");
    const change = await one(
      `INSERT INTO scheduled_catalog_changes (entity_type, entity_id, change_type, field_name, new_value, scheduled_at)
       VALUES ('product', $1, 'price', 'price', '310', NOW()) RETURNING *`,
      [id],
    );
    const out = await applyScheduledChange(db, change);
    expect(out.status).toBe("applied");
    const items = await list();
    expect(items).toHaveLength(1);
    expect(num(items[0].new_price)).toBe(310);
  });

  it("variant price edit lists that variant, not the parent", async () => {
    const id = await makeProduct("Car Pack", 500, {
      has_variants: true,
      variants: [
        { sku: `LR-RED-${Date.now()}`, barcode: `LR-RED-BC-${Date.now()}`, price: 500, cost_price: 300 },
        { sku: `LR-BLU-${Date.now()}`, barcode: `LR-BLU-BC-${Date.now()}`, price: 500, cost_price: 300 },
      ],
    });
    const variants = (await db.query("SELECT id, sku, barcode FROM product_variants WHERE product_id = $1 ORDER BY id", [id])).rows;
    expect(variants).toHaveLength(2);
    await db.query("DELETE FROM label_reprints");

    const res = await admin().put(`/api/products/${id}`).send({
      variants: [
        { id: variants[0].id, sku: variants[0].sku, barcode: variants[0].barcode, price: 550, cost_price: 300 },
        { id: variants[1].id, sku: variants[1].sku, barcode: variants[1].barcode, price: 500, cost_price: 300 },
      ],
    });
    expect(res.status).toBe(200);

    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ product_id: id, variant_id: variants[0].id, variant_sku: variants[0].sku });
    expect(items[0].barcode).toBe(variants[0].barcode);
    expect(num(items[0].old_price)).toBe(500);
    expect(num(items[0].new_price)).toBe(550);
  });
});

describe("new items", () => {
  it("a new product is listed as new at its price", async () => {
    const id = await makeProduct("Yo-yo New", 150);
    const items = await list();
    const row = items.find((i) => i.product_id === id);
    expect(row).toBeTruthy();
    expect(row.is_new).toBe(true);
    expect(row.old_price).toBeNull();
    expect(num(row.new_price)).toBe(150);
  });

  it("a new product with variants lists each variant, not the parent", async () => {
    const id = await makeProduct("Doll Set", 900, {
      has_variants: true,
      variants: [{ sku: `LR-D1-${Date.now()}`, price: 900 }, { sku: `LR-D2-${Date.now()}`, price: 950 }],
    });
    const rows = (await list()).filter((i) => i.product_id === id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.variant_id !== null && r.is_new)).toBe(true);
    expect(rows.map((r) => num(r.new_price)).sort()).toEqual([900, 950]);
  });

  it("packages and services never go on the list", async () => {
    await db.query("INSERT INTO products (name, price, product_type, status) VALUES ('Svc', 100, 'service', 'active')");
    await db.query("INSERT INTO products (name, price, product_type, status) VALUES ('Pkg', 100, 'package', 'active')");
    expect(await list()).toHaveLength(0);
  });

  it("spreadsheet import lists new items; the 'already labelled' tick keeps them off", async () => {
    const stamp = Date.now();
    const csv = (tag) =>
      Buffer.from(`name,sku,selling_price,cost_price\nImport ${tag},LR-IMP-${tag}-${stamp},250,100\n`);

    let res = await admin().post("/api/import/products").attach("file", csv("A"), "a.csv");
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    let items = await list();
    expect(items.map((i) => i.name)).toContain("Import A");

    await db.query("DELETE FROM label_reprints");
    res = await admin().post("/api/import/products?already_labelled=1").attach("file", csv("B"), "b.csv");
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    items = await list();
    expect(items.map((i) => i.name)).not.toContain("Import B");
  });
});

describe("clearing", () => {
  it("printing the label at the current price clears it", async () => {
    const id = await makeProduct("Ball A", 200);
    await admin().put(`/api/products/${id}`).send({ price: 220 });
    expect((await list()).some((i) => i.product_id === id)).toBe(true);

    const res = await admin().post("/api/barcode-print-jobs").send({
      template_id: null,
      items: [{ product_id: id, name: "Ball A", barcode: "x", price: 220, copies: 3 }],
    });
    expect(res.status).toBe(200);
    expect((await list()).some((i) => i.product_id === id)).toBe(false);
  });

  it("printing at a stale price does NOT clear it", async () => {
    const id = await makeProduct("Ball B", 200);
    await admin().put(`/api/products/${id}`).send({ price: 220 });
    await admin().post("/api/barcode-print-jobs").send({
      items: [{ product_id: id, name: "Ball B", barcode: "x", price: 200, copies: 1 }],
    });
    expect((await list()).some((i) => i.product_id === id)).toBe(true);
  });

  it("a label printed after the change becomes the new 'old price'", async () => {
    const id = await makeProduct("Ball C", 200);
    await admin().put(`/api/products/${id}`).send({ price: 220 });
    await admin().post("/api/barcode-print-jobs").send({
      items: [{ product_id: id, name: "Ball C", barcode: "x", price: 220, copies: 1 }],
    });
    await admin().put(`/api/products/${id}`).send({ price: 240 });
    const row = (await list()).find((i) => i.product_id === id);
    expect(num(row.old_price)).toBe(220);
    expect(num(row.new_price)).toBe(240);
  });

  it("'Label is fine' takes rows off without printing", async () => {
    const a = await makeProduct("Top A", 100);
    const b = await makeProduct("Top B", 100);
    const rows = await list();
    const rowA = rows.find((i) => i.product_id === a);

    const res = await admin().post("/api/label-reprints/dismiss").send({ ids: [rowA.id] });
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(1);
    const left = await list();
    expect(left.some((i) => i.product_id === a)).toBe(false);
    expect(left.some((i) => i.product_id === b)).toBe(true);
  });

  it("archived items drop off the list", async () => {
    const id = await makeProduct("Old Top", 100);
    expect((await list()).some((i) => i.product_id === id)).toBe(true);
    await admin().delete(`/api/products/${id}`);
    expect((await list()).some((i) => i.product_id === id)).toBe(false);
  });

  it("schema-pg.sql carries the same DDL as migration v141", () => {
    const fs = require("fs");
    const path = require("path");
    const { LABEL_REPRINTS_DDL } = require("../../services/label-reprints");
    const norm = (s) => s.replace(/\r\n/g, "\n");
    const schema = norm(fs.readFileSync(path.join(__dirname, "../../schema-pg.sql"), "utf8"));
    expect(schema).toContain(norm(LABEL_REPRINTS_DDL).trim());
  });

  it("migration v141: skips a schema without products, and marks prices in one that has them", async () => {
    const pool = require("../../db-pg");
    const { MIGRATIONS } = require("../../migrate-pg");
    const v141 = MIGRATIONS.find((m) => m.version === 141);
    const bare = `lr_bare_${Date.now()}`;
    const shop = `lr_shop_${Date.now()}`;
    const client = await pool.getClient();
    try {
      await client.query(`CREATE SCHEMA ${bare}; CREATE SCHEMA ${shop}`);
      await client.query(`SET search_path = ${bare}`);
      await v141.up(client); // must not throw (the public schema has no products)
      await client.query(`SET search_path = ${shop}`);
      await client.query(`CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT, price NUMERIC(12,2),
        product_type TEXT, has_variants BOOLEAN DEFAULT false, deleted_at TIMESTAMPTZ)`);
      await client.query(`CREATE TABLE product_variants (id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id), price NUMERIC(12,2))`);
      await client.query("INSERT INTO products (name, price) VALUES ('Before', 100)");
      await v141.up(client);
      await v141.up(client); // idempotent
      await client.query("UPDATE products SET price = 120 WHERE name = 'Before'");
      const { rows } = await client.query("SELECT old_price, new_price FROM label_reprints");
      expect(rows.map((r) => [num(r.old_price), num(r.new_price)])).toEqual([[100, 120]]);
    } finally {
      await client.query("SET search_path = public");
      await client.query(`DROP SCHEMA IF EXISTS ${bare} CASCADE; DROP SCHEMA IF EXISTS ${shop} CASCADE`);
      client.release();
    }
  });

  it("the list needs manage_inventory", async () => {
    const res = await makeRequest(app).get("/api/label-reprints");
    expect([401, 403]).toContain(res.status);
  });
});

// Step 6b: the label page adds single variants (own barcode + price), and the
// print log records which variant was printed.
describe("variant labels (step 6b)", () => {
  async function variantProduct(name) {
    const t = Date.now();
    const id = await makeProduct(name, 450, {
      has_variants: true,
      variants: [
        { sku: `LR-${name}-A-${t}`, barcode: `LR-${name}-A-BC-${t}`, price: 450, cost_price: 300 },
        { sku: `LR-${name}-B-${t}`, barcode: `LR-${name}-B-BC-${t}`, price: 450, cost_price: 300 },
      ],
    });
    const variants = (await db.query("SELECT id, sku, barcode FROM product_variants WHERE product_id = $1 ORDER BY id", [id])).rows;
    return { id, variants };
  }

  it("a printed variant label is logged with its variant, and clears only that variant", async () => {
    const { id, variants: [a, b] } = await variantProduct("VarLbl");
    await db.query("UPDATE product_variants SET price = 475 WHERE product_id = $1", [id]);
    expect((await list()).filter((i) => i.product_id === id)).toHaveLength(2);

    const res = await admin().post("/api/barcode-print-jobs").send({
      items: [{ product_id: id, variant_id: a.id, name: `VarLbl – ${a.sku}`, barcode: a.barcode, price: 475, copies: 2 }],
    });
    expect(res.status).toBe(200);

    const job = await one("SELECT product_id, variant_id, barcode, copies FROM barcode_print_jobs WHERE product_id = $1", [id]);
    expect(job).toMatchObject({ product_id: id, variant_id: a.id, barcode: a.barcode, copies: 2 });
    const left = (await list()).filter((i) => i.product_id === id);
    expect(left.map((i) => i.variant_id)).toEqual([b.id]);
  });

  it("a variant id from another product is not logged as that product's variant", async () => {
    const { id } = await variantProduct("VarOwn");
    const other = await variantProduct("VarOther");
    const res = await admin().post("/api/barcode-print-jobs").send({
      items: [{ product_id: id, variant_id: other.variants[0].id, name: "x", barcode: "x", price: 450, copies: 1 }],
    });
    expect(res.status).toBe(200);
    const job = await one("SELECT variant_id FROM barcode_print_jobs WHERE product_id = $1", [id]);
    expect(job.variant_id).toBeNull();
  });

  it("migration v142: adds barcode_print_jobs.variant_id; skips a schema without the table; idempotent", async () => {
    const pool = require("../../db-pg");
    const { MIGRATIONS } = require("../../migrate-pg");
    const v142 = MIGRATIONS.find((m) => m.version === 142);
    expect(v142).toBeTruthy();
    const bare = `lr_bare2_${Date.now()}`;
    const shop = `lr_shop2_${Date.now()}`;
    const client = await pool.getClient();
    try {
      await client.query(`CREATE SCHEMA ${bare}; CREATE SCHEMA ${shop}`);
      await client.query(`SET search_path = ${bare}`);
      await v142.up(client);
      await client.query(`SET search_path = ${shop}`);
      await client.query(`CREATE TABLE products (id SERIAL PRIMARY KEY);
        CREATE TABLE product_variants (id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id));
        CREATE TABLE barcode_print_jobs (id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id))`);
      await v142.up(client);
      await v142.up(client);
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'barcode_print_jobs' AND column_name = 'variant_id'`, [shop]);
      expect(rows).toHaveLength(1);
    } finally {
      await client.query("SET search_path = public");
      await client.query(`DROP SCHEMA IF EXISTS ${bare} CASCADE; DROP SCHEMA IF EXISTS ${shop} CASCADE`);
      client.release();
    }
  });

  it("schema-pg.sql has barcode_print_jobs.variant_id", () => {
    const fs = require("fs");
    const path = require("path");
    const schema = fs.readFileSync(path.join(__dirname, "../../schema-pg.sql"), "utf8");
    const table = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS barcode_print_jobs"));
    expect(table.slice(0, table.indexOf(");"))).toMatch(/variant_id INTEGER REFERENCES product_variants\(id\) ON DELETE SET NULL/);
  });
});
