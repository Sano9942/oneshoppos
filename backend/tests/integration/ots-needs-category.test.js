/**
 * ots-needs-category.test.js — One Toy Store pilot, "Needs a Category" fix-it list
 * (PHASE-F-PLAN "Reports the owner uses": sold items imported without a category).
 *
 * The iPOS import put toys it had no category for into the sub-category
 * "Other → Needs a Category" (live: 694 toys, 302 in stock, 8 sold). Owner,
 * 2026-10-19:
 *   - a screen to fix them (pick a category per row, or tick many);
 *   - lists toys that sold or are in stock: sold first (biggest sale less
 *     returns first), then in stock (biggest stock value at cost first);
 *     the rest only with "show all";
 *   - a suggestion from the supplier: when most of the same supplier's other
 *     toys share one category, offer it (nothing changes until clicked);
 *   - a dashboard reminder with the count while any are left.
 * Saving goes through the existing POST /api/products/bulk-category.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const CASHIER = 3; // seeded with view_sales_reports only — no manage_inventory
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const ids = {};
let needs, cycles, dolls, other;

async function toy(key, { category, supplier = null, price = 1000, cost = 500, stock = null }) {
  const id = (await one(
    "INSERT INTO products (name, sku, price, cost_price, gst, tax_id, category_id, supplier_id) VALUES ($1, $2, $3, $4, 0, NULL, $5, $6) RETURNING id",
    [key, `SKU-${key}`, price, cost, category, supplier])).id;
  if (stock !== null) await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, $2)", [id, stock]);
  ids[key] = id;
  return id;
}

async function sell(productId, qty, price, { voided = false } = {}) {
  const s = await one(
    "INSERT INTO sales (total_amount, payment_method, outlet_id, voided) VALUES ($1, 'Cash', 1, $2) RETURNING id",
    [qty * price, voided]);
  await db.query(
    "INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale) VALUES ($1, $2, $3, $4, 0)",
    [s.id, productId, qty, price]);
  return s.id;
}

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("TRUNCATE sales, returns RESTART IDENTITY CASCADE");
  await db.query("DELETE FROM outlet_stock");
  const cat = async (name, parent = null) =>
    (await one("INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id", [name, parent])).id;
  other = await cat("Other NC");
  needs = await cat("Needs a Category", other);
  const ride = await cat("Ride-ons NC");
  cycles = await cat("Cycles NC", ride);
  dolls = await cat("Dolls NC");

  const rehmat = (await one("INSERT INTO suppliers (name) VALUES ('REHMAT SPORTS NC') RETURNING id")).id;
  const mixed = (await one("INSERT INTO suppliers (name) VALUES ('MIXED NC') RETURNING id")).id;

  // Rehmat's categorised toys: 3 cycles + 1 doll → suggest Cycles (3 of 4).
  await toy("R-cycle-1", { category: cycles, supplier: rehmat });
  await toy("R-cycle-2", { category: cycles, supplier: rehmat });
  await toy("R-cycle-3", { category: cycles, supplier: rehmat });
  await toy("R-doll", { category: dolls, supplier: rehmat });
  // Mixed supplier: 1 cycle + 1 doll → no clear suggestion.
  await toy("M-cycle", { category: cycles, supplier: mixed });
  await toy("M-doll", { category: dolls, supplier: mixed });

  // Needs a Category toys.
  await toy("Sold big", { category: needs, supplier: rehmat, stock: 1 });   // 2 × 5,000 less 1 returned
  await toy("Sold small", { category: needs, supplier: mixed, stock: 0 });  // 1 × 6,000
  await toy("Stock big", { category: needs, cost: 900, stock: 10 });        // 9,000 at cost
  await toy("Stock small", { category: needs, cost: 100, stock: 5 });       // 500 at cost
  await toy("No stock unsold", { category: needs, stock: 0 });
  await toy("No category at all", { category: null, stock: 2 });
  await toy("Only voided", { category: needs });
  await toy("Fine toy", { category: cycles, stock: 50 });

  const big = await sell(ids["Sold big"], 2, 5000);
  await sell(ids["Sold small"], 1, 6000);
  await sell(ids["Only voided"], 1, 99999, { voided: true });
  const r = await one(
    "INSERT INTO returns (original_sale_id, outlet_id, total_refund, refund_method) VALUES ($1, 1, 5000, 'Cash') RETURNING id", [big]);
  await db.query(
    "INSERT INTO return_items (return_id, product_id, quantity, refund_price, restock_flag) VALUES ($1, $2, 1, 5000, true)",
    [r.id, ids["Sold big"]]);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const list = async (q = "") => {
  const res = await makeRequest(app, ADMIN_ID).get(`/api/products/needs-category${q}`);
  expect(res.status).toBe(200);
  return res.body;
};

describe("Needs a Category — the list", () => {
  it("sold toys first by sale less returns, then in-stock by stock value; nothing else", async () => {
    const d = await list();
    expect(d.rows.map((r) => r.name)).toEqual(["Sold small", "Sold big", "Stock big", "No category at all", "Stock small"]);
  });

  it("each row has codes, supplier, stock, value, sales and its current category", async () => {
    const d = await list();
    const big = d.rows.find((r) => r.name === "Sold big");
    expect(big).toMatchObject({
      id: ids["Sold big"], sku: "SKU-Sold big", supplier_name: "REHMAT SPORTS NC",
      stock: 1, cost_value: 500, units_sold: 2, sold_amount: 5000, category_name: "Needs a Category",
    });
    expect(big.last_sold).toBeTruthy();
    const stock = d.rows.find((r) => r.name === "Stock big");
    expect(stock).toMatchObject({ stock: 10, cost_value: 9000, units_sold: 0, sold_amount: 0, last_sold: null });
    expect(d.rows.find((r) => r.name === "No category at all").category_name).toBeNull();
  });

  it("counts the listed toys and all of them", async () => {
    const d = await list();
    expect(d.counts).toEqual({ listed: 5, all: 7 });
  });

  it("show all adds the toys with no stock and no sale, after the rest", async () => {
    const d = await list("?all=1");
    expect(d.rows).toHaveLength(7);
    expect(d.rows.slice(5).map((r) => r.name).sort()).toEqual(["No stock unsold", "Only voided"]);
  });

  it("suggests the supplier's usual category only when it is a clear majority", async () => {
    const d = await list();
    const big = d.rows.find((r) => r.name === "Sold big");
    expect(big.suggestion).toMatchObject({ category_id: cycles, count: 3, of: 4 });
    expect(big.suggestion.path_label).toContain("Cycles NC");
    expect(d.rows.find((r) => r.name === "Sold small").suggestion).toBeNull(); // 1 of 2: not clear
    expect(d.rows.find((r) => r.name === "Stock big").suggestion).toBeNull(); // no supplier
  });

  it("the dashboard count is the listed number", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/products/needs-category/count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 5 });
  });

  it("needs the manage-inventory permission", async () => {
    expect((await makeRequest(app, CASHIER).get("/api/products/needs-category")).status).toBe(403);
    expect((await makeRequest(app, CASHIER).get("/api/products/needs-category/count")).status).toBe(403);
  });
});

describe("Needs a Category — fixing", () => {
  it("a toy given a category through bulk-category leaves the list", async () => {
    const res = await makeRequest(app, ADMIN_ID).post("/api/products/bulk-category")
      .send({ ids: [ids["Sold big"], ids["Stock small"]], category_id: cycles });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const d = await list();
    expect(d.rows.map((r) => r.name)).toEqual(["Sold small", "Stock big", "No category at all"]);
    expect(d.counts).toEqual({ listed: 3, all: 5 });
  });
});
