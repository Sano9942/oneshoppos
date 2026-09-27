/**
 * One Toy Store pilot, Phase B step 7: the product History tab (owner
 * decisions 2026-09-27, docs/onetoystore-pilot/PROGRESS.md):
 *  - stock ledger: the database records every stock change from now on
 *    (triggers on outlet_stock / variant_outlet_stock, any writer); running
 *    balance per branch, or all branches combined; per variant;
 *  - price & cost history: every change to price / cost_price (triggers), with
 *    who and why where the writing route tags it;
 *  - sales by bill no, returns as minus lines (read from the bills themselves).
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const history = require("../../services/product-history");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  // a second branch for the per-branch / all-branches views
  const o2 = await one("SELECT id FROM outlets WHERE id = 2");
  if (!o2) await db.query("INSERT INTO outlets (id, name) VALUES (2, 'Store Room') ON CONFLICT DO NOTHING");
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function makeProduct(name, extra = {}) {
  const res = await admin().post("/api/products").send({
    name, price: 300, cost_price: 150, sku: `PH-${name.replace(/\W/g, "")}-${S}`, ...extra,
  });
  expect([200, 201]).toContain(res.status);
  return res.body.id ?? res.body.product?.id ?? res.body.productId;
}

async function openTill(outletId = 1) {
  const open = await one("SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1", [outletId]);
  if (!open) {
    const res = await admin().post("/api/shifts/open").send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: 500 });
    expect(res.status).toBe(200);
  }
  await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: outletId });
}

const movements = (pid, vid = null) =>
  all(`SELECT outlet_id, variant_id, qty_change, balance_after, kind, ref_type, ref_id, employee_id
         FROM stock_movements WHERE product_id = $1 AND COALESCE(variant_id, 0) = COALESCE($2::int, 0) ORDER BY id`, [pid, vid]);

describe("stock ledger: the database records every change", () => {
  it("insert, change, no-change and delete of an outlet_stock row", async () => {
    const pid = await makeProduct("LedgerA");
    await db.query("DELETE FROM stock_movements WHERE product_id = $1", [pid]);
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 10) ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 10", [pid]);
    await db.query("UPDATE outlet_stock SET quantity = 7 WHERE product_id = $1 AND outlet_id = 1", [pid]);
    await db.query("UPDATE outlet_stock SET quantity = 7 WHERE product_id = $1 AND outlet_id = 1", [pid]);
    await db.query("DELETE FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1", [pid]);
    const m = await movements(pid);
    expect(m.map((r) => [num(r.qty_change), num(r.balance_after)])).toEqual([[10, 10], [-3, 7], [-7, 0]]);
    expect(m.every((r) => r.kind === null)).toBe(true); // nobody tagged these raw writes
  });

  it("a variant's stock change is recorded against the variant", async () => {
    const pid = await makeProduct("LedgerV", {
      has_variants: true, variants: [{ sku: `PH-LV1-${S}`, price: 300, cost_price: 150 }],
    });
    const vid = (await one("SELECT id FROM product_variants WHERE product_id = $1", [pid])).id;
    await db.query(
      `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 4)
       ON CONFLICT (variant_id, outlet_id) DO UPDATE SET quantity = variant_outlet_stock.quantity + 4`, [vid]);
    const m = await movements(pid, vid);
    expect(m.at(-1)).toMatchObject({ outlet_id: 1, variant_id: vid });
    expect(num(m.at(-1).qty_change)).toBe(4);
  });

  it("tagChanges labels only the current transaction's untagged rows", async () => {
    const pid = await makeProduct("LedgerT");
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 5) ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 5", [pid]);
    await db.transaction(async (client) => {
      await client.query("UPDATE outlet_stock SET quantity = quantity - 2 WHERE product_id = $1 AND outlet_id = 1", [pid]);
      await history.tagChanges(client, { kind: "adjustment", refType: "adjustment", refId: 99, employeeId: ADMIN_ID, note: "breakage" });
    });
    const m = await movements(pid);
    const last = m.at(-1);
    expect(last).toMatchObject({ kind: "adjustment", ref_type: "adjustment", ref_id: 99, employee_id: ADMIN_ID });
    expect(m.slice(0, -1).every((r) => r.kind !== "adjustment")).toBe(true);
  });
});

describe("price & cost history: the database records every change", () => {
  it("a new product records its first price and cost; an edit records what changed", async () => {
    const pid = await makeProduct("PriceA");
    await db.query("UPDATE products SET price = 350 WHERE id = $1", [pid]);
    await db.query("UPDATE products SET price = 350 WHERE id = $1", [pid]); // no change
    await db.query("UPDATE products SET cost_price = 160 WHERE id = $1", [pid]);
    const rows = await all("SELECT field, old_value, new_value FROM price_changes WHERE product_id = $1 ORDER BY id", [pid]);
    expect(rows.map((r) => [r.field, num(r.old_value), num(r.new_value)])).toEqual([
      ["price", null, 300], ["cost_price", null, 150], ["price", 300, 350], ["cost_price", 150, 160],
    ]);
  });

  it("a variant price change is recorded against the variant", async () => {
    const pid = await makeProduct("PriceV", { has_variants: true, variants: [{ sku: `PH-PV1-${S}`, price: 300, cost_price: 150 }] });
    const vid = (await one("SELECT id FROM product_variants WHERE product_id = $1", [pid])).id;
    await db.query("UPDATE product_variants SET price = 325 WHERE id = $1", [vid]);
    const row = await one("SELECT variant_id, old_value, new_value FROM price_changes WHERE product_id = $1 AND field = 'price' ORDER BY id DESC LIMIT 1", [pid]);
    expect([row.variant_id, num(row.old_value), num(row.new_value)]).toEqual([vid, 300, 325]);
  });
});

describe("GET /api/products/:id/history/stock", () => {
  it("per branch: each line's balance is that branch's stock after it; the newest equals on-hand", async () => {
    const pid = await makeProduct("LedgerB");
    await db.query("DELETE FROM stock_movements WHERE product_id = $1", [pid]);
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 10), ($1, 2, 3) ON CONFLICT (product_id, outlet_id) DO NOTHING", [pid]);
    await db.query("UPDATE outlet_stock SET quantity = 8 WHERE product_id = $1 AND outlet_id = 1", [pid]);

    let res = await admin().get(`/api/products/${pid}/history/stock?outlet_id=1`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => [num(i.qty_change), num(i.balance)])).toEqual([[-2, 8], [10, 10]]); // newest first
    expect(num(res.body.on_hand)).toBe(8);

    res = await admin().get(`/api/products/${pid}/history/stock`); // all branches
    expect(res.body.items.map((i) => [i.outlet_id, num(i.qty_change), num(i.balance)])).toEqual([[1, -2, 11], [2, 3, 13], [1, 10, 10]]);
    expect(num(res.body.on_hand)).toBe(11);
  });

  it("a variant's ledger is separate from the product total", async () => {
    const pid = await makeProduct("LedgerVV", { has_variants: true, variants: [{ sku: `PH-VV1-${S}`, price: 300, cost_price: 150 }] });
    const vid = (await one("SELECT id FROM product_variants WHERE product_id = $1", [pid])).id;
    await db.query(`INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 6)
                    ON CONFLICT (variant_id, outlet_id) DO UPDATE SET quantity = 6`, [vid]);
    const res = await admin().get(`/api/products/${pid}/history/stock?variant_id=${vid}&outlet_id=1`);
    expect(res.body.items[0]).toMatchObject({ variant_id: vid });
    expect(num(res.body.items[0].balance)).toBe(6);
    expect(num(res.body.on_hand)).toBe(6);
  });

  it("needs inventory permission", async () => {
    const res = await makeRequest(app).get("/api/products/1/history/stock");
    expect([401, 403]).toContain(res.status);
  });
});

describe("GET /api/products/:id/history/prices", () => {
  it("lists changes newest first, with who and why when tagged", async () => {
    const pid = await makeProduct("PriceH");
    await db.transaction(async (client) => {
      await client.query("UPDATE products SET price = 390 WHERE id = $1", [pid]);
      await history.tagChanges(client, { kind: "price_sheet", employeeId: ADMIN_ID });
    });
    const res = await admin().get(`/api/products/${pid}/history/prices`);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ field: "price", kind: "price_sheet", employee_id: ADMIN_ID });
    expect(res.body.items[0].employee_name).toBeTruthy();
    expect([num(res.body.items[0].old_value), num(res.body.items[0].new_value)]).toEqual([300, 390]);
  });
});

describe("GET /api/products/:id/history/sales", () => {
  it("sales by bill no, returns as minus lines against the original bill, voided bills marked", async () => {
    await openTill(1);
    const pid = await makeProduct("SalesH");
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 20) ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 20", [pid]);
    const sell = (qty) => admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID, cartItems: [{ id: pid, quantity: qty, price: 300 }],
      payments: [{ method: "Cash", amount: 300 * qty }],
    });
    const s1 = await sell(2);
    expect(s1.status).toBe(200);
    const s2 = await sell(1);
    const ret = await admin().post("/api/returns").send({
      original_sale_id: s1.body.saleId, outlet_id: 1, employee_id: ADMIN_ID, total_refund: 300, refund_method: "Cash",
      items: [{ product_id: pid, quantity: 1, refund_price: 300 }],
    });
    expect(ret.status).toBe(200);
    const v = await admin().put(`/api/sales/${s2.body.saleId}/void`).send({ void_reason: "test" });
    expect([200, 201]).toContain(v.status);

    const inv1 = (await one("SELECT invoice_number FROM sales WHERE id = $1", [s1.body.saleId])).invoice_number;
    expect(inv1).toBeTruthy();
    const res = await admin().get(`/api/products/${pid}/history/sales`);
    expect(res.status).toBe(200);
    const lines = res.body.items.map((i) => [i.line_type, i.invoice_number === inv1 ? "INV1" : "other", num(i.quantity), i.voided]);
    expect(lines).toEqual(expect.arrayContaining([
      ["sale", "INV1", 2, false],
      ["return", "INV1", -1, false],
      ["sale", "other", 1, true],
    ]));
    expect(res.body.items.find((i) => i.line_type === "sale").cashier).toBeTruthy();
  });
});

describe("schema + migration v143", () => {
  it("schema-pg.sql carries the same DDL as migration v143", () => {
    const fs = require("fs");
    const path = require("path");
    const norm = (s) => s.replace(/\r\n/g, "\n");
    const schema = norm(fs.readFileSync(path.join(__dirname, "../../schema-pg.sql"), "utf8"));
    expect(schema).toContain(norm(history.PRODUCT_HISTORY_DDL).trim());
  });

  it("skips a schema without the tables; opens existing stock as 'opening' lines; records changes after; idempotent", async () => {
    const pool = require("../../db-pg");
    const { MIGRATIONS } = require("../../migrate-pg");
    const v143 = MIGRATIONS.find((m) => m.version === 143);
    const bare = `ph_bare_${Date.now()}`;
    const shop = `ph_shop_${Date.now()}`;
    const client = await pool.getClient();
    try {
      await client.query(`CREATE SCHEMA ${bare}; CREATE SCHEMA ${shop}`);
      await client.query(`SET search_path = ${bare}`);
      await v143.up(client);
      await client.query(`SET search_path = ${shop}`);
      await client.query(`
        CREATE TABLE products (id SERIAL PRIMARY KEY, price NUMERIC(12,2), cost_price NUMERIC(12,2));
        CREATE TABLE product_variants (id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id),
          price NUMERIC(12,2), cost_price NUMERIC(12,2));
        CREATE TABLE outlet_stock (id SERIAL PRIMARY KEY, product_id INTEGER, outlet_id INTEGER, quantity NUMERIC(10,3));
        CREATE TABLE variant_outlet_stock (id SERIAL PRIMARY KEY, variant_id INTEGER, outlet_id INTEGER, quantity NUMERIC(10,3));
        INSERT INTO products (price, cost_price) VALUES (100, 50), (200, 90);
        INSERT INTO product_variants (product_id, price) VALUES (2, 210);
        INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 1, 7), (1, 2, 0), (2, 1, 3);
        INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES (1, 1, 3);`);
      await v143.up(client);
      await v143.up(client); // idempotent: no second set of opening lines
      await client.query("UPDATE outlet_stock SET quantity = 5 WHERE product_id = 1 AND outlet_id = 1");
      await client.query("UPDATE products SET price = 120 WHERE id = 1");
      const { rows } = await client.query(
        "SELECT product_id, variant_id, outlet_id, qty_change, balance_after, kind FROM stock_movements ORDER BY id");
      expect(rows.map((r) => [r.product_id, r.variant_id, r.outlet_id, num(r.qty_change), num(r.balance_after), r.kind])).toEqual([
        [1, null, 1, 7, 7, "opening"],
        [2, null, 1, 3, 3, "opening"],
        [2, 1, 1, 3, 3, "opening"],
        [1, null, 1, -2, 5, null],
      ]);
      const { rows: pc } = await client.query("SELECT product_id, field, old_value, new_value FROM price_changes");
      expect(pc.map((r) => [r.product_id, r.field, num(r.old_value), num(r.new_value)])).toEqual([[1, "price", 100, 120]]);
    } finally {
      await client.query("SET search_path = public");
      await client.query(`DROP SCHEMA IF EXISTS ${bare} CASCADE; DROP SCHEMA IF EXISTS ${shop} CASCADE`);
      client.release();
    }
  });
});

// Who and why: each main writer tags its own changes (kind, document, employee).
describe("who and why: the main writers tag their changes", () => {
  let pid;
  const lastMove = async () => one(
    `SELECT kind, ref_type, ref_id, employee_id, note, qty_change FROM stock_movements
      WHERE product_id = $1 AND variant_id IS NULL ORDER BY id DESC LIMIT 1`, [pid]);
  const lastPrice = async (field) => one(
    `SELECT kind, ref_type, ref_id, employee_id, old_value, new_value FROM price_changes
      WHERE product_id = $1 AND field = $2 ORDER BY id DESC LIMIT 1`, [pid, field]);

  beforeAll(async () => {
    await openTill(1);
    pid = await makeProduct("WhoWhy");
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 50) ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 50", [pid]);
  });

  it("new product: first price and cost tagged 'new item' by who created it", async () => {
    const id = await makeProduct("WhoNew", { stock: 4 });
    const p = await one("SELECT kind, employee_id FROM price_changes WHERE product_id = $1 AND field = 'price'", [id]);
    expect(p).toMatchObject({ kind: "new_item", employee_id: ADMIN_ID });
  });

  it("product edit: price change tagged 'edit' with the employee", async () => {
    // The PUT replaces sku/barcode/etc. when omitted (D28), so send them like the screen does.
    const cur = await one("SELECT sku, barcode FROM products WHERE id = $1", [pid]);
    expect((await admin().put(`/api/products/${pid}`).send({ price: 333, sku: cur.sku, barcode: cur.barcode })).status).toBe(200);
    expect(await lastPrice("price")).toMatchObject({ kind: "edit", employee_id: ADMIN_ID });
  });

  it("sale: tagged 'sale' with the sale id (bill no looked up), the cashier", async () => {
    const s = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID, cartItems: [{ id: pid, quantity: 2, price: 333 }],
      payments: [{ method: "Cash", amount: 666 }],
    });
    expect(s.status).toBe(200);
    expect(await lastMove()).toMatchObject({ kind: "sale", ref_type: "sale", ref_id: s.body.saleId, employee_id: ADMIN_ID });
    const res = await admin().get(`/api/products/${pid}/history/stock?outlet_id=1`);
    const inv = (await one("SELECT invoice_number FROM sales WHERE id = $1", [s.body.saleId])).invoice_number;
    expect(res.body.items[0]).toMatchObject({ kind: "sale", ref_no: inv });
    expect(res.body.items[0].employee_name).toBeTruthy();

    const v = await admin().put(`/api/sales/${s.body.saleId}/void`).send({ void_reason: "mistake" });
    expect(v.status).toBe(200);
    expect(await lastMove()).toMatchObject({ kind: "void", ref_type: "sale", ref_id: s.body.saleId, employee_id: ADMIN_ID });
  });

  it("return: tagged 'return' with the return id", async () => {
    const s = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID, cartItems: [{ id: pid, quantity: 1, price: 333 }],
      payments: [{ method: "Cash", amount: 333 }],
    });
    const r = await admin().post("/api/returns").send({
      original_sale_id: s.body.saleId, outlet_id: 1, employee_id: ADMIN_ID, total_refund: 333, refund_method: "Cash",
      items: [{ product_id: pid, quantity: 1, refund_price: 333 }],
    });
    expect(r.status).toBe(200);
    const m = await lastMove();
    expect(m).toMatchObject({ kind: "return", ref_type: "return", employee_id: ADMIN_ID });
    expect(num(m.qty_change)).toBe(1);
  });

  it("adjustment: tagged 'adjustment' with the reason", async () => {
    const r = await admin().post("/api/adjustments").send({ product_id: pid, outlet_id: 1, quantity_change: -1, reason: "Damaged" });
    expect(r.status).toBe(200);
    expect(await lastMove()).toMatchObject({ kind: "adjustment", employee_id: ADMIN_ID, note: "Damaged" });
  });

  it("transfer: both branches tagged 'transfer'", async () => {
    const r = await admin().post("/api/transfers").send({ product_id: pid, from_outlet_id: 1, to_outlet_id: 2, quantity: 2 });
    expect(r.status).toBe(200);
    const rows = await all(
      `SELECT outlet_id, qty_change, kind, employee_id FROM stock_movements
        WHERE product_id = $1 AND variant_id IS NULL ORDER BY id DESC LIMIT 2`, [pid]);
    expect(rows.map((x) => [x.outlet_id, num(x.qty_change), x.kind, x.employee_id]).sort()).toEqual(
      [[1, -2, "transfer", ADMIN_ID], [2, 2, "transfer", ADMIN_ID]].sort());
  });

  it("stock count: tagged 'count' with the count id", async () => {
    const sc = await admin().post("/api/stock-counts").send({ outlet_id: 1 });
    const id = sc.body.stockCount.id;
    const line = await one("SELECT id FROM stock_count_items WHERE stock_count_id = $1 AND product_id = $2", [id, pid]);
    expect((await admin().put(`/api/stock-counts/${id}/items/${line.id}`).send({ counted_qty: 30 })).status).toBe(200);
    expect((await admin().post(`/api/stock-counts/${id}/complete?auto_adjust=true`).send({})).status).toBe(200);
    expect(await lastMove()).toMatchObject({ kind: "count", ref_type: "stock_count", ref_id: id, employee_id: ADMIN_ID });
  });

  it("delivery: stock and the cost change both tagged 'delivery' with the GRN", async () => {
    const po = await admin().post("/api/purchase-orders").send({ supplier_id: 1, items: [{ product_id: pid, quantity: 5, cost_price: 170 }] });
    const poId = po.body.id ?? po.body.po_id ?? po.body.purchaseOrder?.id;
    await admin().post(`/api/purchase-orders/${poId}/approve`).send({});
    const g = await admin().post(`/api/purchase-orders/${poId}/receive`).send({ outlet_id: 1, items: [{ product_id: pid, qty_received: 5 }] });
    expect(g.status).toBe(200);
    const m = await lastMove();
    expect(m).toMatchObject({ kind: "delivery", ref_type: "grn", employee_id: ADMIN_ID });
    const grnNo = (await one("SELECT grn_number FROM goods_received_notes WHERE id = $1", [m.ref_id])).grn_number;
    expect(grnNo).toBeTruthy();
    const c = await lastPrice("cost_price");
    expect(c).toMatchObject({ kind: "delivery", ref_type: "grn", ref_id: m.ref_id });
    expect(num(c.new_value)).toBe(170);
  });

  it("supplier return: tagged 'supplier_return'", async () => {
    const r = await admin().post("/api/supplier-returns").send({ supplier_id: 1, outlet_id: 1, items: [{ product_id: pid, quantity: 1, unit_price: 170 }] });
    expect(r.status).toBe(200);
    expect(await lastMove()).toMatchObject({ kind: "supplier_return", employee_id: ADMIN_ID });
  });

  it("price sheet: tagged 'price_sheet'", async () => {
    const sku = (await one("SELECT sku FROM products WHERE id = $1", [pid])).sku;
    const r = await admin().post("/api/import/prices").field("rows", "[2]")
      .attach("file", Buffer.from(`sku,selling_price\n${sku},444\n`), "p.csv");
    expect(r.body).toMatchObject({ updated: 1 });
    expect(await lastPrice("price")).toMatchObject({ kind: "price_sheet", employee_id: ADMIN_ID });
  });
});
