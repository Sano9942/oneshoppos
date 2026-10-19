/**
 * ots-stock-value-summary.test.js — One Toy Store pilot G1 (PHASE-F-PLAN "Reports the owner uses").
 *
 * Stock value in one table, grouped by Supplier / Category / Brand /
 * Sub-category, like iPOS's PSP summaries: per name the toys in stock, units,
 * value at cost, value at sale price, margin % and share of the total cost.
 * Owner, 2026-10-19: one table with a "Group by" choice.
 * Category = top level, Sub-category = the level the toy sits in (live shop:
 * 14 top, 31 under them). No supplier / no brand get their own row.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const admin = () => makeRequest(app, ADMIN_ID);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const num = (v) => Number(v);
const get = (q) => admin().get(`/api/reports/stock-value-summary?${q}`);

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("DELETE FROM outlet_stock");
  const cat = async (name, parent = null) =>
    (await one("INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id", [name, parent])).id;
  const vehicles = await cat("Vehicles");
  const cars = await cat("Die-cast & Hot Wheels", vehicles);
  const rc = await cat("Remote Control Toys", vehicles);
  const soft = await cat("Soft Toys");
  const plush = await cat("Stuffed & Plush Toys", soft);
  const mattel = (await one("INSERT INTO brands (name) VALUES ('Mattel') RETURNING id")).id;
  const hafiz = (await one("INSERT INTO suppliers (name) VALUES ('HAFIZ NAWAZ') RETURNING id")).id;
  const toys = (await one("INSERT INTO suppliers (name) VALUES ('TOYS AND TOYS') RETURNING id")).id;
  const toy = async (name, price, cost, category, brand, supplier, qty) => {
    const { id } = await one(
      `INSERT INTO products (name, price, cost_price, category_id, brand_id, supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [name, price, cost, category, brand, supplier]);
    if (qty !== null) await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, $2)", [id, qty]);
  };
  // cost × units: 2,000 / 3,000 / 1,000 / 500 = 6,500 · sale: 4,000 / 5,000 / 2,000 / 1,000 = 12,000
  await toy("Hot Wheels 5-Pack", 400, 200, cars, mattel, hafiz, 10);
  await toy("RC Car", 2500, 1500, rc, null, toys, 2);
  await toy("Teddy", 1000, 500, plush, null, hafiz, 2);
  await toy("Bunny", 500, 250, plush, mattel, null, 2);
  await toy("Sold-out car", 400, 200, cars, mattel, hafiz, 0); // no units: not counted
  await toy("Never stocked", 400, 200, cars, mattel, hafiz, null);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, {
  toys: num(r.toys), units: num(r.units), cost_value: num(r.cost_value), retail_value: num(r.retail_value),
}]));

describe("G1 — stock value summary", () => {
  it("by supplier, with a No supplier row, biggest cost first", async () => {
    const res = await get("group_by=supplier");
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.name)).toEqual(["HAFIZ NAWAZ", "TOYS AND TOYS", "No supplier"]);
    expect(byName(res.body.rows)).toEqual({
      "HAFIZ NAWAZ": { toys: 2, units: 12, cost_value: 3000, retail_value: 6000 },
      "TOYS AND TOYS": { toys: 1, units: 2, cost_value: 3000, retail_value: 5000 },
      "No supplier": { toys: 1, units: 2, cost_value: 500, retail_value: 1000 },
    });
  });

  it("totals match the whole shop, with margin % and share of cost", async () => {
    const res = await get("group_by=supplier");
    expect(res.body.totals).toEqual({ toys: 4, units: 16, cost_value: 6500, retail_value: 12000, margin_pct: 45.83 });
    const h = res.body.rows.find((r) => r.name === "HAFIZ NAWAZ");
    expect(num(h.margin_pct)).toBe(50); // (6,000 − 3,000) / 6,000
    expect(num(h.share_pct)).toBe(46.15); // 3,000 / 6,500
  });

  it("by category = the top level", async () => {
    const res = await get("group_by=category");
    expect(byName(res.body.rows)).toEqual({
      Vehicles: { toys: 2, units: 12, cost_value: 5000, retail_value: 9000 },
      "Soft Toys": { toys: 2, units: 4, cost_value: 1500, retail_value: 3000 },
    });
  });

  it("by sub-category = the toy's own category, showing its parent", async () => {
    const res = await get("group_by=subcategory");
    expect(byName(res.body.rows)).toEqual({
      "Remote Control Toys": { toys: 1, units: 2, cost_value: 3000, retail_value: 5000 },
      "Die-cast & Hot Wheels": { toys: 1, units: 10, cost_value: 2000, retail_value: 4000 },
      "Stuffed & Plush Toys": { toys: 2, units: 4, cost_value: 1500, retail_value: 3000 },
    });
    expect(res.body.rows.find((r) => r.name === "Remote Control Toys").parent).toBe("Vehicles");
  });

  it("by brand, with a No brand row", async () => {
    const res = await get("group_by=brand");
    expect(byName(res.body.rows)).toEqual({
      "No brand": { toys: 2, units: 4, cost_value: 4000, retail_value: 7000 }, // RC Car + Teddy
      Mattel: { toys: 2, units: 12, cost_value: 2500, retail_value: 5000 },
    });
  });

  it("can be limited to one branch", async () => {
    const res = await get("group_by=supplier&outlet_id=2");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.totals.units).toBe(0);
  });

  it("refuses an unknown grouping", async () => {
    expect((await get("group_by=colour")).status).toBe(400);
  });

  it("needs the inventory reports permission", async () => {
    const res = await makeRequest(app, 999999).get("/api/reports/stock-value-summary?group_by=supplier");
    expect([401, 403]).toContain(res.status);
  });
});
